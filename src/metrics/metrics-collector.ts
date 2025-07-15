import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { Logger } from '../types';

/**
 * Metrics configuration
 */
interface MetricsConfig {
  /** Enable Prometheus metrics collection */
  enablePrometheus: boolean;
  /** Collect default Node.js metrics */
  collectDefaultMetrics: boolean;
  /** Metrics collection interval in milliseconds */
  collectionInterval: number;
  /** Metric name prefix */
  prefix: string;
}

/**
 * Custom metrics interface
 */
interface CustomMetrics {
  [key: string]: number;
}

/**
 * Comprehensive metrics collector for gRPC pool monitoring
 * Supports Prometheus metrics and custom metrics collection
 */
export class MetricsCollector {
  private customMetrics: CustomMetrics = {};
  private isEnabled: boolean;

  // Core metrics - initialized in initializeMetrics
  private connectionsEstablished!: Counter<string>;
  private connectionsLost!: Counter<string>;
  private connectionsRecovered!: Counter<string>;
  private messagesProcessed!: Counter<string>;
  private messagesDeduplicated!: Counter<string>;
  private messageProcessingErrors!: Counter<string>;
  private failoverEvents!: Counter<string>;
  private circuitBreakerOpened!: Counter<string>;
  private circuitBreakerClosed!: Counter<string>;

  private connectionHealth!: Gauge<string>;
  private connectionLatency!: Gauge<string>;
  private connectionErrorRate!: Gauge<string>;
  private poolHealth!: Gauge<string>;
  private cacheSize!: Gauge<string>;
  private activeConnections!: Gauge<string>;

  private messageProcessingDuration!: Histogram<string>;
  private connectionLatencyHistogram!: Histogram<string>;

