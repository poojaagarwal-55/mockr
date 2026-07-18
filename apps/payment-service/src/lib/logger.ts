// Comprehensive Logging System for Payment Service
// Structured logging with security and compliance features

import winston from 'winston';
import { config, isDevelopment } from '../config';

// Custom log levels
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    audit: 4,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    audit: 'magenta',
  },
};

// Add colors to winston
winston.addColors(customLevels.colors);

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Sanitize sensitive data
    const sanitizedMeta = sanitizeLogData(meta);
    
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...sanitizedMeta,
    });
  })
);

// Development format for better readability
const developmentFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss.SSS',
  }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const sanitizedMeta = sanitizeLogData(meta);
    const metaStr = Object.keys(sanitizedMeta).length > 0 
      ? `\n${JSON.stringify(sanitizedMeta, null, 2)}` 
      : '';
    
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Sanitize sensitive data from logs
const sanitizeLogData = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'password',
    'secret',
    'key',
    'token',
    'signature',
    'razorpaySignature',
    'razorpayKeySecret',
    'webhookSecret',
    'encryptionKey',
    'clientIp',
    'userAgent',
    'email',
    'phone',
    'contact',
    'cardNumber',
    'cvv',
    'pin',
  ];
  
  const sanitized = { ...data };
  
  const sanitizeValue = (obj: any, path: string[] = []): any => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map((item, index) => sanitizeValue(item, [...path, index.toString()]));
    }
    
    if (typeof obj === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = [...path, key];
        const fieldName = key.toLowerCase();
        
        // Check if field is sensitive
        const isSensitive = sensitiveFields.some(field => 
          fieldName.includes(field.toLowerCase())
        );
        
        if (isSensitive) {
          if (typeof value === 'string') {
            // Mask sensitive strings
            if (value.length <= 8) {
              result[key] = '***';
            } else {
              result[key] = value.substring(0, 4) + '***' + value.substring(value.length - 4);
            }
          } else {
            result[key] = '[REDACTED]';
          }
        } else {
          result[key] = sanitizeValue(value, currentPath);
        }
      }
      
      return result;
    }
    
    return obj;
  };
  
  return sanitizeValue(sanitized);
};

