import { DeduplicationEngine } from '../../src/deduplication/deduplication-engine';
import { createTestTransaction, waitFor } from '../setup';

describe('DeduplicationEngine', () => {
  let engine: DeduplicationEngine;

  beforeEach(() => {
    engine = new DeduplicationEngine(5000, 100); // 5 second window, 100 max cache
  });

  afterEach(() => {
    engine.stop();
  });

  describe('isDuplicate', () => {
    it('should return false for new transaction', () => {
      const transaction = createTestTransaction('sig1');
      const result = engine.isDuplicate(transaction);
      expect(result).toBe(false);
    });

    it('should return true for duplicate transaction within window', () => {
      const transaction = createTestTransaction('sig1');
      
      engine.isDuplicate(transaction);
      const result = engine.isDuplicate(transaction);
      
      expect(result).toBe(true);
    });

    it('should return false for same signature after window expires', async () => {
      const shortWindowEngine = new DeduplicationEngine(100, 100); // 100ms window
      const transaction = createTestTransaction('sig1');
      
      shortWindowEngine.isDuplicate(transaction);
      await waitFor(150); // Wait for window to expire
      const result = shortWindowEngine.isDuplicate(transaction);
      
      expect(result).toBe(false);
      shortWindowEngine.stop();
    });

    it('should handle transactions without signature', () => {
      const transaction = { ...createTestTransaction(), signature: '' };
      const result = engine.isDuplicate(transaction);
      expect(result).toBe(false);
    });
  });

  describe('processTransaction', () => {
    it('should return true for unique transaction', () => {
      const transaction = createTestTransaction('sig1');
      const result = engine.processTransaction(transaction);
      expect(result).toBe(true);
    });

    it('should return false for duplicate transaction', () => {
      const transaction = createTestTransaction('sig1');
      
      engine.processTransaction(transaction);
      const result = engine.processTransaction(transaction);
      
      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const transaction1 = createTestTransaction('sig1');
      const transaction2 = createTestTransaction('sig2');
      const transaction3 = createTestTransaction('sig1'); // duplicate
      
      engine.processTransaction(transaction1);
      engine.processTransaction(transaction2);
      engine.processTransaction(transaction3);
      
      const stats = engine.getStats();
      
      expect(stats.processedCount).toBe(2);
      expect(stats.duplicateCount).toBe(1);
      expect(stats.cacheSize).toBe(2);
      expect(stats.duplicateRate).toBe(0.5);
    });
  });

  describe('cleanup', () => {
    it('should remove stale entries', async () => {
      const shortWindowEngine = new DeduplicationEngine(100, 100);
      const transaction = createTestTransaction('sig1');
      
      shortWindowEngine.isDuplicate(transaction);
      expect(shortWindowEngine.hasSignature('sig1')).toBe(true);
      
      await waitFor(150);
      const removedCount = shortWindowEngine.cleanup();
      
      expect(removedCount).toBe(1);
      expect(shortWindowEngine.hasSignature('sig1')).toBe(false);
      
      shortWindowEngine.stop();
    });
  });

  describe('processBatch', () => {
    it('should filter out duplicates from batch', () => {
      const transactions = [
        createTestTransaction('sig1'),
        createTestTransaction('sig2'),
        createTestTransaction('sig1'), // duplicate
        createTestTransaction('sig3')
      ];
      
      const uniqueTransactions = engine.processBatch(transactions);
      
      expect(uniqueTransactions).toHaveLength(3);
      expect(uniqueTransactions.map(t => t.signature)).toEqual(['sig1', 'sig2', 'sig3']);
    });
  });

  describe('cache management', () => {
    it('should respect max cache size', () => {
      const smallCacheEngine = new DeduplicationEngine(10000, 3); // 3 max entries
      
      // Add 5 transactions
      for (let i = 0; i < 5; i++) {
        smallCacheEngine.isDuplicate(createTestTransaction(`sig${i}`));
      }
      
      const stats = smallCacheEngine.getStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(3);
      
      smallCacheEngine.stop();
    });

    it('should clear cache', () => {
      engine.isDuplicate(createTestTransaction('sig1'));
      engine.isDuplicate(createTestTransaction('sig2'));
      
      expect(engine.getStats().cacheSize).toBe(2);
      
      engine.clear();
      
      const stats = engine.getStats();
      expect(stats.cacheSize).toBe(0);
      expect(stats.processedCount).toBe(0);
      expect(stats.duplicateCount).toBe(0);
    });
  });

  describe('optimizeCache', () => {
    it('should optimize cache when it gets too large', () => {
      const engine = new DeduplicationEngine(10000, 10); // Small cache for testing
      
      // Fill cache beyond 80% capacity
      for (let i = 0; i < 15; i++) {
        engine.isDuplicate(createTestTransaction(`sig${i}`));
      }
      
      const statsBefore = engine.getStats();
      engine.optimizeCache();
      const statsAfter = engine.getStats();
      
      expect(statsAfter.cacheSize).toBeLessThan(statsBefore.cacheSize);
    });
  });

  describe('getDuplicatesInWindow', () => {
    it('should return duplicates within specified window', async () => {
      const transaction1 = createTestTransaction('sig1');
      const transaction2 = createTestTransaction('sig2');
      
      engine.isDuplicate(transaction1);
      await waitFor(50);
      engine.isDuplicate(transaction2);
      
      const duplicates = engine.getDuplicatesInWindow(100);
      expect(duplicates).toHaveLength(2);
      
      const duplicatesShortWindow = engine.getDuplicatesInWindow(25);
      expect(duplicatesShortWindow).toHaveLength(1);
    });
  });
});