  constructor(
    enabled: boolean = true,
    private config: MetricsConfig = {
      enablePrometheus: true,
      collectDefaultMetrics: true,
      collectionInterval: 10000,
      prefix: 'grpc_pool_'
    },
    private logger?: Logger
  ) {
    this.isEnabled = enabled;
    
    if (this.isEnabled) {
      this.initializeMetrics();
      
      if (this.config.collectDefaultMetrics) {
        collectDefaultMetrics({ register });
      }
      
      this.logger?.info('Metrics collector initialized');
    }
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializeMetrics(): void {
    const prefix = this.config.prefix;

    // Counters
    this.connectionsEstablished = new Counter({
      name: `${prefix}connections_established_total`,
      help: 'Total number of connections established',
      labelNames: ['endpoint']
    });

    this.connectionsLost = new Counter({
      name: `${prefix}connections_lost_total`,
      help: 'Total number of connections lost',
      labelNames: ['endpoint', 'reason']
    });

    this.connectionsRecovered = new Counter({
      name: `${prefix}connections_recovered_total`,
      help: 'Total number of connections recovered',
      labelNames: ['endpoint']
    });

    this.messagesProcessed = new Counter({
      name: `${prefix}messages_processed_total`,
      help: 'Total number of messages processed',
      labelNames: ['source', 'type']
    });

    this.messagesDeduplicated = new Counter({
      name: `${prefix}messages_deduplicated_total`,
      help: 'Total number of duplicate messages filtered',
      labelNames: ['source']
    });

    this.messageProcessingErrors = new Counter({
      name: `${prefix}message_processing_errors_total`,
      help: 'Total number of message processing errors',
      labelNames: ['source', 'error_type']
    });

    this.failoverEvents = new Counter({
      name: `${prefix}failover_events_total`,
      help: 'Total number of failover events',
      labelNames: ['from', 'to', 'reason']
    });

    this.circuitBreakerOpened = new Counter({
      name: `${prefix}circuit_breaker_opened_total`,
      help: 'Total number of times circuit breaker opened',
      labelNames: ['endpoint']
    });

    this.circuitBreakerClosed = new Counter({
      name: `${prefix}circuit_breaker_closed_total`,
      help: 'Total number of times circuit breaker closed',
      labelNames: ['endpoint']
    });

    // Gauges
    this.connectionHealth = new Gauge({
      name: `${prefix}connection_health`,
      help: 'Connection health status (1 = healthy, 0 = unhealthy)',
      labelNames: ['endpoint']
    });

    this.connectionLatency = new Gauge({
      name: `${prefix}connection_latency_ms`,
      help: 'Connection latency in milliseconds',
      labelNames: ['endpoint']
    });

    this.connectionErrorRate = new Gauge({
      name: `${prefix}connection_error_rate`,
      help: 'Connection error rate (0-1)',
      labelNames: ['endpoint']
    });

    this.poolHealth = new Gauge({
      name: `${prefix}pool_health`,
      help: 'Overall pool health (0-1)',
    });

    this.cacheSize = new Gauge({
      name: `${prefix}deduplication_cache_size`,
      help: 'Current size of deduplication cache'
    });

    this.activeConnections = new Gauge({
      name: `${prefix}active_connections`,
      help: 'Number of active connections'
    });

    // Histograms
    this.messageProcessingDuration = new Histogram({
      name: `${prefix}message_processing_duration_seconds`,
      help: 'Time spent processing messages',
      labelNames: ['source', 'type'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0]
    });

    this.connectionLatencyHistogram = new Histogram({
      name: `${prefix}connection_latency_histogram_ms`,
      help: 'Connection latency histogram',
      labelNames: ['endpoint'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    });

    // Register all metrics
    register.registerMetric(this.connectionsEstablished);
    register.registerMetric(this.connectionsLost);
    register.registerMetric(this.connectionsRecovered);
    register.registerMetric(this.messagesProcessed);
    register.registerMetric(this.messagesDeduplicated);
    register.registerMetric(this.messageProcessingErrors);
    register.registerMetric(this.failoverEvents);
    register.registerMetric(this.circuitBreakerOpened);
    register.registerMetric(this.circuitBreakerClosed);
    register.registerMetric(this.connectionHealth);
    register.registerMetric(this.connectionLatency);
    register.registerMetric(this.connectionErrorRate);
    register.registerMetric(this.poolHealth);
    register.registerMetric(this.cacheSize);
    register.registerMetric(this.activeConnections);
    register.registerMetric(this.messageProcessingDuration);
    register.registerMetric(this.connectionLatencyHistogram);
  }

  /**
   * Increment a counter metric
   */
  public incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    if (!this.isEnabled) return;

    switch (name) {
      case 'connections_established':
        this.connectionsEstablished.inc(labels, value);
        break;
      case 'connections_lost':
        this.connectionsLost.inc(labels, value);
        break;
      case 'connections_recovered':
        this.connectionsRecovered.inc(labels, value);
        break;
      case 'messages_processed':
        this.messagesProcessed.inc(labels, value);
        break;
      case 'messages_deduplicated':
        this.messagesDeduplicated.inc(labels, value);
        break;
      case 'message_processing_errors':
        this.messageProcessingErrors.inc(labels, value);
        break;
      case 'failover_events':
        this.failoverEvents.inc(labels, value);
        break;
      case 'circuit_breaker_opened':
        this.circuitBreakerOpened.inc(labels, value);
        break;
      case 'circuit_breaker_closed':
        this.circuitBreakerClosed.inc(labels, value);
        break;
      default:
        // Custom counter
        this.customMetrics[name] = (this.customMetrics[name] || 0) + value;
    }
  }

  /**
   * Set a gauge metric
   */
  public setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.isEnabled) return;

