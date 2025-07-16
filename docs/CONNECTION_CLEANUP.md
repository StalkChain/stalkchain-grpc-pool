# Connection Cleanup and Resource Management

The StalkChain gRPC Pool implements comprehensive connection cleanup to ensure proper resource management and prevent connection leaks. This is especially critical when using paid gRPC servers that have concurrent connection limits.

## Why Proper Connection Cleanup Matters

### Connection Limits on Paid Servers

Most paid gRPC providers (including Solana Yellowstone gRPC services) have limits on:
- **Concurrent connections per API key**
- **Total connections per account**
- **Connection duration limits**
- **Resource usage quotas**

If connections aren't properly closed before reconnecting, you can:
- ❌ Accumulate unused connections that count against your limits
- ❌ Hit connection limits and get blocked
- ❌ Waste server resources and increase costs
- ❌ Experience degraded performance

### Server-Side Resource Management

Proper connection cleanup helps:
- ✅ Release server-side resources immediately
- ✅ Clean up connection tracking in middleware/proxies
- ✅ Maintain optimal server performance
- ✅ Ensure fair resource allocation

## How Connection Cleanup Works

### 1. Stream Cancellation

When streams need to be closed, the pool uses the proper `stream.cancel()` method:

```javascript
// Proper stream cancellation
stream.on('error', (error) => {
  if (error.code === 1 || error.message.includes('Cancelled')) {
    console.log('✅ Stream cancelled by user');
    // This is expected and normal
  } else {
    console.error('❌ Stream error:', error);
  }
});

stream.on('close', () => {
  console.log('Stream closed and resources released');
});

// Cancel the stream properly
stream.cancel();
```

### 2. Connection Manager Cleanup

The `ConnectionManager` implements proper cleanup in several scenarios:

#### Graceful Shutdown
```javascript
public async stop(): Promise<void> {
  this.stopHealthChecks();
  this.stopReconnectTimer();
  
  // Properly close the gRPC client
  await this.closeClient();
  
  this.state = ConnectionState.DISCONNECTED;
}
```

#### Forced Reconnection
```javascript
public async forceReconnect(reason: string): Promise<void> {
  // Mark connection as failed
  this.state = ConnectionState.FAILED;
  
  // Properly close the client before reconnecting
  await this.closeClient();
  
  // Schedule reconnection
  this.scheduleReconnect();
}
```

#### Health Check Failures
```javascript
if (this.consecutiveFailures >= 3) {
  this.state = ConnectionState.FAILED;
  
  // Properly close the client before reconnecting
  await this.closeClient();
  
  this.scheduleReconnect();
}
```

### 3. Pool Manager Cleanup

The `PoolManager` ensures all streams are properly cancelled during shutdown:

```javascript
// Cancel all active streams with proper error handling
for (const [endpoint, stream] of this.activeStreams.entries()) {
  const cancelPromise = new Promise<void>((resolve) => {
    stream.on('error', (error) => {
      if (error.code === 1 || error.message.includes('Cancelled')) {
        resolve(); // Expected cancellation
      } else {
        resolve(); // Still resolve to avoid hanging
      }
    });
    
    stream.on('close', () => {
      resolve(); // Stream fully closed
    });
    
    stream.cancel(); // Proper cancellation method
    
    // Timeout to prevent hanging
    setTimeout(() => resolve(), 3000);
  });
  
  streamCancelPromises.push(cancelPromise);
}

// Wait for all streams to close
await Promise.all(streamCancelPromises);
```

## Connection Lifecycle Management

### Normal Operation
1. **Connection Established** → Client created and connected
2. **Stream Started** → Subscription stream created
3. **Data Flowing** → Messages processed normally
4. **Health Monitoring** → Regular ping/pong and message timeout checks

### Stale Detection and Reconnection
1. **Stale Detected** → Message timeout or ping timeout
2. **Stream Cancelled** → `stream.cancel()` called
3. **Client Closed** → `closeClient()` called
4. **Reconnection Scheduled** → Exponential backoff delay
5. **New Connection** → Fresh client and stream created

