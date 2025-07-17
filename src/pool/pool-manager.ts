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
  private activeStreams: Map<string, any> = new Map(); // Store actual stream objects for cancellation
  private streamProcessors: Map<string, Promise<void>> = new Map();
  private streamRetryAttempts: Map<string, number> = new Map();
  private streamRetryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastErrorTypes: Map<string, string> = new Map();
  private shutdownHandlersRegistered: boolean = false;
  private activeSubscriptionRequest: any = null;
  private messageTimeoutTimer: ReturnType<typeof setInterval> | null = null;
  private messageTimeoutCheckInterval: number = 30000; // Check every 30 seconds by default
  private streamPingTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private streamPingSequence: Map<string, number> = new Map();
  private pendingPongs: Map<string, Set<number>> = new Map();
  private missedPongCounts: Map<string, number> = new Map();

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

    // Register graceful shutdown handlers
    this.registerShutdownHandlers();

    // Start all connections in parallel
    const startPromises = Array.from(this.connections.values()).map(
      connection => connection.start()
    );

    await Promise.allSettled(startPromises);

    // Start message timeout monitoring if configured
    if (this.config.messageTimeout) {
      this.startMessageTimeoutMonitoring();
    }

    this.isStarted = true;
    this.logger?.info('gRPC pool started successfully');
  }

  /**
   * Stop the pool and all connections with graceful shutdown
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger?.info('Stopping gRPC pool with graceful shutdown...');

    // Clear retry timers
    for (const [endpoint, timer] of this.streamRetryTimers) {
      clearTimeout(timer);
      this.logger?.debug(`Cleared retry timer for ${endpoint}`);
    }
    this.streamRetryTimers.clear();

    // Cancel all active streams properly using the centralized method
    const activeEndpoints = Array.from(this.activeStreams.keys());
    if (activeEndpoints.length > 0) {
      this.logger?.info(`Cancelling ${activeEndpoints.length} active streams for graceful shutdown...`);

      const streamCancelPromises = activeEndpoints.map(endpoint =>
        this.cancelStreamForEndpoint(endpoint, 'Graceful shutdown')
      );

      // Wait for all streams to be properly cancelled with a timeout
      await Promise.race([
        Promise.all(streamCancelPromises),
        new Promise(resolve => setTimeout(resolve, 8000)) // 8 second timeout (longer for shutdown)
      ]);
    }

    // Clear any remaining tracking data
    this.streamProcessors.clear();
    this.activeStreams.clear();
    this.streamRetryAttempts.clear();
    this.activeSubscriptionRequest = null;

    // Stop message timeout monitoring
    this.stopMessageTimeoutMonitoring();

    // Stop all stream ping timers
    for (const [endpoint] of this.streamPingTimers) {
      this.stopStreamPing(endpoint);
    }

    // Stop all connections
    const stopPromises = Array.from(this.connections.values()).map(
      connection => connection.stop()
    );

    await Promise.allSettled(stopPromises);

    this.isStarted = false;
    this.logger?.info('gRPC pool stopped successfully');
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

        // Try to failover to other healthy connections (async, but don't await)
        this.handleConnectionFailure(ep).catch((err) => {
          this.logger?.error(`Error handling connection failure for ${ep}: ${err}`);
        });
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

      // Check if a stream already exists and close it before creating a new one
      if (this.activeStreams.has(endpoint)) {
        this.logger?.info(`Existing stream found for ${endpoint}, closing it before creating new stream`);
        await this.cancelStreamForEndpoint(endpoint, 'Replacing with new stream');
      }

      // Execute subscription through circuit breaker
      const stream = await circuitBreaker.execute(async () => {
        const grpcStream = await client.subscribe();

        // Send the subscription request to the stream
        grpcStream.write(request);

        return grpcStream;
      });

      this.activeStreams.set(endpoint, stream);

      // Reset retry attempts and error tracking on successful stream start
      this.streamRetryAttempts.delete(endpoint);
      this.lastErrorTypes.delete(endpoint);

      // Clear any existing retry timer
      const existingTimer = this.streamRetryTimers.get(endpoint);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.streamRetryTimers.delete(endpoint);
      }

      // Start processing the stream with proper error handling
      const processor = this.processStreamWithRetry(endpoint, stream, request);
      this.streamProcessors.set(endpoint, processor);

      // Start stream ping/pong if enabled and connection doesn't have noPing
      const connection = this.connections.get(endpoint);
      const shouldSkipStreamPing = connection?.connectionConfig?.noPing;

      if (this.config.streamPing?.enabled && !shouldSkipStreamPing) {
        this.startStreamPing(endpoint, stream);
      } else if (shouldSkipStreamPing) {
        this.logger?.debug(`Skipping stream ping for ${endpoint} (noPing: true)`);
      }

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
      stream.on('error', (error: any) => {
        // Check if this is a user-initiated cancellation
        const isCancellation = error.code === 1 || (error.message && error.message.includes('Cancelled'));

        if (isCancellation) {
          this.logger?.debug(`Stream for ${endpoint} cancelled by user`);
          // Don't treat cancellation as an error - it's intentional
          this.activeStreams.delete(endpoint);
          this.streamProcessors.delete(endpoint);

          // Stop stream ping for this endpoint
          this.stopStreamPing(endpoint);

          resolve(); // Resolve instead of reject for cancellation
          return;
        }

        this.logger?.error(`Stream processing error for ${endpoint}: ${error}`);
        this.emit('error', error, `stream-processing-${endpoint}`);

        // Store information about RST_STREAM errors for smarter retry handling
        const isRstStreamError = error.message && error.message.includes('RST_STREAM');
        if (isRstStreamError) {
          this.logger?.warn(`RST_STREAM error detected for ${endpoint}, may indicate server-side resource constraints`);
          // Store this error type for the endpoint to adjust retry strategy
          this.storeErrorType(endpoint, 'RST_STREAM');
        }

        // Remove failed stream
        this.activeStreams.delete(endpoint);
        this.streamProcessors.delete(endpoint);

        // Stop stream ping for this endpoint
        this.stopStreamPing(endpoint);

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
      // Check if this is a pong response
      if (this.handlePongMessage(endpoint, rawMessage)) {
        return; // Pong handled, don't process further
      }

      const message = this.parseMessage(rawMessage, endpoint);

      if (!message) {
        return;
      }

      // Update last message time for this connection
      const connection = this.connections.get(endpoint);
      if (connection) {
        connection.updateLastMessageTime();
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
   * Schedule retry for a failed stream with intelligent backoff and rate limiting
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

    // Implement rate limiting for rapid failures
    // If we've had many recent failures, increase the base delay significantly
    const rapidFailureThreshold = 5;
    const maxReasonableAttempts = 20; // After 20 attempts, use very long delays

    let baseDelay = 1000; // Start with 1 second

    // For rapid failures (first 5 attempts), use shorter delays but still reasonable
    if (currentAttempts < rapidFailureThreshold) {
      baseDelay = 2000; // 2 seconds minimum for rapid failures
    } else if (currentAttempts < maxReasonableAttempts) {
      baseDelay = 5000; // 5 seconds for moderate failures
    } else {
      baseDelay = 30000; // 30 seconds for persistent failures
    }

    const maxDelay = 300000; // 5 minutes maximum delay for persistent issues

    // For RST_STREAM errors, use longer delays as they often indicate server-side issues
    const isRstStreamError = this.lastErrorWasRstStream(endpoint);
    if (isRstStreamError) {
      baseDelay = Math.max(baseDelay * 3, 10000); // At least 10 seconds for RST_STREAM
    }

    // Calculate delay with exponential backoff, but cap at maxDelay
    const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, Math.min(currentAttempts, 15)), maxDelay);
    const delay = Math.max(exponentialDelay, baseDelay);

    this.logger?.info(`Scheduling stream retry for ${endpoint} in ${delay}ms (attempt ${currentAttempts + 1})`);

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
        this.logger?.warn(`Connection ${endpoint} is not healthy, scheduling another retry`);
        // Schedule another retry with increased delay
        this.scheduleStreamRetry(endpoint, request);
      }
    }, delay);

    this.streamRetryTimers.set(endpoint, timer);
  }

  /**
   * Store the error type for an endpoint to help with retry strategy
   */
  private storeErrorType(endpoint: string, errorType: string): void {
    this.lastErrorTypes.set(endpoint, errorType);
  }

  /**
   * Check if the last error for this endpoint was an RST_STREAM error
   * Used to adjust retry strategy for specific error types
   */
  private lastErrorWasRstStream(endpoint: string): boolean {
    return this.lastErrorTypes.get(endpoint) === 'RST_STREAM';
  }

  /**
   * Register process signal handlers for graceful shutdown
   * This ensures streams are properly closed when the process exits
   */
  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) {
      return;
    }

    // Only register these handlers once
    this.shutdownHandlersRegistered = true;

    const gracefulShutdown = async (signal: string) => {
      this.logger?.info(`Received ${signal} signal, performing graceful shutdown...`);

      try {
        await this.stop();
        this.logger?.info(`Graceful shutdown completed on ${signal}`);

        // Exit with success code after clean shutdown
        // Use a small timeout to ensure logs are flushed
        setTimeout(() => {
          process.exit(0);
        }, 100);
      } catch (error) {
        this.logger?.error(`Error during graceful shutdown: ${error}`);

        // Exit with error code
        setTimeout(() => {
          process.exit(1);
        }, 100);
      }
    };

    // Handle termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      this.logger?.error(`Uncaught exception: ${error}`);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      this.logger?.error(`Unhandled rejection: ${reason}`);
      gracefulShutdown('unhandledRejection');
    });

    this.logger?.debug('Registered process signal handlers for graceful shutdown');
  }

  /**
   * Start message timeout monitoring
   * Checks for connections that haven't received messages within the timeout period
   */
  private startMessageTimeoutMonitoring(): void {
    if (!this.config.messageTimeout || this.messageTimeoutTimer) {
      return;
    }

    this.logger?.debug(`Starting message timeout monitoring with ${this.config.messageTimeout}ms timeout`);

    this.messageTimeoutTimer = setInterval(() => {
      this.checkMessageTimeouts();
    }, this.messageTimeoutCheckInterval);
  }

  /**
   * Stop message timeout monitoring
   */
  private stopMessageTimeoutMonitoring(): void {
    if (this.messageTimeoutTimer) {
      clearInterval(this.messageTimeoutTimer);
      this.messageTimeoutTimer = null;
      this.logger?.debug('Stopped message timeout monitoring');
    }
  }

  /**
   * Check all connections for message timeouts and mark stale ones for reconnection
   */
  private checkMessageTimeouts(): void {
    if (!this.config.messageTimeout) {
      return;
    }

    for (const [endpoint, connection] of this.connections.entries()) {
      // Only check connected connections
      if (!connection.isHealthy) {
        continue;
      }

      // Check if connection is stale based on message timeout
      if (connection.isStaleByMessageTimeout(this.config.messageTimeout)) {
        const metrics = connection.getHealthMetrics();
        const timeSinceLastMessage = metrics.lastMessageTime
          ? Date.now() - metrics.lastMessageTime
          : Date.now() - metrics.lastSuccessTime;

        this.logger?.warn(
          `Connection ${endpoint} is stale - no messages received for ${timeSinceLastMessage}ms ` +
          `(timeout: ${this.config.messageTimeout}ms). Marking as failed for reconnection.`
        );

        // Emit a specific event for message timeout stale connections
        this.emit('connection-lost', endpoint, new Error(`Message timeout: no messages received for ${timeSinceLastMessage}ms`));

        // Force the connection to reconnect by triggering connection failure handling
        this.handleConnectionFailure(endpoint).catch((err) => {
          this.logger?.error(`Error handling message timeout failure for ${endpoint}: ${err}`);
        });

        // Increment metrics
        this.metricsCollector.incrementCounter('message_timeout_failures');
      }
    }
  }

  /**
   * Start stream ping/pong keep-alive for a specific stream
   */
  private startStreamPing(endpoint: string, stream: any): void {
    if (!this.config.streamPing?.enabled) {
      return;
    }

    // Initialize tracking for this endpoint
    this.streamPingSequence.set(endpoint, 0);
    this.pendingPongs.set(endpoint, new Set());
    this.missedPongCounts.set(endpoint, 0);

    this.logger?.debug(`Starting stream ping for ${endpoint} with ${this.config.streamPing.interval}ms interval`);

    const pingTimer = setInterval(() => {
      this.sendStreamPing(endpoint, stream);
    }, this.config.streamPing.interval);

    this.streamPingTimers.set(endpoint, pingTimer);
  }

  /**
   * Stop stream ping/pong for a specific endpoint
   */
  private stopStreamPing(endpoint: string): void {
    const timer = this.streamPingTimers.get(endpoint);
    if (timer) {
      clearInterval(timer);
      this.streamPingTimers.delete(endpoint);
    }

    // Clean up tracking data
    this.streamPingSequence.delete(endpoint);
    this.pendingPongs.delete(endpoint);
    this.missedPongCounts.delete(endpoint);

    this.logger?.debug(`Stopped stream ping for ${endpoint}`);
  }

  /**
   * Cancel stream for a specific endpoint with simple cleanup
   * Simplified to match working example approach - just end the stream and null references
   */
  private async cancelStreamForEndpoint(endpoint: string, reason: string): Promise<void> {
    const stream = this.activeStreams.get(endpoint);
    if (!stream) {
      this.logger?.debug(`No active stream found for ${endpoint}`);
      return;
    }

    this.logger?.info(`Cancelling stream for ${endpoint}: ${reason}`);

    try {
      // Simple cleanup like the working example
      if (stream) {
        try {
          stream.removeAllListeners();
          stream.end();
        } catch (error) {
          this.logger?.warn(`Error cleaning up stream for ${endpoint}: ${error}`);
        }
      }

      // Clean up tracking data immediately
      this.activeStreams.delete(endpoint);
      this.streamProcessors.delete(endpoint);
      this.stopStreamPing(endpoint);

      this.logger?.info(`Stream for ${endpoint} cancelled and cleaned up successfully`);

    } catch (error) {
      this.logger?.error(`Error cancelling stream for ${endpoint}: ${error}`);

      // Force cleanup even if cancellation failed
      this.activeStreams.delete(endpoint);
      this.streamProcessors.delete(endpoint);
      this.stopStreamPing(endpoint);
    }
  }

  /**
   * Send a ping message to the stream
   */
  private sendStreamPing(endpoint: string, stream: any): void {
    if (!this.config.streamPing?.enabled) {
      return;
    }

    try {
      const sequence = (this.streamPingSequence.get(endpoint) || 0) + 1;
      this.streamPingSequence.set(endpoint, sequence);

      // Add to pending pongs
      const pendingPongs = this.pendingPongs.get(endpoint);
      if (pendingPongs) {
        pendingPongs.add(sequence);
      }

      // Create ping request with sequence number
      const pingRequest = {
        accounts: {},
        slots: {},
        transactions: {},
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        commitment: undefined,
        accountsDataSlice: [],
        ping: { id: sequence } // This is the ping message
      };

      // Send ping to stream
      stream.write(pingRequest);

      this.logger?.debug(`Sent ping ${sequence} to ${endpoint}`);

      // Set timeout for pong response
      setTimeout(() => {
        this.checkPongTimeout(endpoint, sequence);
      }, this.config.streamPing.timeout);

    } catch (error) {
      this.logger?.error(`Error sending ping to ${endpoint}: ${error}`);
    }
  }

  /**
   * Handle incoming pong messages
   */
  private handlePongMessage(endpoint: string, rawMessage: any): boolean {
    if (!this.config.streamPing?.enabled) {
      return false;
    }

    try {
      // Check if this message contains a pong response
      if (rawMessage && typeof rawMessage === 'object' && rawMessage.pong) {
        const pongId = rawMessage.pong.id;

        if (typeof pongId === 'number') {
          this.logger?.debug(`Received pong ${pongId} from ${endpoint}`);

          // Remove from pending pongs
          const pendingPongs = this.pendingPongs.get(endpoint);
          if (pendingPongs && pendingPongs.has(pongId)) {
            pendingPongs.delete(pongId);

            // Reset missed pong count on successful pong
            this.missedPongCounts.set(endpoint, 0);

            // Update connection last message time
            const connection = this.connections.get(endpoint);
            if (connection) {
              connection.updateLastMessageTime();
            }

            return true; // Indicate this was a pong message
          }
        }
      }
    } catch (error) {
      this.logger?.debug(`Error handling potential pong message from ${endpoint}: ${error}`);
    }

    return false; // Not a pong message
  }

  /**
   * Check for pong timeout and handle missed pongs
   */
  private checkPongTimeout(endpoint: string, sequence: number): void {
    if (!this.config.streamPing?.enabled) {
      return;
    }

    const pendingPongs = this.pendingPongs.get(endpoint);
    if (pendingPongs && pendingPongs.has(sequence)) {
      // Pong not received within timeout
      pendingPongs.delete(sequence);

      const missedCount = (this.missedPongCounts.get(endpoint) || 0) + 1;
      this.missedPongCounts.set(endpoint, missedCount);

      this.logger?.warn(`Missed pong ${sequence} from ${endpoint} (${missedCount}/${this.config.streamPing.maxMissedPongs})`);

      // Check if we've exceeded the maximum missed pongs
      if (missedCount >= this.config.streamPing.maxMissedPongs) {
        this.logger?.error(`Stream ${endpoint} exceeded maximum missed pongs (${missedCount}), marking as stale`);

        // Emit connection lost event for ping timeout
        this.emit('connection-lost', endpoint, new Error(`Stream ping timeout: ${missedCount} consecutive missed pongs`));

        // Stop ping for this stream
        this.stopStreamPing(endpoint);

        // Trigger reconnection
        this.handleConnectionFailure(endpoint).catch((err) => {
          this.logger?.error(`Error handling stream ping timeout failure for ${endpoint}: ${err}`);
        });

        // Increment metrics
        this.metricsCollector.incrementCounter('stream_ping_timeout_failures');
      }
    }
  }

  /**
   * Handle connection failure and attempt failover
   */
  private async handleConnectionFailure(failedEndpoint: string): Promise<void> {
    this.logger?.warn(`Handling connection failure for ${failedEndpoint}`);

    // First, cancel any active streams for this endpoint before reconnecting
    await this.cancelStreamForEndpoint(failedEndpoint, 'Connection failure detected');

    // Then, force the failed connection to reconnect
    const failedConnection = this.connections.get(failedEndpoint);
    if (failedConnection) {
      this.logger?.info(`Forcing reconnection for stale connection: ${failedEndpoint}`);

      try {
        // Force the connection to reconnect using the proper method
        await failedConnection.forceReconnect('Connection marked as stale by pool manager');
      } catch (error) {
        this.logger?.error(`Error during forced reconnection for ${failedEndpoint}: ${error}`);
      }
    }

    // Then handle failover to healthy connections
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
