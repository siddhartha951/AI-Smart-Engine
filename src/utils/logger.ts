export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  storeId?: string;
  visitorId?: string;
  sessionId?: string;
  action?: string;
  [key: string]: unknown;
}

class StructuredLogger {
  private formatLog(level: LogLevel, message: string, context?: LogContext, error?: unknown): string {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      message,
      context: this.sanitizeContext(context),
      ...(error instanceof Error
        ? {
            error: {
              name: error.name,
              message: error.message,
              stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
          }
        : error
        ? { error }
        : {}),
    };
    return JSON.stringify(entry);
  }

  private sanitizeContext(context?: LogContext): LogContext | undefined {
    if (!context) return undefined;
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(context)) {
      if (/token|secret|password|key|auth/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized as LogContext;
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== 'production' || process.env.LOG_LEVEL === 'debug') {
      console.debug(this.formatLog('debug', message, context));
    }
  }

  public info(message: string, context?: LogContext): void {
    console.info(this.formatLog('info', message, context));
  }

  public warn(message: string, context?: LogContext): void {
    console.warn(this.formatLog('warn', message, context));
  }

  public error(message: string, error?: unknown, context?: LogContext): void {
    console.error(this.formatLog('error', message, context, error));
  }
}

export const logger = new StructuredLogger();
