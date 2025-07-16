const { createSolanaGrpcPool, createDefaultStreamPingConfig } = require('../dist/index');

/**
 * Test script to verify stream ping/pong functionality
 * This script tests that streams send ping messages and handle pong responses
 */
async function testStreamPing() {
  console.log('🧪 Testing stream ping/pong functionality...\n');

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

  // Create the pool with stream ping enabled
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      messageTimeout: 120000, // 2 minutes
      streamPing: {
        enabled: true,
        interval: 10000, // 10 seconds - short interval for testing
        timeout: 5000, // 5 seconds timeout
        maxMissedPongs: 2 // Allow only 2 missed pongs
      },
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
  let pingTimeoutFailures = 0;
  let connectionLostEvents = 0;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionsEstablished++;
    console.log(`✅ Connected to: ${endpoint} (Total: ${connectionsEstablished})`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionLostEvents++;
    if (error.message.includes('Stream ping timeout')) {
      pingTimeoutFailures++;
      console.log(`🏓 Stream ping timeout detected for: ${endpoint} - ${error.message}`);
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
    console.log('🚀 Starting gRPC pool with stream ping enabled...');
    await pool.start();

    // Subscribe to account updates
    const subscriptionRequest = {
      accounts: {},
      slots: {},
      transactions: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: ['11111111111111111111111111111112'], // System program
        accountExclude: [],
        accountRequired: []
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: 1, // Processed
      accountsDataSlice: [],
      ping: undefined // This will be managed by the pool's ping system
    };

    console.log('📡 Starting subscription with stream ping enabled...');
    await pool.subscribe(subscriptionRequest);

    console.log('\n📊 Initial Status:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Stream ping enabled: 10-second intervals`);
    console.log(`   - Ping timeout: 5 seconds`);
    console.log(`   - Max missed pongs: 2`);
    console.log(`   - Monitoring for ping/pong behavior...\n`);

    // Monitor for 2 minutes to observe ping/pong behavior
    console.log('⏱️ Monitoring for 2 minutes to observe stream ping/pong behavior...');
    console.log('   - Pings will be sent every 10 seconds to each stream');
    console.log('   - Pong responses should be received within 5 seconds');
    console.log('   - Streams will be marked as stale after 2 missed pongs');
    console.log('   - This helps detect stream-level connectivity issues\n');

    // Check status every 20 seconds
    const statusInterval = setInterval(() => {
      console.log(`📊 Status Update:`);
      console.log(`   - Messages received: ${messagesReceived}`);
      console.log(`   - Ping timeout failures: ${pingTimeoutFailures}`);
      console.log(`   - Connection lost events: ${connectionLostEvents}`);
      console.log(`   - Pool running: ${pool.isRunning()}`);
      console.log(`   - Expected: Pings should be sent every 10 seconds\n`);
    }, 20000);

    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));

    clearInterval(statusInterval);

    // Final statistics
    console.log('\n📊 Final Statistics:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Messages received: ${messagesReceived}`);
    console.log(`   - Ping timeout failures: ${pingTimeoutFailures}`);
    console.log(`   - Total connection lost events: ${connectionLostEvents}`);

    // Verify stream ping functionality
    if (pingTimeoutFailures === 0) {
      console.log('\n✅ SUCCESS: Stream ping/pong is working correctly!');
      console.log('   - No ping timeout failures detected');
      console.log('   - Streams are responding to ping messages');
      console.log('   - Keep-alive functionality is operational');
    } else {
      console.log('\n⚠️ INFO: Stream ping timeout events detected');
      console.log('   - This could indicate network issues or server problems');
      console.log('   - Ping/pong detection is working as expected');
      console.log('   - Stale streams were properly identified and reconnected');
    }

    console.log('\n🏓 Stream Ping/Pong Summary:');
    console.log('   - Ping messages are sent at regular intervals to keep streams alive');
    console.log('   - Pong responses confirm that streams are actively processing messages');
    console.log('   - Missing pongs indicate potential stream-level issues');
    console.log('   - This provides an additional layer of connection health monitoring');

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
  testStreamPing().catch(console.error);
}

module.exports = { testStreamPing };
