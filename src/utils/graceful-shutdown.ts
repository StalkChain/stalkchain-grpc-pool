import { PoolManager } from '../pool/pool-manager';
import { Logger } from '../types';

/**
 * Utility for setting up graceful shutdown handlers for gRPC pools
 * This ensures proper cleanup when the application is terminated
 */
export class GracefulShutdownManager {
  private pools: PoolManager[] = [];
  private handlersRegistered: boolean = false;
  private isShuttingDown: boolean = false;
  
  constructor(private logger?: Logger) {}
  
  /**
   * Register a pool for graceful shutdown
   */
  public registerPool(pool: PoolManager): void {
    this.pools.push(pool);
    
    // Register signal handlers when the first pool is added
    if (!this.handlersRegistered) {
      this.registerSignalHandlers();
    }
  }
  
  /**
   * Unregister a pool from graceful shutdown
   */
  public unregisterPool(pool: PoolManager): void {
    const index = this.pools.indexOf(pool);
    if (index > -1) {
      this.pools.splice(index, 1);
    }
  }
  
  /**
   * Manually trigger graceful shutdown
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    this.logger?.info('Starting graceful shutdown of all gRPC pools...');
    
    const shutdownPromises = this.pools.map(async (pool, index) => {
      try {
        this.logger?.debug(`Shutting down pool ${index + 1}/${this.pools.length}`);
        await pool.stop();
        this.logger?.debug(`Pool ${index + 1} shutdown completed`);
      } catch (error) {
        this.logger?.error(`Error shutting down pool ${index + 1}: ${error}`);
      }
    });
    
    // Wait for all pools to shutdown with a timeout
    await Promise.race([
      Promise.all(shutdownPromises),
      new Promise(resolve => setTimeout(resolve, 10000)) // 10 second timeout
    ]);
    
    this.logger?.info('Graceful shutdown completed');
  }
  
  /**
   * Register process signal handlers
   */
  private registerSignalHandlers(): void {
    if (this.handlersRegistered) {
      return;
    }
    
    this.handlersRegistered = true;
    
    const handleSignal = async (signal: string) => {
      this.logger?.info(`Received ${signal} signal, initiating graceful shutdown...`);
      
      try {
        await this.shutdown();
        
        // Exit with success code after clean shutdown
        setTimeout(() => {
          process.exit(0);
        }, 100);
      } catch (error) {
        this.logger?.error(`Error during graceful shutdown: ${error}`);
        
        // Exit with error code
        setTimeout(() => {
          process.exit(1);
        }, 100);
      }
    };
    
    // Handle termination signals
    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    
    // Handle process exit
    process.on('beforeExit', () => {
      if (!this.isShuttingDown) {
        this.logger?.info('Process exiting, performing cleanup...');
        // Synchronous cleanup only
        this.pools.forEach(pool => {
          try {
            // Note: This is synchronous, so we can't await
            pool.stop();
          } catch (error) {
            this.logger?.error(`Error in synchronous cleanup: ${error}`);
          }
        });
      }
    });
    
    this.logger?.debug('Registered graceful shutdown signal handlers');
  }
}

/**
 * Create a global graceful shutdown manager instance
 */
let globalShutdownManager: GracefulShutdownManager | null = null;

/**
 * Get or create the global graceful shutdown manager
 */
export function getGracefulShutdownManager(logger?: Logger): GracefulShutdownManager {
  if (!globalShutdownManager) {
    globalShutdownManager = new GracefulShutdownManager(logger);
  }
  return globalShutdownManager;
}

/**
 * Convenience function to register a pool for graceful shutdown
 */
export function registerPoolForGracefulShutdown(pool: PoolManager, logger?: Logger): void {
  const manager = getGracefulShutdownManager(logger);
  manager.registerPool(pool);
}

/**
 * Convenience function to manually trigger graceful shutdown
 */
export async function performGracefulShutdown(logger?: Logger): Promise<void> {
  const manager = getGracefulShutdownManager(logger);
  await manager.shutdown();
}
