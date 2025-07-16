import { PoolManager } from '../pool/pool-manager';
// import { HealthMonitor } from '../health/health-monitor'; // Unused for now
import { PoolConfig, Logger } from '../types';
import { 
  createDefaultPoolConfig, 
  createHighAvailabilityPoolConfig, 
  createDevelopmentPoolConfig,
  validatePoolConfig 
} from '../utils/config';
import { createDefaultLogger } from '../utils/logger';

/**
 * Factory options for creating gRPC pools
 */
export interface PoolFactoryOptions {
  /** Pool configuration */
  config?: Partial<PoolConfig>;
  /** Logger instance */
  logger?: Logger;
  /** Enable health monitoring */
  enableHealthMonitoring?: boolean;
  /** Validate configuration before creating pool */
  validateConfig?: boolean;
}

/**
 * gRPC pool factory for easy pool creation
 */
export class PoolFactory {
  /**
   * Create a gRPC pool with default configuration
   */
  public static createDefault(
    connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    const logger = options.logger || createDefaultLogger();
    const config = createDefaultPoolConfig(connections, {
      logger,
      ...options.config
    });

    return this.createFromConfig(config, options);
  }

  /**
   * Create a high-availability gRPC pool
   * Optimized for 99.99% SLA requirements
   */
  public static createHighAvailability(
    connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    const logger = options.logger || createDefaultLogger();
    const config = createHighAvailabilityPoolConfig(connections, {
      logger,
      ...options.config
    });

    return this.createFromConfig(config, options);
  }

  /**
   * Create a development gRPC pool
   * Optimized for development and testing
   */
  public static createDevelopment(
    connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    const logger = options.logger || createDefaultLogger();
    const config = createDevelopmentPoolConfig(connections, {
      logger,
      ...options.config
    });

    return this.createFromConfig(config, options);
  }

