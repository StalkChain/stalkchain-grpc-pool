/**
 * constants.ts - Constants and enums for stalkchain-grpc-pool
 *
 * Defines all constant values used throughout the package.
 * These values never change between environments.
 *
 * @module constants
 * @author StalkChain Team
 * @version 0.1.0
 */

/**
 * Solana commitment levels for transaction confirmation
 *
 * @enum CommitmentLevel
 */
export enum CommitmentLevel {
  PROCESSED = 'processed',
  CONFIRMED = 'confirmed',
  FINALIZED = 'finalized'
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  /** Maximum number of signatures to keep in deduplication cache */
  MAX_DEDUP_SIGNATURES: 10000,
  
  /** Time to live for deduplication cache entries (1 minute in milliseconds) */
  DEDUP_TTL_MS: 60 * 1000,
  
  /** Default connection timeout in milliseconds */
  CONNECTION_TIMEOUT_MS: 5000,
  
  /** Default ping interval in milliseconds */
  PING_INTERVAL_MS: 30000,
  
  /** Stale connection detection timeout in milliseconds (2 minutes) */
  STALE_CONNECTION_TIMEOUT_MS: 2 * 60 * 1000,
  
  /** Fraction of stale timeout to use for check interval (1/10th) */
  STALE_CHECK_FRACTION: 0.1,
  
  /** Minimum stale check interval in milliseconds (1 second) */
  MIN_STALE_CHECK_INTERVAL_MS: 1 * 1000,
  
  /** Maximum stale check interval in milliseconds (60 seconds) */
  MAX_STALE_CHECK_INTERVAL_MS: 60 * 1000,
  
  /** Initial retry delay in milliseconds (500ms) */
  INITIAL_RETRY_DELAY_MS: 500,
  
  /** Maximum retry delay in milliseconds (30 seconds) */
  MAX_RETRY_DELAY_MS: 30 * 1000,
  
  /** Retry backoff multiplier (factor of 2) */
  RETRY_BACKOFF_FACTOR: 2,
  
  /** Default commitment level for subscriptions */
  DEFAULT_COMMITMENT: CommitmentLevel.CONFIRMED
} as const;

/**
 * Known Solana gRPC endpoints for different providers
 */
export const KNOWN_ENDPOINTS = {
  SOLANA_TRACKER: {
    PRIMARY: 'https://grpc.solanatracker.io',
    SECONDARY: 'https://grpc-us.solanatracker.io'
  },
  PUBLIC_NODE: {
    PRIMARY: 'https://solana-yellowstone-grpc.publicnode.com'
  }
} as const; 