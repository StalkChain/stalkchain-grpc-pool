/**
 * lib/pool.ts - Main gRPC pool manager
 *
 * Manages connections to 3 gRPC endpoints simultaneously and routes
 * transaction data from all of them. Handles all stream management internally,
 * emits processed messages to the user, and monitors for stale connections.
 *
 * @module lib/pool
 * @author StalkChain Team
 * @version 1.1.2
 */

import { EventEmitter } from 'events';
import { PoolConfig, PoolOptions, StreamData, TransactionEvent, DuplicateEvent, EndpointEvent } from '../types';
import { GrpcClient } from './client';
import { DeduplicationService } from './deduplication';
import { DEFAULT_CONFIG } from '../constants';
import bs58 from 'bs58';

/**
 * Internal configuration combining defaults with user options
 */
interface ResolvedConfig {
  pingIntervalMs: number;
  staleTimeoutMs: number;
  deduplicationTtlMs: number;
  maxCacheSize: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  retryBackoffFactor: number;
  staleCheckFraction: number;
  minStaleCheckIntervalMs: number;
  maxStaleCheckIntervalMs: number;
}

/**
 * Main pool manager for multiple gRPC connections
 * 
 * This class extends EventEmitter and handles all the complexity of managing
 * multiple gRPC streams internally. Users simply listen for 'message-processed'
 * events to receive transaction data. Includes automatic stale detection.
 */
export class GrpcPool extends EventEmitter {
  private config: PoolConfig;
  private options: ResolvedConfig;
  private clients: GrpcClient[] = [];
  private connected: boolean = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private staleCheckInterval: NodeJS.Timeout | null = null;
  private currentSubscription: any = null;
  private deduplicationService: DeduplicationService;
  private endpointStates: Map<string, boolean> = new Map(); // Track individual endpoint connection states by clientId

  constructor(config: PoolConfig, options: PoolOptions = {}) {
    super();
    this.config = config;
    
    // Merge user options with defaults
    this.options = {
      pingIntervalMs: options.pingIntervalMs ?? DEFAULT_CONFIG.PING_INTERVAL_MS,
      staleTimeoutMs: options.staleTimeoutMs ?? DEFAULT_CONFIG.STALE_CONNECTION_TIMEOUT_MS,
      deduplicationTtlMs: options.deduplicationTtlMs ?? DEFAULT_CONFIG.DEDUP_TTL_MS,
      maxCacheSize: options.maxCacheSize ?? DEFAULT_CONFIG.MAX_DEDUP_SIGNATURES,
      initialRetryDelayMs: options.initialRetryDelayMs ?? DEFAULT_CONFIG.INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULT_CONFIG.MAX_RETRY_DELAY_MS,
      retryBackoffFactor: options.retryBackoffFactor ?? DEFAULT_CONFIG.RETRY_BACKOFF_FACTOR,
      staleCheckFraction: DEFAULT_CONFIG.STALE_CHECK_FRACTION,
      minStaleCheckIntervalMs: DEFAULT_CONFIG.MIN_STALE_CHECK_INTERVAL_MS,
      maxStaleCheckIntervalMs: DEFAULT_CONFIG.MAX_STALE_CHECK_INTERVAL_MS
    };
    
    this.deduplicationService = new DeduplicationService(this.options);
  }

  /**
   * Connect to all endpoints in the pool and set up internal stream management
   */
  async connect(): Promise<void> {
    console.log(`🚀 Connecting to ${this.config.endpoints.length} gRPC endpoints...`);

    // Create clients for each endpoint and initialize their states by clientId
    this.clients = this.config.endpoints.map(endpoint => {
      const client = new GrpcClient(endpoint, {
        staleTimeoutMs: this.options.staleTimeoutMs,
        initialRetryDelayMs: this.options.initialRetryDelayMs,
        maxRetryDelayMs: this.options.maxRetryDelayMs,
        retryBackoffFactor: this.options.retryBackoffFactor
      });
      this.endpointStates.set(client.getId(), false);
      return client;
    });

    // Connect to all endpoints
    const connectionPromises = this.clients.map(client => 
      client.connect().catch(error => {
        console.error(`Connection failed for ${client.getEndpoint().endpoint}:`, error.message);
        return null; // Don't fail the whole pool if one endpoint fails
      })
    );

    await Promise.allSettled(connectionPromises);

    // Check if at least one connection succeeded
    const connectedClients = this.clients.filter(client => client.isConnected());
    
    if (connectedClients.length === 0) {
      throw new Error('❌ Failed to connect to any gRPC endpoints');
    }

    // Set up internal stream management
    this.setupInternalStreams();
    
    // Update endpoint states for initially connected clients
    connectedClients.forEach(client => {
      const endpoint = client.getEndpoint().endpoint;
      const clientId = client.getId();
      this.endpointStates.set(clientId, true);
      
      // Emit initial endpoint connected events
      const endpointEvent: EndpointEvent = {
        clientId,
        endpoint,
        status: 'connected',
        timestamp: Date.now()
      };
      this.emit('endpoint', endpointEvent);
    });
    
    // Set pool as connected and emit connected event
    this.connected = true;
    this.emit('connected');
    
    console.log(`✅ Connected to ${connectedClients.length}/${this.config.endpoints.length} endpoints`);

    // Start automatic ping management
    this.startPingInterval();

    // Start stale connection monitoring
    this.startStaleDetection();
  }

