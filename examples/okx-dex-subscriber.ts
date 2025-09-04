/**
 * okx-dex-subscriber.ts - OKX DEX Transaction Subscriber Example
 *
 * This example demonstrates subscribing to OKX DEX transactions and
 * processing the raw transaction data with proper debuffering for
 * human-readable output.
 *
 * Features:
 * - Subscribes to OKX DEX program transactions
 * - Debuffers transaction data for readability
 * - Logs transaction signatures, metadata, and first few lines of data
 * - Handles connection events and errors gracefully
 */

import 'dotenv/config';
import { GrpcPool, PoolConfig, PoolOptions, TransactionEvent, DuplicateEvent, EndpointEvent } from '../src';
import bs58 from 'bs58';

/**
 * Recursively converts Buffer objects and Uint8Arrays to base58 strings
 * @param {any} obj - Object to process
 * @returns {any} Processed object with readable strings
 */
function debufferMessage(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle Buffer objects (typical in older library versions or direct gRPC data)
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return bs58.encode(new Uint8Array(obj.data));
  }

  // Handle Uint8Array (more common with newer gRPC/protobuf versions)
  if (obj instanceof Uint8Array) {
    return bs58.encode(obj);
  }

  // Handle arrays recursively
  if (Array.isArray(obj)) {
    return obj.map((item: any) => debufferMessage(item));
  }

  // Handle objects recursively
  if (typeof obj === 'object') {
    const debuffered: any = {};
    for (const [key, value] of Object.entries(obj)) {
      debuffered[key] = debufferMessage(value);
    }
    return debuffered;
  }

  return obj;
}

// Configuration
const SOLANA_GRPC_TOKEN = process.env.SOLANA_GRPC_TOKEN || '';
const SOLANA_GRPC_URL_MAIN = process.env.SOLANA_GRPC_URL_MAIN || 'https://grpc.solanatracker.io';
const SOLANA_GRPC_URL_SECONDARY = process.env.SOLANA_GRPC_URL_SECONDARY || 'https://grpc-us.solanatracker.io';

// OKX DEX Program ID (replace with actual OKX program if different)
const OKX_DEX_PROGRAM = '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma';

async function main() {
  console.log('🏦 Starting OKX DEX Transaction Subscriber');
  console.log('=========================================');
  console.log(`📍 Target Program: ${OKX_DEX_PROGRAM}`);
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

  // Standard production settings
  const poolOptions: PoolOptions = {
    pingIntervalMs: 30000,
    staleTimeoutMs: 120000,     // 2 minutes - production safe
    deduplicationTtlMs: 60000,  // 1 minute dedup window
    maxCacheSize: 10000,
    initialRetryDelayMs: 500,
    maxRetryDelayMs: 30000,
    retryBackoffFactor: 2
  };

  const pool = new GrpcPool(poolConfig, poolOptions);

  let transactionCount = 0;
  let duplicateCount = 0;

  // === TRANSACTION EVENT HANDLER ===
  pool.on('transaction', (event: TransactionEvent) => {
    transactionCount++;
    const timestamp = new Date(event.timestamp).toISOString();
    
    console.log('\n' + '='.repeat(80));
    console.log(`🔄 NEW OKX TRANSACTION #${transactionCount}`);
    console.log('='.repeat(80));
    console.log(`📅 Timestamp: ${timestamp}`);
    console.log(`🔗 Signature: ${event.signature}`);
    console.log(`📡 Source: ${event.source}`);
    
    // Process and debuffer the raw transaction data
    const debufferedData = debufferMessage(event.data);
    
    // Show transaction metadata if available
    if (event.data.meta) {
      console.log('\n📊 TRANSACTION METADATA:');
      console.log(`   Error: ${event.data.meta.err ? 'Failed' : 'Success'}`);
      console.log(`   Slot: ${event.data.slot || 'N/A'}`);
      
      // Show fee information if available
      if (event.data.meta.fee !== undefined) {
        console.log(`   Fee: ${event.data.meta.fee} lamports`);
      }
      
      // Show account balances changes if available
      if (event.data.meta.preBalances && event.data.meta.postBalances) {
        const balanceChanges = event.data.meta.postBalances.length;
        console.log(`   Account Changes: ${balanceChanges} accounts affected`);
      }
    }
    
    // Show first few lines of debuffered transaction data
    console.log('\n📋 TRANSACTION DATA (First 10 lines):');
    const dataLines = JSON.stringify(debufferedData, null, 2).split('\n');
    const previewLines = dataLines.slice(0, 10);
    previewLines.forEach((line, index) => {
      console.log(`   ${String(index + 1).padStart(2, ' ')}: ${line}`);
    });
    
    if (dataLines.length > 10) {
      console.log(`   ... and ${dataLines.length - 10} more lines`);
    }
    
    console.log('\n' + '='.repeat(80));
  });

  // === DUPLICATE EVENT HANDLER ===
  pool.on('duplicate', (event: DuplicateEvent) => {
    duplicateCount++;
    const timestamp = new Date(event.timestamp).toISOString();
    console.log(`🔄 [${timestamp}] Filtered duplicate from ${event.source}`);
  });

  // === CONNECTION EVENT HANDLERS ===
  pool.on('connected', () => {
    console.log('✅ Pool connected - ready to receive OKX DEX transactions');
  });

  pool.on('disconnected', () => {
    console.log('🔴 Pool disconnected');
  });

  pool.on('endpoint', (event: EndpointEvent) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const statusIcon = event.status === 'connected' ? '🟢' : 
                      event.status === 'reconnected' ? '🔄' : '🔴';
    console.log(`${statusIcon} [${timestamp}] ${event.endpoint} [${event.clientId}]: ${event.status.toUpperCase()}`);
  });

  // === ERROR HANDLER ===
  pool.on('error', (error: Error) => {
    console.error('❌ Pool error:', error.message);
  });

  try {
    // Connect to all endpoints
    console.log('🔌 Connecting to gRPC endpoints...');
    await pool.connect();

    // Subscribe to OKX DEX transactions
    console.log(`🎯 Subscribing to OKX DEX program: ${OKX_DEX_PROGRAM}`);
    await pool.subscribe({
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        'okx_dex_txns': {
          accountInclude: [OKX_DEX_PROGRAM],
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

    console.log('✅ OKX DEX subscription active!');
    console.log('📈 Will display transaction details with debuffered data');
    console.log('Press Ctrl+C to exit gracefully\n');

    // Show periodic statistics
    const statsInterval = setInterval(() => {
      const total = transactionCount + duplicateCount;
      const uniquePercent = total > 0 ? Math.round((transactionCount / total) * 100) : 0;
      console.log(`\n📊 Statistics: ${transactionCount} unique, ${duplicateCount} duplicates (${uniquePercent}% unique)`);
    }, 60000); // Every minute

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down OKX DEX subscriber...');
      
      clearInterval(statsInterval);
      
      // Show final statistics
      const total = transactionCount + duplicateCount;
      console.log(`\n📊 Final Statistics:`);
        console.log(`   Unique transactions: ${transactionCount}`);
      console.log(`   Filtered duplicates: ${duplicateCount}`);
      console.log(`   Total processed: ${total}`);
      
      await pool.close();
      console.log('👋 OKX DEX subscriber stopped!');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

main().catch(console.error); 