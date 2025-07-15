require('dotenv').config();
const { createSolanaGrpcPool } = require('./dist');

async function testPool() {
  console.log('🚀 Starting gRPC Pool Test with SolanaTracker endpoints...');

  // Check if API key is available
  if (!process.env.SOLANA_TRACKER_API_KEY) {
    console.error('❌ SOLANA_TRACKER_API_KEY not found in environment variables');
    console.error('   Please create a .env file with: SOLANA_TRACKER_API_KEY=your_api_key_here');
    process.exit(1);
  }

  // Your 3 gRPC endpoints
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
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
      token: '' // Public endpoint
    }
  ];

  // Create the pool
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000, // 1 minute for testing
      maxCacheSize: 10000,
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      }
    }
  });

  // Set up event handlers
  let messageCount = 0;
  let duplicateCount = 0;
  let connectionEvents = [];

  pool.on('connection-established', (endpoint) => {
    console.log(`✅ Connected to: ${endpoint}`);
    connectionEvents.push({ type: 'connected', endpoint, time: new Date() });
  });

  pool.on('connection-lost', (endpoint, error) => {
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
    connectionEvents.push({ type: 'lost', endpoint, error: error.message, time: new Date() });
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Recovered connection to: ${endpoint}`);
    connectionEvents.push({ type: 'recovered', endpoint, time: new Date() });
  });

  pool.on('failover', (from, to, reason) => {
    console.log(`🔀 Failover: ${from} → ${to} (${reason})`);
  });

  pool.on('message-processed', (message) => {
    messageCount++;

    // Extract and convert signature from the message (Buffer to readable string)
    let signature = 'NO_SIGNATURE';
    if (message.data && message.data.signature) {
      if (Buffer.isBuffer(message.data.signature)) {
        // Convert buffer to base64 for display (first 12 chars for readability)
        signature = message.data.signature.toString('base64').substring(0, 12) + '...';
      } else {
        signature = message.data.signature.toString().substring(0, 12) + '...';
      }
    }

    // Simple one-line log with signature and source
    console.log(`📨 #${messageCount} | ${signature} | from: ${message.source} | slot: ${message.data?.slot || 'unknown'}`);

    // Log summary every 25 messages
    if (messageCount % 25 === 0) {
      console.log(`\n� SUMMARY: Processed ${messageCount} messages (${duplicateCount} duplicates filtered)\n`);
    }
  });

  pool.on('message-deduplicated', (signature, source) => {
    duplicateCount++;
    // Signature here is already converted to string by deduplication engine
    const shortSig = signature.substring(0, 12) + '...';
    // console.log(`🔄 DUPLICATE: ${shortSig} | from: ${source} | ❌ FILTERED OUT`);
  });

  pool.on('error', (error, context) => {
    console.log(`💥 Error${context ? ` in ${context}` : ''}: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
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

    // Subscribe using the correct Yellowstone gRPC format
    console.log('\n🔔 Subscribing to Solana transactions...');
    console.log('   Target accounts: Token Programs (very active)');
    console.log('   - TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token)');
    console.log('   - TokenzQdB6q6JkUeT2XkC1gYwA9kL5QkUuU2eQ3M7z6 (Token-2022)');
    console.log('   Commitment: CONFIRMED');
    console.log('   Vote transactions: excluded');
    console.log('   Failed transactions: excluded\n');

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

    console.log('📋 Subscription request:', JSON.stringify(subscriptionRequest, null, 2));

    try {
      await pool.subscribe(subscriptionRequest);
      console.log('✅ Subscription call completed successfully');
    } catch (error) {
      console.log('❌ Subscription failed:', error.message);
      console.log('   Stack:', error.stack);
      throw error;
    }

    console.log('✅ Subscription started! Monitoring for 30 seconds...');
    console.log('   This will show unified stream from all healthy connections');
    console.log('   Duplicates are automatically filtered out');
    console.log('   Format: 📨 #count | signature | from: endpoint | slot: number');
    console.log('   Waiting for messages...\n');

    // Monitor for 30 seconds with periodic status updates
    console.log('⏱️  Starting 30-second monitoring period...\n');

    const startTime = Date.now();
    const monitoringInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = 30 - elapsed;

      console.log(`\n⏰ Status Update (${elapsed}s elapsed, ${remaining}s remaining):`);
      console.log(`   Messages received: ${messageCount}`);
      console.log(`   Duplicates filtered: ${duplicateCount}`);

      const currentHealth = pool.getHealthStatus();
      const currentHealthyCount = currentHealth.filter(h => h.isHealthy).length;
      console.log(`   Healthy connections: ${currentHealthyCount}/${currentHealth.length}`);

      if (messageCount === 0) {
        console.log('   ⚠️  No messages received yet - this might be normal if the account is not very active');
      }
      console.log('');
    }, 10000); // Update every 10 seconds

    await new Promise(resolve => setTimeout(resolve, 30000));
    clearInterval(monitoringInterval);

    // Show final stats
    console.log('\n📈 Final Statistics:');
    console.log(`  Messages processed: ${messageCount}`);
    console.log(`  Duplicates filtered: ${duplicateCount}`);
    console.log(`  Deduplication rate: ${messageCount > 0 ? ((duplicateCount / (messageCount + duplicateCount)) * 100).toFixed(1) : 0}%`);

    const finalHealth = pool.getHealthStatus();
    const finalHealthyCount = finalHealth.filter(h => h.isHealthy).length;
    console.log(`  Final health: ${finalHealthyCount}/${finalHealth.length} connections healthy`);

    if (messageCount === 0) {
      console.log('\n⚠️  NO MESSAGES RECEIVED - Possible reasons:');
      console.log('  1. The Token Programs should be very active, so this is unexpected');
      console.log('  2. Check if the gRPC connections are actually streaming data');
      console.log('  3. Verify the subscription request format matches Yellowstone gRPC spec');
      console.log('  4. The subscription might be working but no transactions matched the filter');
      console.log('  5. Try a broader filter or check gRPC server logs');
      console.log('\n🔍 Current subscription targets:');
      console.log('     - TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token Program)');
      console.log('     - TokenzQdB6q6JkUeT2XkC1gYwA9kL5QkUuU2eQ3M7z6 (Token-2022 Program)');
    }

    console.log('\n🔗 Connection Events:');
    connectionEvents.forEach(event => {
      const time = event.time.toLocaleTimeString();
      console.log(`  ${time} - ${event.type}: ${event.endpoint}${event.error ? ` (${event.error})` : ''}`);
    });

    const metrics = pool.getMetrics();
    console.log('\n📊 Metrics:', metrics);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    console.log('\n🛑 Stopping pool...');
    await pool.stop();
    console.log('✅ Pool stopped. Test complete!');
  }
}

// Run the test
testPool().catch(console.error);
