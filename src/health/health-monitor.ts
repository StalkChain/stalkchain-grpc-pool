import { EventEmitter } from 'eventemitter3';
import { ConnectionManager } from '../connection/connection-manager';
import { HealthMetrics, Logger, PoolEvents } from '../types';

/**
 * Health check configuration
 */
interface HealthCheckConfig {
  /** Interval between health checks in milliseconds */
  checkInterval: number;
  /** Timeout for health check requests in milliseconds */
  checkTimeout: number;
  /** Number of consecutive failures before marking as unhealthy */
  failureThreshold: number;
  /** Number of consecutive successes needed to mark as healthy */
  recoveryThreshold: number;
  /** Maximum latency before considering connection degraded */
  latencyThreshold: number;
  /** Enable detailed health logging */
  enableDetailedLogging: boolean;
}

/**
 * Connection health status
 */
interface ConnectionHealth {
  endpoint: string;
  isHealthy: boolean;
  isDegraded: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckTime: number;
  lastSuccessTime: number;
  averageLatency: number;
  recentLatencies: number[];
  errorRate: number;
  staleDetected: boolean;
}

/**
 * Health monitoring system for gRPC connections
 * Detects stale connections and triggers recovery actions
 */
export class HealthMonitor extends EventEmitter<PoolEvents> {
  private connections: Map<string, ConnectionManager> = new Map();
  private healthStatus: Map<string, ConnectionHealth> = new Map();
  private monitoringTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;

  constructor(
    private config: HealthCheckConfig,
    private logger?: Logger
  ) {
    super();
    
    this.logger?.info(`Health monitor initialized with check interval: ${config.checkInterval}ms`);
  }

  /**
   * Add connection to monitoring
   */
  public addConnection(connection: ConnectionManager): void {
    const endpoint = connection.id;
    
    this.connections.set(endpoint, connection);
    this.healthStatus.set(endpoint, {
      endpoint,
      isHealthy: false,
      isDegraded: false,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheckTime: 0,
      lastSuccessTime: 0,
      averageLatency: 0,
      recentLatencies: [],
      errorRate: 0,
      staleDetected: false
    });

    this.logger?.debug(`Added connection ${endpoint} to health monitoring`);
  }

  /**
   * Remove connection from monitoring
   */
  public removeConnection(endpoint: string): void {
    this.connections.delete(endpoint);
    this.healthStatus.delete(endpoint);
    
    this.logger?.debug(`Removed connection ${endpoint} from health monitoring`);
  }

  /**
   * Start health monitoring
   */
  public start(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.scheduleNextCheck();
    
    this.logger?.info('Health monitoring started');
  }

