import { EventEmitter } from 'eventemitter3';
import { SubscribeRequest } from '@triton-one/yellowstone-grpc';
import { ConnectionManager } from '../connection/connection-manager';
import { DeduplicationEngine } from '../deduplication/deduplication-engine';
import { CircuitBreaker } from '../circuit-breaker/circuit-breaker';
import { MetricsCollector } from '../metrics/metrics-collector';
import {
  PoolConfig,
  HealthMetrics,
  Logger,
  PoolEvents,
  IPool,
  ProcessedMessage,
  Transaction
} from '../types';

/**
 * Main pool manager that coordinates multiple gRPC connections
 * with active-active configuration, deduplication, and failover
 */
export class PoolManager extends EventEmitter<PoolEvents> implements IPool {
  private connections: Map<string, ConnectionManager> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private deduplicationEngine: DeduplicationEngine;
  private metricsCollector: MetricsCollector;
  private isStarted: boolean = false;
  private activeStreams: Map<string, AsyncIterable<unknown>> = new Map();
  private streamProcessors: Map<string, Promise<void>> = new Map();
  private streamRetryAttempts: Map<string, number> = new Map();
  private streamRetryTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeSubscriptionRequest: any = null;

  constructor(
    private config: PoolConfig,
    private logger?: Logger
  ) {
    super();
    
    this.deduplicationEngine = new DeduplicationEngine(
      this.config.deduplicationWindow,
      this.config.maxCacheSize,
      this.logger
    );
    
    this.metricsCollector = new MetricsCollector(this.config.enableMetrics);
    
    this.initializeConnections();
    this.setupEventHandlers();
  }

  /**
   * Start the pool and all connections
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.logger?.info('Starting gRPC pool...');
    
    // Start all connections in parallel
    const startPromises = Array.from(this.connections.values()).map(
      connection => connection.start()
    );
    
    await Promise.allSettled(startPromises);
    
    this.isStarted = true;
    this.logger?.info('gRPC pool started successfully');
  }

  /**
   * Stop the pool and all connections
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger?.info('Stopping gRPC pool...');

    // Clear retry timers
    for (const [endpoint, timer] of this.streamRetryTimers) {
      clearTimeout(timer);
      this.logger?.debug(`Cleared retry timer for ${endpoint}`);
    }
    this.streamRetryTimers.clear();

    // Stop all stream processors
    for (const [endpoint] of this.streamProcessors) {
      try {
        // Cancel the processor (this will depend on implementation)
        this.logger?.debug(`Stopping stream processor for ${endpoint}`);
      } catch (error) {
        this.logger?.warn(`Error stopping stream processor for ${endpoint}: ${error}`);
      }
    }

    this.streamProcessors.clear();
    this.activeStreams.clear();
    this.streamRetryAttempts.clear();
    this.activeSubscriptionRequest = null;

    // Stop all connections
    const stopPromises = Array.from(this.connections.values()).map(
      connection => connection.stop()
    );

    await Promise.allSettled(stopPromises);

    this.isStarted = false;
    this.logger?.info('gRPC pool stopped');
  }

  /**
   * Subscribe to gRPC streams from all healthy connections
   */
  public async subscribe(request: SubscribeRequest): Promise<void> {
    if (!this.isStarted) {
      throw new Error('Pool is not started');
    }

    // Store the subscription request for retries
    this.activeSubscriptionRequest = request;

    this.logger?.info('Starting subscription to all healthy connections');

    const healthyConnections = this.getHealthyConnections();

    if (healthyConnections.length === 0) {
      throw new Error('No healthy connections available');
    }

    // Start streaming from all healthy connections
    for (const connection of healthyConnections) {
      await this.startStreamForConnection(connection, request);
    }
  }

  /**
   * Get current health status of all connections
   */
  public getHealthStatus(): HealthMetrics[] {
    return Array.from(this.connections.values()).map(
      connection => connection.getHealthMetrics()
    );
  }

