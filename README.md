# stalkchain-grpc-pool

High-performance, production-ready Solana gRPC connection pool with active-active configuration, automatic failover, and message deduplication for Solana Yellowstone gRPC streams.

## Overview

`stalkchain-grpc-pool` provides a robust solution for connecting to Solana blockchain data streams through multiple gRPC endpoints. It automatically handles connection pooling, failover, and deduplication to ensure reliable data streaming even when individual endpoints experience issues.

## Features

- 🔄 **Connection Pooling**: Connect to multiple gRPC endpoints simultaneously
- ⚡ **Automatic Failover**: Intelligent routing and reconnection
- 🔍 **Message Deduplication**: Filter duplicate transactions by signature  
- 🎯 **Simple Event API**: Clean event-driven architecture
- 📝 **TypeScript Support**: Full type definitions included
- 🛡️ **Built on Triton-One**: Uses `@triton-one/yellowstone-grpc` under the hood
- 🎯 **Production Ready**: Achieves 99.99% SLA with proper configuration

## Installation

```bash
pnpm install stalkchain-grpc-pool
```

### Local Testing

For testing the package locally before npm publication, see [MANUAL_INSTALL.md](./MANUAL_INSTALL.md) for detailed instructions on building and testing the package in a separate project.

## Quick Start

```typescript
import { GrpcPool } from 'stalkchain-grpc-pool';

const pool = new GrpcPool({
  endpoints: [
    { endpoint: 'https://grpc.solanatracker.io', token: 'your-token', ping: true },
    { endpoint: 'https://grpc-us.solanatracker.io', token: 'your-token', ping: true },
    { endpoint: 'https://solana-yellowstone-grpc.publicnode.com', token: '', ping: false }
  ]
});

// Listen for transactions
pool.on('transaction', (transaction) => {
  console.log('New transaction:', transaction.signature);
  console.log('From endpoint:', transaction.source);
  console.log('Received at:', new Date(transaction.timestamp));
});

// Monitor pool status
pool.on('connected', () => console.log('Pool ready!'));
pool.on('endpoint', (event) => console.log(`${event.endpoint}: ${event.status}`));

// Connect and subscribe
await pool.connect();
await pool.subscribe({
  accounts: {},
  accountsDataSlice: [],
  transactions: {
    'program_txns': {
      accountInclude: ['YourProgramIdHere'],
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
```

## Events

The pool emits events for all important activities. Listen to these events to receive data and monitor the system:

### Core Data Events

#### `transaction` - Unique Transaction Received
Emitted when a unique transaction is received from any endpoint after deduplication.

```typescript
pool.on('transaction', (event: TransactionEvent) => {
  // event.signature - Full base58 transaction signature (64 characters)
  // event.data - Complete gRPC transaction object with all Yellowstone data
  // event.source - Full endpoint URL that received this transaction
  // event.timestamp - When transaction was received (unix timestamp in ms)
  
  console.log(`New transaction: ${event.signature}`);
  console.log(`From: ${event.source}`);
  console.log(`Slot: ${event.data.slot}`);
  console.log(`Success: ${!event.data.meta?.err}`);
});
```

**TransactionEvent Interface:**
```typescript
interface TransactionEvent {
  signature: string;        // Base58 encoded transaction signature
  data: FullTransactionData; // Complete gRPC transaction object
  source: string;           // Which endpoint received this transaction
  timestamp: number;        // When the transaction was received
}
```

**Example Data:**
```typescript
{
  signature: "5M7Z6GRVk8Z5FQhKccZtztrUpqeG1g27XyVwx4KjL8pQrJ9fX3aBNdT2CvK8Zh4L9mR2Gw1Hv5FPZQx",
  data: {
    transaction: {
      signature: Buffer, // Raw signature buffer
      isVote: false,
      transaction: {
        signatures: [Buffer],
        message: { /* Solana transaction message */ }
      }
    },
    slot: 245123456,
    meta: {
      err: null, // null = success, object = error details
      fee: 5000,
      preBalances: [1000000000],
      postBalances: [999995000]
    }
  },
  source: "https://grpc.solanatracker.io", 
  timestamp: 1703123456789
}
```

