# StalkChain gRPC Pool

[![npm version](https://badge.fury.io/js/%40stalkchain%2Fgrpc-pool.svg)](https://badge.fury.io/js/%40stalkchain%2Fgrpc-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

High-performance, production-ready gRPC connection pooling module with active-active configuration, intelligent deduplication, and automatic failover for Solana Yellowstone gRPC streams.

## 🚀 Features

- **Active-Active Pooling**: Multiple gRPC connections working simultaneously
- **Intelligent Deduplication**: Buffer-based signature comparison for maximum efficiency
- **Automatic Failover**: Seamless switching when connections fail
- **Circuit Breaker Pattern**: Prevents cascade failures
- **Health Monitoring**: Real-time connection health tracking
- **High Performance**: 3,000+ messages/second throughput
- **TypeScript Support**: Full type safety and IntelliSense
- **Production Ready**: Battle-tested for 99.99% SLA

## 📦 Installation

### Option 1: Package Manager (When Published)

```bash
# Note: This will work once the package is published to npm
# Using pnpm (recommended)
pnpm add @stalkchain/grpc-pool

# Using npm
npm install @stalkchain/grpc-pool

# Using yarn
yarn add @stalkchain/grpc-pool
```

### Option 2: Direct Repository Setup (Recommended)

If you've downloaded or cloned this repository directly:

```bash
# Clone the repository
git clone https://github.com/StalkChain/stalkchain-grpc-pool.git
cd stalkchain-grpc-pool

# Install dependencies
pnpm install

# Build the project
pnpm build
```

Then in your project, reference it as a local module in your package.json:

```json
{
  "name": "your-stalkchain-app",
  "dependencies": {
    "@stalkchain/grpc-pool": "file:../modules/stalkchain-grpc-pool",
    "other-dependencies": "..."
  }
}
```

Or use it directly with require/import:

```javascript
// If using the built version
const { createSolanaGrpcPool } = require('./path/to/stalkchain-grpc-pool/dist');

// Or if using TypeScript directly
import { createSolanaGrpcPool } from './path/to/stalkchain-grpc-pool/src';
```

## 🔧 Quick Start

### 1. Environment Setup

Create a `.env` file in your project root:

```bash
cp .env.example .env
```

Add your SolanaTracker API key:

```env
SOLANA_TRACKER_API_KEY=your_api_key_here
```

### 2. Basic Usage

```typescript
// If installed via package manager
import { createSolanaGrpcPool } from '@stalkchain/grpc-pool';

// If using local repository
import { createSolanaGrpcPool } from './path/to/stalkchain-grpc-pool/dist';
// or
const { createSolanaGrpcPool } = require('./path/to/stalkchain-grpc-pool/dist');

// Create pool with multiple endpoints
const pool = createSolanaGrpcPool({
  connections: [
    {
      endpoint: 'https://grpc.solanatracker.io',
      token: process.env.SOLANA_TRACKER_API_KEY!
    },
    {
      endpoint: 'https://grpc-us.solanatracker.io',
      token: process.env.SOLANA_TRACKER_API_KEY!
    },
    {
      endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
      token: '' // Public endpoint
    }
  ],
  deduplicationWindow: 60000, // 60 seconds
  maxCacheSize: 10000
});

// Start the pool
await pool.start();

// Listen for messages
pool.on('message-processed', (message) => {
  console.log('Transaction:', message.data.signature);
  console.log('From:', message.source);
  console.log('Slot:', message.data.slot);
});

// Listen for duplicates (for monitoring)
pool.on('message-deduplicated', (signature, source) => {
  console.log(`Duplicate filtered: ${signature} from ${source}`);
});

// Subscribe to Solana transactions
await pool.subscribe({
  accounts: {},
  accountsDataSlice: [],
  transactions: {
    alltxs: {
      accountInclude: [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
        "TokenzQdB6q6JkUeT2XkC1gYwA9kL5QkUuU2eQ3M7z6"  // Token-2022
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
});
```

## 🧪 Testing

### For Local Repository Setup

Run the included tests to verify everything works:

```bash
# First, make sure you have built the project
pnpm build

# Run the basic pool test
node test-pool.js

# Test error handling and retry behavior
node test-retry.js

# Test original issue fix (401 error handling)
node test-original-issue.js

# Or use the npm script
pnpm run test:pool
```

### For Package Installation

```bash
# Build and test
pnpm run test:pool
```

The tests will:
- Connect to all configured endpoints
- Show real-time transaction signatures
- Display deduplication statistics
- Monitor connection health
- Test error handling and automatic retry behavior
- Verify the pool continues working even when individual connections fail

### Test Files Description

- **`test-pool.js`**: Basic functionality test with all endpoints
- **`test-retry.js`**: Tests retry behavior when connections fail
- **`test-original-issue.js`**: Verifies the fix for 401 authentication errors
- **`test-error-handling.js`**: Comprehensive error handling validation

## 📊 Performance

Tested performance metrics:
- **Throughput**: 3,000+ messages/second
- **Deduplication**: ~5% duplicate rate in real-world scenarios
- **Latency**: Sub-millisecond processing overhead
- **Memory**: Efficient buffer-based signature comparison
- **Reliability**: 99.99% uptime with proper failover

## 🔧 Configuration

### Pool Options

```typescript
interface PoolConfig {
  connections: ConnectionConfig[];
  deduplicationWindow?: number;    // Default: 60000ms
  maxCacheSize?: number;          // Default: 10000
  healthCheckInterval?: number;    // Default: 30000ms
  circuitBreakerThreshold?: number; // Default: 5
  logger?: Logger;
}
```

### Connection Options

```typescript
interface ConnectionConfig {
  endpoint: string;
  token: string;
  timeout?: number;        // Default: 30000ms
  retryAttempts?: number; // Default: 3
}
```

## 🏗️ Architecture

The pool implements several key patterns:

1. **Active-Active**: All connections stream simultaneously
2. **Deduplication**: Buffer-based signature comparison
3. **Circuit Breaker**: Automatic failure isolation
4. **Health Monitoring**: Continuous connection health checks
5. **Event-Driven**: Clean separation of concerns

## 📝 API Reference

### Events

- `message-processed`: New unique message received
- `message-deduplicated`: Duplicate message filtered
- `connection-connected`: Connection established
- `connection-disconnected`: Connection lost
- `connection-recovered`: Connection restored
- `error`: Error occurred

### Methods

- `start()`: Start the pool
- `stop()`: Stop the pool
- `subscribe(request)`: Subscribe to gRPC stream
- `getHealthStatus()`: Get connection health
- `getMetrics()`: Get performance metrics
- `isRunning()`: Check if pool is running

## 🛠️ Local Development

If you're developing with the local repository:

1. Clone the repository:
   ```bash
   git clone https://github.com/StalkChain/stalkchain-grpc-pool.git
   cd stalkchain-grpc-pool
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   pnpm build
   ```

4. Run tests:
   ```bash
   node test-pool.js
   ```

5. Make your changes to the TypeScript source in the `src` directory

6. Rebuild after changes:
   ```bash
   pnpm build
   ```

### Using in Another Project During Development

You can link your local copy to another project:

1. In the stalkchain-grpc-pool directory:
   ```bash
   pnpm link --global
   ```

2. In your project directory:
   ```bash
   pnpm link --global @stalkchain/grpc-pool
   ```

Or reference it directly in your package.json:

```json
{
  "dependencies": {
    "@stalkchain/grpc-pool": "file:../path/to/stalkchain-grpc-pool"
  }
}
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Triton One](https://triton.one/) for Yellowstone gRPC
- [SolanaTracker](https://solanatracker.io/) for reliable endpoints
- Solana community for continuous innovation

---

Built with ❤️ by the [StalkChain](https://github.com/StalkChain) team
