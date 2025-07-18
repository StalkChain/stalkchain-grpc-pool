# Manual Installation Guide

This guide shows you how to install and test `stalkchain-grpc-pool` locally before it's published to npm.

## 📦 Local Package Testing

### Prerequisites

- Node.js 16+ 
- pnpm (recommended) or npm
- TypeScript knowledge

### Step 1: Build and Pack the Library

From the `stalkchain-grpc-pool` project directory:

```bash
# Clean and build the project
pnpm run clean
pnpm run build

# Create a local package tarball
pnpm pack
```

This creates `stalkchain-grpc-pool-0.1.0.tgz` in the project root.

### Step 2: Create a Test Project

```bash
# Create a new test directory (outside the library directory)
mkdir ../test-stalkchain-grpc-pool
cd ../test-stalkchain-grpc-pool

# Initialize a new Node.js project
pnpm init -y
```

### Step 3: Install the Local Package

```bash
# Install the local tarball
pnpm install ../stalkchain-grpc-pool/stalkchain-grpc-pool-0.1.0.tgz

# Install development dependencies
pnpm add -D typescript ts-node @types/node

# Install runtime dependencies (if not auto-installed)
pnpm add @triton-one/yellowstone-grpc bs58 dotenv
```

### Step 4: Create Environment Configuration

Create `.env` file:

```env
SOLANA_GRPC_TOKEN=your_token_here
SOLANA_GRPC_URL_MAIN=https://grpc.solanatracker.io
SOLANA_GRPC_URL_SECONDARY=https://grpc-us.solanatracker.io
```

### Step 5: Create Test Scripts

#### Basic Test (`test-basic.ts`)

```typescript
import 'dotenv/config';
import { GrpcPool, PoolConfig, TransactionEvent, DuplicateEvent, EndpointEvent } from 'stalkchain-grpc-pool';

const config: PoolConfig = {
  endpoints: [
    {
      endpoint: process.env.SOLANA_GRPC_URL_MAIN || 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_GRPC_TOKEN || '',
      ping: true
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
      token: '',
      ping: false
    }
  ]
};

async function testBasic() {
  console.log('🧪 Testing stalkchain-grpc-pool basic functionality');
  
  const pool = new GrpcPool(config);
  
  // Test event listeners
  pool.on('transaction', (tx: TransactionEvent) => {
    console.log(`📦 Transaction: ${tx.signature.substring(0, 8)}... from ${tx.source.split('.')[0]}`);
  });
  
  pool.on('duplicate', (dup: DuplicateEvent) => {
    console.log(`🔄 Duplicate filtered from ${dup.source.split('.')[0]}`);
  });
  
  pool.on('endpoint', (event: EndpointEvent) => {
    console.log(`📡 ${event.endpoint.split('.')[0]}: ${event.status.toUpperCase()}`);
  });
  
  pool.on('connected', () => {
    console.log('✅ Pool connected successfully!');
  });
  
  pool.on('error', (error: Error) => {
    console.error('❌ Pool error:', error.message);
  });
  
  try {
    await pool.connect();
    
    // Test subscription
    await pool.subscribe({
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        'test_txns': {
          accountInclude: ['6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma'],
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
    
    console.log('🎯 Package working perfectly! Press Ctrl+C to exit.');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down test...');
      await pool.close();
      console.log('👋 Test completed!');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBasic();
```

#### Advanced Test (`test-advanced.ts`)

