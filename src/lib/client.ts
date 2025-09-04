/**
 * lib/client.ts - Individual gRPC client wrapper
 *
 * Wraps a single Triton-One Yellowstone gRPC connection with simple interface.
 * Handles connection, subscription, and streaming for one endpoint.
 * Includes infinite retry mechanism and stale connection detection.
 *
 * @module lib/client
 * @author StalkChain Team
 * @version 1.1.2
 */

import { EventEmitter } from 'events';
import Client from '@triton-one/yellowstone-grpc';
import { PoolEndpoint, SubscribeRequest, StreamData } from '../types';
import { DEFAULT_CONFIG } from '../constants';

// Simple incremental ID generator to uniquely identify each client instance
let nextClientId = 1;

/**
 * Simple wrapper for a single gRPC client with infinite retry and stale detection
 */
export class GrpcClient extends EventEmitter {
  private client: Client;
  private endpoint: PoolEndpoint;
  private clientId: string;
  private connected: boolean = false;
  private stream: any = null;
  private retryAttempts: number = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private lastMessageTimestamp: number = 0;
  private currentSubscription: any = null;
  private config: {
    staleTimeoutMs: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;
    retryBackoffFactor: number;
  };

  constructor(endpoint: PoolEndpoint, options?: {
    staleTimeoutMs?: number;
    initialRetryDelayMs?: number;
    maxRetryDelayMs?: number;
    retryBackoffFactor?: number;
  }) {
    super();
    this.endpoint = endpoint;
    this.clientId = `client-${nextClientId++}`;
    this.client = new Client(endpoint.endpoint, endpoint.token, {});
    this.lastMessageTimestamp = Date.now(); // Initialize to current time
    
    this.config = {
      staleTimeoutMs: options?.staleTimeoutMs ?? DEFAULT_CONFIG.STALE_CONNECTION_TIMEOUT_MS,
      initialRetryDelayMs: options?.initialRetryDelayMs ?? DEFAULT_CONFIG.INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? DEFAULT_CONFIG.MAX_RETRY_DELAY_MS,
      retryBackoffFactor: options?.retryBackoffFactor ?? DEFAULT_CONFIG.RETRY_BACKOFF_FACTOR
    };
  }

  /**
   * Connect to the gRPC endpoint with infinite retry mechanism
   */
  async connect(): Promise<void> {
    try {
      // Create subscription stream
      this.stream = await this.client.subscribe();
      
      // Set up stream event handlers
      this.stream.on('data', (data: any) => {
        const streamData: StreamData = {};
        
        if (data.transaction) {
          // Only update last message timestamp for actual transactions
          this.lastMessageTimestamp = Date.now();
          // Pass FULL transaction data to pool (not just extracted fields)
          // Pool will handle deduplication and emit complete data to user
          streamData.transaction = data.transaction; // Complete gRPC transaction object
          streamData.receivedTimestamp = Date.now(); // When client received this data
        }
        
        if (data.pong) {
          streamData.pong = { id: data.pong.id };
        }
        
        this.emit('data', streamData);
      });
      
      this.stream.on('error', (error: Error) => {
        this.connected = false;
        this.emit('error', error);
        
        // Start infinite retry mechanism on stream error
        this.scheduleRetry();
      });
      
      this.stream.on('end', () => {
        this.connected = false;
        this.emit('disconnected');
        
        // Start infinite retry mechanism on stream end
        this.scheduleRetry();
      });
      
      this.connected = true;
      this.retryAttempts = 0; // Reset retry counter on successful connection
      this.lastMessageTimestamp = Date.now(); // Reset timestamp on successful connection
      
      this.emit('connected');
      
      // Resubscribe if we had a previous subscription
      if (this.currentSubscription) {
        await this.subscribe(this.currentSubscription);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Schedule infinite retry
      this.scheduleRetry();
      throw error;
    }
  }

  /**
   * Check if connection is stale (no messages received for too long)
   */
  isStale(): boolean {
    if (!this.connected) return false;
    
    const timeSinceLastMessage = Date.now() - this.lastMessageTimestamp;
    return timeSinceLastMessage > this.config.staleTimeoutMs;
  }

  /**
   * Clean up existing connection resources properly
   * 
   * This method safely closes streams and clients while preserving the
   * subscription state, which should persist across reconnections.
   */
  private cleanupConnection(): void {
    // Close existing stream if it exists
    if (this.stream) {
      try {
        // Add error handler to prevent unhandled error events during cleanup
        this.stream.on('error', () => {}); // Ignore errors during cleanup
        
        // Remove event listeners to prevent duplicate handlers
        this.stream.removeAllListeners();
        this.stream.end();
        this.stream.destroy();
      } catch (error) {
        // Cleanup errors are expected and can be ignored
      }
      this.stream = null;
    }
    
    this.connected = false;
  }

  /**
   * Force reconnection for stale connections
   */
  async forceReconnect(): Promise<void> {
    // Emit disconnected event before cleanup if currently connected
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
    
    // Clean up current connection
    this.cleanupConnection();
    
    // Reset retry attempts for immediate reconnection
    this.retryAttempts = 0;
    
    // Attempt to reconnect
    try {
      await this.connect();
    } catch (error) {
      // Error already logged in connect method, retry will be scheduled
    }
  }

  /**
   * Schedule infinite retry with exponential backoff (500ms to 30s max)
   */
  private scheduleRetry(): void {
    // Clear any existing retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    // Calculate delay with exponential backoff: 500ms * 2^attempt, capped at 30s
    const delay = Math.min(
      this.config.initialRetryDelayMs * Math.pow(this.config.retryBackoffFactor, this.retryAttempts),
      this.config.maxRetryDelayMs
    );
    
    this.retryAttempts++;

    this.retryTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        // Error already logged in connect method, retry will be scheduled again
      }
    }, delay);
  }

  /**
   * Subscribe using full subscription request object
   */
  async subscribe(subscribeRequest: any): Promise<void> {
    if (!this.connected || !this.stream) {
      throw new Error('Client not connected');
    }

    try {
      // Store subscription for potential resubscription after reconnection
      this.currentSubscription = subscribeRequest;
      
      // Send subscription request using Promise wrapper like working example
      await new Promise((resolve, reject) => {
        this.stream.write(subscribeRequest, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(undefined);
          }
        });
      });
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * Send ping if enabled for this endpoint
   */
  async ping(id: number): Promise<void> {
    if (!this.endpoint.ping || !this.connected || !this.stream) {
      return;
    }

    // Use complete ping request format matching working grpc.service.js
    const pingRequest = {
      ping: { id },
      accounts: {},
      accountsDataSlice: [],
      transactions: {},
      blocks: {},
      blocksMeta: {},
      slots: {},
      transactionsStatus: {},
      entry: {},
    };

    try {
      await new Promise((resolve, reject) => {
        this.stream.write(pingRequest, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(undefined);
          }
        });
      });
    } catch (error) {
      // Ping errors are handled silently
    }
  }

  /**
   * Close the client connection and clear any retry timeouts
   */
  async close(): Promise<void> {
    // Clear retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    
    // Clean up connection
    this.cleanupConnection();
    
    // Reset retry counter and subscription
    this.retryAttempts = 0;
    this.currentSubscription = null;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get endpoint info
   */
  getEndpoint(): PoolEndpoint {
    return this.endpoint;
  }

  /**
   * Get unique client identifier
   */
  getId(): string {
    return this.clientId;
  }

  /**
   * Get time since last message in milliseconds
   */
  getTimeSinceLastMessage(): number {
    return Date.now() - this.lastMessageTimestamp;
  }
}