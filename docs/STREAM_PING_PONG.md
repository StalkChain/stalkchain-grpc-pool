# Stream Ping/Pong Keep-Alive

The StalkChain gRPC Pool includes a sophisticated stream ping/pong keep-alive system that actively monitors stream health and detects stream-level connectivity issues that traditional connection health checks might miss.

## Why Stream Ping/Pong Matters

While connection-level health checks (like TCP keep-alive and connection pings) can detect network-level issues, they may not catch stream-specific problems:

1. **Stream-level failures**: Issues that affect the data stream but not the underlying connection
2. **Server-side stream processing issues**: Problems on the server that impact stream handling
3. **Middleware interference**: Proxies or load balancers that affect stream data flow
4. **Partial connectivity**: Situations where control messages work but data streams don't
5. **Cloud provider issues**: Some cloud providers may interfere with long-running streams

Stream ping/pong provides an additional layer of monitoring by actively testing the stream's ability to process and respond to messages.

## How It Works

The stream ping/pong system operates at the gRPC stream level:

1. **Regular ping messages**: Sends ping messages at configurable intervals through the active stream
2. **Pong response monitoring**: Waits for pong responses within a specified timeout
3. **Missed pong tracking**: Counts consecutive missed pong responses
4. **Stream failure detection**: Marks streams as stale when too many pongs are missed
5. **Automatic recovery**: Triggers stream reconnection when failures are detected

## Configuration

### Basic Configuration

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    streamPing: {
      enabled: true,           // Enable stream ping/pong
      interval: 30000,         // Send ping every 30 seconds
      timeout: 10000,          // Wait 10 seconds for pong response
      maxMissedPongs: 3        // Allow 3 missed pongs before marking as stale
    }
    // other configuration options...
  }
});
```

### Default Configurations by Type

| Configuration Type | Enabled | Interval | Timeout | Max Missed Pongs |
|-------------------|---------|----------|---------|------------------|
| **Default** | `false` | 30s | 10s | 3 |
| **High-Availability** | `true` | 15s | 5s | 2 |
| **Development** | `false` | 60s | 15s | 5 |

### Configuration Options

- **`enabled`**: Whether to enable stream ping/pong functionality
- **`interval`**: Time between ping messages (milliseconds)
- **`timeout`**: Maximum time to wait for pong response (milliseconds)
- **`maxMissedPongs`**: Number of consecutive missed pongs before marking stream as stale

### Validation Rules

- `interval` must be >= 1000ms (1 second)
- `timeout` must be >= 1000ms (1 second)
- `timeout` must be less than `interval`
- `maxMissedPongs` must be >= 1

## Usage Examples

### High-Availability Setup

For critical applications that need maximum uptime:

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    streamPing: {
      enabled: true,
      interval: 15000,    // Ping every 15 seconds
      timeout: 5000,      // 5-second timeout
      maxMissedPongs: 2   // Only allow 2 missed pongs
    }
  }
});
```

### Development Setup

For development environments where you want less aggressive monitoring:

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    streamPing: {
      enabled: false,     // Disabled to reduce noise
      interval: 60000,    // 1 minute if enabled
      timeout: 15000,     // 15-second timeout
      maxMissedPongs: 5   // Allow more missed pongs
    }
  }
});
```

### Custom Configuration

For specific requirements:

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    streamPing: {
      enabled: true,
      interval: 45000,    // Ping every 45 seconds
      timeout: 12000,     // 12-second timeout
      maxMissedPongs: 4   // Allow 4 missed pongs
    }
  }
});
```

## Monitoring Stream Ping Events

You can monitor stream ping events through the pool's event system:

```javascript
pool.on('connection-lost', (endpoint, error) => {
  if (error.message.includes('Stream ping timeout')) {
    console.log(`Stream ping timeout detected for ${endpoint}: ${error.message}`);
    // Handle stream ping timeout
  }
});
```

## How Ping/Pong Messages Work

### Ping Message Structure

The ping message is sent as part of the subscription request:

```javascript
{
  accounts: {},
  slots: {},
  transactions: {},
  transactionsStatus: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  commitment: undefined,
  accountsDataSlice: [],
  ping: { id: sequenceNumber }  // Ping with unique sequence number
}
```

### Pong Response Structure

The server responds with a pong message:

```javascript
{
  pong: { id: sequenceNumber }  // Matching sequence number
}
```

### Sequence Number Tracking

- Each ping message includes a unique sequence number
- The pool tracks pending pong responses by sequence number
- Pong responses are matched to their corresponding ping messages
- Missed pongs are detected when responses don't arrive within the timeout

## Best Practices

### Choosing the Right Interval

The ping interval should balance monitoring effectiveness with resource usage:

1. **High-frequency applications**: 15-30 seconds for critical systems
2. **Medium-frequency applications**: 30-60 seconds for standard applications
3. **Low-frequency applications**: 60-120 seconds for less critical systems

### Setting Appropriate Timeouts

The timeout should account for network latency and server processing time:

- **Local networks**: 2-5 seconds
- **Internet connections**: 5-15 seconds
- **High-latency connections**: 10-30 seconds

### Missed Pong Thresholds

The number of allowed missed pongs affects sensitivity:

- **Sensitive detection**: 1-2 missed pongs (may have false positives)
- **Balanced detection**: 3-4 missed pongs (recommended for most cases)
- **Tolerant detection**: 5+ missed pongs (may miss some issues)

## Testing Stream Ping/Pong

Use the provided test script to verify stream ping/pong functionality:

```bash
pnpm run test:stream-ping
```

This test:
1. Creates a pool with stream ping enabled (10-second intervals)
2. Monitors ping/pong behavior for 2 minutes
3. Reports on ping timeout events
4. Verifies that the keep-alive system is working correctly

## Integration with Other Features

Stream ping/pong works alongside other reliability features:

### Message Timeout Detection

- Stream ping/pong provides active monitoring
- Message timeout provides passive monitoring
- Together they catch different types of stream issues

### Endless Retries

- When stream ping detects a stale stream, endless retries take over
- The stream is automatically reconnected and ping/pong resumes

### Circuit Breakers

- Frequent ping timeouts can trigger circuit breaker protection
- This prevents cascading failures from problematic endpoints

## Troubleshooting

### High Ping Timeout Rates

If you're experiencing frequent ping timeouts:

1. **Increase timeout**: Allow more time for pong responses
2. **Increase interval**: Reduce ping frequency
3. **Check network**: Verify network stability and latency
4. **Server capacity**: Ensure the server can handle the ping load

### False Positives

If streams are being marked as stale incorrectly:

1. **Increase maxMissedPongs**: Allow more missed responses
2. **Check server logs**: Verify the server is processing pings correctly
3. **Network analysis**: Look for intermittent connectivity issues

### No Ping Activity

If ping/pong isn't working:

1. **Verify configuration**: Ensure `enabled: true`
2. **Check server support**: Confirm the server supports ping/pong
3. **Review logs**: Look for ping-related error messages

## Conclusion

Stream ping/pong keep-alive provides an active monitoring layer that complements passive monitoring techniques. By regularly testing the stream's ability to process and respond to messages, it can detect issues that other monitoring methods might miss, ensuring maximum reliability for your gRPC streams.