### Graceful Shutdown
1. **Stop Initiated** → `pool.stop()` called
2. **Streams Cancelled** → All active streams cancelled properly
3. **Connections Closed** → All clients closed
4. **Resources Released** → Complete cleanup

## Best Practices

### 1. Always Close Before Reconnecting

```javascript
// ❌ BAD: Just creating a new connection
this.client = new Client(endpoint, token);

// ✅ GOOD: Close old connection first
await this.closeClient();
this.client = new Client(endpoint, token);
```

### 2. Handle Cancellation Errors Properly

```javascript
stream.on('error', (error) => {
  if (error.code === 1 || error.message.includes('Cancelled')) {
    // ✅ This is normal - user-initiated cancellation
    console.log('Stream cancelled successfully');
  } else {
    // ❌ This is a real error
    console.error('Stream error:', error);
  }
});
```

### 3. Use Timeouts to Prevent Hanging

```javascript
// Always include timeouts for cleanup operations
const cleanupPromise = new Promise((resolve) => {
  // ... cleanup logic
  
  // Prevent hanging
  setTimeout(() => {
    console.warn('Cleanup timeout, forcing completion');
    resolve();
  }, 3000);
});
```

### 4. Monitor Connection Counts

```javascript
// Track connection lifecycle
let activeConnections = 0;

pool.on('connection-established', () => {
  activeConnections++;
  console.log(`Active connections: ${activeConnections}`);
});

pool.on('connection-lost', () => {
  activeConnections--;
  console.log(`Active connections: ${activeConnections}`);
});
```

## Testing Connection Cleanup

Use the provided test script to verify proper cleanup:

```bash
pnpm run test:connection-cleanup
```

This test:
- Creates connections with aggressive timeouts
- Monitors forced reconnections
- Verifies streams are cancelled properly
- Tests graceful shutdown timing
- Analyzes connection lifecycle events

## Troubleshooting

### Connection Limit Errors

If you're hitting connection limits:

1. **Check for connection leaks**:
   ```bash
   # Monitor active connections
   pnpm run test:connection-cleanup
   ```

2. **Verify proper cleanup**:
   - Ensure `stream.cancel()` is called
   - Check that `closeClient()` is working
   - Monitor shutdown timing

3. **Adjust timeouts**:
   - Reduce message timeout for faster detection
   - Increase cleanup timeouts if needed

### Slow Shutdown

If graceful shutdown is slow:

1. **Check stream cancellation**:
   - Verify streams respond to `cancel()`
   - Look for hanging streams
   - Check timeout values

2. **Monitor cleanup promises**:
   - Ensure all promises resolve
   - Check for infinite waits
   - Verify error handling

### Resource Leaks

If you suspect resource leaks:

1. **Monitor connection events**:
   - Track established vs lost connections
   - Check for unmatched events
   - Monitor recovery patterns

2. **Test with aggressive settings**:
   - Use short timeouts
   - Force frequent reconnections
   - Monitor resource usage

## Integration with Paid Services

### Solana Tracker gRPC

When using paid Solana gRPC services:

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    // Aggressive cleanup for paid services
    messageTimeout: 30000,
    streamPing: {
      enabled: true,
      interval: 15000,
      timeout: 5000,
      maxMissedPongs: 2
    }
  }
});

// Monitor connection usage
pool.on('connection-lost', (endpoint, error) => {
  console.log(`Connection lost: ${endpoint}`);
  console.log('This connection will be properly closed before reconnecting');
});
```

### Connection Pooling

For optimal resource usage:

```javascript
// Use multiple endpoints to distribute load
const connections = [
  { endpoint: 'https://grpc.solanatracker.io', token: process.env.TOKEN },
  { endpoint: 'https://grpc-us.solanatracker.io', token: process.env.TOKEN }
];

// Each connection is managed independently
// Failed connections are cleaned up without affecting others
```

## Conclusion

Proper connection cleanup is essential for:
- **Preventing connection leaks** that count against server limits
- **Maintaining optimal performance** through proper resource management
- **Ensuring reliability** in production environments
- **Reducing costs** by avoiding unnecessary connection usage

The StalkChain gRPC Pool implements comprehensive cleanup mechanisms that follow best practices and ensure your application can run reliably in production environments with paid gRPC services.
