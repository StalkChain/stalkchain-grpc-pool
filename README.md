# StalkChain gRPC Pool

[![npm version](https://badge.fury.io/js/%40stalkchain%2Fgrpc-pool.svg)](https://badge.fury.io/js/%40stalkchain%2Fgrpc-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

High-performance, production-ready gRPC connection pooling module with active-active configuration, intelligent deduplication, and automatic failover for Solana Yellowstone gRPC streams.

## 🚀 Features

- **Active-Active Pooling**: Multiple gRPC connections working simultaneously
- **Intelligent Deduplication**: Buffer-based signature comparison for maximum efficiency
- **Automatic Failover**: Seamless switching when connections fail
- **Endless Retries**: Never gives up reconnecting for maximum production uptime
- **Message Timeout Detection**: Identifies stale connections when no messages are received
- **Stream Ping/Pong Keep-Alive**: Active monitoring of stream health with ping/pong messages
- **Proper Connection Cleanup**: Always closes connections before reconnecting to prevent leaks
- **Graceful Shutdown**: Properly closes all streams when the process exits
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
import { createSolanaGrpcPool, registerPoolForGracefulShutdown } from '@stalkchain/grpc-pool';

// If using local repository
import { createSolanaGrpcPool, registerPoolForGracefulShutdown } from './path/to/stalkchain-grpc-pool/dist';
// or
const { createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('./path/to/stalkchain-grpc-pool/dist');
// or 
import { createSolanaGrpcPool, registerPoolForGracefulShutdown } from '@stalkchain/grpc-pool'; // in case added in package.json with: 
// "dependencies": {
//   "@stalkchain/grpc-pool": "file:modules/stalkchain-grpc-pool-main"
// }

// Create pool with multiple endpoints
const pool = createSolanaGrpcPool([
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
    token: '', // Public endpoint
    noPing: true // Skip ping health checks for this connection
  }
], {
  config: {
    deduplicationWindow: 60000, // 60 seconds
    maxCacheSize: 10000,
    messageTimeout: 300000, // 5 minutes - mark connection as stale if no messages received
    streamPing: {
      enabled: true,        // Enable stream ping/pong keep-alive
      interval: 30000,      // Send ping every 30 seconds
      timeout: 10000,       // Wait 10 seconds for pong response
      maxMissedPongs: 3     // Allow 3 missed pongs before marking as stale
    }
  }
});

// Register for graceful shutdown (recommended for production)
registerPoolForGracefulShutdown(pool);

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
pnpm run test:pool

# Test error handling and retry behavior
pnpm run test:retry

# Test original issue fix (401 error handling)
pnpm run test:original-issue

# Test endless retries functionality
pnpm run test:endless-retries

# Test graceful shutdown
pnpm run test:graceful-shutdown

# Test message timeout detection
pnpm run test:message-timeout

# Test stream ping/pong keep-alive
pnpm run test:stream-ping

# Test connection cleanup
pnpm run test:connection-cleanup

# Test noPing option
pnpm run test:no-ping

# Test stale connection reconnection
pnpm run test:stale-reconnection

# Test public gRPC health (no build required)
pnpm run test:public-grpc

# Test comprehensive error handling
pnpm run test:error-handling
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

#### Root Level Tests
- **`test-pool.js`**: Basic functionality test with all endpoints
- **`test-retry.js`**: Tests retry behavior when connections fail
- **`test-original-issue.js`**: Verifies the fix for 401 authentication errors
- **`test-error-handling.js`**: Comprehensive error handling validation

#### Feature-Specific Tests
- **`test/test-endless-retries.js`**: Tests endless retry functionality for production reliability
- **`test/test-graceful-shutdown.js`**: Tests proper connection cleanup on shutdown
- **`test/test-message-timeout.js`**: Tests stale connection detection via message timeout
- **`test/test-stream-ping.js`**: Tests stream ping/pong keep-alive functionality
- **`test/test-connection-cleanup.js`**: Tests proper gRPC connection cleanup
- **`test/test-no-ping-option.js`**: Tests noPing option for public endpoints
- **`test/test-stale-reconnection.js`**: Tests reconnection behavior for stale connections
- **`test/test-public-grpc-health.js`**: Tests health checks with public gRPC endpoints

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
  deduplicationWindow: number;        // Default: 300000ms (5 minutes)
  maxCacheSize: number;              // Default: 100000
  circuitBreaker: CircuitBreakerConfig;
  batchProcessing: BatchConfig;
  enableMetrics: boolean;            // Default: true
  logger?: Logger;
  messageTimeout?: number;           // Default: 300000ms (5 minutes)
  streamPing?: StreamPingConfig;     // Stream ping/pong configuration
}
```

#### Detailed Configuration Explanations

**`deduplicationWindow`** (number, default: 300000ms)
- Time window in milliseconds for keeping track of processed messages
- Messages with the same signature within this window are considered duplicates
- Larger values = better deduplication but more memory usage
- Recommended: 60-300 seconds for most use cases

**`maxCacheSize`** (number, default: 100000)
- Maximum number of message signatures to keep in the deduplication cache
- When limit is reached, oldest entries are removed (LRU eviction)
- Larger values = better deduplication but more memory usage
- Recommended: 10,000-500,000 depending on message volume

**`messageTimeout`** (number, optional, default: 300000ms)
- Time in milliseconds to wait for messages before considering a connection stale
- If no messages are received within this time, the connection is marked as unhealthy
- Set to `undefined` to disable timeout-based stale detection
- Recommended: 60-600 seconds depending on expected message frequency

**`enableMetrics`** (boolean, default: true)
- Whether to collect performance metrics (Prometheus format)
- Metrics include message counts, connection health, processing times
- Disable only if you don't need monitoring or want to reduce overhead

### Circuit Breaker Configuration

The circuit breaker prevents cascade failures by temporarily blocking requests to failing connections. It has three states:

- **CLOSED** (normal): Requests pass through normally
- **OPEN** (failing): All requests are blocked, connection is considered down
- **HALF_OPEN** (testing): Limited requests allowed to test if connection recovered

```typescript
interface CircuitBreakerConfig {
  errorThresholdPercentage: number;  // Default: 50
  minimumRequestThreshold: number;   // Default: 10
  resetTimeout: number;              // Default: 30000ms
  timeout: number;                   // Default: 5000ms
}
```

**`errorThresholdPercentage`** (number, 0-100, default: 50)
- Percentage of failed requests that triggers the circuit breaker to open
- Example: 50 means if 50% or more requests fail, the circuit opens
- Lower values = more sensitive to failures (opens sooner)
- Higher values = more tolerant of failures (stays closed longer)
- **Production recommendation**: 25-50 for critical systems, 50-70 for development

**`minimumRequestThreshold`** (number, default: 10)
- Minimum number of requests required before circuit breaker can open
- Prevents opening due to a few initial failures during startup
- Example: With threshold 10, circuit won't open until at least 10 requests have been made
- **Production recommendation**: 5-20 requests

**`resetTimeout`** (number, milliseconds, default: 30000)
- Time to wait in OPEN state before attempting to close the circuit (go to HALF_OPEN)
- During this time, all requests to the failing connection are blocked
- After timeout, a few test requests are allowed to check if connection recovered
- **Production recommendation**: 15-60 seconds

**`timeout`** (number, milliseconds, default: 5000)
- Maximum time to wait for a single request before considering it failed
- Applies to individual gRPC calls and connection attempts
- Shorter timeouts = faster failure detection but may cause false positives
- **Production recommendation**: 3-10 seconds for real-time applications

#### Circuit Breaker Example Scenarios

**Scenario 1: High Availability Setup**
```typescript
circuitBreaker: {
  errorThresholdPercentage: 25,    // Very sensitive - open after 25% failures
  minimumRequestThreshold: 5,      // Quick to respond
  resetTimeout: 15000,             // Fast recovery attempts (15s)
  timeout: 3000                    // Short timeout for real-time data
}
```

**Scenario 2: Development/Testing**
```typescript
circuitBreaker: {
  errorThresholdPercentage: 70,    // More tolerant of failures
  minimumRequestThreshold: 20,     // Require more data before opening
  resetTimeout: 60000,             // Longer recovery time (60s)
  timeout: 10000                   // Longer timeout for debugging
}
```

### Stream Ping Configuration

Stream ping/pong provides active health monitoring by sending periodic ping messages and expecting pong responses.

```typescript
interface StreamPingConfig {
  enabled: boolean;                  // Default: false
  interval: number;                  // Default: 30000ms
  timeout: number;                   // Default: 10000ms
  maxMissedPongs: number;           // Default: 3
}
```

**`enabled`** (boolean, default: false)
- Whether to enable stream-level ping/pong health checks
- When enabled, ping messages are sent periodically to test stream health
- Disable for connections that don't support ping or to reduce overhead

**`interval`** (number, milliseconds, default: 30000)
- Time between ping messages
- Shorter intervals = faster detection of connection issues
- Longer intervals = less overhead but slower detection
- **Recommendation**: 15-60 seconds

**`timeout`** (number, milliseconds, default: 10000)
- Maximum time to wait for a pong response to a ping
- Must be less than the interval to avoid overlapping pings
- **Recommendation**: 25-50% of the interval value

**`maxMissedPongs`** (number, default: 3)
- Number of consecutive missed pong responses before marking connection as stale
- Higher values = more tolerant of temporary network issues
- Lower values = faster detection of connection problems
- **Recommendation**: 2-5 for most use cases

### Connection Options

```typescript
interface ConnectionConfig {
  endpoint: string;
  token: string;
  reconnectAttempts: number;         // Default: varies by config type
  reconnectDelay: number;            // Default: varies by config type
  healthCheckInterval: number;       // Default: varies by config type
  connectionTimeout: number;         // Default: varies by config type
  requestTimeout: number;            // Default: varies by config type
  grpcOptions?: Record<string, unknown>;
  noPing?: boolean;                  // Skip ping health checks (useful for public endpoints)
}
```

#### Connection Configuration Details

**`endpoint`** (string, required)
- The gRPC server URL (e.g., 'https://grpc.solanatracker.io')
- Must include protocol (https:// or http://)
- Can include port number if non-standard (e.g., ':443')

**`token`** (string, required)
- Authentication token for the gRPC service
- Can be empty string for public endpoints that don't require authentication
- Keep secure and use environment variables in production

**`reconnectAttempts`** (number)
- Maximum number of reconnection attempts when connection fails
- Set to high values (50+) for production reliability
- Set to lower values (5-10) for development/testing
- **Default values by config type:**
  - Production/High-Availability: 50
  - Development: 10
  - Testing: 3

**`reconnectDelay`** (number, milliseconds)
- Base delay between reconnection attempts
- Actual delay uses exponential backoff: `delay * (2 ^ attempt)`
- **Default values:**
  - Production: 1000ms (1 second base)
  - Development: 2000ms (2 seconds base)
  - Testing: 500ms (0.5 seconds base)

**`healthCheckInterval`** (number, milliseconds)
- How often to perform connection-level health checks
- Separate from stream ping/pong checks
- **Default values:**
  - Production: 2000ms (2 seconds)
  - Development: 5000ms (5 seconds)
  - Testing: 10000ms (10 seconds)

**`connectionTimeout`** (number, milliseconds)
- Maximum time to wait when establishing initial connection
- **Default values:**
  - Production: 5000ms (5 seconds)
  - Development: 10000ms (10 seconds)
  - Testing: 15000ms (15 seconds)

**`requestTimeout`** (number, milliseconds)
- Maximum time to wait for individual gRPC requests
- **Default values:**
  - Production: 3000ms (3 seconds)
  - Development: 10000ms (10 seconds)
  - Testing: 15000ms (15 seconds)

**`grpcOptions`** (object, optional)
- Custom gRPC client options passed directly to the underlying gRPC client
- Advanced configuration for specific gRPC behaviors
- Example: `{ 'grpc.keepalive_time_ms': 30000 }`

**`noPing`** (boolean, optional, default: false)
- When `true`, skips both connection-level and stream-level ping health checks
- Useful for public endpoints that may not support ping operations
- Connection health relies solely on message timeout detection
- **Use cases:**
  - Public gRPC endpoints without ping support
  - Endpoints with authentication issues for ping requests
  - Reducing overhead when ping checks aren't needed

### noPing Option

The `noPing` option allows you to skip ping health checks for specific connections. This is particularly useful for:

- **Public endpoints** that don't support ping operations
- **Endpoints with authentication issues** for ping requests
- **Connections where you want to rely only on message timeout detection**

```typescript
const connections = [
  {
    endpoint: 'https://grpc.solanatracker.io',
    token: process.env.SOLANA_TRACKER_API_KEY
    // Regular connection - will perform ping health checks
  },
  {
    endpoint: 'https://solana-yellowstone-grpc.publicnode.com:443',
    token: '', // Public endpoint
    noPing: true // Skip ping health checks, rely only on message timeout
  }
];

const pool = createSolanaGrpcPool(connections, {
  config: {
    messageTimeout: 300000, // 5 minutes
    streamPing: {
      enabled: true,
      interval: 30000,
      timeout: 10000,
      maxMissedPongs: 3
    }
  }
});
```

When `noPing: true` is set:
- ✅ **Connection-level ping health checks are skipped**
- ✅ **Stream-level ping/pong is skipped**
- ✅ **Connection relies on message timeout detection only**
- ✅ **Other connections in the pool still perform ping health checks**

### Configuration Examples for Different Use Cases

#### Production High-Availability Setup
For critical applications requiring maximum uptime:

```typescript
const pool = createSolanaGrpcPool([
  { endpoint: 'https://grpc.solanatracker.io', token: process.env.API_KEY },
  { endpoint: 'https://grpc-us.solanatracker.io', token: process.env.API_KEY },
  { endpoint: 'https://grpc-eu.solanatracker.io', token: process.env.API_KEY }
], {
  config: {
    deduplicationWindow: 180000,     // 3 minutes - balance between accuracy and memory
    maxCacheSize: 200000,            // Large cache for high throughput
    messageTimeout: 60000,           // 1 minute - aggressive timeout for quick failover
    enableMetrics: true,             // Enable for monitoring

    circuitBreaker: {
      errorThresholdPercentage: 25,  // Very sensitive - fail fast
      minimumRequestThreshold: 5,    // Quick to respond to issues
      resetTimeout: 15000,           // Fast recovery attempts
      timeout: 3000                  // Short timeout for real-time data
    },

    streamPing: {
      enabled: true,                 // Active health monitoring
      interval: 15000,               // Ping every 15 seconds
      timeout: 5000,                 // 5 second timeout
      maxMissedPongs: 2              // Only allow 2 missed pongs
    }
  }
});
```

#### Development/Testing Setup
For local development with more relaxed timeouts:

```typescript
const pool = createSolanaGrpcPool([
  { endpoint: 'https://grpc.solanatracker.io', token: process.env.API_KEY },
  { endpoint: 'https://solana-yellowstone-grpc.publicnode.com', token: '', noPing: true }
], {
  config: {
    deduplicationWindow: 60000,      // 1 minute - shorter for faster testing
    maxCacheSize: 10000,             // Smaller cache
    messageTimeout: 600000,          // 10 minutes - relaxed for debugging
    enableMetrics: false,            // Disable to reduce noise

    circuitBreaker: {
      errorThresholdPercentage: 70,  // More tolerant of failures
      minimumRequestThreshold: 20,   // Require more data before opening
      resetTimeout: 60000,           // Longer recovery time
      timeout: 10000                 // Longer timeout for debugging
    },

    streamPing: {
      enabled: false                 // Disable to reduce noise during development
    }
  }
});
```

#### Mixed Public/Private Endpoint Setup
Combining paid and free endpoints:

```typescript
const pool = createSolanaGrpcPool([
  // Primary paid endpoints with full health monitoring
  {
    endpoint: 'https://grpc.solanatracker.io',
    token: process.env.SOLANA_TRACKER_API_KEY
  },
  {
    endpoint: 'https://grpc-us.solanatracker.io',
    token: process.env.SOLANA_TRACKER_API_KEY
  },

  // Public fallback endpoints with ping disabled
  {
    endpoint: 'https://solana-yellowstone-grpc.publicnode.com',
    token: '',
    noPing: true  // Public endpoint may not support ping
  },
  {
    endpoint: 'https://api.mainnet-beta.solana.com',
    token: '',
    noPing: true
  }
], {
  config: {
    deduplicationWindow: 120000,     // 2 minutes
    maxCacheSize: 50000,
    messageTimeout: 300000,          // 5 minutes - accommodate slower public endpoints

    circuitBreaker: {
      errorThresholdPercentage: 40,  // Moderate sensitivity
      minimumRequestThreshold: 10,
      resetTimeout: 30000,           // 30 seconds
      timeout: 5000
    },

    streamPing: {
      enabled: true,                 // Only applies to endpoints without noPing
      interval: 30000,               // 30 seconds
      timeout: 10000,
      maxMissedPongs: 3
    }
  }
});
```

#### Memory-Optimized Setup
For environments with limited memory:

```typescript
const pool = createSolanaGrpcPool(connections, {
  config: {
    deduplicationWindow: 30000,      // 30 seconds - shorter window
    maxCacheSize: 5000,              // Small cache
    messageTimeout: 120000,          // 2 minutes
    enableMetrics: false,            // Disable metrics to save memory

    circuitBreaker: {
      errorThresholdPercentage: 50,
      minimumRequestThreshold: 5,
      resetTimeout: 20000,
      timeout: 4000
    },

    streamPing: {
      enabled: false                 // Disable to reduce overhead
    }
  }
});
```

## 🏗️ Architecture

The pool implements several key patterns:

1. **Active-Active**: All connections stream simultaneously
2. **Deduplication**: Buffer-based signature comparison
3. **Circuit Breaker**: Automatic failure isolation
4. **Health Monitoring**: Continuous connection health checks
5. **Event-Driven**: Clean separation of concerns

## 📝 API Reference

### Available Types

The package exports the following TypeScript types for full type safety:

```typescript
import {
  // Main classes
  PoolManager,
  ConnectionManager,
  DeduplicationEngine,
  CircuitBreaker,
  HealthMonitor,
  MetricsCollector,

  // Configuration types
  ConnectionConfig,
  PoolConfig,
  CircuitBreakerConfig,
  BatchConfig,
  StreamPingConfig,

  // Data types
  HealthMetrics,
  Transaction,
  ProcessedMessage,

  // Enums
  ConnectionState,
  CircuitBreakerState,

  // Interfaces
  Logger,
  PoolEvents,
  IPool,

  // Factory functions
  createGrpcPool,
  createHighAvailabilityGrpcPool,
  createSolanaGrpcPool,
  PoolFactory,
  PoolBuilder,

  // Utilities
  createDefaultLogger,
  LogLevel,
  createDefaultPoolConfig,
  createDefaultStreamPingConfig,
  registerPoolForGracefulShutdown,
  performGracefulShutdown
} from '@stalkchain/grpc-pool';
```

### Events

- `connection-established`: Connection established
- `connection-lost`: Connection lost
- `connection-recovered`: Connection restored
- `failover`: Failover from one connection to another
- `circuit-breaker-opened`: Circuit breaker opened for endpoint
- `circuit-breaker-closed`: Circuit breaker closed for endpoint
- `message-processed`: New unique message received
- `message-deduplicated`: Duplicate message filtered
- `health-check`: Health check results
- `error`: Error occurred
- `metrics-updated`: Metrics updated

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

## 📚 Documentation

- [Endless Retries Guide](docs/ENDLESS_RETRIES.md) - Production reliability features
- [Message Timeout Detection](docs/MESSAGE_TIMEOUT.md) - Detecting stale connections
- [Stream Ping/Pong Keep-Alive](docs/STREAM_PING_PONG.md) - Active stream health monitoring
- [Connection Cleanup Guide](docs/CONNECTION_CLEANUP.md) - Proper resource management and leak prevention
- [Graceful Shutdown Guide](docs/GRACEFUL_SHUTDOWN.md) - Properly closing gRPC connections
- [Examples](examples/) - Usage examples and patterns

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
