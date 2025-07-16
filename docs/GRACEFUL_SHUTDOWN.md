# Graceful Shutdown Guide

This guide explains how to properly shut down gRPC connections to ensure clean termination of streams and prevent resource leaks.

## Why Graceful Shutdown Matters

When your application terminates, it's important to properly close all gRPC streams and connections to:

1. **Prevent resource leaks** on both client and server
2. **Release server-side resources** promptly
3. **Avoid connection tracking issues** in middleware or proxies
4. **Ensure clean termination** of all pending operations

Without proper shutdown, your application might leave "zombie" connections that can cause issues on subsequent restarts or lead to resource exhaustion on the server.

## Automatic Graceful Shutdown

The StalkChain gRPC Pool includes built-in graceful shutdown capabilities that handle process termination signals automatically.

### Basic Usage

```javascript
const { createSolanaGrpcPool, registerPoolForGracefulShutdown } = require('@stalkchain/grpc-pool');

// Create your pool
const pool = createSolanaGrpcPool(connections, options);

// Register for automatic graceful shutdown
registerPoolForGracefulShutdown(pool);

// Start the pool
await pool.start();
```

With this setup, the pool will automatically:

1. Detect SIGINT (Ctrl+C) and SIGTERM signals
2. Cancel all active gRPC streams properly
3. Close all connections
4. Wait for cleanup to complete before exiting

### Multiple Pools

If you have multiple pools, you can register all of them:

```javascript
const { registerPoolForGracefulShutdown } = require('@stalkchain/grpc-pool');

// Register multiple pools
registerPoolForGracefulShutdown(pool1);
registerPoolForGracefulShutdown(pool2);
registerPoolForGracefulShutdown(pool3);
```

## Manual Graceful Shutdown

You can also trigger graceful shutdown manually:

### Using the Pool's stop() Method

```javascript
// Gracefully stop a single pool
await pool.stop();
```

### Using the Global Shutdown Manager

```javascript
const { performGracefulShutdown } = require('@stalkchain/grpc-pool');

// Gracefully shut down all registered pools
await performGracefulShutdown();
```

## How It Works

The graceful shutdown process follows these steps:

1. **Cancel all active streams**:
   - Each stream is cancelled using `stream.cancel()`
   - The library listens for cancellation events to confirm completion

2. **Wait for stream closure**:
   - The library waits for all streams to emit 'close' or cancellation events
   - A timeout ensures the process doesn't hang if some streams don't close properly

3. **Stop all connections**:
   - All connection managers are stopped
   - Resources are released

4. **Clean up resources**:
   - Timers and event listeners are cleared
   - Memory is freed

## Handling Different Shutdown Scenarios

### Node.js Process Termination

The library handles these common termination signals:

- **SIGINT**: Sent when you press Ctrl+C in the terminal
- **SIGTERM**: Sent by process managers like PM2, Docker, or Kubernetes

### Application Restart

When using tools like `node --watch` or PM2's watch mode, the application will be restarted automatically. The graceful shutdown ensures that:

1. All connections from the previous instance are properly closed
2. The new instance can establish fresh connections without conflicts

### Unhandled Exceptions

The library also catches unhandled exceptions and rejections to perform cleanup before the process exits with an error code.

## Best Practices

1. **Always register pools for graceful shutdown**:
   ```javascript
   registerPoolForGracefulShutdown(pool);
   ```

2. **Set reasonable timeouts**:
   The default timeout for stream cancellation is 5 seconds, which should be sufficient for most cases.

3. **Log shutdown events**:
   Enable logging to track the shutdown process:
   ```javascript
   const logger = createDefaultLogger();
   registerPoolForGracefulShutdown(pool, logger);
   ```

4. **Test shutdown scenarios**:
   Use the provided test script to verify graceful shutdown:
   ```bash
   node test/test-graceful-shutdown.js
   ```

## Example

See the complete example in `examples/graceful-shutdown-example.ts`:

```bash
# Build the project
pnpm run build

# Run the example
node -r ts-node/register examples/graceful-shutdown-example.ts
```

This example demonstrates:
- Setting up a pool with multiple connections
- Registering for graceful shutdown
- Handling manual shutdown
- Responding to process termination signals

## Troubleshooting

### Streams not closing properly

If you notice that streams aren't closing properly during shutdown:

1. Ensure you're using the latest version of the library
2. Check that you've registered the pool for graceful shutdown
3. Increase the log level to see detailed shutdown events
4. Verify that your application isn't catching signals without propagating them

### Process hanging during shutdown

If the process hangs during shutdown:

1. The default timeout might be too long - you can adjust it in the code
2. There might be other resources keeping the process alive
3. Check for any infinite loops or blocked event handlers

## Further Reading

- [Yellowstone gRPC Documentation](https://docs.shyft.to/solana-yellowstone-grpc/grpc-docs/getting-started/gracefully-closing-a-grpc-connection)
- [Node.js Process Signals](https://nodejs.org/api/process.html#process_signal_events)
- [PM2 Graceful Shutdown](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)
