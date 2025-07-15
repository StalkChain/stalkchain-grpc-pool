import { Logger, Transaction } from '../types';

/**
 * Cache entry for deduplication
 */
interface CacheEntry {
  signature: string;
  timestamp: number;
  source: string;
  slot: number;
}

/**
 * LRU Cache implementation for deduplication
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }
}

/**
 * Deduplication engine that prevents processing duplicate transactions
 * across multiple gRPC streams using time-based windows and LRU caching
 */
export class DeduplicationEngine {
  private cache: LRUCache<string, CacheEntry>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private duplicateCount: number = 0;
  private processedCount: number = 0;
  private lastCleanup: number = 0;

  constructor(
    private windowSize: number = 300000, // 5 minutes default
    private maxCacheSize: number = 100000, // 100k entries default
    private logger?: Logger
  ) {
    this.cache = new LRUCache<string, CacheEntry>(maxCacheSize);
    this.startCleanupTimer();
    
    this.logger?.info(`Deduplication engine initialized with window: ${windowSize}ms, cache size: ${maxCacheSize}`);
  }

  /**
   * Check if a transaction is a duplicate
   */
  public isDuplicate(transaction: Transaction): boolean {
    const signature = transaction.signature;

    if (!signature) {
      this.logger?.warn('Transaction without signature received');
      return false;
    }

    // Convert signature to string key for cache lookup (Buffer or string)
    const signatureKey = Buffer.isBuffer(signature) ? signature.toString('base64') : signature;

    const now = Date.now();
    const existingEntry = this.cache.get(signatureKey);

    if (existingEntry) {
      // Check if within deduplication window
      if (now - existingEntry.timestamp <= this.windowSize) {
        this.duplicateCount++;
        
        this.logger?.debug(`Duplicate transaction detected: ${signature} from ${transaction.source} (original from ${existingEntry.source})`);
        
        return true;
      } else {
        // Entry is stale, remove it
        this.cache.delete(signatureKey);
      }
    }

    // Add new entry to cache
    const entry: CacheEntry = {
      signature: signatureKey,
      timestamp: now,
      source: transaction.source,
      slot: transaction.slot
    };

    this.cache.set(signatureKey, entry);
    this.processedCount++;

    return false;
  }

  /**
   * Process a transaction and check for duplicates
   */
  public processTransaction(transaction: Transaction): boolean {
    return !this.isDuplicate(transaction);
  }

  /**
   * Get deduplication statistics
   */
  public getStats(): {
    processedCount: number;
    duplicateCount: number;
    cacheSize: number;
    duplicateRate: number;
    lastCleanup: number;
  } {
    return {
      processedCount: this.processedCount,
      duplicateCount: this.duplicateCount,
      cacheSize: this.cache.size(),
      duplicateRate: this.processedCount > 0 ? this.duplicateCount / this.processedCount : 0,
      lastCleanup: this.lastCleanup
    };
  }

  /**
   * Clear all cached entries
   */
  public clear(): void {
    this.cache.clear();
    this.duplicateCount = 0;
    this.processedCount = 0;
    this.logger?.info('Deduplication cache cleared');
  }

  /**
   * Manually trigger cleanup of stale entries
   */
  public cleanup(): number {
    const now = Date.now();
    let removedCount = 0;

    // Iterate through cache and remove stale entries
    for (const signature of Array.from(this.cache.keys())) {
      const entry = this.cache.get(signature);
      
      if (entry && (now - entry.timestamp) > this.windowSize) {
        this.cache.delete(signature);
        removedCount++;
      }
    }

    this.lastCleanup = now;
    
    if (removedCount > 0) {
      this.logger?.debug(`Cleaned up ${removedCount} stale entries from deduplication cache`);
    }

    return removedCount;
  }

  /**
   * Stop the deduplication engine
   */
  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.clear();
    this.logger?.info('Deduplication engine stopped');
  }

  /**
   * Check if a signature exists in cache (for testing)
   */
  public hasSignature(signature: string): boolean {
    return this.cache.has(signature);
  }

  /**
   * Get cache entry for signature (for testing)
   */
  public getCacheEntry(signature: string): CacheEntry | undefined {
    return this.cache.get(signature);
  }

  /**
   * Force add entry to cache (for testing)
   */
  public addEntry(signature: string, source: string, slot: number): void {
    const entry: CacheEntry = {
      signature,
      timestamp: Date.now(),
      source,
      slot
    };
    
    this.cache.set(signature, entry);
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Advanced deduplication for high-frequency scenarios
   * Uses bloom filter for initial check before LRU cache
   */
  public isDuplicateAdvanced(transaction: Transaction): boolean {
    // For very high throughput scenarios, we could implement a bloom filter
    // as a first-pass filter before checking the LRU cache
    // This would reduce memory usage and improve performance
    
    // For now, use the standard implementation
    return this.isDuplicate(transaction);
  }

  /**
   * Batch process multiple transactions
   */
  public processBatch(transactions: Transaction[]): Transaction[] {
    const uniqueTransactions: Transaction[] = [];
    
    for (const transaction of transactions) {
      if (!this.isDuplicate(transaction)) {
        uniqueTransactions.push(transaction);
      }
    }
    
    return uniqueTransactions;
  }

  /**
   * Get duplicate transactions within a time window
   */
  public getDuplicatesInWindow(windowMs: number = this.windowSize): CacheEntry[] {
    const now = Date.now();
    const duplicates: CacheEntry[] = [];
    
    for (const signature of this.cache.keys()) {
      const entry = this.cache.get(signature);
      
      if (entry && (now - entry.timestamp) <= windowMs) {
        duplicates.push(entry);
      }
    }
    
    return duplicates;
  }

  /**
   * Optimize cache by removing entries older than window
   */
  public optimizeCache(): void {
    const removedCount = this.cleanup();
    
    // If cache is still too large, remove oldest entries
    if (this.cache.size() > this.maxCacheSize * 0.8) {
      const targetSize = Math.floor(this.maxCacheSize * 0.6);
      const currentSize = this.cache.size();
      const toRemove = currentSize - targetSize;
      
      let removed = 0;
      for (const signature of this.cache.keys()) {
        if (removed >= toRemove) break;
        this.cache.delete(signature);
        removed++;
      }
      
      this.logger?.info(`Optimized cache: removed ${removedCount} stale + ${removed} old entries`);
    }
  }
}
