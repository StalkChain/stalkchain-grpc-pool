import { 
  createSolanaGrpcPool, 
  registerPoolForGracefulShutdown,
  performGracefulShutdown
} from '../dist/index';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Example demonstrating graceful shutdown of gRPC connections
 * 
 * This example shows how to:
 * 1. Set up a gRPC pool with multiple connections
 * 2. Register it for graceful shutdown
 * 3. Handle manual shutdown
 * 4. Respond to process termination signals (SIGINT, SIGTERM)
 */
async function main() {
  console.log('🚀 Starting graceful shutdown example...');
  
  // Get token from environment variables
  const token = process.env.SOLANA_TRACKER_TOKEN;
  if (!token) {
    console.error('❌ SOLANA_TRACKER_TOKEN environment variable is required');
    process.exit(1);
  }
  
  // Create connection configurations
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token
    }
  ];
  
  // Create the pool
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      }
    }
  });
  
  // Register the pool for graceful shutdown
  // This will automatically handle SIGINT and SIGTERM signals
  registerPoolForGracefulShutdown(pool);
  
  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    console.log(`✅ Connected to: ${endpoint}`);
  });
  
  pool.on('connection-lost', (endpoint, error) => {
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
  });
  
  pool.on('error', (error, context) => {
    console.log(`⚠️ Error: ${context || 'unknown'} - ${error.message}`);
  });
  
  // Start the pool
  await pool.start();
  
  // Subscribe to account updates
  const subscriptionRequest = {
    accounts: {},
    slots: {},
    transactions: {
      vote: false,
      failed: false,
      signature: undefined,
      accountInclude: [],
      accountExclude: [],
      accountRequired: []
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    commitment: 1, // Processed
    accountsDataSlice: [],
    ping: undefined
  };
  
  console.log('📡 Starting subscription...');
  await pool.subscribe(subscriptionRequest);
  
  console.log('\n🔄 Pool is running. You can test graceful shutdown in these ways:');
  console.log('  1. Press Ctrl+C to trigger SIGINT');
  console.log('  2. Run "kill <pid>" in another terminal to trigger SIGTERM');
  console.log('  3. Wait 30 seconds for automatic shutdown');
  console.log('\nPool will gracefully close all connections when shutting down.\n');
  
  // Automatically shut down after 30 seconds
  setTimeout(async () => {
    console.log('\n⏱️ 30 seconds elapsed, performing manual graceful shutdown...');
    await performGracefulShutdown();
    process.exit(0);
  }, 30000);
}

// Run the example
main().catch(error => {
  console.error('❌ Example failed:', error);
  process.exit(1);
});
