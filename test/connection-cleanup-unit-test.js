#!/usr/bin/env node

/**
 * Unit test to verify connection cleanup logic works correctly
 * This test focuses on the internal cleanup mechanisms without requiring external gRPC endpoints
 */

const { ConnectionManager } = require('../dist/connection/connection-manager.js');
const { ConnectionState } = require('../dist/types/index.js');

// Mock logger
const mockLogger = {
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

// Test configuration
const testConfig = {
  endpoint: 'https://test-endpoint.example.com',
  token: 'test-token',
  reconnectDelay: 100, // Fast reconnection for testing
  healthCheckInterval: 1000,
  grpcOptions: {}
};

console.log('🧪 Starting Connection Cleanup Unit Test\n');

// Test 1: Verify client nullification on stop
async function testClientNullificationOnStop() {
  console.log('📋 Test 1: Client nullification on stop');
  
  const connection = new ConnectionManager(testConfig, mockLogger);
  
  // Simulate having a client
  const mockClient = { endpoint: testConfig.endpoint };
  connection.client = mockClient; // Direct assignment for testing
  
  console.log('   ✓ Mock client assigned');
  console.log(`   ✓ Client exists: ${connection.getClient() !== null}`);
  
  // Stop the connection
  await connection.stop();
  
  // Verify client is nullified
  const clientAfterStop = connection.getClient();
  if (clientAfterStop === null) {
    console.log('   ✅ PASS: Client properly nullified after stop\n');
    return true;
  } else {
    console.log('   ❌ FAIL: Client not nullified after stop\n');
    return false;
  }
}

// Test 2: Verify client nullification on force reconnect
async function testClientNullificationOnForceReconnect() {
  console.log('📋 Test 2: Client nullification on force reconnect');
  
  const connection = new ConnectionManager(testConfig, mockLogger);
  
  // Simulate having a client
  const mockClient = { endpoint: testConfig.endpoint };
  connection.client = mockClient; // Direct assignment for testing
  
  console.log('   ✓ Mock client assigned');
  console.log(`   ✓ Client exists: ${connection.getClient() !== null}`);
  
  // Force reconnection
  await connection.forceReconnect('Test force reconnect');
  
  // Verify client is nullified
  const clientAfterReconnect = connection.getClient();
  if (clientAfterReconnect === null) {
    console.log('   ✅ PASS: Client properly nullified after force reconnect\n');
    return true;
  } else {
    console.log('   ❌ FAIL: Client not nullified after force reconnect\n');
    return false;
  }
}

// Test 3: Verify connection state management
async function testConnectionStateManagement() {
  console.log('📋 Test 3: Connection state management');
  
  const connection = new ConnectionManager(testConfig, mockLogger);
  
  // Initial state should be DISCONNECTED
  if (connection.connectionState === ConnectionState.DISCONNECTED) {
    console.log('   ✓ Initial state is DISCONNECTED');
  } else {
    console.log('   ❌ Initial state is not DISCONNECTED');
    return false;
  }

  // After stop, state should be DISCONNECTED
  await connection.stop();

  if (connection.connectionState === ConnectionState.DISCONNECTED) {
    console.log('   ✅ PASS: State properly managed\n');
    return true;
  } else {
    console.log('   ❌ FAIL: State not properly managed\n');
    return false;
  }
}

// Test 4: Verify no complex cleanup methods exist
function testNoComplexCleanupMethods() {
  console.log('📋 Test 4: Verify complex cleanup methods removed');
  
  const connection = new ConnectionManager(testConfig, mockLogger);
  
  // Check that closeClient method doesn't exist
  if (typeof connection.closeClient === 'undefined') {
    console.log('   ✓ closeClient method successfully removed');
  } else {
    console.log('   ❌ closeClient method still exists');
    return false;
  }
  
  // Check that nullifyClient method exists (our simple replacement)
  if (typeof connection.nullifyClient !== 'undefined') {
    console.log('   ✓ nullifyClient method exists');
    console.log('   ✅ PASS: Complex cleanup methods properly replaced\n');
    return true;
  } else {
    console.log('   ❌ nullifyClient method missing');
    return false;
  }
}

// Test 5: Memory leak simulation test
async function testMemoryLeakPrevention() {
  console.log('📋 Test 5: Memory leak prevention simulation');
  
  const connections = [];
  const initialMemory = process.memoryUsage().heapUsed;
  
  console.log(`   📊 Initial memory usage: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
  
  // Create multiple connections and clean them up
  for (let i = 0; i < 10; i++) {
    const connection = new ConnectionManager({
      ...testConfig,
      endpoint: `https://test-endpoint-${i}.example.com`
    }, mockLogger);
    
    // Simulate having a client
    connection.client = { endpoint: connection.config.endpoint };
    connections.push(connection);
  }
  
  console.log(`   ✓ Created ${connections.length} connections with mock clients`);
  
  // Clean up all connections
  for (const connection of connections) {
    await connection.stop();
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  const finalMemory = process.memoryUsage().heapUsed;
  const memoryDiff = finalMemory - initialMemory;
  
  console.log(`   📊 Final memory usage: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   📊 Memory difference: ${(memoryDiff / 1024 / 1024).toFixed(2)} MB`);
  
  // Check if memory usage is reasonable (less than 10MB increase)
  if (memoryDiff < 10 * 1024 * 1024) {
    console.log('   ✅ PASS: Memory usage appears reasonable\n');
    return true;
  } else {
    console.log('   ⚠️  WARNING: High memory usage detected - potential leak\n');
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running Connection Cleanup Unit Tests...\n');
  
  const tests = [
    testClientNullificationOnStop,
    testClientNullificationOnForceReconnect,
    testConnectionStateManagement,
    testNoComplexCleanupMethods,
    testMemoryLeakPrevention
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Test failed with error: ${error.message}\n`);
      failed++;
    }
  }
  
  console.log('📊 === TEST RESULTS ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Connection cleanup appears to be working correctly.');
    console.log('✅ The simplified cleanup approach should prevent connection leaks.');
  } else {
    console.log('\n⚠️  Some tests failed. Connection cleanup may need further investigation.');
  }
  
  console.log('====================\n');
  
  return failed === 0;
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

// Run the tests
runAllTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
