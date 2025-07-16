import { PoolConfig, ConnectionConfig, CircuitBreakerConfig, BatchConfig, StreamPingConfig } from '../types';
import { createDefaultLogger } from './logger';

/**
 * Create default stream ping configuration
 */
export function createDefaultStreamPingConfig(overrides: Partial<StreamPingConfig> = {}): StreamPingConfig {
  return {
    enabled: false, // Disabled by default
    interval: 30000, // 30 seconds between pings
    timeout: 10000, // 10 seconds timeout for pong response
    maxMissedPongs: 3, // Allow 3 missed pongs before considering stream stale
    ...overrides
  };
}

/**
 * Create default connection configuration
 */
export function createDefaultConnectionConfig(
  endpoint: string,
  token: string,
  overrides: Partial<ConnectionConfig> = {}
): ConnectionConfig {
  return {
    endpoint,
    token,
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    healthCheckInterval: 5000,
    connectionTimeout: 10000,
    requestTimeout: 5000,
    grpcOptions: {
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_reconnect_backoff_ms': 10000
    },
    ...overrides
  };
}

/**
 * Create default circuit breaker configuration
 */
export function createDefaultCircuitBreakerConfig(
  overrides: Partial<CircuitBreakerConfig> = {}
): CircuitBreakerConfig {
  return {
    errorThresholdPercentage: 50,
    minimumRequestThreshold: 10,
    resetTimeout: 30000,
    timeout: 5000,
    ...overrides
  };
}

/**
 * Create default batch configuration
 */
export function createDefaultBatchConfig(
  overrides: Partial<BatchConfig> = {}
): BatchConfig {
  return {
    maxBatchSize: 100,
    maxBatchTimeout: 10,
    enabled: true,
    ...overrides
  };
}

/**
 * Create default pool configuration
 */
export function createDefaultPoolConfig(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  overrides: Partial<PoolConfig> = {}
): PoolConfig {
  const connectionConfigs = connections.map(conn =>
    createDefaultConnectionConfig(conn.endpoint, conn.token, {
      ...(conn.noPing !== undefined && { noPing: conn.noPing })
    })
  );

  return {
    connections: connectionConfigs,
    deduplicationWindow: 300000, // 5 minutes
    maxCacheSize: 100000,
    circuitBreaker: createDefaultCircuitBreakerConfig(),
    batchProcessing: createDefaultBatchConfig(),
    enableMetrics: true,
    messageTimeout: 300000, // 5 minutes - connection considered stale if no messages received
    streamPing: createDefaultStreamPingConfig(),
    logger: createDefaultLogger(),
    ...overrides
  };
}

/**
 * Create high-availability pool configuration
 * Optimized for 99.99% SLA requirements
 */
export function createHighAvailabilityPoolConfig(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  overrides: Partial<PoolConfig> = {}
): PoolConfig {
  const connectionConfigs = connections.map(conn =>
    createDefaultConnectionConfig(conn.endpoint, conn.token, {
      reconnectAttempts: Number.MAX_SAFE_INTEGER, // Effectively unlimited reconnect attempts for production
      reconnectDelay: 500,
      healthCheckInterval: 2000,
      connectionTimeout: 5000,
      requestTimeout: 3000,
      ...(conn.noPing !== undefined && { noPing: conn.noPing })
    })
  );

  return {
    connections: connectionConfigs,
    deduplicationWindow: 180000, // 3 minutes for faster processing
    maxCacheSize: 200000, // Larger cache for high throughput
    circuitBreaker: createDefaultCircuitBreakerConfig({
      errorThresholdPercentage: 30, // More sensitive
      minimumRequestThreshold: 5,
      resetTimeout: 15000, // Faster recovery
      timeout: 3000
    }),
    batchProcessing: createDefaultBatchConfig({
      maxBatchSize: 50, // Smaller batches for lower latency
      maxBatchTimeout: 5,
      enabled: true
    }),
    enableMetrics: true,
    messageTimeout: 60000, // 1 minute - aggressive timeout for high-availability
    streamPing: createDefaultStreamPingConfig({
      enabled: true, // Enable for high-availability
      interval: 15000, // 15 seconds - more frequent pings
      timeout: 5000, // 5 seconds timeout
      maxMissedPongs: 2 // Only allow 2 missed pongs
    }),
    logger: createDefaultLogger(),
    ...overrides
  };
}

/**
 * Create development pool configuration
 * Optimized for development and testing
 */
export function createDevelopmentPoolConfig(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  overrides: Partial<PoolConfig> = {}
): PoolConfig {
  const connectionConfigs = connections.map(conn =>
    createDefaultConnectionConfig(conn.endpoint, conn.token, {
      reconnectAttempts: 3,
      reconnectDelay: 2000,
      healthCheckInterval: 10000,
      connectionTimeout: 15000,
      requestTimeout: 10000,
      ...(conn.noPing !== undefined && { noPing: conn.noPing })
    })
  );

  return {
    connections: connectionConfigs,
    deduplicationWindow: 60000, // 1 minute
    maxCacheSize: 10000, // Smaller cache
    circuitBreaker: createDefaultCircuitBreakerConfig({
      errorThresholdPercentage: 70, // Less sensitive
      minimumRequestThreshold: 20,
      resetTimeout: 60000,
      timeout: 10000
    }),
    batchProcessing: createDefaultBatchConfig({
      maxBatchSize: 200,
      maxBatchTimeout: 50,
      enabled: false // Disabled for easier debugging
    }),
    enableMetrics: true,
    messageTimeout: 600000, // 10 minutes - relaxed timeout for development
    streamPing: createDefaultStreamPingConfig({
      enabled: false, // Disabled for development to reduce noise
      interval: 60000, // 1 minute if enabled
      timeout: 15000, // 15 seconds timeout
      maxMissedPongs: 5 // Allow more missed pongs in development
    }),
    logger: createDefaultLogger(),
    ...overrides
  };
}

