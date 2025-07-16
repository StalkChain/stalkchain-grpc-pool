# Message Timeout Detection

The StalkChain gRPC Pool includes a powerful message timeout detection feature that identifies stale connections even when they appear to be healthy according to traditional health checks.

## Why Message Timeout Detection Matters

Traditional health checks (like ping/pong) can sometimes fail to detect certain types of connection issues:

1. **Silent failures**: Connections that appear healthy but aren't delivering messages
2. **Half-open connections**: TCP connections that are established but not functioning properly
3. **Server-side issues**: Problems on the server that don't affect the control plane but impact the data plane
4. **Firewall/proxy issues**: Network devices that allow health check traffic but block actual data

Message timeout detection solves these problems by monitoring the actual flow of messages, not just the connection status.

## How It Works

The message timeout detection system:

1. **Tracks message timestamps**: Records when the last message was received from each connection
2. **Monitors inactivity**: Periodically checks if any connections haven't received messages within the configured timeout
3. **Marks stale connections**: Identifies and marks connections as stale if they exceed the timeout
4. **Forces reconnection**: Automatically reconnects stale connections to restore service

## Configuration

### Basic Configuration

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    messageTimeout: 300000, // 5 minutes - connection considered stale if no messages received
    // other configuration options...
  }
});
```

### Default Timeouts by Configuration Type

| Configuration Type | Default Message Timeout | Description |
|-------------------|-------------------------|-------------|
| Default | 300000 ms (5 minutes) | Standard timeout for most applications |
| High-Availability | 60000 ms (1 minute) | Aggressive timeout for critical applications |
| Development | 600000 ms (10 minutes) | Relaxed timeout for development environments |

### Customizing the Timeout

You can customize the message timeout based on your specific needs:

```javascript
// Very aggressive timeout for critical applications
const pool = createSolanaGrpcPool(connections, {
  config: {
    messageTimeout: 30000, // 30 seconds
    // other configuration options...
  }
});

// Relaxed timeout for low-traffic applications
const pool = createSolanaGrpcPool(connections, {
  config: {
    messageTimeout: 1800000, // 30 minutes
    // other configuration options...
  }
});

// Disable message timeout detection
const pool = createSolanaGrpcPool(connections, {
  config: {
    messageTimeout: 0, // Disabled
    // other configuration options...
  }
});
```

## Monitoring Message Timeout Events

You can monitor message timeout events through the pool's event system:

```javascript
pool.on('connection-lost', (endpoint, error) => {
  if (error.message.includes('Message timeout')) {
    console.log(`Message timeout detected for ${endpoint}: ${error.message}`);
    // Log or alert on message timeout events
  }
});
```

## Best Practices

### Setting Appropriate Timeouts

The ideal message timeout depends on your application's expected message frequency:

1. **High-frequency applications** (many messages per second): 30-60 seconds
2. **Medium-frequency applications** (several messages per minute): 2-5 minutes
3. **Low-frequency applications** (occasional messages): 10-30 minutes

### Handling Specific Subscription Types

Different subscription types may have different expected message frequencies:

- **Transaction subscriptions**: Usually high frequency, use shorter timeouts (1-5 minutes)
- **Account update subscriptions**: Medium frequency, use moderate timeouts (5-15 minutes)
- **Block subscriptions**: Usually consistent frequency, use moderate timeouts (2-10 minutes)

### Testing Message Timeout Detection

Use the provided test script to verify message timeout detection:

```bash
pnpm run test:message-timeout
```

This test:
1. Creates a pool with a 30-second message timeout
2. Subscribes to a very specific filter that might not generate messages
3. Monitors for message timeout events
4. Verifies that connections are marked as stale when no messages are received

## Implementation Details

### Connection Manager

The ConnectionManager class tracks the last message time and provides methods to check for stale connections:

```typescript
// Update last message time when a message is received
connection.updateLastMessageTime();

// Check if connection is stale
const isStale = connection.isStaleByMessageTimeout(messageTimeout);
```

### Pool Manager

The PoolManager periodically checks all connections for message timeouts:

```typescript
private checkMessageTimeouts(): void {
  if (!this.config.messageTimeout) {
    return;
  }
  
  for (const [endpoint, connection] of this.connections.entries()) {
    // Only check connected connections
    if (!connection.isHealthy) {
      continue;
    }
    
    // Check if connection is stale based on message timeout
    if (connection.isStaleByMessageTimeout(this.config.messageTimeout)) {
      // Mark as stale and trigger reconnection
      // ...
    }
  }
}
```

## Troubleshooting

### False Positives

If you're experiencing false positives (connections marked as stale when they shouldn't be):

1. **Increase the timeout**: Use a longer timeout value
2. **Check subscription filters**: Ensure your subscription filters aren't too restrictive
3. **Verify server activity**: Confirm the server is actually generating messages

### False Negatives

If stale connections aren't being detected:

1. **Decrease the timeout**: Use a shorter timeout value
2. **Verify configuration**: Ensure messageTimeout is properly configured
3. **Check event handlers**: Make sure you're listening for connection-lost events

## Conclusion

Message timeout detection provides an additional layer of reliability by ensuring that connections are not just established but actually delivering messages. This is crucial for production applications where silent failures can go undetected by traditional health checks.

By combining message timeout detection with endless retries and circuit breakers, the StalkChain gRPC Pool provides comprehensive protection against all types of connection failures.
