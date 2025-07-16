#!/usr/bin/env node

/**
 * Test to verify the infinite loop fixes are working
 */

const { createSolanaGrpcPool } = require('../dist/index.js');

async function testFixes() {
  console.log('🔧 Testing infinite loop fixes...\n');

  // Use the same configuration that was causing issues
  const connections = [
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
      token: '', // This may cause auth issues on some nodes
      noPing: true
    }
  ];

  // Track events to verify the fix
  let connectionLostCount = 0;
  let failoverCount = 0;
  let errorCount = 0;
  let lastErrorTime = 0;

  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 60000,
      maxCacheSize: 10000,
      messageTimeout: 10000, // 10 seconds
      circuitBreaker: {
        errorThresholdPercentage: 30,
        minimumRequestThreshold: 3,
        resetTimeout: 15000,
        timeout: 5000
      },
      streamPing: {
        enabled: true,
        interval: 15000,
        timeout: 5000,
        maxMissedPongs: 2
      }
    }
  });

  // Monitor events
  pool.on('connection-lost', (endpoint, error) => {
    connectionLostCount++;
    const now = Date.now();
    const timeSinceLastError = now - lastErrorTime;
    lastErrorTime = now;
    
    console.log(`❌ [${connectionLostCount}] Lost connection to: ${endpoint} - ${error.message}`);
    console.log(`   Time since last error: ${timeSinceLastError}ms`);
    
    // Check for rapid-fire events (less than 100ms apart)
    if (timeSinceLastError < 100 && connectionLostCount > 1) {
      console.log('🚨 RAPID FIRE DETECTED - Fix may not be working!');
    }
  });

  pool.on('failover', (from, to, reason) => {
    failoverCount++;
    console.log(`🔀 [${failoverCount}] Failover: ${from} → ${to} (${reason})`);
  });

  pool.on('connection-established', (endpoint) => {
    console.log(`✅ Connection established: ${endpoint}`);
  });

  pool.on('error', (error, context) => {
    errorCount++;
    console.log(`💥 [${errorCount}] Error [${context}]: ${error.message}`);
  });

  try {
    console.log('Starting pool...');
    await pool.start();
    
    // Try to create a subscription
    console.log('Creating subscription...');
    try {
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
      
      console.log('Subscription created successfully');
      
    } catch (subError) {
      console.log('Subscription failed (expected):', subError.message);
    }
    
    // Wait and observe behavior
    console.log('Waiting 30 seconds to observe retry behavior...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log('\n📊 Results after 30 seconds:');
    console.log(`- Connection lost events: ${connectionLostCount}`);
    console.log(`- Failover events: ${failoverCount}`);
    console.log(`- Error events: ${errorCount}`);
    
    // Analyze results
    if (connectionLostCount > 50) {
      console.log('🚨 STILL HAMMERING - Fix not working properly');
    } else if (connectionLostCount > 10) {
      console.log('⚠️  Still quite frequent, but much better than before');
    } else {
      console.log('✅ Retry rate looks reasonable - fix appears to be working');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    console.log('\nStopping pool...');
    await pool.stop();
    console.log('Pool stopped.');
  }
}

// Run the test
testFixes().catch(console.error);
