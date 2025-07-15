import { CircuitBreaker } from '../../src/circuit-breaker/circuit-breaker';
import { CircuitBreakerState } from '../../src/types';
import { waitFor } from '../setup';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      errorThresholdPercentage: 50,
      minimumRequestThreshold: 3,
      resetTimeout: 1000,
      timeout: 500
    });
  });

  describe('execute', () => {
    it('should execute successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should handle failed operation', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('test error'));
      
      await expect(circuitBreaker.execute(operation)).rejects.toThrow('test error');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should open circuit after error threshold is reached', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Execute enough failed requests to open circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should block requests when circuit is open', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      // Now requests should be blocked
      await expect(circuitBreaker.execute(operation)).rejects.toThrow('Circuit breaker is OPEN');
      expect(operation).toHaveBeenCalledTimes(5); // Should not be called again
    });

    it('should transition to half-open after reset timeout', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('test error'));
      const successOperation = jest.fn().mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      
      // Wait for reset timeout
      await waitFor(1100);
      
      // Next request should transition to half-open
      const result = await circuitBreaker.execute(successOperation);
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should close circuit after successful requests in half-open state', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('test error'));
      const successOperation = jest.fn().mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      // Wait for reset timeout
      await waitFor(1100);
      
      // Execute successful requests to close circuit
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(successOperation);
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should handle timeout', async () => {
      const slowOperation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 1000))
      );
      
      await expect(circuitBreaker.execute(slowOperation)).rejects.toThrow('Operation timed out');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const successOperation = jest.fn().mockResolvedValue('success');
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      await circuitBreaker.execute(successOperation);
      try {
        await circuitBreaker.execute(failOperation);
      } catch (error) {
        // Expected to fail
      }
      
      const stats = circuitBreaker.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(1);
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('getErrorRate', () => {
    it('should calculate error rate correctly', async () => {
      const successOperation = jest.fn().mockResolvedValue('success');
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      await circuitBreaker.execute(successOperation);
      try {
        await circuitBreaker.execute(failOperation);
      } catch (error) {
        // Expected to fail
      }
      
      expect(circuitBreaker.getErrorRate()).toBe(50);
    });

    it('should return 0 for no requests', () => {
      expect(circuitBreaker.getErrorRate()).toBe(0);
    });
  });

  describe('isHealthy', () => {
    it('should return true for healthy circuit', () => {
      expect(circuitBreaker.isHealthy()).toBe(true);
    });

    it('should return false for open circuit', async () => {
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.isHealthy()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset circuit breaker state', async () => {
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Execute some failed requests
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      circuitBreaker.reset();
      
      const stats = circuitBreaker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('forceOpen', () => {
    it('should force circuit to open state', () => {
      circuitBreaker.forceOpen();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('forceClosed', () => {
    it('should force circuit to closed state', async () => {
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      circuitBreaker.forceClosed();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('getTimeUntilNextAttempt', () => {
    it('should return 0 for closed circuit', () => {
      expect(circuitBreaker.getTimeUntilNextAttempt()).toBe(0);
    });

    it('should return time until next attempt for open circuit', async () => {
      const failOperation = jest.fn().mockRejectedValue(new Error('fail'));
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      const timeUntilNext = circuitBreaker.getTimeUntilNextAttempt();
      expect(timeUntilNext).toBeGreaterThan(0);
      expect(timeUntilNext).toBeLessThanOrEqual(1000);
    });
  });

  describe('static methods', () => {
    it('should create default circuit breaker', () => {
      const defaultCircuitBreaker = CircuitBreaker.createDefault();
      expect(defaultCircuitBreaker).toBeInstanceOf(CircuitBreaker);
      expect(defaultCircuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should wrap function with circuit breaker', async () => {
      const testFunction = jest.fn().mockResolvedValue('test result');
      const wrappedFunction = CircuitBreaker.wrap(testFunction, {
        errorThresholdPercentage: 50,
        minimumRequestThreshold: 3,
        resetTimeout: 1000,
        timeout: 500
      });
      
      const result = await wrappedFunction('arg1', 'arg2');
      expect(result).toBe('test result');
      expect(testFunction).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });
});
