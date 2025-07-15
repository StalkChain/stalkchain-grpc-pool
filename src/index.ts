// Main exports
export { PoolManager } from './pool/pool-manager';
export { ConnectionManager } from './connection/connection-manager';
export { DeduplicationEngine } from './deduplication/deduplication-engine';
export { CircuitBreaker } from './circuit-breaker/circuit-breaker';
export { HealthMonitor } from './health/health-monitor';
export { MetricsCollector } from './metrics/metrics-collector';

// Type exports
export {
  ConnectionConfig,
  PoolConfig,
  CircuitBreakerConfig,
  BatchConfig,
  HealthMetrics,
  ConnectionState,
  CircuitBreakerState,
  Transaction,
  ProcessedMessage,
  Logger,
  PoolEvents,
  IPool
} from './types';

// Utility exports
export { createDefaultLogger } from './utils/logger';
export { createDefaultPoolConfig } from './utils/config';

// Factory functions for easy setup
export {
  createGrpcPool,
  createHighAvailabilityGrpcPool,
  createSolanaGrpcPool,
  PoolFactory,
  PoolBuilder
} from './factory/pool-factory';