```typescript
import 'dotenv/config';
import { 
  GrpcPool, 
  PoolConfig, 
  PoolOptions,
  TransactionEvent, 
  DuplicateEvent, 
  EndpointEvent 
} from 'stalkchain-grpc-pool';

async function testAdvanced() {
  console.log('🔬 Testing advanced stalkchain-grpc-pool features');
  
  const config: PoolConfig = {
    endpoints: [
      {
        endpoint: process.env.SOLANA_GRPC_URL_MAIN || 'https://grpc.solanatracker.io',
        token: process.env.SOLANA_GRPC_TOKEN || '',
        ping: true
      },
      {
        endpoint: process.env.SOLANA_GRPC_URL_SECONDARY || 'https://grpc-us.solanatracker.io',
        token: process.env.SOLANA_GRPC_TOKEN || '',
        ping: true
      },
      {
        endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
        token: '',
        ping: false
      }
    ]
  };
  
  const options: PoolOptions = {
    pingIntervalMs: 30000,
    staleTimeoutMs: 60000,
    deduplicationTtlMs: 30000,
    maxCacheSize: 5000,
    initialRetryDelayMs: 500,
    maxRetryDelayMs: 30000,
    retryBackoffFactor: 2
  };
  
  const pool = new GrpcPool(config, options);
  
  let txCount = 0;
  let dupCount = 0;
  
  // Comprehensive event monitoring
  pool.on('transaction', (tx: TransactionEvent) => {
    txCount++;
    console.log(`📦 TX #${txCount}: ${tx.signature.substring(0, 12)}... from ${tx.source.split('.')[0]}`);
    
    // Test transaction data access
    if (tx.data.meta) {
      const status = tx.data.meta.err ? 'FAILED' : 'SUCCESS';
      console.log(`   └─ Status: ${status}, Slot: ${tx.data.slot || 'N/A'}`);
    }
  });
  
  pool.on('duplicate', (dup: DuplicateEvent) => {
    dupCount++;
    console.log(`🔄 Duplicate #${dupCount} from ${dup.source.split('.')[0]}`);
  });
  
  pool.on('endpoint', (event: EndpointEvent) => {
    const endpoint = event.endpoint.split('.')[0];
    const timestamp = new Date(event.timestamp).toISOString();
    console.log(`📡 [${timestamp}] ${endpoint}: ${event.status.toUpperCase()}`);
  });
  
  pool.on('connected', () => {
    console.log('✅ Pool connected - all features working!');
  });
  
  pool.on('disconnected', () => {
    console.log('🔴 Pool disconnected');
  });
  
  pool.on('error', (error: Error) => {
    console.error('❌ Error:', error.message);
  });
  
  try {
    await pool.connect();
    
    await pool.subscribe({
      accounts: {},
      accountsDataSlice: [],
      transactions: {
        'advanced_test': {
          accountInclude: ['6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma'],
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
    
    // Show periodic statistics
    const statsInterval = setInterval(() => {
      const status = pool.getStatus();
      const connectedCount = status.filter(s => s.connected).length;
      const dedupStats = pool.getDeduplicationStats();
      
      console.log(`📊 Stats: ${txCount} txns, ${dupCount} dups, ${connectedCount}/${status.length} endpoints, cache: ${dedupStats.size}/${dedupStats.maxSize}`);
    }, 30000);
    
    console.log('🎯 Advanced testing active! Press Ctrl+C to exit.');
    
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down advanced test...');
      clearInterval(statsInterval);
      
      console.log(`\n📊 Final Results:`);
      console.log(`   Transactions: ${txCount}`);
      console.log(`   Duplicates: ${dupCount}`);
      console.log(`   Efficiency: ${txCount + dupCount > 0 ? Math.round((dupCount / (txCount + dupCount)) * 100) : 0}% deduplication`);
      
      await pool.close();
      console.log('👋 Advanced test completed!');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Advanced test failed:', error);
    process.exit(1);
  }
}

testAdvanced();
```

### Step 6: Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 7: Run Tests

```bash
# Run basic test
npx ts-node test-basic.ts

# Run advanced test
npx ts-node test-advanced.ts
```

## 🔧 Testing Different Scenarios

### Connection Testing

Test connection resilience:

```typescript
// Test with invalid token (should show error handling)
const config = {
  endpoints: [
    { endpoint: 'https://grpc.solanatracker.io', token: 'invalid', ping: true }
  ]
};
```

### Subscription Testing

All subscription requests must include the complete Yellowstone gRPC structure with all required fields.

Test different subscription types:

```typescript
// Test account subscriptions
await pool.subscribe({
  accounts: {
    'token_accounts': {
      owner: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
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
  commitment: 'confirmed'
});

// Test transaction subscriptions  
await pool.subscribe({
  accounts: {},
  accountsDataSlice: [],
  transactions: {
    'program_txns': {
      accountInclude: ['YourProgramId'],
      accountExclude: [],
      accountRequired: [],
      vote: false,
      failed: true  // Include failed transactions
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

## 🐛 Troubleshooting

### Common Issues

1. **Module not found errors**
   ```bash
   # Make sure TypeScript is installed
   pnpm add -D typescript ts-node
   ```

2. **Connection errors**
   ```bash
   # Check your .env file has valid tokens
   echo $SOLANA_GRPC_TOKEN
   ```

3. **TypeScript compilation errors**
   ```bash
   # Ensure tsconfig.json is properly configured
   npx tsc --noEmit
   ```

### Verification Checklist

- [ ] Package installs without errors
- [ ] TypeScript imports work correctly  
- [ ] All event types are properly typed
- [ ] Connection to endpoints succeeds
- [ ] Transactions are received and deduplicated
- [ ] Graceful shutdown works
- [ ] Error handling functions correctly

## 🚀 Ready for Production

Once local testing passes, the package is ready for:

1. **npm publication**: `npm publish`
2. **Production deployment**: Use in real applications
3. **CI/CD integration**: Add to automated pipelines

## 📞 Support

If you encounter issues during manual installation:

1. Check all dependencies are installed correctly
2. Verify environment variables are set
3. Test with minimal configuration first
4. Check network connectivity to gRPC endpoints
5. Review error messages for specific issues

The manual installation process validates that the package works correctly in isolated environments before npm publication. 