  /**
   * Set up internal stream listeners for all connected clients
   */
  private setupInternalStreams(): void {
    const connectedClients = this.clients.filter(client => client.isConnected());
    
    connectedClients.forEach(client => {
      client.on('data', (data: StreamData) => {
        // Process transaction data and emit to user
        if (data.transaction) {
          // Extract signature buffer from full transaction data for deduplication
          const signatureBuffer = data.transaction.transaction?.signature;
          
          // Only process transactions that have signatures
          if (!signatureBuffer || !Buffer.isBuffer(signatureBuffer)) {
            return; // Skip transactions without valid signatures
          }
          
          // === DEDUPLICATION CHECK ===
          {
            const isDuplicate = this.deduplicationService.isDuplicate(signatureBuffer);
            const signature = bs58.encode(signatureBuffer);
            const truncatedSignature = signature.substring(0, 32) + '...';
            
            if (isDuplicate) {
              // Emit duplicate event for filtered transactions
              const duplicateEvent: DuplicateEvent = {
                signature: bs58.encode(signatureBuffer), // Full signature, not truncated
                source: client.getEndpoint().endpoint,
                timestamp: Date.now()
              };
              this.emit('duplicate', duplicateEvent);
              return; // Don't emit duplicate transactions
            }
          }

          // Create transaction event with full transaction data + our metadata
          const transactionEvent: TransactionEvent = {
            signature: bs58.encode(signatureBuffer), // Full base58 signature
            data: data.transaction,           // Full gRPC transaction object
            source: client.getEndpoint().endpoint,  // Which endpoint sent this
            timestamp: data.receivedTimestamp || Date.now() // Use client timestamp or fallback
          };
          
          // Emit transaction event to user (only unique transactions reach here)
          this.emit('transaction', transactionEvent);
        }

        // Handle pong responses silently
      });

      client.on('error', (error: Error) => {
        this.emit('error', error);
      });

      client.on('connected', () => {
        const endpoint = client.getEndpoint().endpoint;
        const clientId = client.getId();
        const wasConnected = this.endpointStates.get(clientId);
        this.endpointStates.set(clientId, true);
        
        // Determine status: reconnected if was previously false, connected if undefined or first time
        let status: 'connected' | 'reconnected' = 'connected';
        if (wasConnected === false) {
          status = 'reconnected';
        }
        
        // Emit endpoint event
        const endpointEvent: EndpointEvent = {
          clientId,
          endpoint,
          status,
          timestamp: Date.now()
        };
        this.emit('endpoint', endpointEvent);
        
        // Check if pool should be considered connected
        this.checkPoolConnectionStatus();
      });

      client.on('disconnected', () => {
        const endpoint = client.getEndpoint().endpoint;
        const clientId = client.getId();
        this.endpointStates.set(clientId, false);
        
        // Emit endpoint disconnection event
        const endpointEvent: EndpointEvent = {
          clientId,
          endpoint,
          status: 'disconnected',
          timestamp: Date.now()
        };
        this.emit('endpoint', endpointEvent);
        
        // Check if pool should be considered disconnected
        this.checkPoolConnectionStatus();
      });
    });
  }

