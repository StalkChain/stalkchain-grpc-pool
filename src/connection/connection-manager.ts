import Client from '@triton-one/yellowstone-grpc';
import { EventEmitter } from 'eventemitter3';
import {
  ConnectionConfig,
  ConnectionState,
  HealthMetrics,
  Logger,
  PoolEvents
} from '../types';

/**
 * Manages a single gRPC connection with health monitoring and automatic reconnection
 */
export class ConnectionManager extends EventEmitter<PoolEvents> {
  private client: Client | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  // private lastHealthCheck: number = 0; // Unused for now
  private consecutiveFailures: number = 0;
  private lastSuccessTime: number = 0;
  private lastMessageTime: number = 0;
  private currentLatency: number = 0;
  private errorRate: number = 0;
  private requestCount: number = 0;
  private errorCount: number = 0;

  constructor(
    private config: ConnectionConfig,
    private logger?: Logger
  ) {
    super();
  }

  /**
   * Get connection identifier
   */
  public get id(): string {
    return this.config.endpoint;
  }

  /**
   * Get connection configuration
   */
  public get connectionConfig(): ConnectionConfig {
    return this.config;
  }

  /**
   * Get current connection state
   */
  public get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connection is healthy
   */
  public get isHealthy(): boolean {
    return this.state === ConnectionState.CONNECTED && 
           this.consecutiveFailures === 0 &&
           (Date.now() - this.lastSuccessTime) < (this.config.healthCheckInterval * 2);
  }

  /**
   * Get current health metrics
   */
  public getHealthMetrics(): HealthMetrics {
    return {
      endpoint: this.config.endpoint,
      isHealthy: this.isHealthy,
      latency: this.currentLatency,
      errorRate: this.errorRate,
      lastSuccessTime: this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures,
      lastMessageTime: this.lastMessageTime
    };
  }

  /**
   * Update the last message received time
   * This should be called whenever a message is received from this connection
   */
  public updateLastMessageTime(): void {
    this.lastMessageTime = Date.now();
  }

  /**
   * Check if the connection is stale based on message timeout
   * @param messageTimeout Timeout in milliseconds
   * @returns true if connection is stale (no messages received within timeout)
   */
  public isStaleByMessageTimeout(messageTimeout: number): boolean {
    if (this.lastMessageTime === 0) {
      // No messages received yet, check against connection time
      return Date.now() - this.lastSuccessTime > messageTimeout;
    }

    return Date.now() - this.lastMessageTime > messageTimeout;
  }

  /**
   * Start the connection
   */
  public async start(): Promise<void> {
    if (this.state !== ConnectionState.DISCONNECTED) {
      return;
    }

    this.logger?.info(`Starting connection to ${this.config.endpoint}`);
    await this.connect();
    this.startHealthChecks();
  }

  /**
   * Stop the connection
   */
  public async stop(): Promise<void> {
    this.logger?.info(`Stopping connection to ${this.config.endpoint}`);

    this.stopHealthChecks();
    this.stopReconnectTimer();

    // Properly close the gRPC client connection
    this.nullifyClient();

    this.state = ConnectionState.DISCONNECTED;
  }

  /**
   * Get the gRPC client
   */
  public getClient(): Client | null {
    return this.client;
  }

  /**
   * Test connection with ping
   */
  public async ping(): Promise<number> {
    if (!this.client || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Connection not available');
    }

    return this.internalPing();
  }

  /**
   * Force reconnection of this connection
   * This is used when the pool manager detects the connection is stale
   */
  public async forceReconnect(reason: string): Promise<void> {
    this.logger?.warn(`Forcing reconnection for ${this.config.endpoint}: ${reason}`);

    // Mark connection as failed
    this.state = ConnectionState.FAILED;
    this.consecutiveFailures = 3; // Set to threshold to trigger reconnection logic

    // Properly close the gRPC client connection
    this.nullifyClient();

    // DO NOT emit connection-lost event here to avoid infinite loop
    // The pool manager already knows about the failure and called this method
    // Emitting another connection-lost event would trigger handleConnectionFailure again

    // Schedule reconnection
    this.scheduleReconnect();
  }

