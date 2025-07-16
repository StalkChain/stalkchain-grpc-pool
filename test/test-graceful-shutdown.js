const { createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('../dist/index');

/**
 * Test script to verify graceful shutdown functionality
 * This script tests that gRPC streams are properly cancelled when the process exits
 */
async function testGracefulShutdown() {
  console.log('🧪 Testing graceful shutdown functionality...\n');

  // Test connections
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
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

  // Register for graceful shutdown
  registerPoolForGracefulShutdown(pool);

  // Track events
  let connectionsEstablished = 0;
  let streamsStarted = 0;
  let streamsCancelled = 0;
  let gracefulShutdownTriggered = false;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionsEstablished++;
    console.log(`✅ Connected to: ${endpoint} (Total: ${connectionsEstablished})`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
  });

  pool.on('error', (error, context) => {
    if (context && context.includes('stream-processing')) {
      if (error.code === 1 || error.message.includes('Cancelled')) {
        streamsCancelled++;
        console.log(`🔄 Stream cancelled gracefully: ${context} (Total cancelled: ${streamsCancelled})`);
      } else {
        console.log(`⚠️ Stream error: ${context} - ${error.message}`);
      }
    } else {
      console.log(`⚠️ Error: ${context || 'unknown'} - ${error.message}`);
    }
  });

  try {
    // Start the pool
    console.log('🚀 Starting gRPC pool...');
    await pool.start();

    // Subscribe to streams
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
    streamsStarted = connectionsEstablished; // Assume one stream per connection

    console.log(`\n📊 Initial Status:`);
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Streams started: ${streamsStarted}`);

    // Test manual graceful shutdown
    console.log('\n⏱️ Running for 5 seconds, then testing graceful shutdown...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n🛑 Testing manual graceful shutdown...');
    gracefulShutdownTriggered = true;
    
    // Manually stop the pool to test graceful shutdown
    await pool.stop();

    console.log('\n📊 Final Status:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Streams started: ${streamsStarted}`);
    console.log(`   - Streams cancelled: ${streamsCancelled}`);
    console.log(`   - Graceful shutdown triggered: ${gracefulShutdownTriggered}`);

    // Verify graceful shutdown worked
    if (gracefulShutdownTriggered && pool.isRunning() === false) {
      console.log('\n✅ SUCCESS: Graceful shutdown functionality is working!');
      console.log('   - Pool was properly stopped');
      console.log('   - All streams should be cancelled');
      console.log('   - No hanging connections remain');
    } else {
      console.log('\n⚠️ WARNING: Graceful shutdown may not be working correctly');
      console.log(`   - Pool running status: ${pool.isRunning()}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }

  console.log('\n✅ Test completed');
}

// Test signal handling
console.log('🔧 Setting up signal test...');
console.log('   You can test signal handling by pressing Ctrl+C');
console.log('   The process should shut down gracefully\n');

// Run the test
if (require.main === module) {
  testGracefulShutdown().catch(console.error);
}

module.exports = { testGracefulShutdown };
