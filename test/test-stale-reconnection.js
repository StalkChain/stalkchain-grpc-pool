const { createSolanaGrpcPool } = require('../dist/index');

/**
 * Test script to verify that stale connection detection triggers actual reconnection
 * This script tests both message timeout and stream ping timeout scenarios
 */
async function testStaleReconnection() {
  console.log('🧪 Testing stale connection detection and reconnection...\n');

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

  // Create the pool with aggressive timeouts to trigger stale detection quickly
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      messageTimeout: 30000, // 30 seconds - short timeout to trigger quickly
      streamPing: {
        enabled: true,
        interval: 10000,    // 10 seconds - frequent pings
        timeout: 5000,      // 5 seconds timeout
        maxMissedPongs: 2   // Only allow 2 missed pongs
      },
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      }
    }
  });

  // Track events to verify reconnection behavior
  let connectionsEstablished = 0;
  let connectionsLost = 0;
  let connectionsRecovered = 0;
  let failoverEvents = 0;
  let messageTimeoutEvents = 0;
  let streamPingTimeoutEvents = 0;
  let reconnectionAttempts = 0;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionsEstablished++;
    console.log(`✅ Connected to: ${endpoint} (Total established: ${connectionsEstablished})`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionsLost++;
    
    if (error.message.includes('Message timeout')) {
      messageTimeoutEvents++;
      console.log(`⏰ Message timeout detected for: ${endpoint} - ${error.message}`);
    } else if (error.message.includes('Stream ping timeout')) {
      streamPingTimeoutEvents++;
      console.log(`🏓 Stream ping timeout detected for: ${endpoint} - ${error.message}`);
    } else if (error.message.includes('marked as stale')) {
      reconnectionAttempts++;
      console.log(`🔄 Forced reconnection triggered for: ${endpoint} - ${error.message}`);
    } else {
      console.log(`❌ Connection lost: ${endpoint} - ${error.message}`);
    }
  });

  pool.on('connection-recovered', (endpoint) => {
    connectionsRecovered++;
    console.log(`🔄 Connection recovered: ${endpoint} (Total recovered: ${connectionsRecovered})`);
  });

  pool.on('failover', (from, to, reason) => {
    failoverEvents++;
    console.log(`🔀 Failover: ${from} → ${to} (${reason}) (Total failovers: ${failoverEvents})`);
  });

  pool.on('error', (error, context) => {
    if (context && !context.includes('stream-processing')) {
      console.log(`⚠️ Error: ${context || 'unknown'} - ${error.message}`);
    }
  });

  try {
    // Start the pool
    console.log('🚀 Starting gRPC pool with aggressive stale detection...');
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
      ping: undefined
    };

    console.log('📡 Starting subscription...');
    await pool.subscribe(subscriptionRequest);

    console.log('\n📊 Initial Status:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Message timeout: 30 seconds`);
    console.log(`   - Stream ping interval: 10 seconds`);
    console.log(`   - Stream ping timeout: 5 seconds`);
    console.log(`   - Max missed pongs: 2`);
    console.log('\n⏱️ Monitoring for 3 minutes to observe stale detection and reconnection...');
    console.log('   - Looking for message timeout events');
    console.log('   - Looking for stream ping timeout events');
    console.log('   - Verifying that stale connections trigger actual reconnection');
    console.log('   - Checking that connections recover after being marked as stale\n');

    // Monitor for 3 minutes with status updates every 30 seconds
    const statusInterval = setInterval(() => {
      console.log(`📊 Status Update:`);
      console.log(`   - Connections established: ${connectionsEstablished}`);
      console.log(`   - Connections lost: ${connectionsLost}`);
      console.log(`   - Connections recovered: ${connectionsRecovered}`);
      console.log(`   - Message timeout events: ${messageTimeoutEvents}`);
      console.log(`   - Stream ping timeout events: ${streamPingTimeoutEvents}`);
      console.log(`   - Forced reconnection attempts: ${reconnectionAttempts}`);
      console.log(`   - Failover events: ${failoverEvents}`);
      console.log(`   - Pool running: ${pool.isRunning()}\n`);
    }, 30000);

    // Run for 3 minutes
    await new Promise(resolve => setTimeout(resolve, 180000));

    clearInterval(statusInterval);

    // Final statistics
    console.log('\n📊 Final Test Results:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Connections lost: ${connectionsLost}`);
    console.log(`   - Connections recovered: ${connectionsRecovered}`);
    console.log(`   - Message timeout events: ${messageTimeoutEvents}`);
    console.log(`   - Stream ping timeout events: ${streamPingTimeoutEvents}`);
    console.log(`   - Forced reconnection attempts: ${reconnectionAttempts}`);
    console.log(`   - Failover events: ${failoverEvents}`);

    // Analyze results
    console.log('\n🔍 Analysis:');
    
    if (reconnectionAttempts > 0) {
      console.log('✅ SUCCESS: Stale connection detection triggered forced reconnections!');
      console.log(`   - ${reconnectionAttempts} forced reconnection attempts were made`);
      console.log('   - This means the pool manager is properly detecting stale connections');
      console.log('   - And it\'s actually forcing them to reconnect (not just doing failover)');
    } else {
      console.log('⚠️ INFO: No forced reconnections detected');
      console.log('   - This could mean connections are stable (good!)');
      console.log('   - Or the stale detection timeouts weren\'t reached');
    }

    if (connectionsRecovered > connectionsLost) {
      console.log('✅ SUCCESS: More recoveries than losses detected!');
      console.log('   - This indicates the reconnection mechanism is working');
      console.log('   - Connections are successfully recovering after being marked as stale');
    }

    if (messageTimeoutEvents > 0 || streamPingTimeoutEvents > 0) {
      console.log('✅ SUCCESS: Stale detection mechanisms are working!');
      if (messageTimeoutEvents > 0) {
        console.log(`   - Message timeout detection: ${messageTimeoutEvents} events`);
      }
      if (streamPingTimeoutEvents > 0) {
        console.log(`   - Stream ping timeout detection: ${streamPingTimeoutEvents} events`);
      }
    }

    console.log('\n🎯 Key Improvements Made:');
    console.log('   - Added forceReconnect() method to ConnectionManager');
    console.log('   - Updated handleConnectionFailure() to actually trigger reconnection');
    console.log('   - Now stale connections are forced to reconnect, not just failed over');
    console.log('   - Both message timeout and stream ping timeout trigger reconnection');

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
  testStaleReconnection().catch(console.error);
}

module.exports = { testStaleReconnection };
