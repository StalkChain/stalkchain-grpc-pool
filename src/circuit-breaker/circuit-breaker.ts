import { CircuitBreakerConfig, CircuitBreakerState, Logger } from '../types';

/**
 * Circuit breaker statistics
 */
interface CircuitBreakerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeouts: number;
  circuitOpenTime: number | null;
  lastFailureTime: number | null;
  consecutiveFailures: number;
  state: CircuitBreakerState;
}

// Removed unused RequestResult interface

/**
 * Circuit breaker implementation for fault tolerance
 * Prevents cascading failures by temporarily blocking requests
 * when error thresholds are exceeded
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private stats: CircuitBreakerStats;
  private nextAttemptTime: number = 0;
  private halfOpenSuccessCount: number = 0;
  private readonly halfOpenMaxAttempts: number = 3;

  constructor(
    private config: CircuitBreakerConfig,
    private logger?: Logger
  ) {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      circuitOpenTime: null,
      lastFailureTime: null,
      consecutiveFailures: 0,
      state: this.state
    };

    this.logger?.debug(`Circuit breaker initialized with config: ${JSON.stringify(config)}`);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        const error = new Error('Circuit breaker is OPEN');
        this.logger?.debug('Request blocked by circuit breaker');
        throw error;
      }
      
      // Transition to half-open
      this.transitionToHalfOpen();
    }

    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(operation);
      const duration = Date.now() - startTime;
      
      await this.onSuccess(duration);
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.onFailure(error as Error, duration);
      throw error;
    }
  }

  /**
   * Get current circuit breaker state
   */
  public getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  public getStats(): CircuitBreakerStats {
    return {
      ...this.stats,
      state: this.state
    };
  }

  /**
   * Get error rate percentage
   */
  public getErrorRate(): number {
    if (this.stats.totalRequests === 0) {
      return 0;
    }
    return (this.stats.failedRequests / this.stats.totalRequests) * 100;
  }

  /**
   * Check if circuit breaker is healthy
   */
  public isHealthy(): boolean {
    return this.state === CircuitBreakerState.CLOSED && 
           this.getErrorRate() < this.config.errorThresholdPercentage;
  }

  /**
   * Reset circuit breaker statistics
   */
  public reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      circuitOpenTime: null,
      lastFailureTime: null,
      consecutiveFailures: 0,
      state: this.state
    };
    this.nextAttemptTime = 0;
    this.halfOpenSuccessCount = 0;
    
    this.logger?.info('Circuit breaker reset');
  }

  /**
   * Force circuit breaker to open state
   */
  public forceOpen(): void {
    this.transitionToOpen();
    this.logger?.warn('Circuit breaker forced to OPEN state');
  }

  /**
   * Force circuit breaker to closed state
   */
  public forceClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.stats.circuitOpenTime = null;
    this.nextAttemptTime = 0;
    this.halfOpenSuccessCount = 0;
    
    this.logger?.info('Circuit breaker forced to CLOSED state');
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stats.timeouts++;
        reject(new Error(`Operation timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      operation()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Handle successful request
   */
  private async onSuccess(duration: number): Promise<void> {
    this.stats.successfulRequests++;
    this.stats.consecutiveFailures = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenSuccessCount++;
      
      if (this.halfOpenSuccessCount >= this.halfOpenMaxAttempts) {
        this.transitionToClosed();
      }
    }

    this.logger?.debug(`Request succeeded in ${duration}ms`);
  }

  /**
   * Handle failed request
   */
  private async onFailure(error: Error, duration: number): Promise<void> {
    this.stats.failedRequests++;
    this.stats.consecutiveFailures++;
    this.stats.lastFailureTime = Date.now();

    this.logger?.debug(`Request failed in ${duration}ms: ${error.message}`);

    if (this.shouldOpenCircuit()) {
      this.transitionToOpen();
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Failed in half-open state, go back to open
      this.transitionToOpen();
    }
  }

  /**
   * Check if circuit should be opened
   */
  private shouldOpenCircuit(): boolean {
    if (this.state === CircuitBreakerState.OPEN) {
      return false;
    }

    // Need minimum number of requests
    if (this.stats.totalRequests < this.config.minimumRequestThreshold) {
      return false;
    }

    // Check error rate threshold
    const errorRate = this.getErrorRate();
    return errorRate >= this.config.errorThresholdPercentage;
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    if (this.state === CircuitBreakerState.OPEN) {
      return;
    }

    const previousState = this.state;
    this.state = CircuitBreakerState.OPEN;
    this.stats.circuitOpenTime = Date.now();
    this.nextAttemptTime = Date.now() + this.config.resetTimeout;
    this.halfOpenSuccessCount = 0;

    this.logger?.warn(`Circuit breaker transitioned from ${previousState} to OPEN. Next attempt at ${new Date(this.nextAttemptTime).toISOString()}`);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      return;
    }

    const previousState = this.state;
    this.state = CircuitBreakerState.HALF_OPEN;
    this.halfOpenSuccessCount = 0;

    this.logger?.info(`Circuit breaker transitioned from ${previousState} to HALF_OPEN`);
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    if (this.state === CircuitBreakerState.CLOSED) {
      return;
    }

    const previousState = this.state;
    this.state = CircuitBreakerState.CLOSED;
    this.stats.circuitOpenTime = null;
    this.nextAttemptTime = 0;
    this.halfOpenSuccessCount = 0;

    this.logger?.info(`Circuit breaker transitioned from ${previousState} to CLOSED`);
  }

  /**
   * Get time until next attempt (for OPEN state)
   */
  public getTimeUntilNextAttempt(): number {
    if (this.state !== CircuitBreakerState.OPEN) {
      return 0;
    }
    
    return Math.max(0, this.nextAttemptTime - Date.now());
  }

  /**
   * Get circuit breaker health summary
   */
  public getHealthSummary(): {
    isHealthy: boolean;
    state: CircuitBreakerState;
    errorRate: number;
    timeUntilNextAttempt: number;
    consecutiveFailures: number;
  } {
    return {
      isHealthy: this.isHealthy(),
      state: this.state,
      errorRate: this.getErrorRate(),
      timeUntilNextAttempt: this.getTimeUntilNextAttempt(),
      consecutiveFailures: this.stats.consecutiveFailures
    };
  }

  /**
   * Create a circuit breaker with default configuration
   */
  public static createDefault(logger?: Logger): CircuitBreaker {
    const defaultConfig: CircuitBreakerConfig = {
      errorThresholdPercentage: 50,
      minimumRequestThreshold: 10,
      resetTimeout: 30000, // 30 seconds
      timeout: 5000 // 5 seconds
    };

    return new CircuitBreaker(defaultConfig, logger);
  }

  /**
   * Wrap a function with circuit breaker protection
   */
  public static wrap<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    config: CircuitBreakerConfig,
    logger?: Logger
  ): (...args: T) => Promise<R> {
    const circuitBreaker = new CircuitBreaker(config, logger);
    
    return async (...args: T): Promise<R> => {
      return circuitBreaker.execute(() => fn(...args));
    };
  }
}
