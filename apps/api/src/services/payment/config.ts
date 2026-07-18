// Payment Service Configuration
// Environment-specific configuration with validation for the payment module

import { PaymentConfig } from './types.js';

let cachedConfig: PaymentConfig | null = null;

// Clear cached config (useful for testing or when env vars change)
export const clearPaymentConfigCache = (): void => {
  cachedConfig = null;
  console.log('✅ Payment config cache cleared');
};

// Get configuration from environment variables (lazy-loaded)
const getPaymentConfig = (): PaymentConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Validate required environment variables
  const requiredVars = {
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    PAYMENT_ENCRYPTION_KEY: process.env.PAYMENT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY,
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key, _]) => key);

  if (missingVars.length > 0) {
    console.warn(`⚠️  WARNING: Missing payment environment variables: ${missingVars.join(', ')}`);
    console.warn('⚠️  Payment system will use fallback values for development');
    
    // Use fallback values for development
    cachedConfig = {
      razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID || '',
        keySecret: process.env.RAZORPAY_KEY_SECRET || '',
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'dev_webhook_secret',
      },
      encryption: {
        key: process.env.PAYMENT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || 'd2def33abaa42bf3e4362622374e6b9e606605a5818fce7ef771bc392dcb8a76',
      },
      rateLimiting: {
        max: parseInt(process.env.PAYMENT_RATE_LIMIT_MAX || '100'),
        window: parseInt(process.env.PAYMENT_RATE_LIMIT_WINDOW || '60000'),
      },
      abuseProtection: {
        maxFailedAttemptsPerHour: parseInt(process.env.MAX_FAILED_ATTEMPTS_PER_HOUR || '10'),
        maxFailedAttemptsPerDay: parseInt(process.env.MAX_FAILED_ATTEMPTS_PER_DAY || '50'),
        cooldownPeriods: (process.env.COOLDOWN_PERIODS || '300,900,3600,86400')
          .split(',')
          .map(Number),
      },
      reconciliation: {
        intervalMinutes: parseInt(process.env.RECONCILIATION_INTERVAL_MINUTES || '30'),
        zombieDetectionIntervalHours: parseInt(process.env.ZOMBIE_DETECTION_INTERVAL_HOURS || '6'),
      },
      features: {
        enablePartialPayments: process.env.ENABLE_PARTIAL_PAYMENTS === 'true',
        enableFraudDetection: process.env.ENABLE_FRAUD_DETECTION !== 'false',
        enableBusinessReconciliation: process.env.ENABLE_BUSINESS_RECONCILIATION !== 'false',
        enableAutoCapture: process.env.ENABLE_AUTO_CAPTURE !== 'false', // Default true
      },
    };
    return cachedConfig;
  }

  cachedConfig = {
    razorpay: {
      keyId: requiredVars.RAZORPAY_KEY_ID!,
      keySecret: requiredVars.RAZORPAY_KEY_SECRET!,
      webhookSecret: requiredVars.RAZORPAY_WEBHOOK_SECRET!,
    },
    encryption: {
      key: requiredVars.PAYMENT_ENCRYPTION_KEY!,
    },
    rateLimiting: {
      max: parseInt(process.env.PAYMENT_RATE_LIMIT_MAX || '100'),
      window: parseInt(process.env.PAYMENT_RATE_LIMIT_WINDOW || '60000'), // 1 minute
    },
    abuseProtection: {
      maxFailedAttemptsPerHour: parseInt(process.env.MAX_FAILED_ATTEMPTS_PER_HOUR || '10'),
      maxFailedAttemptsPerDay: parseInt(process.env.MAX_FAILED_ATTEMPTS_PER_DAY || '50'),
      cooldownPeriods: (process.env.COOLDOWN_PERIODS || '300,900,3600,86400')
        .split(',')
        .map(Number), // 5min, 15min, 1hr, 24hr
    },
    reconciliation: {
      intervalMinutes: parseInt(process.env.RECONCILIATION_INTERVAL_MINUTES || '30'),
      zombieDetectionIntervalHours: parseInt(process.env.ZOMBIE_DETECTION_INTERVAL_HOURS || '6'),
    },
    features: {
      enablePartialPayments: process.env.ENABLE_PARTIAL_PAYMENTS === 'true',
      enableFraudDetection: process.env.ENABLE_FRAUD_DETECTION !== 'false', // Default true
      enableBusinessReconciliation: process.env.ENABLE_BUSINESS_RECONCILIATION !== 'false', // Default true
      enableAutoCapture: process.env.ENABLE_AUTO_CAPTURE !== 'false', // Default true
    },
  };

  return cachedConfig;
};

