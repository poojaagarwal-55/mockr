// Payment Service Types - Comprehensive type definitions for Razorpay integration
// This extends the existing Payment model with all edge cases and financial ledger

import { 
  PaymentKind,
  Payment as PrismaPayment,
  User as PrismaUser
} from '@interviewforge/db';

// ============================================================================
// EXTENDED PAYMENT TYPES (Building on existing Payment model)
// ============================================================================

export interface CreatePaymentRequest {
  userId: string;
  amount: number; // In smallest currency unit (paise)
  currency?: string;
  kind: PaymentKind;
  frontendAmount?: number; // Original frontend amount for validation
  metadata?: Record<string, any>;
  userAgent?: string;
  clientIp?: string;
  sessionId?: string;
}

export interface PaymentResponse {
  id: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  status: string;
  receiptId: string;
  orderExpiry: Date;
  createdAt: Date;
}

export interface VerifyPaymentRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyPaymentResponse {
  success: boolean;
  paymentId: string;
  status: string;
  amount: number;
  message?: string;
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

export interface WebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: {
      entity: RazorpayPayment;
    };
    order?: {
      entity: RazorpayOrder;
    };
    refund?: {
      entity: RazorpayRefund;
    };
    settlement?: {
      entity: RazorpaySettlement;
    };
  };
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  invoice_id?: string;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status?: string;
  captured: boolean;
  description?: string;
  card_id?: string;
  bank?: string;
  wallet?: string;
  vpa?: string;
  email: string;
  contact: string;
  notes: Record<string, any>;
  fee?: number;
  tax?: number;
  error_code?: string;
  error_description?: string;
  error_source?: string;
  error_step?: string;
  error_reason?: string;
  acquirer_data?: Record<string, any>;
  created_at: number;
}

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  offer_id?: string;
  status: string;
  attempts: number;
  notes: Record<string, any>;
  created_at: number;
}

export interface RazorpayRefund {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  notes: Record<string, any>;
  receipt?: string;
  acquirer_data?: Record<string, any>;
  created_at: number;
  batch_id?: string;
  status: string;
  speed_processed: string;
  speed_requested: string;
}

export interface RazorpaySettlement {
  id: string;
  entity: string;
  amount: number;
  status: string;
  fees: number;
  tax: number;
  utr: string;
  created_at: number;
}

// ============================================================================
// EDGE CASE TYPES
// ============================================================================

export interface SettlementData {
  settlementId: string;
  settledAmount: number;
  fees: number;
  tax: number;
  utr: string;
  settlementDate: Date;
}

export interface BankReversalData {
  originalSuccessDate: Date;
  reversalReason: string;
  reversalDate: Date;
  metadata?: Record<string, any>;
}

export interface CurrencyValidationResult {
  valid: boolean;
  frontendAmount: number;
  backendAmount: number;
  precision?: number;
  conversionValidated?: boolean;
  error?: string;
  precisionLoss?: number;
}

export interface TimeSyncResult {
  synchronized: boolean;
  drift: number;
  ntpTime: Date;
  serverTime: Date;
  warning?: string;
  error?: string;
}

export interface AbuseCheckResult {
  allowed: boolean;
  reason?: string;
  cooldownUntil?: Date;
  attempts: {
    hourly: number;
    daily: number;
  };
}

export interface ZombiePayment {
  paymentId: string;
  userId: string;
  ageHours: number;
  localStatus: string;
  razorpayStatus: string | null;
  lastWebhookAt: Date | null;
  isZombie: boolean;
  recoveryPossible: boolean;
  manualReviewRequired: boolean;
}

export interface RecoveryResult {
  success: boolean;
  reason?: string;
  recoveredStatus?: string;
}

// ============================================================================
// RECONCILIATION TYPES
// ============================================================================

export interface ReconciliationReport {
  date: Date;
  localTotals: LocalTotals;
  razorpayTotals: RazorpayTotals | null;
  settlementTotals: SettlementTotals | null;
  discrepancies: DiscrepancyReport;
  status: 'reconciled' | 'discrepancies_found';
}

export interface LocalTotals {
  totalCaptured: number;
  totalRefunded: number;
  paymentCount: number;
  successfulPayments: number;
  failedPayments: number;
}

export interface RazorpayTotals {
  totalCaptured: number;
  totalRefunded: number;
  paymentCount: number;
  successfulPayments: number;
  failedPayments: number;
}

export interface SettlementTotals {
  totalSettled: number;
  settlementCount: number;
  averageSettlementTime: number;
}

export interface DiscrepancyReport {
  hasDiscrepancies: boolean;
  discrepancies: Discrepancy[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface Discrepancy {
  type: string;
  local?: number;
  razorpay?: number;
  expected?: number;
  actual?: number;
  difference: number;
  resolved?: boolean;
}

// ============================================================================
// RATE LIMITING TYPES
// ============================================================================

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number | null;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class PaymentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class CurrencyPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyPrecisionError';
  }
}

export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

export class RetryStormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryStormError';
  }
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface PaymentConfig {
  razorpay: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  };
  encryption: {
    key: string;
  };
  rateLimiting: {
    max: number;
    window: number;
  };
  abuseProtection: {
    maxFailedAttemptsPerHour: number;
    maxFailedAttemptsPerDay: number;
    cooldownPeriods: number[];
  };
  reconciliation: {
    intervalMinutes: number;
    zombieDetectionIntervalHours: number;
  };
  features: {
    enablePartialPayments: boolean;
    enableFraudDetection: boolean;
    enableBusinessReconciliation: boolean;
    enableAutoCapture: boolean;
  };
}

// ============================================================================
// AUDIT TYPES
// ============================================================================

export interface PaymentAuditEvent {
  type: string; // Will be mapped to specific event types
  paymentId: string;
  userId: string;
  data: Record<string, any>;
}

export interface AuditRecord {
  sequence: number;
  timestamp: string;
  eventType: string;
  paymentId: string;
  userId: string;
  data: Record<string, any>;
  previousHash: string | null;
  hash: string;
  sanitizedData: Record<string, any>;
}

export interface IntegrityCheckResult {
  verified: boolean;
  recordsChecked: number;
  issues: IntegrityIssue[];
}

export interface IntegrityIssue {
  sequence: number;
  type: 'hash_mismatch' | 'chain_break';
  expected: string;
  actual: string;
}

export type EventHandlingResult = {
  accepted: boolean;
  type: 'forward_jump' | 'bank_reversal' | 'invalid_regression' | 'sequential';
};

export type SettlementMismatch = {
  paymentId: string;
  capturedAmount: number;
  settledAmount: number;
  difference: number;
  settlementDate: Date;
};

// ============================================================================
// UTILITY TYPES
// ============================================================================

export const PAYMENT_STATUS = {
  CREATED: 'created',
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  BANK_REVERSED: 'bank_reversed',
} as const;

export const CURRENCY_PRECISION = {
  'INR': 2,
  'USD': 2,
  'EUR': 2,
  'JPY': 0,
  'KWD': 3,
  'BHD': 3,
  'OMR': 3,
} as const;

export const ORDER_EXPIRY_MINUTES = {
  STANDARD: 15,
  UPI: 30,
} as const;

export const ERROR_CODES = {
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
} as const;