  /**
   * Internal ping method that doesn't check connection state
   */
  private async internalPing(): Promise<number> {
    if (!this.client) {
      throw new Error('Client not available');
    }

    const startTime = Date.now();

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Ping timeout'));
        }, this.config.requestTimeout);
      });

      // Race between ping and timeout
      await Promise.race([
        this.client.ping(Date.now()),
        timeoutPromise
      ]);

      const latency = Date.now() - startTime;
      this.updateSuccessMetrics(latency);
      return latency;
    } catch (error) {
      this.updateErrorMetrics();
      throw error;
    }
  }

  /**
   * Establish connection to gRPC endpoint
   */
  private async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTING) {
      return;
    }

    this.state = ConnectionState.CONNECTING;

    // Clean up any existing client before creating new one
    this.nullifyClient();

    try {
      const grpcOptions = {
        'grpc.max_receive_message_length': 64 * 1024 * 1024,
        'grpc.keepalive_time_ms': 30000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.max_reconnect_backoff_ms': 10000,
        ...this.config.grpcOptions
      };

      this.client = new Client(
        this.config.endpoint,
        this.config.token,
        grpcOptions
      );

      // Test connection with ping
      await this.internalPing();
      
      this.state = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;
      this.lastSuccessTime = Date.now();
      
      this.logger?.info(`Connected to ${this.config.endpoint}`);
      this.emit('connection-established', this.config.endpoint);
      
    } catch (error) {
      this.logger?.error(`Failed to connect to ${this.config.endpoint}: ${error}`);
      this.state = ConnectionState.FAILED;
      this.consecutiveFailures++;

      // Immediately close and null the client on failure
      this.nullifyClient();

      this.emit('connection-lost', this.config.endpoint, error as Error);

      // For initial connection failures, schedule reconnect directly since there are no active streams to cancel
      // For established connections that fail health checks, the pool manager handles reconnection after stream cleanup
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.logger?.info(`Scheduling reconnect to ${this.config.endpoint} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.state = ConnectionState.RECONNECTING;
      await this.connect();
    }, delay);
  }

  /**
   * Stop reconnection timer
   */
  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start health check monitoring
   */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health check monitoring
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    if (this.state !== ConnectionState.CONNECTED) {
      return;
    }

    // Skip ping health checks if noPing is enabled for this connection
    if (this.config.noPing) {
      this.logger?.debug(`Skipping ping health check for ${this.config.endpoint} (noPing: true)`);

      // For noPing connections, we only rely on message timeout detection
      // Reset consecutive failures since we're not actually checking ping
      if (this.consecutiveFailures > 0) {
        this.logger?.debug(`Resetting consecutive failures for noPing connection ${this.config.endpoint}`);
        this.consecutiveFailures = 0;
        this.emit('connection-recovered', this.config.endpoint);
      }

      // Update last success time to indicate the connection is being monitored
      this.lastSuccessTime = Date.now();
      return;
    }

    try {
      await this.ping();

      if (this.consecutiveFailures > 0) {
        this.logger?.info(`Connection to ${this.config.endpoint} recovered`);
        this.emit('connection-recovered', this.config.endpoint);
        this.consecutiveFailures = 0;
      }

    } catch (error) {
      this.consecutiveFailures++;
      this.logger?.warn(`Health check failed for ${this.config.endpoint}: ${error}`);

      // For production reliability, we'll be more aggressive with reconnection
      // but still allow a few failures before considering the connection stale
      if (this.consecutiveFailures >= 3) {
        this.logger?.error(`Connection to ${this.config.endpoint} appears to be stale`);
        this.state = ConnectionState.FAILED;

        // Properly close the gRPC client connection
        this.nullifyClient();

        // Emit connection-lost event to let the pool manager handle proper stream cancellation and reconnection
        // The pool manager will call forceReconnect() which will handle the reconnection scheduling
        this.emit('connection-lost', this.config.endpoint, error as Error);
      } else {
        // Even with fewer failures, log a warning but don't mark as failed yet
        this.logger?.warn(`Health check failed (${this.consecutiveFailures}/3) for ${this.config.endpoint}`);
      }
    }
    
    // this.lastHealthCheck = Date.now(); // Unused for now
    this.emit('health-check', [this.getHealthMetrics()]);
  }

  /**
   * Update success metrics
   */
  private updateSuccessMetrics(latency: number): void {
    this.requestCount++;
    this.currentLatency = latency;
    this.lastSuccessTime = Date.now();
    this.errorRate = this.errorCount / this.requestCount;
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(): void {
    this.requestCount++;
    this.errorCount++;
    this.errorRate = this.errorCount / this.requestCount;
  }

  /**
   * Properly close the gRPC client connection before nullifying the reference
   * This prevents connection accumulation by ensuring the underlying connection is closed
   */
  private nullifyClient(): void {
    if (this.client) {
      this.logger?.debug(`Closing and nullifying gRPC client for ${this.config.endpoint}`);

      try {
        // Access the underlying gRPC client and close it to prevent resource leaks
        // The Yellowstone Client wraps the actual gRPC client in _client property
        if ((this.client as any)._client && typeof (this.client as any)._client.close === 'function') {
          (this.client as any)._client.close();
        }
      } catch (error) {
        this.logger?.warn(`Error closing gRPC client for ${this.config.endpoint}: ${error}`);
      }

      this.client = null;
    }
  }
}
