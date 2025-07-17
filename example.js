// Try to import from npm package first, fallback to local dist for development
let createSolanaGrpcPool, registerPoolForGracefulShutdown;
try {
  ({ createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('@stalkchain/grpc-pool'));
} catch (error) {
  // Fallback to local dist for development/testing
  ({ createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('./dist/index.js'));
}

/**
 * 🎯 StalkChain gRPC Pool - Working Example
 *
 * This example demonstrates how to use @stalkchain/grpc-pool to monitor
 * SPL Token and Token-2022 transactions in real-time with automatic failover.
 *
 * Features demonstrated:
 * ✅ Multi-endpoint gRPC pool (2 paid + 1 free public endpoint)
 * ✅ Real-time token transaction monitoring
 * ✅ Automatic deduplication across endpoints
 * ✅ Connection health monitoring and failover
 * ✅ Graceful shutdown handling
 * ✅ Statistics and performance metrics
 *
 * Usage:
 * 1. Optional: Set environment variable SOLANA_TRACKER_TOKEN="your-token"
 * 2. Run: node example.js
 * 3. Watch real-time token transactions
 * 4. Press Ctrl+C to stop gracefully
 *
 * The example will work with just the free public endpoint if no API tokens are provided.
 */

async function runExample() {
  console.log('🚀 Starting StalkChain gRPC Pool Example\n');

  // Configure connections - replace with your actual tokens or use environment variables
  const connections = [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-solana-tracker-token-here'
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io', 
      token: process.env.SOLANA_TRACKER_TOKEN || 'your-solana-tracker-token-here'
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
      token: '', // Free public endpoint
      noPing: true // Disable health checks for public endpoint
    }
  ];

  // Create the gRPC pool with basic configuration
  const pool = createSolanaGrpcPool(connections, {
    config: {
      deduplicationWindow: 30000,  // 30 seconds
      maxCacheSize: 10000,
      messageTimeout: 60000,       // 1 minute
      streamPing: {
        enabled: true,
        interval: 30000,           // 30 seconds
        timeout: 5000,             // 5 seconds
        maxMissedPongs: 2
      }
    }
  });

  // Register for graceful shutdown (handles Ctrl+C)
  registerPoolForGracefulShutdown(pool);

  // Track statistics
  let messageCount = 0;
  let duplicateCount = 0;
  let connectionCount = 0;

  // Set up event handlers
  pool.on('connection-established', (endpoint) => {
    connectionCount++;
    console.log(`✅ Connected to: ${endpoint} (${connectionCount} active)`);
  });

  pool.on('connection-lost', (endpoint, error) => {
    connectionCount--;
    console.log(`❌ Lost connection to: ${endpoint} - ${error.message}`);
  });

  pool.on('connection-recovered', (endpoint) => {
    console.log(`🔄 Recovered connection to: ${endpoint}`);
  });

  pool.on('failover', (failed, active, reason) => {
    console.log(`🔀 Failover: ${failed} → ${active} (${reason})`);
  });

  pool.on('error', (error, context) => {
    console.log(`⚠️  Error [${context || 'unknown'}]: ${error.message}`);
  });

  // Handle incoming messages
  pool.on('message-processed', (message) => {
    messageCount++;
    
    if (message.isDuplicate) {
      duplicateCount++;
    }

    // Log every 10th message to avoid spam
    if (messageCount % 10 === 0) {
      const deduplicationRate = ((1 - duplicateCount / messageCount) * 100).toFixed(1);
      console.log(`📨 Messages: ${messageCount} | Duplicates: ${duplicateCount} | Deduplication: ${deduplicationRate}%`);
    }

    // Show transaction details for first few messages
    if (messageCount <= 5 && message.transaction) {
      console.log(`\n🔍 Transaction ${messageCount}:`);
      console.log(`   Signature: ${message.transaction.signature}`);
      console.log(`   Slot: ${message.slot}`);
      console.log(`   Success: ${!message.transaction.meta?.err}`);
      
      if (message.transaction.meta?.logMessages) {
        const tokenLogs = message.transaction.meta.logMessages.filter(log => 
          log.includes('Token') || log.includes('SPL')
        );
        if (tokenLogs.length > 0) {
          console.log(`   Token Activity: ${tokenLogs[0]}`);
        }
      }
      console.log('');
    }
  });

  try {
    // Start the pool
    console.log('🔧 Starting gRPC pool...');
    await pool.start();
    
    // Wait for connections to establish
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check pool health
    const health = pool.getHealthStatus();
    const healthyConnections = health.filter(h => h.isHealthy).length;
    console.log(`\n🏥 Pool Health: ${healthyConnections}/${health.length} connections healthy`);
    
    health.forEach(h => {
      console.log(`   ${h.endpoint}: ${h.isHealthy ? '✅' : '❌'} (${h.latency}ms)`);
    });

    // Subscribe to token transactions
    console.log('\n📡 Subscribing to token transactions...');
    
    const subscriptionRequest = {
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        alltxs: {
          accountInclude: [
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
            "TokenzQdB6q6JkUeT2XkC1gYwA9kL5QkUuU2eQ3M7z6", // Token-2022 Program
          ],
          accountExclude: [],
          accountRequired: [],
          vote: false,
          failed: false,
        },
      },
      slots: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: "CONFIRMED",
    };

    await pool.subscribe(subscriptionRequest);
    
    console.log('🎯 Subscription active! Monitoring token transactions...');
    console.log('📊 Statistics will be displayed every 10 messages');
    console.log('🛑 Press Ctrl+C to stop gracefully\n');

    // Start statistics reporting
    setInterval(() => {
      if (messageCount > 0) {
        const deduplicationRate = ((1 - duplicateCount / messageCount) * 100).toFixed(1);
        const messagesPerSecond = (messageCount / (Date.now() - startTime) * 1000).toFixed(1);
        
        console.log(`📈 [${new Date().toISOString()}] Stats:`);
        console.log(`   Messages: ${messageCount} (${messagesPerSecond}/s)`);
        console.log(`   Duplicates: ${duplicateCount} (${deduplicationRate}% unique)`);
        console.log(`   Connections: ${connectionCount} active`);
        console.log('');
      }
    }, 30000); // Every 30 seconds

    const startTime = Date.now();

    // Keep the example running until interrupted
    await new Promise(() => {}); // Run indefinitely until Ctrl+C

  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  // The registerPoolForGracefulShutdown will handle the cleanup
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  // The registerPoolForGracefulShutdown will handle the cleanup
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Only run the example if this file is executed directly (not required)
if (require.main === module) {
  console.log('🎬 StalkChain gRPC Pool - Token Transaction Monitor');
  console.log('==================================================');
  console.log('');

  runExample().catch(console.error);
}