    switch (name) {
      case 'connection_health':
        this.connectionHealth.set(labels, value);
        break;
      case 'connection_latency':
        this.connectionLatency.set(labels, value);
        break;
      case 'connection_error_rate':
        this.connectionErrorRate.set(labels, value);
        break;
      case 'pool_health':
        this.poolHealth.set(value);
        break;
      case 'cache_size':
        this.cacheSize.set(value);
        break;
      case 'active_connections':
        this.activeConnections.set(value);
        break;
      default:
        // Handle dynamic gauge names (e.g., connection_health_endpoint1)
        if (name.startsWith('connection_health_')) {
          const endpoint = name.replace('connection_health_', '');
          this.connectionHealth.set({ endpoint }, value);
        } else if (name.startsWith('connection_latency_')) {
          const endpoint = name.replace('connection_latency_', '');
          this.connectionLatency.set({ endpoint }, value);
        } else if (name.startsWith('connection_error_rate_')) {
          const endpoint = name.replace('connection_error_rate_', '');
          this.connectionErrorRate.set({ endpoint }, value);
        } else {
          // Custom gauge
          this.customMetrics[name] = value;
        }
    }
  }

  /**
   * Observe a histogram metric
   */
  public observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.isEnabled) return;

    switch (name) {
      case 'message_processing_duration':
        this.messageProcessingDuration.observe(labels, value);
        break;
      case 'connection_latency_histogram':
        this.connectionLatencyHistogram.observe(labels, value);
        break;
    }
  }

  /**
   * Record message processing time
   */
  public recordMessageProcessingTime(source: string, type: string, durationMs: number): void {
    this.observeHistogram('message_processing_duration', durationMs / 1000, { source, type });
  }

  /**
   * Record connection latency
   */
  public recordConnectionLatency(endpoint: string, latencyMs: number): void {
    this.observeHistogram('connection_latency_histogram', latencyMs, { endpoint });
    this.setGauge('connection_latency', latencyMs, { endpoint });
  }

  /**
   * Update connection health metrics
   */
  public updateConnectionHealth(endpoint: string, isHealthy: boolean, latency: number, errorRate: number): void {
    this.setGauge('connection_health', isHealthy ? 1 : 0, { endpoint });
    this.setGauge('connection_latency', latency, { endpoint });
    this.setGauge('connection_error_rate', errorRate, { endpoint });
  }

  /**
   * Update pool health
   */
  public updatePoolHealth(healthyConnections: number, totalConnections: number): void {
    const health = totalConnections > 0 ? healthyConnections / totalConnections : 0;
    this.setGauge('pool_health', health);
    this.setGauge('active_connections', totalConnections);
  }

  /**
   * Update deduplication cache size
   */
  public updateCacheSize(size: number): void {
    this.setGauge('cache_size', size);
  }

  /**
   * Get all metrics
   */
  public getMetrics(): Record<string, number> {
    if (!this.isEnabled) {
      return {};
    }

    return { ...this.customMetrics };
  }

  /**
   * Get Prometheus metrics
   */
  public async getPrometheusMetrics(): Promise<string> {
    if (!this.isEnabled || !this.config.enablePrometheus) {
      return '';
    }

    return register.metrics();
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    if (!this.isEnabled) return;

    register.clear();
    this.customMetrics = {};
    this.initializeMetrics();
    
    this.logger?.info('Metrics reset');
  }

  /**
   * Get metrics summary
   */
  public getMetricsSummary(): {
    connectionsEstablished: number;
    connectionsLost: number;
    messagesProcessed: number;
    messagesDeduplicated: number;
    failoverEvents: number;
    averageLatency: number;
    errorRate: number;
  } {
    // This would need to be implemented to extract values from Prometheus metrics
    // For now, return basic summary from custom metrics
    return {
      connectionsEstablished: this.customMetrics['connections_established'] || 0,
      connectionsLost: this.customMetrics['connections_lost'] || 0,
      messagesProcessed: this.customMetrics['messages_processed'] || 0,
      messagesDeduplicated: this.customMetrics['messages_deduplicated'] || 0,
      failoverEvents: this.customMetrics['failover_events'] || 0,
      averageLatency: this.customMetrics['average_latency'] || 0,
      errorRate: this.customMetrics['error_rate'] || 0
    };
  }

  /**
   * Enable metrics collection
   */
  public enable(): void {
    if (!this.isEnabled) {
      this.isEnabled = true;
      this.initializeMetrics();
      this.logger?.info('Metrics collection enabled');
    }
  }

  /**
   * Disable metrics collection
   */
  public disable(): void {
    if (this.isEnabled) {
      this.isEnabled = false;
      register.clear();
      this.customMetrics = {};
      this.logger?.info('Metrics collection disabled');
    }
  }

  /**
   * Check if metrics are enabled
   */
  public isMetricsEnabled(): boolean {
    return this.isEnabled;
  }
}