  /**
   * Create a gRPC pool from configuration
   */
  public static createFromConfig(
    config: PoolConfig,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    // Validate configuration if requested
    if (options.validateConfig !== false) {
      const errors = validatePoolConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid pool configuration:\n${errors.join('\n')}`);
      }
    }

    const logger = config.logger || createDefaultLogger();
    
    // Create pool manager
    const poolManager = new PoolManager(config, logger);

    // Add health monitoring if enabled
    if (options.enableHealthMonitoring !== false) {
      // Health monitoring is handled internally by the pool manager
      // This is just a placeholder for future external health monitoring
    }

    logger.info(`Created gRPC pool with ${config.connections.length} connections`);
    
    return poolManager;
  }

  /**
   * Create a gRPC pool for Solana/Yellowstone monitoring
   */
  public static createSolanaPool(
    connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    const logger = options.logger || createDefaultLogger();
    
    // Solana-specific optimizations
    const solanaConfig = createHighAvailabilityPoolConfig(connections, {
      deduplicationWindow: 120000, // 2 minutes for fast Solana blocks
      maxCacheSize: 500000, // Large cache for high transaction volume
      circuitBreaker: {
        errorThresholdPercentage: 25, // Very sensitive for blockchain data
        minimumRequestThreshold: 3,
        resetTimeout: 10000, // Fast recovery
        timeout: 2000 // Short timeout for real-time data
      },
      batchProcessing: {
        maxBatchSize: 25, // Small batches for low latency
        maxBatchTimeout: 2,
        enabled: true
      },
      logger,
      ...options.config
    });

    return this.createFromConfig(solanaConfig, options);
  }

  /**
   * Create a gRPC pool for testing
   */
  public static createForTesting(
    connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
    options: PoolFactoryOptions = {}
  ): PoolManager {
    const config = createDevelopmentPoolConfig(connections, {
      deduplicationWindow: 10000, // 10 seconds for fast tests
      maxCacheSize: 1000,
      circuitBreaker: {
        errorThresholdPercentage: 90, // Very tolerant for tests
        minimumRequestThreshold: 50,
        resetTimeout: 5000,
        timeout: 1000
      },
      batchProcessing: {
        maxBatchSize: 10,
        maxBatchTimeout: 1,
        enabled: false // Disabled for predictable test behavior
      },
      enableMetrics: false, // Disabled for cleaner test output
      ...options.config
    });

    return this.createFromConfig(config, {
      validateConfig: false, // Skip validation for test flexibility
      enableHealthMonitoring: false, // Disabled for simpler tests
      ...options
    });
  }
}

/**
 * Convenience function to create a default gRPC pool
 */
export function createGrpcPool(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  options: PoolFactoryOptions = {}
): PoolManager {
  return PoolFactory.createDefault(connections, options);
}

/**
 * Convenience function to create a high-availability gRPC pool
 */
export function createHighAvailabilityGrpcPool(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  options: PoolFactoryOptions = {}
): PoolManager {
  return PoolFactory.createHighAvailability(connections, options);
}

/**
 * Convenience function to create a Solana gRPC pool
 */
export function createSolanaGrpcPool(
  connections: Array<{ endpoint: string; token: string; noPing?: boolean }>,
  options: PoolFactoryOptions = {}
): PoolManager {
  return PoolFactory.createSolanaPool(connections, options);
}

/**
 * Builder pattern for creating gRPC pools
 */
export class PoolBuilder {
  private connections: Array<{ endpoint: string; token: string; noPing?: boolean }> = [];
  private config: Partial<PoolConfig> = {};
  private logger?: Logger;
  private enableHealthMonitoring: boolean = true;
  private validateConfig: boolean = true;

  /**
   * Add a connection to the pool
   */
  public addConnection(endpoint: string, token: string, noPing?: boolean): this {
    this.connections.push({
      endpoint,
      token,
      ...(noPing !== undefined && { noPing })
    });
    return this;
  }

  /**
   * Add multiple connections to the pool
   */
  public addConnections(connections: Array<{ endpoint: string; token: string; noPing?: boolean }>): this {
    this.connections.push(...connections);
    return this;
  }

  /**
   * Set deduplication window
   */
  public setDeduplicationWindow(windowMs: number): this {
    this.config.deduplicationWindow = windowMs;
    return this;
  }

  /**
   * Set cache size
   */
  public setCacheSize(size: number): this {
    this.config.maxCacheSize = size;
    return this;
  }

  /**
   * Set logger
   */
  public setLogger(logger: Logger): this {
    this.logger = logger;
    return this;
  }

  /**
   * Enable or disable health monitoring
   */
  public setHealthMonitoring(enabled: boolean): this {
    this.enableHealthMonitoring = enabled;
    return this;
  }

  /**
   * Enable or disable configuration validation
   */
  public setConfigValidation(enabled: boolean): this {
    this.validateConfig = enabled;
    return this;
  }

  /**
   * Set circuit breaker configuration
   */
  public setCircuitBreaker(config: Partial<PoolConfig['circuitBreaker']>): this {
    this.config.circuitBreaker = {
      errorThresholdPercentage: 50,
      minimumRequestThreshold: 10,
      resetTimeout: 30000,
      timeout: 5000,
      ...this.config.circuitBreaker,
      ...config
    };
    return this;
  }

  /**
   * Enable or disable metrics
   */
  public setMetrics(enabled: boolean): this {
    this.config.enableMetrics = enabled;
    return this;
  }

  /**
   * Build the pool with default configuration
   */
  public build(): PoolManager {
    if (this.connections.length === 0) {
      throw new Error('At least one connection must be added');
    }

    const options: PoolFactoryOptions = {
      config: this.config,
      enableHealthMonitoring: this.enableHealthMonitoring,
      validateConfig: this.validateConfig
    };
    if (this.logger) {
      options.logger = this.logger;
    }
    return PoolFactory.createDefault(this.connections, options);
  }

  /**
   * Build the pool with high-availability configuration
   */
  public buildHighAvailability(): PoolManager {
    if (this.connections.length === 0) {
      throw new Error('At least one connection must be added');
    }

    const options: PoolFactoryOptions = {
      config: this.config,
      enableHealthMonitoring: this.enableHealthMonitoring,
      validateConfig: this.validateConfig
    };
    if (this.logger) {
      options.logger = this.logger;
    }
    return PoolFactory.createHighAvailability(this.connections, options);
  }

  /**
   * Build the pool for Solana monitoring
   */
  public buildForSolana(): PoolManager {
    if (this.connections.length === 0) {
      throw new Error('At least one connection must be added');
    }

    const options: PoolFactoryOptions = {
      config: this.config,
      enableHealthMonitoring: this.enableHealthMonitoring,
      validateConfig: this.validateConfig
    };
    if (this.logger) {
      options.logger = this.logger;
    }
    return PoolFactory.createSolanaPool(this.connections, options);
  }
}
