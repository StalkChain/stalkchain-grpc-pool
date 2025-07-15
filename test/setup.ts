// Test setup file
import { jest } from '@jest/globals';

// Mock the @triton-one/yellowstone-grpc module
jest.mock('@triton-one/yellowstone-grpc', () => ({
  Client: jest.fn().mockImplementation(() => ({
    ping: jest.fn(),
    subscribe: jest.fn(),
    close: jest.fn()
  }))
}));

// Mock prom-client
jest.mock('prom-client', () => ({
  register: {
    registerMetric: jest.fn(),
    metrics: jest.fn().mockResolvedValue(''),
    clear: jest.fn()
  },
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn()
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn()
  })),
  Histogram: jest.fn().mockImplementation(() => ({
    observe: jest.fn()
  })),
  collectDefaultMetrics: jest.fn()
}));

// Global test timeout
jest.setTimeout(30000);

// Suppress console output during tests unless explicitly needed
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Restore console for specific tests that need it
export const restoreConsole = (): void => {
  global.console = originalConsole;
};

// Helper to create mock gRPC client
export const createMockClient = (): any => ({
  ping: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      yield { transaction: { signature: 'test-sig', slot: 1000 } };
    }
  }),
  close: jest.fn().mockResolvedValue(undefined)
});

// Helper to create test connection config
export const createTestConnectionConfig = (endpoint: string = 'test:443') => ({
  endpoint,
  token: 'test-token',
  reconnectAttempts: 3,
  reconnectDelay: 100,
  healthCheckInterval: 1000,
  connectionTimeout: 5000,
  requestTimeout: 3000
});

// Helper to create test pool config
export const createTestPoolConfig = () => ({
  connections: [
    createTestConnectionConfig('primary:443'),
    createTestConnectionConfig('secondary:443')
  ],
  deduplicationWindow: 10000,
  maxCacheSize: 1000,
  circuitBreaker: {
    errorThresholdPercentage: 50,
    minimumRequestThreshold: 5,
    resetTimeout: 5000,
    timeout: 1000
  },
  batchProcessing: {
    maxBatchSize: 10,
    maxBatchTimeout: 10,
    enabled: false
  },
  enableMetrics: false
});

// Helper to wait for async operations
export const waitFor = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

// Helper to create test transaction
export const createTestTransaction = (signature: string = 'test-sig', slot: number = 1000) => ({
  signature,
  slot,
  accountKeys: ['account1', 'account2'],
  instructions: [],
  timestamp: Date.now(),
  source: 'test-source',
  raw: { test: 'data' }
});
