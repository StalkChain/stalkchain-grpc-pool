#!/usr/bin/env node

/**
 * Diagnostic test to reproduce and debug the infinite loop issue
 * when a connection fails with authentication errors
 */

const { createSolanaGrpcPool } = require('../dist/index.js');

async function testInfiniteLoop() {
  console.log('🔍 Testing infinite loop issue with failing endpoint...\n');
  console.log('📝 Note: Public API is a pool of nodes, retrying until we hit a node that gives 401...\n');

  // Use a connection that will sometimes fail with auth error
  const connections = [
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
      token: '', // This will cause 401 Unauthorized on some nodes
      noPing: true
    }
  ];

  let attemptNumber = 0;
  const maxAttempts = 10; // Try up to 10 times to hit a failing node

  while (attemptNumber < maxAttempts) {
    attemptNumber++;
    console.log(`\n🔄 Attempt ${attemptNumber}/${maxAttempts}...`);

    // Track events to detect the loop
    let connectionLostCount = 0;
    let failoverCount = 0;
    let authErrorDetected = false;

    const pool = createSolanaGrpcPool(connections, {
      config: {
        deduplicationWindow: 60000,
        maxCacheSize: 10000,
        messageTimeout: 5000, // Very short timeout to trigger quickly
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
      console.log(`❌ [${connectionLostCount}] Lost connection to: ${endpoint} - ${error.message}`);

      // Check if this is an auth error
      if (error.message.includes('401') || error.message.includes('UNAUTHENTICATED')) {
        authErrorDetected = true;
        console.log('🎯 Auth error detected! This should trigger the infinite loop...');
      }

      // Stop after detecting rapid fire events
      if (connectionLostCount > 10) {
        console.log('\n🚨 INFINITE LOOP DETECTED! Stopping test...');
        pool.stop();
        return true; // Signal to exit the retry loop
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
      console.log(`💥 Error [${context}]: ${error.message}`);
    });

    try {
      console.log('Starting pool...');
      await pool.start();

      // Try to create a subscription that will trigger auth error
      console.log('Creating subscription to trigger auth error...');
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

        const subscription = await pool.subscribe(subscriptionRequest);

        console.log('Subscription created, waiting for data...');

        // Listen for data
        subscription.on('data', (data) => {
          console.log('Received data:', data.filters);
        });

        subscription.on('error', (error) => {
          console.log('Subscription error:', error.message);
          if (error.message.includes('401') || error.message.includes('UNAUTHENTICATED')) {
            authErrorDetected = true;
          }
        });

      } catch (subError) {
        console.log('Subscription failed:', subError.message);
        if (subError.message.includes('401') || subError.message.includes('UNAUTHENTICATED')) {
          authErrorDetected = true;
        }
      }

      // Wait a bit to see what happens
      console.log('Waiting 15 seconds to observe behavior...');
      await new Promise(resolve => setTimeout(resolve, 15000));

      console.log('\n📊 Attempt results:');
      console.log(`- Connection lost events: ${connectionLostCount}`);
      console.log(`- Failover events: ${failoverCount}`);
      console.log(`- Auth error detected: ${authErrorDetected}`);

      if (connectionLostCount > 10) {
        console.log('🚨 INFINITE LOOP DETECTED! This confirms the bug.');
        await pool.stop();
        return; // Exit the retry loop
      }

      if (authErrorDetected && connectionLostCount > 3) {
        console.log('🚨 Auth error triggered rapid reconnections - this indicates the infinite loop bug');
        await pool.stop();
        return; // Exit the retry loop
      }

      if (!authErrorDetected) {
        console.log('⏭️  No auth error this time, trying again...');
      } else {
        console.log('✅ Auth error detected but no infinite loop - connection handling is working correctly');
        await pool.stop();
        return; // Exit the retry loop
      }

    } catch (error) {
      console.error(`Attempt ${attemptNumber} failed:`, error);
    } finally {
      await pool.stop();
    }
  }

  console.log('\n🏁 Completed all attempts without hitting the problematic scenario');
}

// Run the test
testInfiniteLoop().catch(console.error);