  /**
   * Check pool connection status and emit connected/disconnected events
   */
  private checkPoolConnectionStatus(): void {
    const connectedEndpoints = Array.from(this.endpointStates.values()).filter(connected => connected).length;
    const wasConnected = this.connected;
    
    if (connectedEndpoints > 0 && !wasConnected) {
      // Pool just became connected
      this.connected = true;
      this.emit('connected');
    } else if (connectedEndpoints === 0 && wasConnected) {
      // Pool just became disconnected
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Start automatic ping interval for connection health
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(async () => {
      try {
        await this.pingAllEndpoints();
      } catch (error) {
        console.error('❌ Ping interval failed:', error);
      }
    }, this.options.pingIntervalMs);
  }

  /**
   * Start stale connection detection monitoring
   */
  private startStaleDetection(): void {
    // Calculate check interval as fraction of stale timeout, with bounds
    const calculatedInterval = this.options.staleTimeoutMs * this.options.staleCheckFraction;
    const checkInterval = Math.max(
      this.options.minStaleCheckIntervalMs,
      Math.min(calculatedInterval, this.options.maxStaleCheckIntervalMs)
    );

    console.log(`🔍 Starting stale detection: checking every ${Math.round(checkInterval / 1000)}s for connections stale after ${Math.round(this.options.staleTimeoutMs / 1000)}s`);

    this.staleCheckInterval = setInterval(async () => {
      try {
        await this.checkForStaleConnections();
      } catch (error) {
        console.error('❌ Stale detection check failed:', error);
      }
    }, checkInterval);
  }

  /**
   * Check all clients for stale connections and force reconnect if needed
   */
  private async checkForStaleConnections(): Promise<void> {
    const staleClients = this.clients.filter(client => client.isStale());
    
    if (staleClients.length > 0) {
      console.log(`🔍 Found ${staleClients.length} stale connection(s), forcing reconnection...`);
      
      const reconnectPromises = staleClients.map(async (client) => {
        const timeSinceLastMessage = client.getTimeSinceLastMessage();
        const endpoint = client.getEndpoint().endpoint;
        console.log(`⚠️ Stale connection detected: ${endpoint} (${Math.round(timeSinceLastMessage / 1000)}s since last message)`);
        
        try {
          await client.forceReconnect();
          console.log(`🔄 Forcing reconnection for: ${endpoint}`);
                  } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ Failed to force reconnect ${endpoint}:`, errorMessage);
          }
      });
      
      await Promise.allSettled(reconnectPromises);
    }
  }

  /**
   * Subscribe to transactions using the simplified API
   * 
   * This method handles all the internal stream setup and subscription management.
   * Users just need to call this once and listen for 'message-processed' events.
   */
  async subscribe(subscribeRequest: any): Promise<void> {
    if (!this.connected) {
      throw new Error('Pool not connected. Call connect() first.');
    }

    console.log('📡 Setting up subscriptions on all connected endpoints...');
    
    // Store current subscription for potential resubscription
    this.currentSubscription = subscribeRequest;

    // Send subscription to all connected clients
    const connectedClients = this.clients.filter(client => client.isConnected());
    const subscriptionPromises = connectedClients.map(client => 
      client.subscribe(subscribeRequest).catch(error => {
        console.error(`Subscription failed for ${client.getEndpoint().endpoint}:`, error.message);
        return null;
      })
    );
    
    await Promise.allSettled(subscriptionPromises);
    
    console.log('✅ Subscriptions active! Pool will emit "message-processed" events.');
  }

  /**
   * Send ping to all endpoints that support it (internal method)
   */
  private async pingAllEndpoints(): Promise<void> {
    const pingId = Date.now();
    const connectedClients = this.clients.filter(client => client.isConnected());
    
    const pingPromises = connectedClients.map(client => client.ping(pingId));
    await Promise.allSettled(pingPromises);
  }

  /**
   * Close all connections and clean up resources
   */
  async close(): Promise<void> {
    console.log('🔒 Closing all pool connections...');
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Clear stale detection interval
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }

    // Clean up deduplication service
    this.deduplicationService.destroy();

    // Close all client connections
    const closePromises = this.clients.map(client => client.close());
    await Promise.allSettled(closePromises);
    
    this.connected = false;
    this.currentSubscription = null;
    console.log('✅ Pool closed');
  }

  /**
   * Get connection status for monitoring
   */
  getStatus(): { clientId: string; endpoint: string; connected: boolean; timeSinceLastMessage?: number }[] {
    return this.clients.map(client => {
      const status: { clientId: string; endpoint: string; connected: boolean; timeSinceLastMessage?: number } = {
        clientId: client.getId(),
        endpoint: client.getEndpoint().endpoint,
        connected: client.isConnected()
      };
      
      if (client.isConnected()) {
        status.timeSinceLastMessage = client.getTimeSinceLastMessage();
      }
      
      return status;
    });
  }

  /**
   * Get deduplication statistics for monitoring
   */
  getDeduplicationStats(): { size: number; maxSize: number; ttlMs: number } {
    return this.deduplicationService.getStats();
  }
} 