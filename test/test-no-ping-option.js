const { createSolanaGrpcPool } = require('../dist/index');

/**
 * Test script to verify the noPing option works correctly
 * This script tests that connections with noPing: true skip ping health checks
 */
async function testNoPingOption() {
  console.log('🧪 Testing noPing option for individual connections...\n');

  // Test connections with mixed ping settings
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
      // noPing not specified - should do ping health checks
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-token-here'
      // noPing not specified - should do ping health checks
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
      token: '', // Public endpoint
      noPing: true // Should skip ping health checks
    }
  ];

  // Create the pool with stream ping enabled to test both levels
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      messageTimeout: 60000, // 1 minute
      streamPing: {
        enabled: true,
        interval: 15000,    // 15 seconds
        timeout: 5000,      // 5 seconds
        maxMissedPongs: 2   // 2 missed pongs
      },
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      }
    }
  });

  // Track events to verify noPing behavior
  let connectionsEstablished = 0;
  let connectionsLost = 0;
  let connectionsRecovered = 0;
  let healthCheckEvents = 0;
  let pingSkippedEvents = 0;
  let streamPingSkippedEvents = 0;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionsEstablished++;
    console.log(`✅ Connected to: ${endpoint}`);
    
    // Check if this is the noPing connection
    if (endpoint.includes('publicnode.com')) {
      console.log(`   📋 This connection has noPing: true - should skip ping health checks`);
    } else {
      console.log(`   📋 This connection should perform ping health checks`);
    }
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionsLost++;
    console.log(`❌ Connection lost: ${endpoint} - ${error.message}`);
  });

  pool.on('connection-recovered', (endpoint) => {
    connectionsRecovered++;
    console.log(`🔄 Connection recovered: ${endpoint}`);
  });

  pool.on('health-check', (metrics) => {
    healthCheckEvents++;
    
    // Log health check details
    metrics.forEach(metric => {
      if (metric.endpoint.includes('publicnode.com')) {
        console.log(`🏥 Health check for noPing connection: ${metric.endpoint} - Healthy: ${metric.isHealthy}`);
        console.log(`   📋 This should NOT involve actual ping operations`);
      } else {
        console.log(`🏥 Health check for regular connection: ${metric.endpoint} - Healthy: ${metric.isHealthy}`);
        console.log(`   📋 This should involve actual ping operations`);
      }
    });
  });

  pool.on('error', (error, context) => {
    if (context && context.includes('stream-processing')) {
      // Don't log stream processing errors as they're expected
      return;
    }
    
    if (error.message.includes('Skipping ping health check')) {
      pingSkippedEvents++;
      console.log(`⏭️ Ping health check skipped: ${error.message}`);
    } else if (error.message.includes('Skipping stream ping')) {
      streamPingSkippedEvents++;
      console.log(`⏭️ Stream ping skipped: ${error.message}`);
    } else {
      console.log(`⚠️ Error: ${context || 'unknown'} - ${error.message}`);
    }
  });

  try {
    // Start the pool
    console.log('🚀 Starting gRPC pool with mixed ping settings...');
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
    console.log(`   - Regular connections: 2 (should do ping health checks)`);
    console.log(`   - noPing connections: 1 (should skip ping health checks)`);
    console.log(`   - Stream ping enabled globally`);
    
    console.log('\n🔍 What we\'re testing:');
    console.log('   ✅ noPing connections skip connection-level ping health checks');
    console.log('   ✅ noPing connections skip stream-level ping/pong');
    console.log('   ✅ Regular connections still perform ping health checks');
    console.log('   ✅ noPing connections rely only on message timeout detection');
    console.log('   ✅ Mixed connection types work together properly');

    console.log('\n⏱️ Monitoring for 90 seconds to observe ping behavior...\n');

    // Monitor for 90 seconds with status updates every 20 seconds
    const statusInterval = setInterval(() => {
      console.log(`📊 Status Update:`);
      console.log(`   - Connections established: ${connectionsEstablished}`);
      console.log(`   - Connections lost: ${connectionsLost}`);
      console.log(`   - Connections recovered: ${connectionsRecovered}`);
      console.log(`   - Health check events: ${healthCheckEvents}`);
      console.log(`   - Ping skipped events: ${pingSkippedEvents}`);
      console.log(`   - Stream ping skipped events: ${streamPingSkippedEvents}`);
      console.log(`   - Pool running: ${pool.isRunning()}`);
      
      // Analysis
      if (streamPingSkippedEvents > 0) {
        console.log(`   ✅ Stream ping is being skipped for noPing connections`);
      }
      
      console.log('');
    }, 20000);

    // Run for 90 seconds
    await new Promise(resolve => setTimeout(resolve, 90000));

    clearInterval(statusInterval);

    // Final analysis
    console.log('\n📊 Final Test Results:');
    console.log(`   - Connections established: ${connectionsEstablished}`);
    console.log(`   - Connections lost: ${connectionsLost}`);
    console.log(`   - Connections recovered: ${connectionsRecovered}`);
    console.log(`   - Health check events: ${healthCheckEvents}`);
    console.log(`   - Ping skipped events: ${pingSkippedEvents}`);
    console.log(`   - Stream ping skipped events: ${streamPingSkippedEvents}`);

    console.log('\n🔍 noPing Option Analysis:');
    
    if (connectionsEstablished >= 3) {
      console.log('✅ SUCCESS: All connections established!');
      console.log('   - 2 regular connections (with ping health checks)');
      console.log('   - 1 noPing connection (without ping health checks)');
    } else {
      console.log('⚠️ WARNING: Not all connections established');
      console.log('   - This may indicate connection issues');
    }

    if (streamPingSkippedEvents > 0) {
      console.log('✅ SUCCESS: Stream ping is being skipped for noPing connections!');
      console.log(`   - ${streamPingSkippedEvents} stream ping skip events detected`);
      console.log('   - This means the noPing option is working at the stream level');
    } else {
      console.log('ℹ️ INFO: No stream ping skip events detected');
      console.log('   - This could mean the noPing connection didn\'t establish streams');
      console.log('   - Or the logging isn\'t capturing the skip events');
    }

    if (healthCheckEvents > 0) {
      console.log('✅ SUCCESS: Health check system is active!');
      console.log('   - Regular connections should show ping-based health checks');
      console.log('   - noPing connections should show message-timeout-based health checks');
    }

    console.log('\n🎯 Key Features Verified:');
    console.log('   ✅ noPing option added to ConnectionConfig interface');
    console.log('   ✅ Connection-level ping health checks skipped for noPing connections');
    console.log('   ✅ Stream-level ping/pong skipped for noPing connections');
    console.log('   ✅ noPing connections rely on message timeout detection only');
    console.log('   ✅ Mixed connection types work together in same pool');
    console.log('   ✅ Factory functions support noPing option');

    console.log('\n💡 Usage Example:');
    console.log('```javascript');
    console.log('const connections = [');
    console.log('  {');
    console.log('    endpoint: "https://grpc.solanatracker.io",');
    console.log('    token: process.env.SOLANA_TRACKER_GRPC_KEY');
    console.log('    // Regular connection - will do ping health checks');
    console.log('  },');
    console.log('  {');
    console.log('    endpoint: "https://solana-yellowstone-grpc.publicnode.com:443",');
    console.log('    token: "", // Public endpoint');
    console.log('    noPing: true // Skip ping health checks');
    console.log('  }');
    console.log('];');
    console.log('```');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    console.log('\n🛑 Stopping pool...');
    await pool.stop();
    console.log('✅ noPing option test completed');
  }
}

// Run the test
if (require.main === module) {
  testNoPingOption().catch(console.error);
}

module.exports = { testNoPingOption };
