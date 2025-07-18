/**
 * pool-monitoring.ts - Pool Connection Monitoring Example
 *
 * This example demonstrates monitoring the connection health and status
 * of multiple gRPC endpoints in real-time. Useful for operational monitoring
 * and debugging connection issues.
 *
 * Features:
 * - Real-time connection status monitoring
 * - Endpoint-level connection events
 * - Stale connection detection testing
 * - Connection statistics and health reporting
 * - Graceful shutdown with summary reports
 */

import 'dotenv/config';
import { GrpcPool, PoolConfig, PoolOptions, TransactionEvent, DuplicateEvent, EndpointEvent } from '../src';

// Configuration
const SOLANA_GRPC_TOKEN = process.env.SOLANA_GRPC_TOKEN || '';
const SOLANA_GRPC_URL_MAIN = process.env.SOLANA_GRPC_URL_MAIN || 'https://grpc.solanatracker.io';
const SOLANA_GRPC_URL_SECONDARY = process.env.SOLANA_GRPC_URL_SECONDARY || 'https://grpc-us.solanatracker.io';

// Target program for minimal subscription (we're monitoring connections, not processing data)
const TARGET_PROGRAM = '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma';

async function main() {
  console.log('🔍 Starting Pool Connection Monitoring');
  console.log('======================================');
  console.log('This example focuses on connection health and status monitoring');
  console.log('');
  
  // Configure endpoints
  const poolConfig: PoolConfig = {
    endpoints: [
      {
        endpoint: SOLANA_GRPC_URL_MAIN,
        token: SOLANA_GRPC_TOKEN,
        ping: true
      },
      {
        endpoint: SOLANA_GRPC_URL_SECONDARY,
        token: SOLANA_GRPC_TOKEN,
        ping: true
      },
      {
        endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
        token: '',
        ping: true
      }
    ]
  };

  // Configuration for connection testing (more aggressive stale detection)
  const poolOptions: PoolOptions = {
    pingIntervalMs: 25000,        // Ping every 25 seconds
    staleTimeoutMs: 30000,        // 30 seconds stale timeout for testing
    deduplicationTtlMs: 45000,    // Keep signatures for 45 seconds
    maxCacheSize: 5000,           // Max 5000 signatures in cache
    initialRetryDelayMs: 1000,    // Start retry at 1 second
    maxRetryDelayMs: 60000,       // Max retry delay 60 seconds
    retryBackoffFactor: 1.5       // Slower backoff growth
  };

  // ⚠️ NOTE: For aggressive testing, you can lower staleTimeoutMs to 5-10 seconds
  // In production, use 30+ seconds to avoid connection thrashing during network issues

  const pool = new GrpcPool(poolConfig, poolOptions);

  // Track endpoint states and statistics for monitoring
  const endpointStates = new Map<string, boolean>();
  const connectionEvents = new Map<string, number>();
  let poolStartTime = Date.now();
  let transactionCount = 0;
  let duplicateCount = 0;

  // === POOL CONNECTION EVENTS ===
  pool.on('connected', () => {
    const timestamp = new Date().toISOString();
    console.log(`🟢 [${timestamp}] POOL CONNECTED - Ready to receive data`);
  });

  pool.on('disconnected', () => {
    const timestamp = new Date().toISOString();
    console.log(`🔴 [${timestamp}] POOL DISCONNECTED - All endpoints offline`);
  });

  // === ENDPOINT CONNECTION MONITORING ===
  pool.on('endpoint', (event: EndpointEvent) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const shortEndpoint = event.endpoint.replace('https://', '').split('.')[0];
    endpointStates.set(event.endpoint, event.status !== 'disconnected');
    
    // Count connection events per endpoint
    const eventKey = `${event.endpoint}-${event.status}`;
    connectionEvents.set(eventKey, (connectionEvents.get(eventKey) || 0) + 1);
    
    const statusIcon = event.status === 'connected' ? '🟢' : 
                      event.status === 'reconnected' ? '🔄' : '🔴';
    
    console.log(`${statusIcon} [${timestamp}] ${shortEndpoint}: ${event.status.toUpperCase()}`);
    
    // Show current connection summary
    const connectedCount = Array.from(endpointStates.values()).filter(connected => connected).length;
    const totalEndpoints = endpointStates.size;
    console.log(`   └─ Pool status: ${connectedCount}/${totalEndpoints} endpoints active`);
    
    // Show details if available
    if (event.details) {
      console.log(`   └─ Details: ${event.details}`);
    }
  });

  // === MINIMAL TRANSACTION MONITORING (for connection validation) ===
  pool.on('transaction', (event: TransactionEvent) => {
    transactionCount++;
    const shortEndpoint = event.source.replace('https://', '').split('.')[0];
    const truncatedSig = event.signature.substring(0, 8) + '...';
    // console.log(`📦 [${new Date().toISOString()}] TX ${truncatedSig} from ${shortEndpoint} (${transactionCount} total)`);
  });

  pool.on('duplicate', (event: DuplicateEvent) => {
    duplicateCount++;
    const shortEndpoint = event.source.replace('https://', '').split('.')[0];
    // console.log(`🔄 [${new Date().toISOString()}] Duplicate filtered from ${shortEndpoint} (${duplicateCount} total)`);
  });

  // === ERROR HANDLING ===
  pool.on('error', (error: Error) => {
    const timestamp = new Date().toISOString();
    console.error(`❌ [${timestamp}] Pool error: ${error.message}`);
    
    // Log additional error details for debugging
    if (error.stack) {
      console.error(`   └─ Stack trace: ${error.stack.split('\n')[1]?.trim()}`);
    }
    
    // Don't exit on errors - let the pool handle reconnection
    console.log(`   └─ Pool will attempt automatic recovery...`);
  });

  try {
    // Connect to all endpoints
    console.log('🔌 Connecting to gRPC endpoints...');
    await pool.connect();

    // Show initial connection status
    const status = pool.getStatus();
    const connectedCount = status.filter((s: any) => s.connected).length;
    console.log(`✅ Connected to ${connectedCount}/${status.length} endpoints`);

    // Subscribe to minimal program transactions (just to keep connection active)
    console.log(`🎯 Subscribing to program: ${TARGET_PROGRAM} (minimal subscription for monitoring)`);
    await pool.subscribe({
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        'monitor_txns': {
          accountInclude: [TARGET_PROGRAM],
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
      commitment: 'confirmed'
    });

    console.log('✅ Monitoring subscription active!');
    console.log('');
    console.log('📊 MONITORING FEATURES:');
    console.log('   🟢 Pool events: connected/disconnected status with timestamps');
    console.log('   📡 Endpoint events: individual endpoint connection lifecycle');
    console.log('   ⏰ Stale detection: 30 seconds (testing mode)');
    console.log('   📊 Connection summary after each endpoint event');
    console.log('   📦 Transaction flow: minimal logging to validate connections');
    console.log('   Press Ctrl+C to exit gracefully');
    console.log('');

    // Add periodic status reporting every 30 seconds
    const statusInterval = setInterval(() => {
      const uptime = Math.round((Date.now() - poolStartTime) / 1000);
      const connectedCount = Array.from(endpointStates.values()).filter(connected => connected).length;
      const totalEndpoints = endpointStates.size;
      
      console.log(`⏰ [${new Date().toISOString()}] Status Report:`);
      console.log(`   └─ Uptime: ${uptime}s | Active: ${connectedCount}/${totalEndpoints} endpoints`);
      console.log(`   └─ Transactions: ${transactionCount} | Duplicates: ${duplicateCount}`);
      
      // Show deduplication cache stats
      const dedupStats = pool.getDeduplicationStats();
      console.log(`   └─ Cache: ${dedupStats.size}/${dedupStats.maxSize} signatures (TTL: ${dedupStats.ttlMs / 1000}s)`);
    }, 30000);

    // Handle uncaught errors to prevent crashes
    process.on('uncaughtException', (error) => {
      console.error(`💥 [${new Date().toISOString()}] Uncaught exception:`, error.message);
      console.error('   └─ This should not happen - please report this bug');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error(`💥 [${new Date().toISOString()}] Unhandled rejection:`, reason);
      console.error('   └─ Promise:', promise);
    });

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down connection monitor...');
      
      // Show final connection statistics
      const totalRunTime = Math.round((Date.now() - poolStartTime) / 1000);
      console.log('\n📊 CONNECTION MONITORING RESULTS:');
      console.log(`   Test duration: ${totalRunTime} seconds`);
      console.log(`   Stale timeout: 30 seconds (testing mode)`);
      console.log(`   Transactions processed: ${transactionCount}`);
      console.log(`   Duplicates filtered: ${duplicateCount}`);
      
      // Show final endpoint states
      if (endpointStates.size > 0) {
        console.log('\n📡 Final endpoint states:');
        endpointStates.forEach((connected, endpoint) => {
          const shortEndpoint = endpoint.replace('https://', '').split('.')[0];
          const status = connected ? '🟢 CONNECTED' : '🔴 DISCONNECTED';
          console.log(`   ${shortEndpoint}: ${status}`);
        });
      }
      
      // Show connection event statistics
      if (connectionEvents.size > 0) {
        console.log('\n🔄 Connection event summary:');
        connectionEvents.forEach((count, eventKey) => {
          const [endpoint, eventType] = eventKey.split('-');
          const shortEndpoint = endpoint?.replace('https://', '').split('.')[0];
          console.log(`   ${shortEndpoint} ${eventType}: ${count} times`);
        });
      }

      // Clear status interval
      clearInterval(statusInterval);
      
      // Close pool gracefully
      await pool.close();
      console.log('👋 Connection monitoring completed!');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Monitoring example failed:', error);
    process.exit(1);
  }
}

main().catch(console.error); 