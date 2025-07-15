/**
 * StalkChain App Template with gRPC Pool Integration
 * 
 * Copy this template to your new StalkChain project and customize as needed.
 * This provides a complete working example with health monitoring, error handling,
 * and graceful shutdown.
 */

import express from 'express';
import { createSolanaGrpcPool } from '@stalkchain/grpc-pool';
import { createDefaultLogger, LogLevel } from '@stalkchain/grpc-pool';

// Environment configuration
const config = {
  port: process.env.PORT || 3000,
  solanaTrackerApiKey: process.env.SOLANA_TRACKER_API_KEY || 'your_key_here',
  logLevel: process.env.LOG_LEVEL || 'INFO'
};

class StalkChainApp {
  private app: express.Application;
  private grpcPool: any;
  private logger: any;
  private isShuttingDown = false;

  constructor() {
    this.app = express();
    this.logger = createDefaultLogger(LogLevel[config.logLevel as keyof typeof LogLevel]);
    this.setupGrpcPool();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupGrpcPool() {
    // Create gRPC pool with your SolanaTracker endpoints
    this.grpcPool = createSolanaGrpcPool([
      { 
        endpoint: 'https://grpc.solanatracker.io', 
        token: config.solanaTrackerApiKey 
      },
      { 
        endpoint: 'https://grpc-us.solanatracker.io', 
        token: config.solanaTrackerApiKey 
      },
      { 
        endpoint: 'https://solana-yellowstone-grpc.publicnode.com', 
        token: '' 
      }
    ], {
      config: {
        logger: this.logger,
        enableMetrics: true
      }
    });

    this.setupGrpcEventHandlers();
  }

  private setupGrpcEventHandlers() {
    // Connection events
    this.grpcPool.on('connection-established', (endpoint: string) => {
      this.logger.info(`✅ gRPC connected: ${endpoint}`);
    });

    this.grpcPool.on('connection-lost', (endpoint: string, error: Error) => {
      this.logger.warn(`❌ gRPC connection lost: ${endpoint} - ${error.message}`);
    });

    this.grpcPool.on('connection-recovered', (endpoint: string) => {
      this.logger.info(`🔄 gRPC connection recovered: ${endpoint}`);
    });

    this.grpcPool.on('failover', (from: string, to: string, reason: string) => {
      this.logger.warn(`🔀 gRPC failover: ${from} → ${to} (${reason})`);
    });

    // Message processing
    let messageCount = 0;
    this.grpcPool.on('message-processed', (message: any) => {
      messageCount++;
      
      // Log every 100th message to avoid spam
      if (messageCount % 100 === 0) {
        this.logger.info(`📨 Processed ${messageCount} transactions`);
      }

      // Process the transaction
      this.processTransaction(message.data);
    });

    this.grpcPool.on('message-deduplicated', (signature: string, source: string) => {
      this.logger.debug(`🔄 Deduplicated transaction ${signature} from ${source}`);
    });

    // Error handling
    this.grpcPool.on('error', (error: Error, context?: string) => {
      this.logger.error(`💥 gRPC Pool Error${context ? ` [${context}]` : ''}: ${error.message}`);
    });
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      if (this.isShuttingDown) {
        return res.status(503).json({ status: 'shutting_down' });
      }

      const grpcHealth = this.grpcPool.getHealthStatus();
      const healthyConnections = grpcHealth.filter((h: any) => h.isHealthy).length;
      const isHealthy = healthyConnections > 0;

      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        grpc: {
          healthy: healthyConnections,
          total: grpcHealth.length,
          connections: grpcHealth.map((h: any) => ({
            endpoint: h.endpoint,
            status: h.isHealthy ? 'UP' : 'DOWN',
            latency: `${h.latency}ms`,
            errorRate: `${(h.errorRate * 100).toFixed(1)}%`,
            lastSuccess: new Date(h.lastSuccessTime).toISOString()
          }))
        }
      });
    });

    // Detailed gRPC health endpoint
    this.app.get('/health/grpc', (req, res) => {
      const health = this.grpcPool.getHealthStatus();
      const metrics = this.grpcPool.getMetrics();
      
      res.json({
        connections: health,
        metrics: {
          messagesProcessed: metrics.messages_processed || 0,
          messagesDeduplicated: metrics.messages_deduplicated || 0,
          connectionsEstablished: metrics.connections_established || 0,
          connectionsLost: metrics.connections_lost || 0,
          failoverEvents: metrics.failover_events || 0
        }
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.grpcPool.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        this.logger.error('Error collecting metrics:', error);
        res.status(500).send('Error collecting metrics');
      }
    });

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json({
        service: 'StalkChain gRPC Service',
        version: '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupErrorHandling() {
    // Global error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Express error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      this.gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    });
  }

  private processTransaction(transaction: any) {
    // Implement your transaction processing logic here
    // Examples:
    // - Save to database
    // - Send to message queue
    // - Trigger business logic
    // - Send notifications
    
    this.logger.debug(`Processing transaction: ${transaction.signature} in slot ${transaction.slot}`);
    
    // Example: Filter for high-value transactions
    // if (transaction.value > 1000000) {
    //   this.handleHighValueTransaction(transaction);
    // }
  }

  public async start() {
    try {
      this.logger.info('🚀 Starting StalkChain gRPC Service...');
      
      // Start gRPC pool
      await this.grpcPool.start();
      this.logger.info('✅ gRPC pool started');

      // Wait for connections to establish
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we have healthy connections
      const health = this.grpcPool.getHealthStatus();
      const healthyCount = health.filter((h: any) => h.isHealthy).length;
      
      if (healthyCount === 0) {
        throw new Error('No healthy gRPC connections available');
      }

      this.logger.info(`✅ ${healthyCount}/${health.length} gRPC connections healthy`);

      // Subscribe to Solana transactions
      await this.grpcPool.subscribe({
        transactions: {
          client: {
            accountInclude: [
              '11111111111111111111111111111112', // System program
              // Add your specific accounts here
            ],
            vote: false,
            failed: false
          }
        },
        commitment: 'CONFIRMED'
      });

      this.logger.info('✅ Subscribed to Solana transactions');

      // Start Express server
      const server = this.app.listen(config.port, () => {
        this.logger.info(`🌐 Server running on port ${config.port}`);
        this.logger.info(`📊 Health: http://localhost:${config.port}/health`);
        this.logger.info(`📈 Metrics: http://localhost:${config.port}/metrics`);
      });

      return server;

    } catch (error) {
      this.logger.error('❌ Failed to start service:', error);
      process.exit(1);
    }
  }

  private async gracefulShutdown(signal: string) {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

    try {
      // Stop accepting new requests
      this.logger.info('Stopping gRPC pool...');
      await this.grpcPool.stop();
      
      this.logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the application
if (require.main === module) {
  const app = new StalkChainApp();
  app.start().catch(console.error);
}

export { StalkChainApp };
