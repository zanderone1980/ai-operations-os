import { createLogger } from '../logger';
import type { LogEntry } from '../logger';

describe('createLogger', () => {
  // Helper: capture log output lines
  function createCapture() {
    const lines: string[] = [];
    const writeFn = (line: string) => lines.push(line);
    return { lines, writeFn };
  }

  // Helper: parse the last captured log line
  function parseLast(lines: string[]): LogEntry {
    expect(lines.length).toBeGreaterThan(0);
    return JSON.parse(lines[lines.length - 1]);
  }

  describe('log levels', () => {
    it('logs at ERROR level', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.error('something failed');
      const entry = parseLast(lines);
      expect(entry.level).toBe('ERROR');
      expect(entry.msg).toBe('something failed');
    });

    it('logs at WARN level', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.warn('something concerning');
      const entry = parseLast(lines);
      expect(entry.level).toBe('WARN');
      expect(entry.msg).toBe('something concerning');
    });

    it('logs at INFO level', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.info('all good');
      const entry = parseLast(lines);
      expect(entry.level).toBe('INFO');
      expect(entry.msg).toBe('all good');
    });

    it('logs at DEBUG level when OPS_LOG_LEVEL is DEBUG', () => {
      const original = process.env.OPS_LOG_LEVEL;
      process.env.OPS_LOG_LEVEL = 'DEBUG';
      try {
        const { lines, writeFn } = createCapture();
        const log = createLogger('test', writeFn);
        log.debug('trace info');
        const entry = parseLast(lines);
        expect(entry.level).toBe('DEBUG');
        expect(entry.msg).toBe('trace info');
      } finally {
        if (original !== undefined) {
          process.env.OPS_LOG_LEVEL = original;
        } else {
          delete process.env.OPS_LOG_LEVEL;
        }
      }
    });
  });

  describe('level filtering', () => {
    it('does not log DEBUG when level is INFO (default)', () => {
      const original = process.env.OPS_LOG_LEVEL;
      delete process.env.OPS_LOG_LEVEL; // defaults to INFO
      try {
        const { lines, writeFn } = createCapture();
        const log = createLogger('test', writeFn);
        log.debug('should be suppressed');
        expect(lines).toHaveLength(0);
      } finally {
        if (original !== undefined) {
          process.env.OPS_LOG_LEVEL = original;
        } else {
          delete process.env.OPS_LOG_LEVEL;
        }
      }
    });

    it('does not log INFO or DEBUG when level is WARN', () => {
      const original = process.env.OPS_LOG_LEVEL;
      process.env.OPS_LOG_LEVEL = 'WARN';
      try {
        const { lines, writeFn } = createCapture();
        const log = createLogger('test', writeFn);
        log.debug('suppressed');
        log.info('suppressed');
        log.warn('visible');
        log.error('visible');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).level).toBe('WARN');
        expect(JSON.parse(lines[1]).level).toBe('ERROR');
      } finally {
        if (original !== undefined) {
          process.env.OPS_LOG_LEVEL = original;
        } else {
          delete process.env.OPS_LOG_LEVEL;
        }
      }
    });

    it('only logs ERROR when level is ERROR', () => {
      const original = process.env.OPS_LOG_LEVEL;
      process.env.OPS_LOG_LEVEL = 'ERROR';
      try {
        const { lines, writeFn } = createCapture();
        const log = createLogger('test', writeFn);
        log.debug('suppressed');
        log.info('suppressed');
        log.warn('suppressed');
        log.error('visible');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).level).toBe('ERROR');
      } finally {
        if (original !== undefined) {
          process.env.OPS_LOG_LEVEL = original;
        } else {
          delete process.env.OPS_LOG_LEVEL;
        }
      }
    });
  });

  describe('JSON output format', () => {
    it('outputs valid JSON with required fields', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('my-service', writeFn);
      log.info('test message');
      const entry = parseLast(lines);
      expect(entry).toHaveProperty('level', 'INFO');
      expect(entry).toHaveProperty('ts');
      expect(entry).toHaveProperty('logger', 'my-service');
      expect(entry).toHaveProperty('msg', 'test message');
      // ts should be a valid ISO 8601 timestamp
      expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
    });

    it('includes data when provided', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.info('with data', { port: 3100, host: 'localhost' });
      const entry = parseLast(lines);
      expect(entry.data).toEqual({ port: 3100, host: 'localhost' });
    });

    it('omits data field when not provided', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.info('no data');
      const entry = parseLast(lines);
      expect(entry).not.toHaveProperty('data');
    });

    it('includes correlationId when provided', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.info('correlated', { key: 'value' }, 'abc-123');
      const entry = parseLast(lines);
      expect(entry.correlationId).toBe('abc-123');
    });

    it('omits correlationId when not provided', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('test', writeFn);
      log.info('no correlation');
      const entry = parseLast(lines);
      expect(entry).not.toHaveProperty('correlationId');
    });
  });

  describe('logger name', () => {
    it('includes the logger name in output', () => {
      const { lines, writeFn } = createCapture();
      const log = createLogger('ops-api', writeFn);
      log.info('hello');
      const entry = parseLast(lines);
      expect(entry.logger).toBe('ops-api');
    });

    it('different loggers have different names', () => {
      const { lines: lines1, writeFn: w1 } = createCapture();
      const { lines: lines2, writeFn: w2 } = createCapture();
      const log1 = createLogger('service-a', w1);
      const log2 = createLogger('service-b', w2);
      log1.info('from a');
      log2.info('from b');
      expect(JSON.parse(lines1[0]).logger).toBe('service-a');
      expect(JSON.parse(lines2[0]).logger).toBe('service-b');
    });
  });
});
