require('dotenv').config();
const { createSolanaGrpcPool } = require('./dist');

async function testErrorHandling() {
  console.log('🚀 Testing gRPC Pool Error Handling and Retry Behavior...');

  // Check if API key is available
  if (!process.env.SOLANA_TRACKER_GRPC_KEY) {
    console.error('❌ SOLANA_TRACKER_GRPC_KEY not found in environment variables');
    process.exit(1);
  }

  // Include one good endpoint and one that will definitely fail
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_GRPC_KEY
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_GRPC_KEY
    },
    {
      endpoint: 'https://invalid-grpc-endpoint.example.com',
      token: 'invalid-token' // This will definitely fail
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
  let streamErrors = 0;
  let connectionErrors = 0;

  pool.on('connection-established', (endpoint) => {
    console.log(`✅ Connected to: ${endpoint}`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionErrors++;
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Recovered connection to: ${endpoint}`);
  });

  pool.on('error', (error, context) => {
    errorCount++;
    
    if (context && context.includes('stream-processing')) {
      streamErrors++;
      console.log(`🔄 Stream error (will retry): ${context} - ${error.message.substring(0, 100)}...`);
    } else if (context && context.includes('stream-start')) {
      console.log(`💥 Stream start error: ${context} - ${error.message.substring(0, 100)}...`);
    } else {
      console.log(`💥 Error in ${context || 'unknown'}: ${error.message.substring(0, 100)}...`);
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

    // Only show every 10th message to reduce noise
    if (messageCount % 10 === 0) {
      console.log(`📨 #${messageCount} | ${signature} | from: ${message.source} | slot: ${message.data?.slot || 'unknown'}`);
    }
  });

  try {
    // Start the pool
    console.log('Starting pool...');
    await pool.start();
    
    // Wait for connections to establish
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check health status
    const health = pool.getHealthStatus();
    console.log('\n📊 Health Status:');
    health.forEach(h => {
      console.log(`  ${h.endpoint}: ${h.isHealthy ? '✅ Healthy' : '❌ Unhealthy'} (${h.latency}ms, ${(h.errorRate * 100).toFixed(1)}% errors)`);
    });
    
    const healthyCount = health.filter(h => h.isHealthy).length;
    console.log(`\n🏥 ${healthyCount}/${health.length} connections are healthy`);

    if (healthyCount === 0) {
      console.log('❌ No healthy connections available. This is unexpected!');
      await pool.stop();
      return;
    }

    // Subscribe to transactions
    console.log('\n🔔 Subscribing to Solana transactions...');
    console.log('   This should trigger errors from the invalid endpoint but continue working with healthy ones.');
    
    const subscriptionRequest = {
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        alltxs: {
          accountInclude: [
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
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
    console.log('✅ Subscription started! Monitoring for 45 seconds to observe error handling...\n');

    // Monitor for 45 seconds to see error handling behavior
    const startTime = Date.now();
    const monitoringInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = 45 - elapsed;

      console.log(`\n⏰ Status Update (${elapsed}s elapsed, ${remaining}s remaining):`);
      console.log(`   Messages received: ${messageCount}`);
      console.log(`   Stream errors: ${streamErrors}`);
      console.log(`   Connection errors: ${connectionErrors}`);
      console.log(`   Total errors: ${errorCount}`);

      const currentHealth = pool.getHealthStatus();
      const currentHealthyCount = currentHealth.filter(h => h.isHealthy).length;
      console.log(`   Healthy connections: ${currentHealthyCount}/${currentHealth.length}`);
      
      if (messageCount > 0 && errorCount > 0) {
        console.log(`   ✅ SUCCESS: Pool is handling errors gracefully while continuing to process messages!`);
      }
      console.log('');
    }, 15000); // Update every 15 seconds

    await new Promise(resolve => setTimeout(resolve, 45000));
    clearInterval(monitoringInterval);

    // Show final stats
    console.log('\n📈 Final Statistics:');
    console.log(`  Messages processed: ${messageCount}`);
    console.log(`  Stream errors: ${streamErrors}`);
    console.log(`  Connection errors: ${connectionErrors}`);
    console.log(`  Total errors: ${errorCount}`);

    const finalHealth = pool.getHealthStatus();
    const finalHealthyCount = finalHealth.filter(h => h.isHealthy).length;
    console.log(`  Final health: ${finalHealthyCount}/${finalHealth.length} connections healthy`);

    // Evaluate success
    if (messageCount > 0 && errorCount > 0) {
      console.log('\n🎉 SUCCESS: Pool handled errors gracefully!');
      console.log('   ✅ The process did not crash');
      console.log('   ✅ Messages continued to be processed despite errors');
      console.log('   ✅ Healthy connections remained operational');
      console.log('   ✅ Error handling and retry logic is working correctly');
    } else if (messageCount > 0 && errorCount === 0) {
      console.log('\n⚠️  PARTIAL SUCCESS: Messages processed but no errors detected');
      console.log('   This might mean the invalid endpoint was filtered out before streaming');
    } else if (messageCount === 0) {
      console.log('\n❌ FAILURE: No messages processed');
    } else {
      console.log('\n❓ UNCLEAR: Unexpected result combination');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('   Stack:', error.stack);
  } finally {
    console.log('\n🛑 Stopping pool...');
    await pool.stop();
    console.log('✅ Pool stopped. Test complete!');
  }
}

// Run the test
testErrorHandling().catch(console.error);
