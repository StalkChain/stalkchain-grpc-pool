const { createSolanaGrpcPool } = require('../dist/index');

/**
 * Test script to verify endless retry functionality
 * This script will test the pool's ability to continuously retry connections
 * even when all servers are temporarily unavailable
 */
async function testEndlessRetries() {
  console.log('🧪 Testing endless retry functionality...\n');

  // Test connections - mix of valid and invalid endpoints
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
    },
    {
      endpoint: 'https://invalid-endpoint-for-testing.com', // This will fail
      token: 'invalid-token'
    }
  ];

  // Create the pool with high-availability configuration
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

  // Track retry events
  let retryCount = 0;
  let connectionEstablished = 0;
  let connectionLost = 0;
  let errorCount = 0;

  // Set up event handlers to monitor retry behavior
  pool.on('connection-established', (endpoint) => {
    connectionEstablished++;
    console.log(`✅ Connected to: ${endpoint} (Total connections: ${connectionEstablished})`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionLost++;
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message} (Total lost: ${connectionLost})`);
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Recovered connection to: ${endpoint}`);
  });

  pool.on('error', (error, context) => {
    errorCount++;
    if (context && context.includes('stream-processing')) {
      retryCount++;
      console.log(`🔄 Stream error (will retry): ${context} - ${error.message} (Retry #${retryCount})`);
    } else {
      console.log(`⚠️  Error: ${context || 'unknown'} - ${error.message}`);
    }
  });

  pool.on('failover', (from, to, reason) => {
    console.log(`🔀 Failover from ${from} to ${to} (reason: ${reason})`);
  });

  try {
    // Start the pool
    console.log('🚀 Starting gRPC pool...');
    await pool.start();

    // Subscribe to account updates (this will trigger streams)
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
      entry: {},
      commitment: 1, // Processed
      accountsDataSlice: [],
      ping: undefined
    };

    console.log('📡 Starting subscription...');
    await pool.subscribe(subscriptionRequest);

    // Let it run for a while to observe retry behavior
    console.log('⏱️  Running for 2 minutes to observe retry behavior...');
    console.log('   - Valid endpoints should connect and stay connected');
    console.log('   - Invalid endpoints should continuously retry without giving up');
    console.log('   - If all connections fail, they should all keep retrying\n');

    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));

    // Print final statistics
    console.log('\n📊 Final Statistics:');
    console.log(`   - Connections established: ${connectionEstablished}`);
    console.log(`   - Connections lost: ${connectionLost}`);
    console.log(`   - Stream retries: ${retryCount}`);
    console.log(`   - Total errors: ${errorCount}`);
    console.log(`   - Pool is still running: ${pool.isRunning()}`);

    // Verify endless retry behavior
    if (retryCount > 0) {
      console.log('\n✅ SUCCESS: Endless retry functionality is working!');
      console.log('   The pool continuously retries failed connections without giving up.');
    } else {
      console.log('\n⚠️  WARNING: No retries observed. This might indicate:');
      console.log('   - All connections are stable (good!)');
      console.log('   - Or the retry mechanism needs verification');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    console.log('\n🛑 Stopping pool...');
    await pool.stop();
    console.log('✅ Test completed');
  }
}

// Run the test
if (require.main === module) {
  testEndlessRetries().catch(console.error);
}

module.exports = { testEndlessRetries };
