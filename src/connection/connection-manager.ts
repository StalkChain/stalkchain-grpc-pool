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
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  // private lastHealthCheck: number = 0; // Unused for now
  private consecutiveFailures: number = 0;
  private lastSuccessTime: number = 0;
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
      consecutiveFailures: this.consecutiveFailures
    };
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
    
    if (this.client) {
      // Note: yellowstone-grpc client doesn't have a close method
      // The connection will be cleaned up automatically
      this.client = null;
    }
    
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
      
      this.emit('connection-lost', this.config.endpoint, error as Error);
      
      if (this.reconnectAttempts < this.config.reconnectAttempts) {
        this.scheduleReconnect();
      } else {
        this.logger?.error(`Max reconnection attempts reached for ${this.config.endpoint}`);
      }
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
      
      if (this.consecutiveFailures >= 3) {
        this.logger?.error(`Connection to ${this.config.endpoint} appears to be stale`);
        this.state = ConnectionState.FAILED;
        this.emit('connection-lost', this.config.endpoint, error as Error);
        
        // Attempt to reconnect
        if (this.client) {
          // Note: yellowstone-grpc client doesn't have a close method
          // The connection will be cleaned up automatically
          this.client = null;
        }
        
        this.scheduleReconnect();
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
}
