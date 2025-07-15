import { createSolanaGrpcPool, PoolBuilder } from '../src';
import { createDefaultLogger, LogLevel } from '../src/utils/logger';

/**
 * Example using SolanaTracker gRPC endpoints with fallback to public endpoint
 * This demonstrates active-active pooling with automatic failover
 */
async function main() {
  const logger = createDefaultLogger(LogLevel.INFO);
  
  // Configuration for your 3 gRPC endpoints
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: 'your_key_here'
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io', 
      token: 'your_key_here'
    },
    {
      endpoint: 'solana-yellowstone-grpc.publicnode.com:443',
      token: '' // Public endpoint doesn't need token
    }
  ];

  // Create high-availability pool optimized for Solana
  const pool = new PoolBuilder()
    .addConnections(connections)
    .setDeduplicationWindow(120000) // 2 minutes for fast Solana blocks
    .setCacheSize(500000) // Large cache for high transaction volume
    .setCircuitBreaker({
      errorThresholdPercentage: 25, // Very sensitive for blockchain data
      minimumRequestThreshold: 3,
      resetTimeout: 10000, // Fast recovery - 10 seconds
      timeout: 3000 // Short timeout for real-time data
    })
    .setHealthMonitoring(true)
    .setMetrics(true)
    .setLogger(logger)
    .buildForSolana();

  // Set up event handlers for monitoring
  setupEventHandlers(pool, logger);

  try {
    logger.info('Starting gRPC pool with SolanaTracker endpoints...');
    await pool.start();

    // Wait a moment for connections to establish
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check initial health status
    const healthStatus = pool.getHealthStatus();
    logger.info(`Pool started with ${healthStatus.filter(h => h.isHealthy).length}/${healthStatus.length} healthy connections`);

    // Subscribe to Solana transactions
    // You can customize this based on what you want to monitor
    const subscriptionRequest = {
      transactions: {
        client: {
          // Monitor system program transactions (very active)
          // 11111111111111111111111111111112
          accountInclude: ['6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma'],
          // Exclude vote transactions to reduce noise
          vote: false,
          failed: false
        }
      },
      // You can also monitor accounts, slots, etc.
      accounts: {
        client: {
          accountInclude: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] // USDC mint
        }
      },
      commitment: 'CONFIRMED'
    };

    logger.info('Starting subscription to Solana transactions...');
    await pool.subscribe(subscriptionRequest);

    // Keep the process running
    logger.info('Pool is running. Press Ctrl+C to stop.');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      await pool.stop();
      process.exit(0);
    });

    // Keep alive
    setInterval(() => {
      const metrics = pool.getMetrics();
      const health = pool.getHealthStatus();
      const healthyCount = health.filter(h => h.isHealthy).length;
      
      logger.info(`Status: ${healthyCount}/${health.length} healthy connections, processed: ${metrics.messages_processed || 0} messages`);
    }, 30000); // Log status every 30 seconds

  } catch (error) {
    logger.error('Failed to start pool:', error);
    process.exit(1);
  }
}

/**
 * Set up comprehensive event handlers for monitoring
 */
function setupEventHandlers(pool: any, logger: any) {
  // Connection events
  pool.on('connection-established', (endpoint: string) => {
    logger.info(`✅ Connected to ${endpoint}`);
  });

  pool.on('connection-lost', (endpoint: string, error: Error) => {
    logger.warn(`❌ Lost connection to ${endpoint}: ${error.message}`);
  });

  pool.on('connection-recovered', (endpoint: string) => {
    logger.info(`🔄 Recovered connection to ${endpoint}`);
  });

  // Failover events
  pool.on('failover', (from: string, to: string, reason: string) => {
    logger.warn(`🔀 Failover from ${from} to ${to}: ${reason}`);
  });

  // Message processing events
  let messageCount = 0;
  let duplicateCount = 0;

  pool.on('message-processed', (message: any) => {
    messageCount++;
    
    // Log every 100th message to avoid spam
    if (messageCount % 100 === 0) {
      logger.info(`📨 Processed ${messageCount} messages (${duplicateCount} duplicates filtered)`);
    }

    // You can process the actual transaction data here
    if (message.type === 'transaction' && message.data) {
      const tx = message.data;
      // Example: Log high-value transactions
      // if (tx.slot && tx.signature) {
      //   logger.debug(`Transaction: ${tx.signature} in slot ${tx.slot}`);
      // }
    }
  });

  pool.on('message-deduplicated', (signature: string, source: string) => {
    duplicateCount++;
    // Uncomment to see deduplication in action
    // logger.debug(`🔄 Deduplicated ${signature} from ${source}`);
  });

  // Circuit breaker events
  pool.on('circuit-breaker-opened', (endpoint: string) => {
    logger.warn(`⚡ Circuit breaker opened for ${endpoint}`);
  });

  pool.on('circuit-breaker-closed', (endpoint: string) => {
    logger.info(`⚡ Circuit breaker closed for ${endpoint}`);
  });

  // Health monitoring
  pool.on('health-check', (metrics: any[]) => {
    const unhealthyEndpoints = metrics.filter(m => !m.isHealthy);
    if (unhealthyEndpoints.length > 0) {
      logger.warn(`🏥 Unhealthy endpoints: ${unhealthyEndpoints.map(m => m.endpoint).join(', ')}`);
    }
  });

  // Error handling
  pool.on('error', (error: Error, context?: string) => {
    logger.error(`💥 Error${context ? ` in ${context}` : ''}: ${error.message}`);
  });

  // Metrics updates
  pool.on('metrics-updated', (metrics: Record<string, number>) => {
    // You can send these metrics to your monitoring system
    // logger.debug('Metrics updated:', metrics);
  });
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

export { main as runSolanaTrackerExample };
