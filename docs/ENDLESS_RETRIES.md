# Endless Retries for Production Reliability

The StalkChain gRPC Pool has been enhanced with endless retry functionality to ensure maximum uptime for production servers. This feature ensures that the pool will never give up trying to reconnect to failed gRPC endpoints.

## Key Features

### 🔄 Endless Stream Retries
- **No retry limits**: The pool will continuously attempt to reconnect failed streams
- **Smart backoff**: Uses exponential backoff with a maximum delay cap of 30 seconds
- **RST_STREAM handling**: Special handling for RST_STREAM errors with longer initial delays

### 🔗 Endless Connection Retries
- **Unlimited reconnection attempts**: Connection manager will never stop trying to reconnect
- **Exponential backoff**: Delays increase exponentially but cap at 30 seconds
- **Health monitoring**: Continuous health checks to detect and recover from stale connections

### 🧠 Intelligent Error Handling
- **Error type tracking**: Remembers the type of last error for each endpoint
- **Adaptive retry strategies**: Adjusts retry behavior based on error patterns
- **Circuit breaker integration**: Works with circuit breakers to prevent cascading failures
- **Message timeout detection**: Marks connections as stale if no messages received within timeout

## How It Works

### Stream-Level Retries
When a gRPC stream fails (e.g., due to RST_STREAM errors), the pool:

1. **Logs the error** with full context and stack trace
2. **Stores error type** for intelligent retry strategy
3. **Calculates backoff delay** using exponential backoff with caps
4. **Schedules retry** without any attempt limits
5. **Continues indefinitely** until the stream is restored

### Connection-Level Retries
When a connection fails, the connection manager:

1. **Marks connection as failed** and emits events
2. **Schedules reconnection** with exponential backoff
3. **Attempts reconnection** indefinitely
4. **Monitors health** continuously once reconnected

### Backoff Strategy
```
Attempt 1: 1 second delay
Attempt 2: 2 seconds delay  
Attempt 3: 4 seconds delay
Attempt 4: 8 seconds delay
Attempt 5: 16 seconds delay
Attempt 6+: 30 seconds delay (capped)
```

For RST_STREAM errors, the initial delay is doubled to give servers more recovery time.

## Configuration

### High-Availability Configuration
The `createSolanaGrpcPool()` function automatically uses high-availability settings:

```javascript
const pool = createSolanaGrpcPool(connections, {
  config: {
    // Endless retries are enabled by default
    circuitBreaker: {
      errorThresholdPercentage: 25, // Sensitive to errors
      minimumRequestThreshold: 3,
      resetTimeout: 10000, // Fast recovery
      timeout: 2000 // Short timeout for real-time data
    }
  }
});
```

### Connection Settings
Each connection is configured for maximum reliability:

```javascript
{
  reconnectAttempts: Number.MAX_SAFE_INTEGER, // Effectively unlimited
  reconnectDelay: 500, // Start with 500ms
  healthCheckInterval: 2000, // Check every 2 seconds
  connectionTimeout: 5000,
  requestTimeout: 3000
}
```

## Monitoring and Observability

### Events to Monitor
The pool emits events that help you monitor retry behavior:

```javascript
pool.on('connection-lost', (endpoint, error) => {
  console.log(`Connection lost: ${endpoint} - ${error.message}`);
});

pool.on('connection-recovered', (endpoint) => {
  console.log(`Connection recovered: ${endpoint}`);
});

pool.on('error', (error, context) => {
  if (context.includes('stream-processing')) {
    console.log(`Stream error (will retry): ${error.message}`);
  }
});
```

### Logging
The pool provides detailed logging at different levels:

- **INFO**: Connection events, retry schedules
- **WARN**: Health check failures, retry attempts
- **ERROR**: Stream failures, connection errors
- **DEBUG**: Detailed retry timing and circuit breaker state

## Testing Endless Retries

Use the provided test script to verify endless retry functionality:

```bash
# Run the endless retry test
node test/test-endless-retries.js
```

This test will:
- Connect to valid and invalid endpoints
- Monitor retry behavior for 2 minutes
- Report statistics on retry attempts
- Verify that retries continue indefinitely

## Production Considerations

### Resource Usage
- **Memory**: Retry timers use minimal memory
- **CPU**: Exponential backoff prevents excessive CPU usage
- **Network**: Capped delays prevent network flooding

### Monitoring Recommendations
1. **Track retry rates** to identify problematic endpoints
2. **Monitor connection recovery times** to assess network health
3. **Set up alerts** for sustained connection failures
4. **Log RST_STREAM patterns** to identify server-side issues

### Best Practices
1. **Use multiple endpoints** for redundancy
2. **Monitor server-side logs** for rate limiting or resource constraints
3. **Implement proper error handling** in your application
4. **Consider load balancing** if experiencing frequent RST_STREAM errors

## Troubleshooting

### Common Issues

**All connections failing simultaneously:**
- Check network connectivity
- Verify authentication tokens
- Review server-side rate limits

**Frequent RST_STREAM errors:**
- May indicate server resource constraints
- Consider reducing request frequency
- Check for server-side connection limits

**High retry rates:**
- Monitor server health and capacity
- Review network stability
- Consider implementing client-side rate limiting

The endless retry system ensures your production application maintains connectivity even during temporary network issues or server problems, providing the reliability needed for mission-critical blockchain data streaming.
