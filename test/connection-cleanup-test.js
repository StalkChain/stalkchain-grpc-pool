#!/usr/bin/env node

/**
 * Test script to verify that gRPC connections are properly cleaned up
 * and don't accumulate when reconnecting after stale connection detection
 */

const { createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('../dist/index.js');
const { performance } = require('perf_hooks');

// Test configuration
const TEST_DURATION_MS = 120000; // 2 minutes
const CONNECTION_CHECK_INTERVAL = 5000; // Check every 5 seconds

// Connection configurations - using only Solana Tracker for reliable testing
const connections = [
  {
    endpoint: 'https://grpc.solanatracker.io',
    token: process.env.SOLANA_TRACKER_GRPC_KEY || '',
    noPing: false
  }
];

// Filter out connections without tokens
const validConnections = connections.filter(conn => conn.token);

if (validConnections.length === 0) {
  console.error('❌ No valid connections available. Please set SOLANA_TRACKER_GRPC_KEY environment variable.');
  console.error('💡 You can get a free API key from: https://solanatracker.io/');
  process.exit(1);
}

console.log(`🧪 Starting connection cleanup test with ${validConnections.length} connections`);
console.log('📊 This test will monitor connection behavior for potential leaks...\n');

// Create the gRPC pool with aggressive settings to trigger reconnections
const pool = createSolanaGrpcPool(validConnections, {
  config: {
    deduplicationWindow: 30000,
    maxCacheSize: 1000,
    messageTimeout: 30000, // Shorter timeout to trigger stale detection faster
    streamPing: {
      enabled: true,
      interval: 15000,  // More frequent pings
      timeout: 5000,
      maxMissedPongs: 2 // Trigger reconnection faster
    }
  }
});

// Register for graceful shutdown
registerPoolForGracefulShutdown(pool);

// Statistics tracking
let stats = {
  connectionsEstablished: 0,
  connectionsLost: 0,
  reconnectionAttempts: 0,
  messagesReceived: 0,
  duplicatesFiltered: 0,
  startTime: performance.now()
};

// Track connection events
pool.on('connection-established', (endpoint) => {
  stats.connectionsEstablished++;
  console.log(`✅ [${new Date().toISOString()}] Connected to: ${endpoint}`);
  console.log(`   📈 Total connections established: ${stats.connectionsEstablished}`);
});

pool.on('connection-lost', (endpoint, error) => {
  stats.connectionsLost++;
  stats.reconnectionAttempts++;
  console.log(`❌ [${new Date().toISOString()}] Lost connection to: ${endpoint}`);
  console.log(`   📉 Reason: ${error.message}`);
  console.log(`   📈 Total connections lost: ${stats.connectionsLost}`);
  console.log(`   🔄 Total reconnection attempts: ${stats.reconnectionAttempts}`);
});

pool.on('connection-recovered', (endpoint) => {
  console.log(`🔄 [${new Date().toISOString()}] Connection recovered: ${endpoint}`);
});

// Track message processing
pool.on('message', (data) => {
  stats.messagesReceived++;
  
  // Log every 10th message to avoid spam
  if (stats.messagesReceived % 10 === 0) {
    console.log(`📨 [${new Date().toISOString()}] Processed ${stats.messagesReceived} messages`);
  }
});

pool.on('duplicate-filtered', () => {
  stats.duplicatesFiltered++;
});

// Subscription request for Jupiter DCA transactions
const subscriptionRequest = {
  commitment: 'confirmed',
  accountsDataSlice: [],
  transactions: {
    client: {
      vote: false,
      failed: false,
      accountInclude: ['DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M'], // Jupiter DCA program
      accountExclude: [],
      accountRequired: [],
    }
  },
  accounts: {},
  slots: {},
  transactionsStatus: {},
  entry: {},
  blocks: {},
  blocksMeta: {},
};

// Function to print detailed statistics
function printStats() {
  const elapsed = (performance.now() - stats.startTime) / 1000;
  const avgMessagesPerSecond = stats.messagesReceived / elapsed;
  
  console.log('\n📊 === CONNECTION CLEANUP TEST STATISTICS ===');
  console.log(`⏱️  Test Duration: ${elapsed.toFixed(1)}s`);
  console.log(`🔗 Connections Established: ${stats.connectionsEstablished}`);
  console.log(`❌ Connections Lost: ${stats.connectionsLost}`);
  console.log(`🔄 Reconnection Attempts: ${stats.reconnectionAttempts}`);
  console.log(`📨 Messages Received: ${stats.messagesReceived}`);
  console.log(`🔄 Duplicates Filtered: ${stats.duplicatesFiltered}`);
  console.log(`📈 Avg Messages/sec: ${avgMessagesPerSecond.toFixed(2)}`);
  
  // Connection health analysis
  const connectionRatio = stats.connectionsLost > 0 ? 
    (stats.connectionsEstablished / stats.connectionsLost).toFixed(2) : 'N/A';
  
  console.log(`🏥 Connection Health Ratio: ${connectionRatio} (established/lost)`);
  
  // Warning indicators
  if (stats.reconnectionAttempts > stats.connectionsLost * 2) {
    console.log('⚠️  WARNING: High reconnection attempts may indicate connection leaks');
  }
  
  if (stats.connectionsLost > 10) {
    console.log('⚠️  WARNING: High connection loss count - check for stability issues');
  }
  
  console.log('===============================================\n');
}

// Start the test
async function runTest() {
  try {
    console.log('🚀 Starting gRPC pool...');
    await pool.start();
    
    console.log('📡 Starting subscription...');
    await pool.subscribe(subscriptionRequest);
    
    console.log(`⏰ Test will run for ${TEST_DURATION_MS / 1000} seconds...\n`);
    
    // Print stats periodically
    const statsInterval = setInterval(printStats, CONNECTION_CHECK_INTERVAL);
    
    // Run test for specified duration
    await new Promise(resolve => setTimeout(resolve, TEST_DURATION_MS));
    
    // Clean up
    clearInterval(statsInterval);
    
    console.log('\n🏁 Test completed! Final statistics:');
    printStats();
    
    console.log('🛑 Stopping pool...');
    await pool.stop();
    
    // Final analysis
    console.log('\n🔍 === FINAL ANALYSIS ===');
    
    if (stats.connectionsLost === 0) {
      console.log('✅ EXCELLENT: No connection losses detected');
    } else if (stats.reconnectionAttempts <= stats.connectionsLost * 1.5) {
      console.log('✅ GOOD: Connection cleanup appears to be working properly');
      console.log('   Reconnection attempts are within expected range');
    } else {
      console.log('❌ POTENTIAL ISSUE: High reconnection attempts detected');
      console.log('   This may indicate connection cleanup problems');
    }
    
    console.log('========================\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Test interrupted by user');
  printStats();
  await pool.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Test terminated');
  printStats();
  await pool.stop();
  process.exit(0);
});

// Start the test
runTest().catch(console.error);
