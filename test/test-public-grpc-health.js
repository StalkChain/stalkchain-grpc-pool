const { Client } = require('@triton-one/yellowstone-grpc');

/**
 * Test script to investigate why health checks fail on the public gRPC endpoint
 * This script will test various aspects of the public endpoint to understand the issue
 */
async function testPublicGrpcHealth() {
  console.log('🔍 Investigating public gRPC endpoint health check failures...\n');

  const publicEndpoint = 'https://solana-yellowstone-grpc.publicnode.com';
  const emptyToken = '';
  const fakeToken = 'fake-token-123';

  console.log(`📡 Testing endpoint: ${publicEndpoint}`);
  console.log(`🔑 Empty token: "${emptyToken}"`);
  console.log(`🔑 Fake token: "${fakeToken}"\n`);

  // Test 1: Basic connection with empty token
  console.log('🧪 Test 1: Basic connection with empty token');
  await testConnection(publicEndpoint, emptyToken, 'empty token');

  // Test 2: Basic connection with fake token
  console.log('\n🧪 Test 2: Basic connection with fake token');
  await testConnection(publicEndpoint, fakeToken, 'fake token');

  // Test 3: Ping method with empty token
  console.log('\n🧪 Test 3: Ping method with empty token');
  await testPing(publicEndpoint, emptyToken, 'empty token');

  // Test 4: Ping method with fake token
  console.log('\n🧪 Test 4: Ping method with fake token');
  await testPing(publicEndpoint, fakeToken, 'fake token');

  // Test 5: Subscribe method with empty token
  console.log('\n🧪 Test 5: Subscribe method with empty token');
  await testSubscribe(publicEndpoint, emptyToken, 'empty token');

  // Test 6: Subscribe method with fake token
  console.log('\n🧪 Test 6: Subscribe method with fake token');
  await testSubscribe(publicEndpoint, fakeToken, 'fake token');

  // Test 7: Multiple rapid ping attempts (simulate health check pattern)
  console.log('\n🧪 Test 7: Multiple rapid ping attempts (health check simulation)');
  await testRapidPings(publicEndpoint, emptyToken);

  // Test 8: Different gRPC options
  console.log('\n🧪 Test 8: Testing different gRPC options');
  await testDifferentGrpcOptions(publicEndpoint, emptyToken);

  console.log('\n✅ Investigation completed');
}

/**
 * Test basic connection establishment
 */
async function testConnection(endpoint, token, tokenDescription) {
  try {
    console.log(`   🔌 Attempting connection with ${tokenDescription}...`);
    
    const client = new Client(endpoint, token, {
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_reconnect_backoff_ms': 10000
    });

    console.log(`   ✅ Client created successfully`);
    console.log(`   📊 Client object:`, typeof client);
    
  } catch (error) {
    console.log(`   ❌ Connection failed: ${error.message}`);
    console.log(`   🔍 Error code: ${error.code}`);
    console.log(`   🔍 Error details:`, error);
  }
}

/**
 * Test ping method specifically
 */
async function testPing(endpoint, token, tokenDescription) {
  try {
    console.log(`   🏓 Testing ping with ${tokenDescription}...`);
    
    const client = new Client(endpoint, token, {
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_reconnect_backoff_ms': 10000
    });

    const startTime = Date.now();
    
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Ping timeout after 5000ms')), 5000);
    });

    // Try ping with timeout
    const result = await Promise.race([
      client.ping(Date.now()),
      timeoutPromise
    ]);

    const latency = Date.now() - startTime;
    console.log(`   ✅ Ping successful! Latency: ${latency}ms`);
    console.log(`   📊 Ping result:`, result);
    
  } catch (error) {
    console.log(`   ❌ Ping failed: ${error.message}`);
    console.log(`   🔍 Error code: ${error.code}`);
    console.log(`   🔍 Error name: ${error.name}`);
    console.log(`   🔍 Full error:`, error);
    
    // Check if it's specifically an auth error
    if (error.code === 16) {
      console.log(`   🚨 This is an UNAUTHENTICATED error (code 16)`);
    }
    
    // Check for HTTP status codes
    if (error.message.includes('401')) {
      console.log(`   🚨 HTTP 401 Unauthorized detected`);
    }
    
    if (error.message.includes('application/json')) {
      console.log(`   🚨 Server returned JSON instead of gRPC response`);
    }
  }
}