// Create logger instance
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: config.server.port ? 'info' : 'debug', // Use config log level when available
  format: isDevelopment ? developmentFormat : structuredFormat,
  defaultMeta: {
    service: 'payment-service',
    version: '1.0.0',
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true,
    }),
    
    // Separate file for audit logs
    new winston.transports.File({
      filename: 'logs/audit.log',
      level: 'audit',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 20,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

// Enhanced logger with additional methods
export class PaymentLogger {
  private winston: winston.Logger;
  
  constructor(winstonLogger: winston.Logger) {
    this.winston = winstonLogger;
  }
  
  // Standard logging methods
  error(message: string, meta?: any): void {
    this.winston.error(message, meta);
  }
  
  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }
  
  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }
  
  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }
  
  // Audit logging for compliance
  audit(message: string, meta?: any): void {
    this.winston.log('audit', message, {
      ...meta,
      auditTimestamp: new Date().toISOString(),
      auditType: 'payment_system',
    });
  }
  
  // Payment-specific logging methods
  paymentCreated(paymentId: string, userId: string, amount: number, meta?: any): void {
    this.audit('Payment created', {
      paymentId,
      userId: this.maskUserId(userId),
      amount,
      eventType: 'PAYMENT_CREATED',
      ...meta,
    });
  }
  
  paymentStatusChanged(
    paymentId: string, 
    fromStatus: string, 
    toStatus: string, 
    reason: string,
    meta?: any
  ): void {
    this.audit('Payment status changed', {
      paymentId,
      fromStatus,
      toStatus,
      reason,
      eventType: 'PAYMENT_STATUS_CHANGED',
      ...meta,
    });
  }
  
  webhookReceived(eventId: string, eventType: string, paymentId?: string, meta?: any): void {
    this.audit('Webhook received', {
      eventId,
      eventType,
      paymentId,
      eventType: 'WEBHOOK_RECEIVED',
      ...meta,
    });
  }
  
  signatureVerified(paymentId: string, success: boolean, meta?: any): void {
    this.audit('Signature verification', {
      paymentId,
      success,
      eventType: success ? 'SIGNATURE_VERIFIED' : 'SIGNATURE_FAILED',
      ...meta,
    });
  }
  
  fraudDetected(userId: string, reason: string, meta?: any): void {
    this.warn('Fraud detected', {
      userId: this.maskUserId(userId),
      reason,
      eventType: 'FRAUD_DETECTED',
      ...meta,
    });
  }
  
  abuseDetected(userId: string, pattern: string, meta?: any): void {
    this.warn('Abuse pattern detected', {
      userId: this.maskUserId(userId),
      pattern,
      eventType: 'ABUSE_DETECTED',
      ...meta,
    });
  }
  
  zombiePaymentDetected(paymentId: string, ageHours: number, meta?: any): void {
    this.warn('Zombie payment detected', {
      paymentId,
      ageHours,
      eventType: 'ZOMBIE_DETECTED',
      ...meta,
    });
  }
  
  bankReversalDetected(paymentId: string, reason: string, meta?: any): void {
    this.error('Bank reversal detected', {
      paymentId,
      reason,
      eventType: 'BANK_REVERSAL_DETECTED',
      ...meta,
    });
  }
  
  settlementReceived(paymentId: string, settlementAmount: number, meta?: any): void {
    this.audit('Settlement received', {
      paymentId,
      settlementAmount,
      eventType: 'SETTLEMENT_RECEIVED',
      ...meta,
    });
  }
  
  ledgerEntryCreated(transactionId: string, totalAmount: number, meta?: any): void {
    this.audit('Ledger entry created', {
      transactionId,
      totalAmount,
      eventType: 'LEDGER_ENTRY_CREATED',
      ...meta,
    });
  }
  
  reconciliationPerformed(type: string, discrepancies: number, meta?: any): void {
    this.audit('Reconciliation performed', {
      type,
      discrepancies,
      eventType: 'RECONCILIATION_PERFORMED',
      ...meta,
    });
  }
  
  secretRotated(secretType: string, reason: string, meta?: any): void {
    this.audit('Secret rotated', {
      secretType,
      reason,
      eventType: 'SECRET_ROTATED',
      ...meta,
    });
  }
  
  systemError(component: string, error: Error, meta?: any): void {
    this.error('System error', {
      component,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      eventType: 'SYSTEM_ERROR',
      ...meta,
    });
  }
  
  // Performance logging
  performanceMetric(operation: string, duration: number, meta?: any): void {
    this.info('Performance metric', {
      operation,
      duration,
      unit: 'ms',
      ...meta,
    });
  }
  
  // Rate limiting logging
  rateLimitExceeded(operation: string, identifier: string, current: number, ttl: number): void {
    this.warn('Rate limit exceeded', {
      operation,
      identifier: this.maskIdentifier(identifier),
      current,
      ttl,
      eventType: 'RATE_LIMIT_EXCEEDED',
    });
  }
  
  // Circuit breaker logging
  circuitBreakerOpened(service: string, failureCount: number): void {
    this.error('Circuit breaker opened', {
      service,
      failureCount,
      eventType: 'CIRCUIT_BREAKER_OPENED',
    });
  }
  
  circuitBreakerClosed(service: string): void {
    this.info('Circuit breaker closed', {
      service,
      eventType: 'CIRCUIT_BREAKER_CLOSED',
    });
  }
  
  // Dependency failure logging
  dependencyFailure(service: string, error: Error, fallbackUsed: boolean): void {
    this.error('Dependency failure', {
      service,
      error: {
        name: error.name,
        message: error.message,
      },
      fallbackUsed,
      eventType: 'DEPENDENCY_FAILURE',
    });
  }
  
  // Helper methods for data masking
  private maskUserId(userId: string): string {
    if (!userId || userId.length <= 8) {
      return '***';
    }
    return userId.substring(0, 8) + '...';
  }
  
  private maskIdentifier(identifier: string): string {
    if (!identifier || identifier.length <= 8) {
      return '***';
    }
    return identifier.substring(0, 4) + '***' + identifier.substring(identifier.length - 4);
  }
  
  // Create child logger with additional context
  child(meta: any): PaymentLogger {
    const childLogger = this.winston.child(meta);
    return new PaymentLogger(childLogger);
  }
}

// Create and export the main logger instance
export const paymentLogger = new PaymentLogger(logger);

// Export for testing and specific use cases
export { logger as winstonLogger };

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received SIGINT, closing logger...');
  logger.end();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, closing logger...');
  logger.end();
});