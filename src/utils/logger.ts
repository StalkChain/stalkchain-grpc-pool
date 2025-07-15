import { Logger } from '../types';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

/**
 * Default console logger implementation
 */
export class ConsoleLogger implements Logger {
  constructor(private level: LogLevel = LogLevel.INFO) {}

  debug(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, meta || '');
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${new Date().toISOString()} - ${message}`, meta || '');
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta || '');
    }
  }

  error(message: string, meta?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, meta || '');
    }
  }
}

/**
 * Silent logger that doesn't output anything
 */
export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Create default logger
 */
export function createDefaultLogger(level: LogLevel = LogLevel.INFO): Logger {
  return new ConsoleLogger(level);
}

/**
 * Create silent logger
 */
export function createSilentLogger(): Logger {
  return new SilentLogger();
}