#### `duplicate` - Duplicate Transaction Filtered
Emitted when a duplicate transaction is filtered out by the deduplication system.

```typescript
pool.on('duplicate', (event: DuplicateEvent) => {
  // event.signature - Full base58 transaction signature that was duplicated
  // event.source - Full endpoint URL that sent the duplicate
  // event.timestamp - When duplicate was detected (unix timestamp in ms)
  
  console.log(`Filtered duplicate: ${event.signature.substring(0, 8)}...`);
  console.log(`From: ${event.source}`);
});
```

**DuplicateEvent Interface:**
```typescript
interface DuplicateEvent {
  signature: string;  // Base58 encoded signature (full signature)
  source: string;     // Which endpoint received the duplicate
  timestamp: number;  // When the duplicate was detected
}
```

**Example Data:**
```typescript
{
  signature: "5M7Z6GRVk8Z5FQhKccZtztrUpqeG1g27XyVwx4KjL8pQrJ9fX3aBNdT2CvK8Zh4L9mR2Gw1Hv5FPZQx",
  source: "https://grpc-us.solanatracker.io",
  timestamp: 1703123456790
}
```

### Pool Connection Events

#### `connected` - Pool Ready
Emitted when the pool successfully connects to at least one endpoint and is ready to receive transactions.

```typescript
pool.on('connected', () => {
  console.log('✅ Pool connected - ready to receive data');
  // Pool is now operational and subscriptions can be made
});
```

#### `disconnected` - Pool Offline
Emitted when all endpoints are disconnected and the pool is completely offline.

```typescript
pool.on('disconnected', () => {
  console.log('🔴 Pool disconnected - all endpoints offline');
  // Pool will automatically attempt to reconnect
});
```

### Endpoint Monitoring Events

#### `endpoint` - Individual Endpoint Status
Emitted when any individual endpoint changes connection status. Use this for detailed monitoring.

```typescript
pool.on('endpoint', (event: EndpointEvent) => {
  // event.endpoint - Full endpoint URL (e.g., "https://grpc.solanatracker.io")
  // event.status - 'connected' | 'disconnected' | 'reconnected'
  // event.timestamp - When status change occurred (unix timestamp in ms)
  // event.details - Optional error message or additional info
  
  const shortName = event.endpoint.split('.')[0].replace('https://', '');
  console.log(`📡 ${shortName}: ${event.status.toUpperCase()}`);
  
  if (event.details) {
    console.log(`   Details: ${event.details}`);
  }
});
```

**EndpointEvent Interface:**
```typescript
interface EndpointEvent {
  endpoint: string;   // Endpoint URL (e.g., "https://grpc.solanatracker.io") 
  status: 'connected' | 'disconnected' | 'reconnected'; // Connection status
  timestamp: number;  // When the status change occurred
  details?: string;   // Optional additional information (e.g., error message)
}
```

**Example Data:**
```typescript
// Initial connection
{
  endpoint: "https://grpc.solanatracker.io",
  status: "connected", 
  timestamp: 1703123456789
}

// After network issue recovery
{
  endpoint: "https://grpc.solanatracker.io",
  status: "reconnected", 
  timestamp: 1703123459123,
  details: "Recovered after 2.3 seconds"
}

// Connection lost
{
  endpoint: "https://grpc.solanatracker.io",
  status: "disconnected", 
  timestamp: 1703123461456,
  details: "UNAUTHENTICATED: Invalid token"
}
```

### Error Events

#### `error` - Pool Error
Emitted when any error occurs in the pool or individual connections. Pool continues operating and attempts recovery.

```typescript
pool.on('error', (error: Error) => {
  console.error('❌ Pool error:', error.message);
  
  // Log additional context if available
  if (error.stack) {
    console.error('Stack:', error.stack.split('\n')[1]?.trim());
  }
  
  // Pool automatically handles recovery - no action needed
});
```

