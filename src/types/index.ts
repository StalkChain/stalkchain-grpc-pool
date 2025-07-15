import { EventEmitter } from 'eventemitter3';

/**
 * Configuration for a single gRPC connection
 */
export interface ConnectionConfig {
  /** gRPC endpoint URL */
  endpoint: string;
  /** Authentication token */
  token: string;
  /** Maximum number of reconnection attempts */
  reconnectAttempts: number;
  /** Delay between reconnection attempts in milliseconds */
  reconnectDelay: number;
  /** Health check interval in milliseconds */
  healthCheckInterval: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Custom gRPC options */
  grpcOptions?: Record<string, unknown>;
}

/**
 * Configuration for the gRPC pool
 */
export interface PoolConfig {
  /** Array of connection configurations */
  connections: ConnectionConfig[];
  /** Deduplication window size in milliseconds */
  deduplicationWindow: number;
  /** Maximum number of items in deduplication cache */
  maxCacheSize: number;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
  /** Batch processing configuration */
  batchProcessing: BatchConfig;
  /** Enable metrics collection */
  enableMetrics: boolean;
  /** Custom logger */
  logger?: Logger;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Failure threshold percentage (0-100) */
  errorThresholdPercentage: number;
  /** Minimum number of requests before circuit breaker can open */
  minimumRequestThreshold: number;
  /** Time in milliseconds to wait before attempting to close circuit */
  resetTimeout: number;
  /** Request timeout in milliseconds */
  timeout: number;
}

/**
 * Batch processing configuration
 */
export interface BatchConfig {
  /** Maximum batch size */
  maxBatchSize: number;
  /** Maximum time to wait before processing batch in milliseconds */
  maxBatchTimeout: number;
  /** Enable batch processing */
  enabled: boolean;
}

/**
 * Health metrics for a connection
 */
export interface HealthMetrics {
  /** Connection endpoint */
  endpoint: string;
  /** Whether the connection is healthy */
  isHealthy: boolean;
  /** Connection latency in milliseconds */
  latency: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Timestamp of last successful request */
  lastSuccessTime: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Last error message if any */
  lastError?: string;
}

/**
 * Connection state enumeration
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  FAILED = 'FAILED'
}

/**
 * Circuit breaker state enumeration
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Transaction data interface
 */
export interface Transaction {
  /** Unique transaction signature (kept as Buffer for efficient deduplication) */
  signature: Buffer | string;
  /** Transaction slot */
  slot: number;
  /** Account keys involved */
  accountKeys: string[];
  /** Transaction instructions */
  instructions: unknown[];
  /** Processing timestamp */
  timestamp: number;
  /** Source connection identifier */
  source: string;
  /** Raw transaction data */
  raw: unknown;
}

/**
 * Processed message interface
 */
export interface ProcessedMessage {
  /** Message type */
  type: 'transaction' | 'account' | 'slot' | 'ping';
  /** Message data */
  data: unknown;
  /** Source connection */
  source: string;
  /** Processing timestamp */
  timestamp: number;
  /** Whether message was deduplicated */
  isDuplicate: boolean;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/**
 * Pool events interface
 */
export interface PoolEvents {
  'connection-established': (endpoint: string) => void;
  'connection-lost': (endpoint: string, error: Error) => void;
  'connection-recovered': (endpoint: string) => void;
  'failover': (from: string, to: string, reason: string) => void;
  'circuit-breaker-opened': (endpoint: string) => void;
  'circuit-breaker-closed': (endpoint: string) => void;
  'message-processed': (message: ProcessedMessage) => void;
  'message-deduplicated': (signature: string, source: string) => void;
  'health-check': (metrics: HealthMetrics[]) => void;
  'error': (error: Error, context?: string) => void;
  'metrics-updated': (metrics: Record<string, number>) => void;
}

/**
 * Base pool interface
 */
export interface IPool extends EventEmitter<PoolEvents> {
  /** Start the pool */
  start(): Promise<void>;
  /** Stop the pool */
  stop(): Promise<void>;
  /** Subscribe to gRPC stream */
  subscribe(request: unknown): Promise<void>;
  /** Get current health status */
  getHealthStatus(): HealthMetrics[];
  /** Get pool metrics */
  getMetrics(): Record<string, number>;
  /** Check if pool is running */
  isRunning(): boolean;
}

// SubscriptionRequest is now imported from @triton-one/yellowstone-grpc as SubscribeRequest