  /**
   * Stop health monitoring
   */
  public stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringTimer) {
      clearTimeout(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.logger?.info('Health monitoring stopped');
  }

  /**
   * Get health status for all connections
   */
  public getHealthStatus(): HealthMetrics[] {
    return Array.from(this.healthStatus.values()).map(status => ({
      endpoint: status.endpoint,
      isHealthy: status.isHealthy,
      latency: status.averageLatency,
      errorRate: status.errorRate,
      lastSuccessTime: status.lastSuccessTime,
      consecutiveFailures: status.consecutiveFailures
    }));
  }

  /**
   * Get detailed health status for a specific connection
   */
  public getConnectionHealth(endpoint: string): ConnectionHealth | undefined {
    return this.healthStatus.get(endpoint);
  }

  /**
   * Get healthy connections
   */
  public getHealthyConnections(): string[] {
    return Array.from(this.healthStatus.values())
      .filter(status => status.isHealthy && !status.staleDetected)
      .map(status => status.endpoint);
  }

  /**
   * Get degraded connections
   */
  public getDegradedConnections(): string[] {
    return Array.from(this.healthStatus.values())
      .filter(status => status.isDegraded)
      .map(status => status.endpoint);
  }

  /**
   * Get stale connections
   */
  public getStaleConnections(): string[] {
    return Array.from(this.healthStatus.values())
      .filter(status => status.staleDetected)
      .map(status => status.endpoint);
  }

  /**
   * Force health check for all connections
   */
  public async forceHealthCheck(): Promise<void> {
    await this.performHealthChecks();
  }

  /**
   * Force health check for specific connection
   */
  public async forceConnectionCheck(endpoint: string): Promise<void> {
    const connection = this.connections.get(endpoint);
    if (connection) {
      await this.checkConnectionHealth(connection);
    }
  }

  /**
   * Schedule next health check
   */
  private scheduleNextCheck(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.monitoringTimer = setTimeout(async () => {
      await this.performHealthChecks();
      this.scheduleNextCheck();
    }, this.config.checkInterval);
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const checkPromises = Array.from(this.connections.values()).map(
      connection => this.checkConnectionHealth(connection)
    );

    await Promise.allSettled(checkPromises);
    
    // Emit health check event
    this.emit('health-check', this.getHealthStatus());
  }

  /**
   * Check health of a specific connection
   */
  private async checkConnectionHealth(connection: ConnectionManager): Promise<void> {
    const endpoint = connection.id;
    const status = this.healthStatus.get(endpoint);
    
    if (!status) {
      return;
    }

    const startTime = Date.now();
    status.lastCheckTime = startTime;

    try {
      // Perform ping with timeout
      const latency = await this.performPingWithTimeout(connection);
      
      // Update success metrics
      status.consecutiveSuccesses++;
      status.consecutiveFailures = 0;
      status.lastSuccessTime = startTime;
      
      // Update latency tracking
      this.updateLatencyMetrics(status, latency);
      
      // Check if connection recovered
      if (!status.isHealthy && status.consecutiveSuccesses >= this.config.recoveryThreshold) {
        status.isHealthy = true;
        status.staleDetected = false;
        
        this.logger?.info(`Connection ${endpoint} recovered (${status.consecutiveSuccesses} consecutive successes)`);
        this.emit('connection-recovered', endpoint);
      }
      
      // Check for degraded performance
      status.isDegraded = status.averageLatency > this.config.latencyThreshold;
      
      if (this.config.enableDetailedLogging) {
        this.logger?.debug(`Health check passed for ${endpoint}: latency=${latency}ms, avg=${status.averageLatency}ms`);
      }
      
    } catch (error) {
      // Update failure metrics
      status.consecutiveFailures++;
      status.consecutiveSuccesses = 0;
      
      // Check if connection should be marked as unhealthy
      if (status.isHealthy && status.consecutiveFailures >= this.config.failureThreshold) {
        status.isHealthy = false;
        
        this.logger?.warn(`Connection ${endpoint} marked as unhealthy (${status.consecutiveFailures} consecutive failures)`);
        this.emit('connection-lost', endpoint, error as Error);
      }
      
      // Check for stale connection
      const timeSinceLastSuccess = startTime - status.lastSuccessTime;
      if (timeSinceLastSuccess > this.config.checkInterval * 5) { // 5 check intervals
        if (!status.staleDetected) {
          status.staleDetected = true;
          
          this.logger?.error(`Stale connection detected for ${endpoint} (${timeSinceLastSuccess}ms since last success)`);
          this.handleStaleConnection(endpoint, connection);
        }
      }
      
      if (this.config.enableDetailedLogging) {
        this.logger?.debug(`Health check failed for ${endpoint}: ${(error as Error).message}`);
      }
    }
    
    // Update error rate
    this.updateErrorRate(status);
  }

  /**
   * Perform ping with timeout
   */
  private async performPingWithTimeout(connection: ConnectionManager): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Health check timeout after ${this.config.checkTimeout}ms`));
      }, this.config.checkTimeout);

      connection.ping()
        .then(latency => {
          clearTimeout(timeout);
          resolve(latency);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Update latency metrics
   */
  private updateLatencyMetrics(status: ConnectionHealth, latency: number): void {
    // Keep last 10 latency measurements
    status.recentLatencies.push(latency);
    if (status.recentLatencies.length > 10) {
      status.recentLatencies.shift();
    }
    
    // Calculate average latency
    status.averageLatency = status.recentLatencies.reduce((sum, lat) => sum + lat, 0) / status.recentLatencies.length;
  }

  /**
   * Update error rate
   */
  private updateErrorRate(status: ConnectionHealth): void {
    const totalChecks = status.consecutiveFailures + status.consecutiveSuccesses;
    if (totalChecks > 0) {
      status.errorRate = status.consecutiveFailures / totalChecks;
    }
  }

  /**
   * Handle stale connection detection
   */
  private async handleStaleConnection(endpoint: string, connection: ConnectionManager): Promise<void> {
    this.logger?.warn(`Handling stale connection for ${endpoint}`);
    
    try {
      // Stop the connection
      await connection.stop();
      
      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Restart the connection
      await connection.start();
      
      this.logger?.info(`Restarted stale connection for ${endpoint}`);
      
    } catch (error) {
      this.logger?.error(`Failed to restart stale connection for ${endpoint}: ${error}`);
      this.emit('error', error as Error, `stale-connection-restart-${endpoint}`);
    }
  }

  /**
   * Get health summary
   */
  public getHealthSummary(): {
    totalConnections: number;
    healthyConnections: number;
    degradedConnections: number;
    staleConnections: number;
    averageLatency: number;
    overallHealth: number;
  } {
    const statuses = Array.from(this.healthStatus.values());
    const healthyCount = statuses.filter(s => s.isHealthy).length;
    const degradedCount = statuses.filter(s => s.isDegraded).length;
    const staleCount = statuses.filter(s => s.staleDetected).length;
    
    const totalLatency = statuses.reduce((sum, s) => sum + s.averageLatency, 0);
    const averageLatency = statuses.length > 0 ? totalLatency / statuses.length : 0;
    
    const overallHealth = statuses.length > 0 ? healthyCount / statuses.length : 0;
    
    return {
      totalConnections: statuses.length,
      healthyConnections: healthyCount,
      degradedConnections: degradedCount,
      staleConnections: staleCount,
      averageLatency,
      overallHealth
    };
  }

  /**
   * Create default health monitor
   */
  public static createDefault(logger?: Logger): HealthMonitor {
    const defaultConfig: HealthCheckConfig = {
      checkInterval: 5000, // 5 seconds
      checkTimeout: 3000, // 3 seconds
      failureThreshold: 3,
      recoveryThreshold: 2,
      latencyThreshold: 1000, // 1 second
      enableDetailedLogging: false
    };

    return new HealthMonitor(defaultConfig, logger);
  }
}