// Export getter function instead of singleton
export const getConfig = getPaymentConfig;

// For backward compatibility, export as property getter
export const paymentConfig = new Proxy({} as PaymentConfig, {
  get(target, prop) {
    const config = getPaymentConfig();
    return (config as any)[prop];
  }
});

// Configuration constants
export const PAYMENT_CONSTANTS = {
  // Currency Configuration
  CURRENCY_PRECISION: {
    'INR': 2,
    'USD': 2,
    'EUR': 2,
    'JPY': 0,
    'KWD': 3,
    'BHD': 3,
    'OMR': 3,
  },
  
  // Time Constants
  ORDER_EXPIRY_MINUTES: {
    STANDARD: 15,
    UPI: 30,
  },
  
  UPI_PENDING_TIMEOUT_MINUTES: 10,
  ZOMBIE_PAYMENT_THRESHOLD_HOURS: 24,
  STALE_PAYMENT_THRESHOLD_MINUTES: 30,
  
  // Rate Limiting
  WEBHOOK_PROCESSING_RATE_LIMIT: {
    limit: 10,
    window: 60, // seconds
  },
  
  PAYMENT_CREATION_RATE_LIMIT: {
    limit: 5,
    window: 300, // seconds
  },
  
  // NTP Configuration
  NTP_SERVERS: ['pool.ntp.org', 'time.google.com', 'time.cloudflare.com'],
  TIME_DRIFT_TOLERANCE_MS: 5000,
  
  // Webhook Configuration
  WEBHOOK_TIMEOUT_MS: 5000,
  WEBHOOK_RETRY_ATTEMPTS: 3,
  
  // Settlement Configuration
  SETTLEMENT_MISMATCH_THRESHOLD: 0.05, // 5% tolerance
  
  // Security
  SIGNATURE_ALGORITHM: 'sha256',
  ENCRYPTION_ALGORITHM: 'aes-256-cbc',
  HASH_ALGORITHM: 'sha256',
  
  // Payment Status Values
  PAYMENT_STATUS: {
    CREATED: 'created',
    PENDING: 'pending',
    AUTHORIZED: 'authorized',
    CAPTURED: 'captured',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
    BANK_REVERSED: 'bank_reversed',
  },
  
  // Settlement Status Values
  SETTLEMENT_STATUS: {
    PENDING: 'pending',
    SETTLED: 'settled',
    FAILED: 'failed',
    PARTIAL: 'partial',
  },
  
  // Error Codes
  ERROR_CODES: {
    PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
    INVALID_SIGNATURE: 'INVALID_SIGNATURE',
    DUPLICATE_PAYMENT: 'DUPLICATE_PAYMENT',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    CURRENCY_PRECISION_ERROR: 'CURRENCY_PRECISION_ERROR',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    USER_IN_COOLDOWN: 'USER_IN_COOLDOWN',
    CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
    WEBHOOK_PROCESSING_ERROR: 'WEBHOOK_PROCESSING_ERROR',
    RECONCILIATION_ERROR: 'RECONCILIATION_ERROR',
    ZOMBIE_PAYMENT_DETECTED: 'ZOMBIE_PAYMENT_DETECTED',
    BANK_REVERSAL_DETECTED: 'BANK_REVERSAL_DETECTED',
    SETTLEMENT_MISMATCH: 'SETTLEMENT_MISMATCH',
    FRAUD_DETECTED: 'FRAUD_DETECTED',
    ABUSE_DETECTED: 'ABUSE_DETECTED',
    DEPENDENCY_FAILURE: 'DEPENDENCY_FAILURE',
    SYSTEM_ERROR: 'SYSTEM_ERROR',
  },
} as const;

// Validation function for startup
export const validatePaymentConfig = (): void => {
  try {
    getPaymentConfig();
    
    // Additional validations
    if (paymentConfig.encryption.key.length < 32) {
      throw new Error('Payment encryption key must be at least 32 characters long');
    }
    
    if (paymentConfig.abuseProtection.cooldownPeriods.length === 0) {
      throw new Error('At least one cooldown period must be configured');
    }
    
    console.log('✅ Payment service configuration validation passed');
  } catch (error) {
    console.error('❌ Payment service configuration validation failed:', error);
    throw error;
  }
};

// Environment helpers
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';