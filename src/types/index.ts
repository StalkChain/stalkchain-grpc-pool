/**
 * types/index.ts - Basic type definitions for gRPC pool MVP
 *
 * Simple types for connecting to 3 endpoints and streaming transaction signatures.
 * Based on Triton-One Yellowstone gRPC patterns.
 *
 * @module types
 * @author StalkChain Team
 * @version 0.1.0
 */

/**
 * Configuration for a single gRPC endpoint
 */
export interface PoolEndpoint {
  endpoint: string;
  token: string;
  ping?: boolean;
}

/**
 * Pool configuration with multiple endpoints
 */
export interface PoolConfig {
  endpoints: PoolEndpoint[];
}

/**
 * Optional configuration for pool behavior and timing
 */
export interface PoolOptions {
  /** Ping interval in milliseconds (default: 30000) */
  pingIntervalMs?: number;
  
  /** Stale connection timeout in milliseconds (default: 120000) */
  staleTimeoutMs?: number;
  
  /** Deduplication TTL in milliseconds (default: 30000) */
  deduplicationTtlMs?: number;
  
  /** Maximum signatures in deduplication cache (default: 10000) */
  maxCacheSize?: number;
  
  /** Initial retry delay in milliseconds (default: 500) */
  initialRetryDelayMs?: number;
  
  /** Maximum retry delay in milliseconds (default: 30000) */
  maxRetryDelayMs?: number;
  
  /** Retry backoff multiplier (default: 2) */
  retryBackoffFactor?: number;
}

/**
 * Subscription request for Yellowstone gRPC
 */
export interface SubscribeRequest {
  accounts?: Record<string, AccountFilter>;
  transactions?: Record<string, TransactionFilter>;
  commitment?: string;
}

/**
 * Account filter for program accounts
 */
export interface AccountFilter {
  owner?: string[];
}

/**
 * Transaction filter
 */
export interface TransactionFilter {
  accountInclude?: string[];
  vote?: boolean;
  failed?: boolean;
}

/**
 * Transaction data from stream
 */
export interface TransactionUpdate {
  signature?: string;
  slot?: number;
  meta?: {
    err?: any;
  };
}

/**
 * Full gRPC transaction data structure
 */
export interface FullTransactionData {
  transaction?: {
    signature?: Buffer;
    isVote?: boolean;
    transaction?: {
      signatures?: Buffer[];
      message?: any;
    };
  };
  slot?: number;
  meta?: any;
  filters?: string[];
  [key: string]: any; // Allow additional gRPC fields
}

/**
 * Stream data event
 */
export interface StreamData {
  transaction?: FullTransactionData;
  pong?: { id: number };
  receivedTimestamp?: number; // When client received this data from gRPC
}

/**
 * Processed message from the pool with source information
 */
export interface ProcessedMessage {
  data: FullTransactionData;
  source: string;
  timestamp: number;
}

/**
 * Transaction event data emitted when a unique transaction is received
 */
export interface TransactionEvent {
  signature: string;        // Base58 encoded transaction signature
  data: FullTransactionData; // Complete gRPC transaction object
  source: string;           // Which endpoint received this transaction
  timestamp: number;        // When the transaction was received
}

/**
 * Duplicate event data emitted when a duplicate transaction is filtered
 */
export interface DuplicateEvent {
  signature: string;  // Base58 encoded signature (full signature)
  source: string;     // Which endpoint received the duplicate
  timestamp: number;  // When the duplicate was detected
}

/**
 * Endpoint connection event data for monitoring individual endpoint status
 */
export interface EndpointEvent {
  endpoint: string;   // Endpoint URL (e.g., "grpc.solanatracker.io") 
  status: 'connected' | 'disconnected' | 'reconnected'; // Connection status
  timestamp: number;  // When the status change occurred
  details?: string;   // Optional additional information (e.g., error message)
}

 