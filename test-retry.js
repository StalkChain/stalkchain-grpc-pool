require('dotenv').config();
const { createSolanaGrpcPool } = require('./dist');

async function testRetryBehavior() {
  console.log('🚀 Testing gRPC Pool Retry Behavior...');

  // Check if API key is available
  if (!process.env.SOLANA_TRACKER_API_KEY) {
    console.error('❌ SOLANA_TRACKER_API_KEY not found in environment variables');
    process.exit(1);
  }

  // Include the problematic public node to test retry behavior
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_API_KEY
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_API_KEY
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
      token: '' // Public endpoint - this will likely fail with 401 just to test the pooling will still work if one grpc fails
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

  // Set up event handlers to monitor retry behavior
  let messageCount = 0;
  let errorCount = 0;
  let retryCount = 0;

  pool.on('connection-established', (endpoint) => {
    console.log(`✅ Connected to: ${endpoint}`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Recovered connection to: ${endpoint}`);
  });

  pool.on('error', (error, context) => {
    errorCount++;
    if (context && context.includes('stream-processing')) {
      retryCount++;
      console.log(`🔄 Stream error (will retry): ${context} - ${error.message}`);
    } else {
      console.log(`💥 Error in ${context || 'unknown'}: ${error.message}`);
    }
  });

  pool.on('message-processed', (message) => {
    messageCount++;
    
    // Extract signature for display
    let signature = 'NO_SIGNATURE';
    if (message.data && message.data.signature) {
      if (Buffer.isBuffer(message.data.signature)) {
        signature = message.data.signature.toString('base64').substring(0, 12) + '...';
      } else {
        signature = message.data.signature.toString().substring(0, 12) + '...';
      }
    }

    console.log(`📨 #${messageCount} | ${signature} | from: ${message.source} | slot: ${message.data?.slot || 'unknown'}`);
  });

  try {
    // Start the pool
    console.log('Starting pool...');
    await pool.start();
    
    // Wait for connections to establish
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check health status
    const health = pool.getHealthStatus();
    console.log('\n📊 Health Status:');
    health.forEach(h => {
      console.log(`  ${h.endpoint}: ${h.isHealthy ? '✅ Healthy' : '❌ Unhealthy'} (${h.latency}ms, ${(h.errorRate * 100).toFixed(1)}% errors)`);
    });
    
    const healthyCount = health.filter(h => h.isHealthy).length;
    console.log(`\n🏥 ${healthyCount}/${health.length} connections are healthy`);

    if (healthyCount === 0) {
      console.log('❌ No healthy connections available. Check your endpoints and tokens.');
      await pool.stop();
      return;
    }

    // Subscribe to transactions
    console.log('\n🔔 Subscribing to Solana transactions...');
    
    const subscriptionRequest = {
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        alltxs: {
          accountInclude: [
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
            "TokenzQdB6q6JkUeT2XkC1gYwA9kL5QkUuU2eQ3M7z6"  // Token-2022 Program
          ],
          accountExclude: [],
          accountRequired: [],
          vote: false,
          failed: false
        }
      },
      slots: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: 'CONFIRMED'
    };

    await pool.subscribe(subscriptionRequest);
    console.log('✅ Subscription started! Monitoring for 60 seconds to observe retry behavior...\n');

    // Monitor for 60 seconds to see retry behavior
    const startTime = Date.now();
    const monitoringInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = 60 - elapsed;

      console.log(`\n⏰ Status Update (${elapsed}s elapsed, ${remaining}s remaining):`);
      console.log(`   Messages received: ${messageCount}`);
      console.log(`   Stream errors (with retries): ${retryCount}`);
      console.log(`   Total errors: ${errorCount}`);

      const currentHealth = pool.getHealthStatus();
      const currentHealthyCount = currentHealth.filter(h => h.isHealthy).length;
      console.log(`   Healthy connections: ${currentHealthyCount}/${currentHealth.length}`);
      console.log('');
    }, 15000); // Update every 15 seconds

    await new Promise(resolve => setTimeout(resolve, 60000));
    clearInterval(monitoringInterval);

    // Show final stats
    console.log('\n📈 Final Statistics:');
    console.log(`  Messages processed: ${messageCount}`);
    console.log(`  Stream errors with retries: ${retryCount}`);
    console.log(`  Total errors: ${errorCount}`);
    console.log(`  Pool remained stable: ${messageCount > 0 ? '✅ YES' : '❌ NO'}`);

    const finalHealth = pool.getHealthStatus();
    const finalHealthyCount = finalHealth.filter(h => h.isHealthy).length;
    console.log(`  Final health: ${finalHealthyCount}/${finalHealth.length} connections healthy`);

    if (retryCount > 0) {
      console.log('\n✅ SUCCESS: Pool handled stream failures gracefully with automatic retries!');
      console.log('   The process did not crash and continued processing messages.');
    } else {
      console.log('\n⚠️  No stream failures detected during test period.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    console.log('\n🛑 Stopping pool...');
    await pool.stop();
    console.log('✅ Pool stopped. Test complete!');
  }
}

// Run the test
testRetryBehavior().catch(console.error);
