/**
 * lib/deduplication.ts - Transaction signature deduplication service
 *
 * Implements LRU cache with time-based expiration for detecting duplicate
 * transactions across multiple gRPC endpoints. Uses signature buffers as
 * unique identifiers with automatic cleanup. Uses binary encoding for
 * optimal performance and memory usage.
 *
 * @module lib/deduplication
 * @author StalkChain Team
 * @version 1.1.2
 */

import { DEFAULT_CONFIG } from '../constants';

/**
 * Cache entry storing signature with timestamp for TTL management
 */
interface CacheEntry {
  timestamp: number;
  signatureBinary: string;
}

/**
 * Transaction deduplication service using LRU cache with TTL
 *
 * Efficiently tracks seen transaction signatures to prevent duplicate
 * emissions when same transaction comes from multiple endpoints.
 * Uses binary encoding for optimal performance and memory efficiency.
 */
export class DeduplicationService {
  private cache: Map<string, CacheEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: {
    ttlMs: number;
    maxSignatures: number;
  };

  constructor(options?: { deduplicationTtlMs?: number; maxCacheSize?: number }) {
    this.config = {
      ttlMs: options?.deduplicationTtlMs ?? DEFAULT_CONFIG.DEDUP_TTL_MS,
      maxSignatures: options?.maxCacheSize ?? DEFAULT_CONFIG.MAX_DEDUP_SIGNATURES
    };
    
    this.startCleanupInterval();
  }

  /**
   * Check if signature has been seen before (is duplicate)
   *
   * Uses Buffer.toString('binary') for optimal performance and memory usage.
   * 
   * ⚠️  IMPORTANT: toString('binary') produces strings with characters that have
   * code points 0-255, which can include non-printable characters and high
   * Unicode code points. This would be problematic for:
   * - JSON serialization/deserialization  
   * - Network transmission
   * - Database storage
   * - Logging/debugging (hard to read)
   * - Any external system interaction
   * 
   * ✅ SAFE FOR OUR USE CASE because:
   * - Only used internally as Map keys
   * - Never serialized to JSON
   * - Never sent over network
   * - Never stored in database
   * - Never logged (we use base58 for logging)
   * - 34% faster than base64 (18.6M vs 13.9M ops/sec)
   * - 27% less memory usage (64 vs 88 characters)
   * - Perfect 1:1 mapping, no data loss
   *
   * @param signatureBuffer - Transaction signature as Buffer
   * @returns true if duplicate, false if new/unique
   */
  isDuplicate(signatureBuffer: Buffer): boolean {
    if (!Buffer.isBuffer(signatureBuffer)) {
      return false;
    }

    // Use binary encoding for optimal performance - see method documentation
    // for why this is safe for internal Map keys but would be problematic elsewhere
    const signatureBinary = signatureBuffer.toString('binary');
    const now = Date.now();

    // Check if signature exists and is still valid (within TTL)
    const entry = this.cache.get(signatureBinary);
    if (entry) {
      const age = now - entry.timestamp;
      
      if (age <= this.config.ttlMs) {
        // Signature found and still valid - it's a duplicate
        return true;
      } else {
        // Signature expired - remove it and treat as new
        this.cache.delete(signatureBinary);
      }
    }

    // New signature - add to cache
    this.addSignature(signatureBinary, now);
    return false;
  }

  /**
   * Add signature to cache with current timestamp
   */
  private addSignature(signatureBinary: string, timestamp: number): void {
    // Enforce size limit - remove oldest entries if at capacity
    if (this.cache.size >= this.config.maxSignatures) {
      this.removeOldestEntries(Math.floor(this.config.maxSignatures * 0.1)); // Remove 10%
    }

    // Add new entry
    this.cache.set(signatureBinary, {
      timestamp,
      signatureBinary
    });
  }

  /**
   * Remove oldest entries from cache (LRU behavior)
   */
  private removeOldestEntries(count: number): void {
    const entries = Array.from(this.cache.entries());
    
    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest entries
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const entry = entries[i];
      if (entry) {
        this.cache.delete(entry[0]);
      }
    }
  }

  /**
   * Start automatic cleanup interval to remove expired entries
   */
  private startCleanupInterval(): void {
    // Clean up every 1 second
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 1000);
  }

  /**
   * Remove all expired entries from cache
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    // Find expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (entry && entry.timestamp) {
        const age = now - entry.timestamp;
        if (age > this.config.ttlMs) {
          expiredKeys.push(key);
        }
      }
    }

    // Remove expired entries
    expiredKeys.forEach(key => this.cache.delete(key));

    // Silent cleanup - no logging needed for normal operation
  }

  /**
   * Get current cache statistics for monitoring
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSignatures,
      ttlMs: this.config.ttlMs
    };
  }

  /**
   * Clear all entries and stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
} 