**Common Error Types:**
- `UNAUTHENTICATED` - Invalid or expired API token
- `UNAVAILABLE` - Endpoint temporarily unavailable
- `DEADLINE_EXCEEDED` - Connection timeout
- `CANCELLED` - Connection cancelled (usually during shutdown)

## Event Usage Patterns

### Basic Transaction Processing
```typescript
// Simple transaction monitoring
pool.on('transaction', (tx) => {
  console.log(`📦 TX: ${tx.signature.substring(0, 8)}...`);
  
  // Access transaction data
  if (tx.data.meta?.err) {
    console.log('   ❌ Transaction failed');
  } else {
    console.log('   ✅ Transaction succeeded');
  }
});
```

### Connection Health Monitoring
```typescript
// Track endpoint health
const endpointStates = new Map();

pool.on('endpoint', (event) => {
  endpointStates.set(event.endpoint, event.status !== 'disconnected');
  
  const connected = Array.from(endpointStates.values()).filter(Boolean).length;
  const total = endpointStates.size;
  
  console.log(`Connection status: ${connected}/${total} endpoints active`);
});
```

### Deduplication Monitoring
```typescript
// Monitor deduplication effectiveness
let uniqueCount = 0;
let duplicateCount = 0;

pool.on('transaction', () => uniqueCount++);
pool.on('duplicate', () => duplicateCount++);

setInterval(() => {
  const total = uniqueCount + duplicateCount;
  const efficiency = total > 0 ? Math.round((duplicateCount / total) * 100) : 0;
  console.log(`Deduplication: ${efficiency}% (${duplicateCount}/${total} filtered)`);
}, 60000);
```

### Comprehensive Event Monitoring
```typescript
// Log all events with timestamps
const logEvent = (type: string, data: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${type}:`, data);
};

pool.on('connected', () => logEvent('CONNECTED', 'Pool ready'));
pool.on('disconnected', () => logEvent('DISCONNECTED', 'Pool offline'));
pool.on('transaction', (tx) => logEvent('TRANSACTION', { 
  sig: tx.signature.substring(0, 8), 
  source: tx.source.split('.')[0] 
}));
pool.on('duplicate', (dup) => logEvent('DUPLICATE', { 
  sig: dup.signature.substring(0, 8), 
  source: dup.source.split('.')[0] 
}));
pool.on('endpoint', (ep) => logEvent('ENDPOINT', { 
  endpoint: ep.endpoint.split('.')[0], 
  status: ep.status 
}));
pool.on('error', (err) => logEvent('ERROR', err.message));
```

## Configuration

### Pool Configuration

> **⚠️ Production Recommendation**: Set `staleTimeoutMs` to 30 seconds or higher. Short timeouts (< 30s) can cause connection thrashing during network outages, where the system repeatedly attempts to close and reconnect streams before network recovery.

```typescript
import { GrpcPool, PoolConfig, PoolOptions } from 'stalkchain-grpc-pool';

const config: PoolConfig = {
  endpoints: [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: 'your-api-token',
      ping: true  // Enable heartbeat ping for authenticated endpoints
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com', 
      token: '',  // Public endpoint - no token required
      ping: false // Disable ping for public endpoints
    }
  ]
};

const options: PoolOptions = {
  pingIntervalMs: 30000,        // Ping every 30 seconds (default)
  staleTimeoutMs: 120000,       // 2 minutes until connection considered stale
  deduplicationTtlMs: 60000,    // Keep signatures for 1 minute
  maxCacheSize: 10000,          // Maximum signatures in deduplication cache
  initialRetryDelayMs: 500,     // Start retry delay at 500ms
  maxRetryDelayMs: 30000,       // Maximum retry delay of 30 seconds  
  retryBackoffFactor: 2         // Double delay after each failed retry
};

// ⚠️ Important: Set staleTimeoutMs to 30 seconds or higher in production
// Short stale timeouts (< 30s) can cause connection thrashing during network issues

