/**
 * Structured JSON Logger — Zero-dependency structured logging for AI Operations OS.
 *
 * Outputs one JSON object per log line. Log level is controlled via the
 * OPS_LOG_LEVEL environment variable (default: INFO).
 *
 * @example
 * ```ts
 * const log = createLogger('ops-api');
 * log.info('Server started', { port: 3100 });
 * // {"level":"INFO","ts":"2026-03-09T...","logger":"ops-api","msg":"Server started","data":{"port":3100}}
 * ```
 */

// ── Log levels ──────────────────────────────────────────────────────────────

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

function resolveLogLevel(): LogLevel {
  const raw = (process.env.OPS_LOG_LEVEL || 'INFO').toUpperCase();
  if (raw in LOG_LEVEL_PRIORITY) {
    return raw as LogLevel;
  }
  return 'INFO';
}

// ── Log entry ───────────────────────────────────────────────────────────────

export interface LogEntry {
  level: LogLevel;
  ts: string;
  logger: string;
  msg: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}

// ── Logger type ─────────────────────────────────────────────────────────────

export interface Logger {
  error(msg: string, data?: Record<string, unknown>, correlationId?: string): void;
  warn(msg: string, data?: Record<string, unknown>, correlationId?: string): void;
  info(msg: string, data?: Record<string, unknown>, correlationId?: string): void;
  debug(msg: string, data?: Record<string, unknown>, correlationId?: string): void;
}

// ── Implementation ──────────────────────────────────────────────────────────

class StructuredLogger implements Logger {
  private readonly name: string;
  private readonly threshold: number;
  private readonly writeFn: (line: string) => void;

  constructor(name: string, writeFn?: (line: string) => void) {
    this.name = name;
    this.threshold = LOG_LEVEL_PRIORITY[resolveLogLevel()];
    this.writeFn = writeFn ?? ((line: string) => process.stdout.write(line + '\n'));
  }

  error(msg: string, data?: Record<string, unknown>, correlationId?: string): void {
    this.log('ERROR', msg, data, correlationId);
  }

  warn(msg: string, data?: Record<string, unknown>, correlationId?: string): void {
    this.log('WARN', msg, data, correlationId);
  }

  info(msg: string, data?: Record<string, unknown>, correlationId?: string): void {
    this.log('INFO', msg, data, correlationId);
  }

  debug(msg: string, data?: Record<string, unknown>, correlationId?: string): void {
    this.log('DEBUG', msg, data, correlationId);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>, correlationId?: string): void {
    if (LOG_LEVEL_PRIORITY[level] > this.threshold) {
      return;
    }

    const entry: LogEntry = {
      level,
      ts: new Date().toISOString(),
      logger: this.name,
      msg,
    };

    if (correlationId !== undefined) {
      entry.correlationId = correlationId;
    }

    if (data !== undefined) {
      entry.data = data;
    }

    this.writeFn(JSON.stringify(entry));
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a named structured logger.
 *
 * @param name    - Logger name, typically the module or service name.
 * @param writeFn - Optional custom write function (defaults to stdout).
 * @returns A Logger instance.
 */
export function createLogger(name: string, writeFn?: (line: string) => void): Logger {
  return new StructuredLogger(name, writeFn);
}