  /**
   * Get pool metrics
   */
  public getMetrics(): Record<string, number> {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Check if pool is running
   */
  public isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Get healthy connections
   */
  private getHealthyConnections(): ConnectionManager[] {
    return Array.from(this.connections.values()).filter(
      connection => connection.isHealthy
    );
  }

  /**
   * Initialize all connections from config
   */
  private initializeConnections(): void {
    for (const connectionConfig of this.config.connections) {
      const connection = new ConnectionManager(connectionConfig, this.logger);
      const circuitBreaker = new CircuitBreaker(this.config.circuitBreaker, this.logger);
      
      this.connections.set(connectionConfig.endpoint, connection);
      this.circuitBreakers.set(connectionConfig.endpoint, circuitBreaker);
      
      this.logger?.debug(`Initialized connection for ${connectionConfig.endpoint}`);
    }
  }

  /**
   * Setup event handlers for connections
   */
  private setupEventHandlers(): void {
    for (const connection of this.connections.values()) {
      // Forward connection events
      connection.on('connection-established', (ep) => {
        this.emit('connection-established', ep);
        this.metricsCollector.incrementCounter('connections_established');
      });
      
      connection.on('connection-lost', (ep, error) => {
        this.emit('connection-lost', ep, error);
        this.metricsCollector.incrementCounter('connections_lost');
        
        // Try to failover to other healthy connections
        this.handleConnectionFailure(ep);
      });
      
      connection.on('connection-recovered', (ep) => {
        this.emit('connection-recovered', ep);
        this.metricsCollector.incrementCounter('connections_recovered');
      });
      
      connection.on('health-check', (metrics) => {
        this.emit('health-check', metrics);
        this.updateHealthMetrics(metrics);
      });
    }
  }

  /**
   * Start streaming for a specific connection
   */
  private async startStreamForConnection(
    connection: ConnectionManager,
    request: SubscribeRequest
  ): Promise<void> {
    const endpoint = connection.id;
    const client = connection.getClient();

    if (!client) {
      this.logger?.warn(`No client available for ${endpoint}`);
      return;
    }

    try {
      const circuitBreaker = this.circuitBreakers.get(endpoint);
      if (!circuitBreaker) {
        throw new Error(`No circuit breaker found for ${endpoint}`);
      }

      // Execute subscription through circuit breaker
      const stream = await circuitBreaker.execute(async () => {
        const grpcStream = await client.subscribe();

        // Send the subscription request to the stream
        grpcStream.write(request);

        return grpcStream;
      });

      this.activeStreams.set(endpoint, stream);

      // Reset retry attempts on successful stream start
      this.streamRetryAttempts.delete(endpoint);

      // Clear any existing retry timer
      const existingTimer = this.streamRetryTimers.get(endpoint);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.streamRetryTimers.delete(endpoint);
      }

      // Start processing the stream with proper error handling
      const processor = this.processStreamWithRetry(endpoint, stream, request);
      this.streamProcessors.set(endpoint, processor);

      this.logger?.info(`Started stream for ${endpoint}`);

    } catch (error) {
      this.logger?.error(`Failed to start stream for ${endpoint}: ${error}`);
      this.emit('error', error as Error, `stream-start-${endpoint}`);

      // Schedule retry for failed stream start
      this.scheduleStreamRetry(endpoint, request);
    }
  }

  /**
   * Process messages from a stream with automatic retry on failure
   */
  private async processStreamWithRetry(
    endpoint: string,
    stream: any,
    request: SubscribeRequest
  ): Promise<void> {
    try {
      await this.processStream(endpoint, stream);
    } catch (error) {
      // Stream failed, schedule retry
      this.logger?.warn(`Stream failed for ${endpoint}, scheduling retry: ${error}`);
      this.scheduleStreamRetry(endpoint, request);
    }
  }