/**
 * Test subscribe method
 */
async function testSubscribe(endpoint, token, tokenDescription) {
  try {
    console.log(`   📡 Testing subscribe with ${tokenDescription}...`);
    
    const client = new Client(endpoint, token, {
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_reconnect_backoff_ms': 10000
    });

    const stream = await client.subscribe();
    console.log(`   ✅ Subscribe stream created successfully`);
    
    // Try to write a simple subscription request
    const subscriptionRequest = {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      commitment: 1,
      accountsDataSlice: [],
      ping: undefined
    };
    
    stream.write(subscriptionRequest);
    console.log(`   ✅ Subscription request sent successfully`);
    
    // Listen for a few seconds to see if we get any data
    let messageCount = 0;
    const timeout = setTimeout(() => {
      console.log(`   📊 Received ${messageCount} messages in 3 seconds`);
      stream.cancel();
    }, 3000);
    
    stream.on('data', (message) => {
      messageCount++;
      if (messageCount === 1) {
        console.log(`   📨 First message received:`, typeof message);
      }
    });
    
    stream.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`   ❌ Stream error: ${error.message}`);
      console.log(`   🔍 Stream error code: ${error.code}`);
    });
    
    stream.on('end', () => {
      clearTimeout(timeout);
      console.log(`   🔚 Stream ended`);
    });
    
    // Wait for the timeout
    await new Promise(resolve => setTimeout(resolve, 3500));
    
  } catch (error) {
    console.log(`   ❌ Subscribe failed: ${error.message}`);
    console.log(`   🔍 Error code: ${error.code}`);
    console.log(`   🔍 Full error:`, error);
  }
}

/**
 * Test multiple rapid pings to simulate health check behavior
 */
async function testRapidPings(endpoint, token) {
  console.log(`   🔄 Testing 5 rapid pings (simulating health checks)...`);
  
  const client = new Client(endpoint, token, {
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.max_reconnect_backoff_ms': 10000
  });

  for (let i = 1; i <= 5; i++) {
    try {
      console.log(`   🏓 Ping ${i}/5...`);
      const startTime = Date.now();
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Ping timeout')), 5000);
      });

      await Promise.race([
        client.ping(Date.now()),
        timeoutPromise
      ]);

      const latency = Date.now() - startTime;
      console.log(`   ✅ Ping ${i} successful (${latency}ms)`);
      
    } catch (error) {
      console.log(`   ❌ Ping ${i} failed: ${error.message}`);
      if (error.code === 16) {
        console.log(`   🚨 Auth error on ping ${i}`);
      }
    }
    
    // Wait 2 seconds between pings (similar to health check interval)
    if (i < 5) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

/**
 * Test different gRPC options
 */
async function testDifferentGrpcOptions(endpoint, token) {
  const optionSets = [
    {
      name: 'Minimal options',
      options: {}
    },
    {
      name: 'Standard options',
      options: {
        'grpc.max_receive_message_length': 64 * 1024 * 1024,
        'grpc.keepalive_time_ms': 30000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1
      }
    },
    {
      name: 'No keepalive options',
      options: {
        'grpc.max_receive_message_length': 64 * 1024 * 1024
      }
    }
  ];

  for (const optionSet of optionSets) {
    try {
      console.log(`   🔧 Testing with ${optionSet.name}...`);
      
      const client = new Client(endpoint, token, optionSet.options);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Ping timeout')), 5000);
      });

      await Promise.race([
        client.ping(Date.now()),
        timeoutPromise
      ]);

      console.log(`   ✅ ${optionSet.name} - ping successful`);
      
    } catch (error) {
      console.log(`   ❌ ${optionSet.name} - ping failed: ${error.message}`);
      if (error.code === 16) {
        console.log(`   🚨 ${optionSet.name} - auth error`);
      }
    }
  }
}

// Run the test
if (require.main === module) {
  testPublicGrpcHealth().catch(console.error);
}

module.exports = { testPublicGrpcHealth };