const pool = new GrpcPool(config, options);
```

### Subscription Configuration

**Required Subscription Structure:**
```typescript
await pool.subscribe({
  accounts: {},                    // Required - even if empty
  accountsDataSlice: [],          // Required - even if empty  
  transactions: {},               // Required - even if empty
  slots: {},                      // Required - even if empty
  transactionsStatus: {},         // Required - even if empty
  blocks: {},                     // Required - even if empty
  blocksMeta: {},                 // Required - even if empty
  entry: {},                      // Required - even if empty
  commitment: 'confirmed'         // Required - commitment level
});
```

Subscribe to different types of data using the standard Yellowstone gRPC format:

```typescript
// Program transactions
await pool.subscribe({
  accounts: {},
  accountsDataSlice: [],
  transactions: {
    'program_txns': {
      accountInclude: ['YourProgramIdHere'],
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

// Account updates  
await pool.subscribe({
  accounts: {
    'token_accounts': {
      owner: ['TokenProgramId'],
      filters: []
    }
  },
  accountsDataSlice: [],
  transactions: {},
  slots: {},
  transactionsStatus: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  commitment: 'processed'
});

// Multiple subscriptions
await pool.subscribe({
  accounts: {
    'user_accounts': { 
      owner: ['UserWallet'],
      filters: []
    }
  },
  accountsDataSlice: [],
  transactions: {
    'program_txns': { 
      accountInclude: ['Program1', 'Program2'],
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
```

## Advanced Usage

### Stale Connection Detection

The pool automatically detects stale connections and forces reconnection. Configure this behavior carefully:

```typescript
const options: PoolOptions = {
  staleTimeoutMs: 60000,  // ✅ Good: 60 seconds allows for network recovery
  // staleTimeoutMs: 5000, // ❌ Avoid: Too aggressive, causes connection thrashing
};
```

**Why 30+ seconds is recommended:**
- During network outages, streams may not receive the close signal immediately
- Short timeouts cause rapid reconnection loops before network recovery
- Longer timeouts allow natural network recovery and reduce server load

### Monitoring Pool Health

```typescript
// Track connection status
pool.on('endpoint', (event) => {
  console.log(`${event.endpoint}: ${event.status}`);
  
  if (event.status === 'disconnected') {
    console.warn(`Lost connection to ${event.endpoint}`);
  }
  
  if (event.status === 'reconnected') {
    console.log(`Restored connection to ${event.endpoint}`);
  }
});

// Monitor deduplication efficiency  
let uniqueCount = 0;
let duplicateCount = 0;

pool.on('transaction', () => uniqueCount++);
pool.on('duplicate', () => duplicateCount++);

setInterval(() => {
  const total = uniqueCount + duplicateCount;
  const efficiency = total > 0 ? Math.round((duplicateCount / total) * 100) : 0;
  console.log(`Deduplication: ${efficiency}% (${duplicateCount}/${total})`);
}, 60000);
```

### Error Handling

```typescript
pool.on('error', (error) => {
  console.error('Pool error:', error.message);
  
  // Implement your error handling logic
  // The pool will automatically attempt to reconnect
});

pool.on('disconnected', () => {
  console.warn('Pool offline - all endpoints disconnected');
  
  // Optional: implement alerting or fallback logic
  // The pool will automatically attempt to reconnect
});
```

### Graceful Shutdown

```typescript
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  
  // Close pool and clean up resources
  await pool.close();
  
  console.log('Pool closed successfully');
  process.exit(0);
});
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import { 
  GrpcPool,
  PoolConfig,
  PoolOptions, 
  TransactionEvent,
  DuplicateEvent,
  EndpointEvent,
  CommitmentLevel
} from 'stalkchain-grpc-pool';

// All events are fully typed
pool.on('transaction', (transaction: TransactionEvent) => {
  // transaction.signature is typed as string
  // transaction.data is typed as FullTransactionData
  // transaction.source is typed as string  
  // transaction.timestamp is typed as number
});
```

## License

MIT