/**
 * Validate pool configuration
 */
export function validatePoolConfig(config: PoolConfig): string[] {
  const errors: string[] = [];

  if (!config.connections || config.connections.length === 0) {
    errors.push('At least one connection configuration is required');
  }

  for (const [index, conn] of config.connections.entries()) {
    if (!conn.endpoint) {
      errors.push(`Connection ${index}: endpoint is required`);
    }
    // Token can be empty for public endpoints
    if (conn.token === undefined || conn.token === null) {
      errors.push(`Connection ${index}: token must be defined (can be empty string for public endpoints)`);
    }
    if (conn.reconnectAttempts < 0) {
      errors.push(`Connection ${index}: reconnectAttempts must be >= 0`);
    }
    if (conn.reconnectDelay < 0) {
      errors.push(`Connection ${index}: reconnectDelay must be >= 0`);
    }
    if (conn.healthCheckInterval < 1000) {
      errors.push(`Connection ${index}: healthCheckInterval must be >= 1000ms`);
    }
  }

  if (config.deduplicationWindow < 1000) {
    errors.push('deduplicationWindow must be >= 1000ms');
  }

  if (config.maxCacheSize < 100) {
    errors.push('maxCacheSize must be >= 100');
  }

  if (config.messageTimeout !== undefined && config.messageTimeout < 1000) {
    errors.push('messageTimeout must be >= 1000ms');
  }

  if (config.streamPing) {
    if (config.streamPing.interval < 1000) {
      errors.push('streamPing.interval must be >= 1000ms');
    }
    if (config.streamPing.timeout < 1000) {
      errors.push('streamPing.timeout must be >= 1000ms');
    }
    if (config.streamPing.maxMissedPongs < 1) {
      errors.push('streamPing.maxMissedPongs must be >= 1');
    }
    if (config.streamPing.timeout >= config.streamPing.interval) {
      errors.push('streamPing.timeout must be less than streamPing.interval');
    }
  }

  if (config.circuitBreaker.errorThresholdPercentage < 0 || config.circuitBreaker.errorThresholdPercentage > 100) {
    errors.push('circuitBreaker.errorThresholdPercentage must be between 0 and 100');
  }

  if (config.circuitBreaker.minimumRequestThreshold < 1) {
    errors.push('circuitBreaker.minimumRequestThreshold must be >= 1');
  }

  if (config.circuitBreaker.resetTimeout < 1000) {
    errors.push('circuitBreaker.resetTimeout must be >= 1000ms');
  }

  if (config.batchProcessing.enabled) {
    if (config.batchProcessing.maxBatchSize < 1) {
      errors.push('batchProcessing.maxBatchSize must be >= 1');
    }
    if (config.batchProcessing.maxBatchTimeout < 1) {
      errors.push('batchProcessing.maxBatchTimeout must be >= 1ms');
    }
  }

  return errors;
}

/**
 * Get configuration recommendations based on use case
 */
export function getConfigurationRecommendations(useCase: 'production' | 'development' | 'testing'): {
  description: string;
  recommendations: string[];
} {
  switch (useCase) {
    case 'production':
      return {
        description: 'Production configuration for high availability and performance',
        recommendations: [
          'Use at least 2-3 gRPC endpoints for redundancy',
          'Set reconnectAttempts to 10+ for maximum resilience',
          'Use healthCheckInterval of 2-5 seconds',
          'Enable metrics collection for monitoring',
          'Set deduplicationWindow to 3-5 minutes',
          'Use circuit breaker with 30-50% error threshold',
          'Enable batch processing for better throughput'
        ]
      };

    case 'development':
      return {
        description: 'Development configuration for easier debugging',
        recommendations: [
          'Use 1-2 gRPC endpoints',
          'Set longer timeouts for debugging',
          'Disable batch processing for simpler flow',
          'Use higher error thresholds to avoid frequent circuit breaking',
          'Enable detailed logging',
          'Use smaller cache sizes to reduce memory usage'
        ]
      };

    case 'testing':
      return {
        description: 'Testing configuration for unit and integration tests',
        recommendations: [
          'Use mock endpoints or test servers',
          'Set short timeouts for faster test execution',
          'Disable metrics collection unless testing metrics',
          'Use small cache sizes',
          'Enable silent logging to reduce test output',
          'Use predictable configuration values'
        ]
      };

    default:
      return {
        description: 'Unknown use case',
        recommendations: ['Use createDefaultPoolConfig for general purpose configuration']
      };
  }
}