  /**
   * Process messages from a stream
   */
  private async processStream(
    endpoint: string,
    stream: any
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Handle data events
      stream.on('data', async (message: unknown) => {
        try {
          await this.processMessage(endpoint, message);
        } catch (error) {
          this.logger?.error(`Message processing error for ${endpoint}: ${error}`);
        }
      });

      // Handle stream errors
      stream.on('error', (error: Error) => {
        this.logger?.error(`Stream processing error for ${endpoint}: ${error}`);
        this.emit('error', error, `stream-processing-${endpoint}`);

        // Remove failed stream
        this.activeStreams.delete(endpoint);
        this.streamProcessors.delete(endpoint);

        reject(error);
      });

      // Handle stream end
      stream.on('end', () => {
        this.logger?.info(`Stream ended for ${endpoint}`);
        this.activeStreams.delete(endpoint);
        this.streamProcessors.delete(endpoint);
        resolve();
      });

      // Handle stream close
      stream.on('close', () => {
        this.logger?.info(`Stream closed for ${endpoint}`);
        this.activeStreams.delete(endpoint);
        this.streamProcessors.delete(endpoint);
        resolve();
      });
    });
  }

  /**
   * Process a single message from stream
   */
  private async processMessage(endpoint: string, rawMessage: unknown): Promise<void> {
    try {
      const message = this.parseMessage(rawMessage, endpoint);
      
      if (!message) {
        return;
      }

      // Check for duplicates
      const isDuplicate = this.deduplicationEngine.isDuplicate(message);
      
      if (isDuplicate) {
        // Convert signature to string for event emission
        const signatureStr = Buffer.isBuffer(message.signature)
          ? message.signature.toString('base64')
          : (message.signature || 'unknown');
        this.emit('message-deduplicated', signatureStr, endpoint);
        this.metricsCollector.incrementCounter('messages_deduplicated');
        return;
      }

      // Process unique message
      const processedMessage: ProcessedMessage = {
        type: 'transaction',
        data: message,
        source: endpoint,
        timestamp: Date.now(),
        isDuplicate: false
      };

      this.emit('message-processed', processedMessage);
      this.metricsCollector.incrementCounter('messages_processed');
      
    } catch (error) {
      this.logger?.error(`Error processing message from ${endpoint}: ${error}`);
      this.metricsCollector.incrementCounter('message_processing_errors');
    }
  }

  /**
   * Parse raw message into structured format
   */
  private parseMessage(rawMessage: unknown, source: string): Transaction | null {
    // Parse Yellowstone gRPC message format - keep signature as buffer for efficient deduplication

    try {
      const message = rawMessage as any;

      if (message.transaction && message.transaction.transaction) {
        const tx = message.transaction.transaction;

        // Keep signature as raw buffer for efficient deduplication
        const signature = tx.signature || Buffer.from('unknown');

        return {
          signature, // Raw buffer - more efficient for deduplication
          slot: message.transaction.slot || 0,
          accountKeys: tx.transaction?.accountKeys || [],
          instructions: tx.transaction?.instructions || [],
          timestamp: Date.now(),
          source,
          raw: rawMessage
        };
      }

      return null;
    } catch (error) {
      this.logger?.warn(`Failed to parse message from ${source}: ${error}`);
      return null;
    }
  }

  /**
   * Schedule retry for a failed stream
   */
  private scheduleStreamRetry(endpoint: string, request: SubscribeRequest): void {
    if (!this.isStarted || !this.activeSubscriptionRequest) {
      return;
    }

    // Clear any existing retry timer
    const existingTimer = this.streamRetryTimers.get(endpoint);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Get current retry attempts
    const currentAttempts = this.streamRetryAttempts.get(endpoint) || 0;
    const maxRetries = 10; // Maximum retry attempts

    if (currentAttempts >= maxRetries) {
      this.logger?.error(`Max retry attempts (${maxRetries}) reached for stream ${endpoint}, giving up`);
      this.streamRetryAttempts.delete(endpoint);
      return;
    }

    // Calculate exponential backoff delay (1s, 2s, 4s, 8s, 16s, 30s max)
    const baseDelay = 1000;
    const delay = Math.min(baseDelay * Math.pow(2, currentAttempts), 30000);

    this.logger?.info(`Scheduling stream retry for ${endpoint} in ${delay}ms (attempt ${currentAttempts + 1}/${maxRetries})`);

    const timer = setTimeout(async () => {
      this.streamRetryTimers.delete(endpoint);

      // Increment retry attempts
      this.streamRetryAttempts.set(endpoint, currentAttempts + 1);

      // Find the connection for this endpoint
      const connection = this.connections.get(endpoint);
      if (connection && connection.isHealthy) {
        this.logger?.info(`Retrying stream for ${endpoint} (attempt ${currentAttempts + 1})`);
        await this.startStreamForConnection(connection, request);
      } else {
        this.logger?.warn(`Connection ${endpoint} is not healthy, skipping retry`);
        // Schedule another retry
        this.scheduleStreamRetry(endpoint, request);
      }
    }, delay);

    this.streamRetryTimers.set(endpoint, timer);
  }

  /**
   * Handle connection failure and attempt failover
   */
  private handleConnectionFailure(failedEndpoint: string): void {
    this.logger?.warn(`Handling connection failure for ${failedEndpoint}`);

    const healthyConnections = this.getHealthyConnections();

    if (healthyConnections.length === 0) {
      this.logger?.error('No healthy connections available for failover');
      this.emit('error', new Error('All connections failed'), 'failover');
      return;
    }

    this.emit('failover', failedEndpoint, healthyConnections[0]!.id, 'connection-failure');
    this.metricsCollector.incrementCounter('failover_events');
  }

  /**
   * Update health metrics
   */
  private updateHealthMetrics(metrics: HealthMetrics[]): void {
    for (const metric of metrics) {
      this.metricsCollector.setGauge(`connection_health_${metric.endpoint}`, metric.isHealthy ? 1 : 0);
      this.metricsCollector.setGauge(`connection_latency_${metric.endpoint}`, metric.latency);
      this.metricsCollector.setGauge(`connection_error_rate_${metric.endpoint}`, metric.errorRate);
    }
  }
}
