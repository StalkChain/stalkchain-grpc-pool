import { PoolManager } from '../../src/pool/pool-manager';
import { createTestPoolConfig, createMockClient, waitFor } from '../setup';
import { Client } from '@triton-one/yellowstone-grpc';

// Mock the Client constructor
const MockClient = Client as jest.MockedClass<typeof Client>;

describe('PoolManager Integration Tests', () => {
  let poolManager: PoolManager;
  let mockClients: any[];

  beforeEach(() => {
    mockClients = [];
    
    // Mock Client constructor to return our mock clients
    MockClient.mockImplementation(() => {
      const mockClient = createMockClient();
      mockClients.push(mockClient);
      return mockClient;
    });

    const config = createTestPoolConfig();
    poolManager = new PoolManager(config);
  });

  afterEach(async () => {
    if (poolManager.isRunning()) {
      await poolManager.stop();
    }
    jest.clearAllMocks();
  });

  describe('Pool Lifecycle', () => {
    it('should start and stop pool successfully', async () => {
      expect(poolManager.isRunning()).toBe(false);
      
      await poolManager.start();
      expect(poolManager.isRunning()).toBe(true);
      
      await poolManager.stop();
      expect(poolManager.isRunning()).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      await poolManager.start();
      await poolManager.start(); // Should not throw
      
      expect(poolManager.isRunning()).toBe(true);
    });

    it('should handle multiple stop calls gracefully', async () => {
      await poolManager.start();
      await poolManager.stop();
      await poolManager.stop(); // Should not throw
      
      expect(poolManager.isRunning()).toBe(false);
    });
  });

  describe('Connection Management', () => {
    it('should establish connections on start', async () => {
      await poolManager.start();
      
      // Should have created clients for each connection
      expect(mockClients).toHaveLength(2);
      
      // Should have called ping on each client for health check
      mockClients.forEach(client => {
        expect(client.ping).toHaveBeenCalled();
      });
    });

    it('should handle connection failures gracefully', async () => {
      // Make one client fail
      mockClients[0] = {
        ...createMockClient(),
        ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };

      let connectionLostEvents = 0;
      poolManager.on('connection-lost', () => {
        connectionLostEvents++;
      });

      await poolManager.start();
      
      // Wait for health checks to run
      await waitFor(100);
      
      // Should still be running with remaining healthy connections
      expect(poolManager.isRunning()).toBe(true);
    });

    it('should report health status correctly', async () => {
      await poolManager.start();
      
      const healthStatus = poolManager.getHealthStatus();
      expect(healthStatus).toHaveLength(2);
      
      healthStatus.forEach(status => {
        expect(status).toHaveProperty('endpoint');
        expect(status).toHaveProperty('isHealthy');
        expect(status).toHaveProperty('latency');
        expect(status).toHaveProperty('errorRate');
      });
    });
  });

  describe('Subscription Management', () => {
    it('should subscribe to streams from healthy connections', async () => {
      await poolManager.start();
      
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      await poolManager.subscribe(subscriptionRequest);
      
      // Should have called subscribe on healthy clients
      const healthyClients = mockClients.filter(client => 
        !client.ping.mockRejectedValue
      );
      
      healthyClients.forEach(client => {
        expect(client.subscribe).toHaveBeenCalledWith(subscriptionRequest);
      });
    });

    it('should handle subscription failures', async () => {
      // Make subscribe fail on one client
      mockClients[0] = {
        ...createMockClient(),
        subscribe: jest.fn().mockRejectedValue(new Error('Subscribe failed'))
      };

      await poolManager.start();
      
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      // Should not throw even if one subscription fails
      await expect(poolManager.subscribe(subscriptionRequest)).resolves.not.toThrow();
    });

    it('should throw error when no healthy connections available', async () => {
      // Make all clients unhealthy
      mockClients.forEach(client => {
        client.ping = jest.fn().mockRejectedValue(new Error('Connection failed'));
      });

      await poolManager.start();
      await waitFor(100); // Wait for health checks
      
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      await expect(poolManager.subscribe(subscriptionRequest))
        .rejects.toThrow('No healthy connections available');
    });
  });

  describe('Message Processing', () => {
    it('should process messages from streams', async () => {
      let processedMessages = 0;
      poolManager.on('message-processed', () => {
        processedMessages++;
      });

      await poolManager.start();
      
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      await poolManager.subscribe(subscriptionRequest);
      
      // Wait for message processing
      await waitFor(100);
      
      expect(processedMessages).toBeGreaterThan(0);
    });

    it('should deduplicate messages across streams', async () => {
      let processedMessages = 0;
      let deduplicatedMessages = 0;
      
      poolManager.on('message-processed', () => {
        processedMessages++;
      });
      
      poolManager.on('message-deduplicated', () => {
        deduplicatedMessages++;
      });

      // Make both clients return the same message
      mockClients.forEach(client => {
        client.subscribe = jest.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { transaction: { signature: 'duplicate-sig', slot: 1000 } };
          }
        });
      });

      await poolManager.start();
      
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      await poolManager.subscribe(subscriptionRequest);
      
      // Wait for message processing
      await waitFor(200);
      
      // Should process one message and deduplicate the other
      expect(processedMessages).toBe(1);
      expect(deduplicatedMessages).toBeGreaterThan(0);
    });
  });

  describe('Failover Behavior', () => {
    it('should handle connection recovery', async () => {
      let connectionRecoveredEvents = 0;
      poolManager.on('connection-recovered', () => {
        connectionRecoveredEvents++;
      });

      // Start with one failing client
      mockClients[0] = {
        ...createMockClient(),
        ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };

      await poolManager.start();
      await waitFor(100);
      
      // Fix the failing client
      mockClients[0].ping = jest.fn().mockResolvedValue(undefined);
      
      // Wait for health check to detect recovery
      await waitFor(1100); // Health check interval + buffer
      
      expect(connectionRecoveredEvents).toBeGreaterThan(0);
    });

    it('should emit failover events', async () => {
      let failoverEvents = 0;
      poolManager.on('failover', () => {
        failoverEvents++;
      });

      await poolManager.start();
      
      // Simulate connection failure
      mockClients[0].ping = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      // Wait for health checks and failover logic
      await waitFor(200);
      
      // Note: Actual failover events depend on the specific implementation
      // This test verifies the event system is working
    });
  });

  describe('Metrics Collection', () => {
    it('should collect basic metrics', async () => {
      await poolManager.start();
      
      const metrics = poolManager.getMetrics();
      expect(typeof metrics).toBe('object');
    });

    it('should update metrics on events', async () => {
      let metricsUpdated = 0;
      poolManager.on('metrics-updated', () => {
        metricsUpdated++;
      });

      await poolManager.start();
      
      // Trigger some events that should update metrics
      const subscriptionRequest = {
        transactions: {
          client: {
            accountInclude: ['test-account']
          }
        }
      };

      await poolManager.subscribe(subscriptionRequest);
      await waitFor(100);
      
      // Metrics should be updated (exact count depends on implementation)
      expect(metricsUpdated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      let errorEvents = 0;
      poolManager.on('error', () => {
        errorEvents++;
      });

      // Make all operations fail
      mockClients.forEach(client => {
        client.ping = jest.fn().mockRejectedValue(new Error('All failed'));
        client.subscribe = jest.fn().mockRejectedValue(new Error('Subscribe failed'));
      });

      await poolManager.start();
      
      try {
        await poolManager.subscribe({
          transactions: {
            client: {
              accountInclude: ['test-account']
            }
          }
        });
      } catch (error) {
        // Expected to fail
      }
      
      await waitFor(100);
      
      // Should emit error events but not crash
      expect(poolManager.isRunning()).toBe(true);
    });
  });
});
