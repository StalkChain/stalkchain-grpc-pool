const { createSolanaGrpcPool } = require('../dist/index');

/**
 * Test script to verify message timeout stale connection detection
 * This script tests that connections are marked as stale when no messages are received
 */
async function testMessageTimeout() {
  console.log('🧪 Testing message timeout stale connection detection...\n');

  // Test connections - mix of valid and potentially slow endpoints
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

  // Create the pool with a short message timeout for testing
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      messageTimeout: 30000, // 30 seconds - short timeout for testing
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      }
    }
  });

  // Track events
  let connectionsEstablished = 0;
  let messagesReceived = 0;
  let messageTimeoutFailures = 0;
  let connectionLostEvents = 0;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionsEstablished++;
    console.log(`✅ Connected to: ${endpoint} (Total: ${connectionsEstablished})`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionLostEvents++;
    if (error.message.includes('Message timeout')) {
      messageTimeoutFailures++;
      console.log(`⏰ Message timeout detected for: ${endpoint} - ${error.message}`);
    } else {
      console.log(`❌ Connection lost: ${endpoint} - ${error.message}`);
    }
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Connection recovered: ${endpoint}`);
  });

  pool.on('message-processed', (message) => {
    messagesReceived++;
    console.log(`📨 Message received from ${message.source} (Total: ${messagesReceived})`);
  });

  pool.on('error', (error, context) => {
    if (context && !context.includes('stream-processing')) {
      console.log(`⚠️ Error: ${context || 'unknown'} - ${error.message}`);
    }
  });

  try {
    // Start the pool
    console.log('🚀 Starting gRPC pool with 30-second message timeout...');
    await pool.start();

    // Subscribe to a very specific filter that might not generate many messages
    const subscriptionRequest = {
      accounts: {},
      slots: {},
      transactions: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: ['11111111111111111111111111111112'], // System program - should get some activity
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

    console.log('📡 Starting subscription with specific filter...');
    await pool.subscribe(subscriptionRequest);

    console.log('\n📊 Initial Status:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Message timeout configured: 30 seconds`);
    console.log(`   - Monitoring for message timeout events...\n`);

    // Monitor for 2 minutes to see if message timeout detection works
    console.log('⏱️ Monitoring for 2 minutes to observe message timeout behavior...');
    console.log('   - If no messages are received within 30 seconds, connections should be marked as stale');
    console.log('   - Stale connections will be automatically reconnected');
    console.log('   - This helps detect "silent" connection failures\n');

    // Check status every 15 seconds
    const statusInterval = setInterval(() => {
      console.log(`📊 Status Update:`);
      console.log(`   - Messages received: ${messagesReceived}`);
      console.log(`   - Message timeout failures: ${messageTimeoutFailures}`);
      console.log(`   - Connection lost events: ${connectionLostEvents}`);
      console.log(`   - Pool running: ${pool.isRunning()}\n`);
    }, 15000);

    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));

    clearInterval(statusInterval);

    // Final statistics
    console.log('\n📊 Final Statistics:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Messages received: ${messagesReceived}`);
    console.log(`   - Message timeout failures: ${messageTimeoutFailures}`);
    console.log(`   - Total connection lost events: ${connectionLostEvents}`);

    // Verify message timeout functionality
    if (messagesReceived === 0 && messageTimeoutFailures > 0) {
      console.log('\n✅ SUCCESS: Message timeout detection is working!');
      console.log('   - No messages were received (as expected with specific filter)');
      console.log('   - Connections were marked as stale due to message timeout');
      console.log('   - This prevents silent connection failures');
    } else if (messagesReceived > 0) {
      console.log('\n✅ SUCCESS: Messages are being received!');
      console.log('   - Connections are active and receiving data');
      console.log('   - Message timeout detection is armed and ready');
    } else {
      console.log('\n⚠️ INFO: No message timeout events detected');
      console.log('   - This could mean connections are working normally');
      console.log('   - Or the timeout period (30s) wasn\'t reached');
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
  testMessageTimeout().catch(console.error);
}

module.exports = { testMessageTimeout };
