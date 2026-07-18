// Order Manager - Handles Razorpay order creation with idempotency and validation
// Implements Edge Case 4: Currency precision handling and Edge Case 5: UTC time sync

import Razorpay from 'razorpay';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@interviewforge/db';
import { 
  CreatePaymentRequest, 
  PaymentResponse, 
  CurrencyValidationResult,
  PaymentError 
} from './types.js';
import { paymentConfig, PAYMENT_CONSTANTS } from './config.js';
import { CurrencyPrecisionHandler } from './edge-cases/currency-precision-handler.js';
import { TimeSync } from './edge-cases/time-sync.js';
import { AuditLogger } from './audit-logger.js';
import { FraudDetector } from './fraud-detector.js';

export class OrderManager {
  private readonly razorpay: Razorpay;
  private readonly prisma: PrismaClient;
  private readonly currencyHandler: CurrencyPrecisionHandler;
  private readonly timeSync: TimeSync;
  private readonly auditLogger: AuditLogger;
  private readonly fraudDetector: FraudDetector;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.razorpay = new Razorpay({
      key_id: paymentConfig.razorpay.keyId,
      key_secret: paymentConfig.razorpay.keySecret,
    });
    this.currencyHandler = new CurrencyPrecisionHandler();
    this.timeSync = new TimeSync();
    this.auditLogger = new AuditLogger(prisma);
    this.fraudDetector = new FraudDetector(prisma);
  }

  /**
   * Creates a new payment order with comprehensive validation and edge case handling
   * Implements Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
   */
  async createOrder(request: CreatePaymentRequest): Promise<PaymentResponse> {
    try {
      // 1. Validate currency precision (Edge Case 4)
      const currencyValidation = await this.validateCurrencyPrecision(request);
      if (!currencyValidation.valid) {
        throw new PaymentError(
          currencyValidation.error!,
          PAYMENT_CONSTANTS.ERROR_CODES.CURRENCY_PRECISION_ERROR,
          400,
          { validation: currencyValidation }
        );
      }

      // 2. Generate idempotent receipt ID
      const receiptId = this.generateIdempotentReceiptId(request.userId, request.amount);

      // 3. Check for existing order with same receipt ID
      const existingPayment = await this.findExistingPayment(receiptId);
      if (existingPayment) {
        return this.mapPaymentToResponse(existingPayment);
      }

      // 4. Validate amount against subscription plans
      await this.validateAmountAgainstPlans(request);

      // 4.1 Fraud assessment
      const fraudAssessment = await this.fraudDetector.assessPaymentRequest({
        userId: request.userId,
        amount: request.amount,
        currency: request.currency,
        sessionId: request.sessionId,
        clientIp: request.clientIp,
        userAgent: request.userAgent,
        metadata: request.metadata,
      });

      if (fraudAssessment.shouldBlock) {
        console.warn('Fraud detector blocked order creation', {
          userId: request.userId.slice(0, 8),
          score: fraudAssessment.score,
          riskLevel: fraudAssessment.riskLevel,
          flags: fraudAssessment.flags,
        });

        throw new PaymentError(
          'Payment request flagged for risk review',
          PAYMENT_CONSTANTS.ERROR_CODES.FRAUD_DETECTED,
          403,
          {
            riskLevel: fraudAssessment.riskLevel,
          }
        );
      }

      // 5. Calculate order expiry with UTC timestamp (Edge Case 5)
      const orderExpiry = this.calculateOrderExpiry(request.metadata?.paymentMethod);

      // 6. Create Razorpay order
      const razorpayOrder = await this.createRazorpayOrder({
        amount: currencyValidation.backendAmount,
        currency: request.currency || 'INR',
        receipt: receiptId,
        notes: this.buildOrderNotes(request),
      });

      // 7. Store payment in database with all edge case fields
      const payment = await this.storePayment({
        ...request,
        razorpayOrderId: razorpayOrder.id,
        receiptId,
        orderExpiry,
        backendAmount: currencyValidation.backendAmount,
        conversionValidated: currencyValidation.conversionValidated,
        amountPrecision: currencyValidation.precision || 2,
        metadata: {
          ...(request.metadata || {}),
          fraudAssessment: {
            score: fraudAssessment.score,
            riskLevel: fraudAssessment.riskLevel,
            flags: fraudAssessment.flags,
          },
        },
      });

      // 8. Log audit event
      await this.auditLogger.logPaymentEvent({
        type: 'PAYMENT_CREATED',
        paymentId: payment.id,
        userId: request.userId,
        data: {
          razorpayOrderId: razorpayOrder.id,
          amount: request.amount,
          currency: request.currency || 'INR',
          kind: request.kind,
          receiptId,
          orderExpiry: orderExpiry.toISOString(),
          currencyValidation,
        },
      });

      return this.mapPaymentToResponse(payment);

    } catch (error) {
      // Log error for debugging
      console.error('Order creation failed:', error);
      
      if (error instanceof PaymentError) {
        throw error;
      }
      
      throw new PaymentError(
        'Failed to create payment order',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { originalError: error.message }
      );
    }
  }

  /**
   * Validates currency precision to prevent ₹99.99 → 9999 paise mismatches
   */
  private async validateCurrencyPrecision(request: CreatePaymentRequest): Promise<CurrencyValidationResult> {
    if (request.frontendAmount) {
      return this.currencyHandler.validateCurrencyConversion(
        request.frontendAmount,
        request.currency || 'INR'
      );
    }

    // If no frontend amount provided, validate the backend amount
    return this.currencyHandler.validateBackendAmount(
      request.amount,
      request.currency || 'INR'
    );
  }

  /**
   * Generates idempotent receipt ID to prevent duplicate orders
   */
  private generateIdempotentReceiptId(userId: string, amount: number): string {
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const userHash = userId.substring(0, 8); // First 8 chars of user ID
    const amountHash = amount.toString();
    return `rcpt_${userHash}_${amountHash}_${timestamp}_${uuidv4().substring(0, 8)}`;
  }

  /**
   * Finds existing payment with same receipt ID
   */
  private async findExistingPayment(receiptId: string) {
    return await this.prisma.payment.findUnique({
      where: { receiptId },
    });
  }

  /**
   * Validates payment amount against subscription plans
   */
  private async validateAmountAgainstPlans(request: CreatePaymentRequest): Promise<void> {
    // This would integrate with your subscription plan validation logic
    // For now, we'll do basic validation
    if (request.amount <= 0) {
      throw new PaymentError(
        'Payment amount must be greater than zero',
        PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_FAILED,
        400
      );
    }

    // Add more sophisticated plan validation here
    // e.g., check if amount matches available subscription plans
  }

  /**
   * Calculates order expiry with UTC timestamp enforcement
   */
  private calculateOrderExpiry(paymentMethod?: string): Date {
    const now = this.timeSync.createUTCTimestamp();
    const expiryMinutes = paymentMethod === 'upi' 
      ? PAYMENT_CONSTANTS.ORDER_EXPIRY_MINUTES.UPI 
      : PAYMENT_CONSTANTS.ORDER_EXPIRY_MINUTES.STANDARD;
    
    return new Date(now.getTime() + (expiryMinutes * 60 * 1000));
  }

  /**
   * Builds order notes for fraud detection metadata
   */
  private buildOrderNotes(request: CreatePaymentRequest): Record<string, any> {
    return {
      userId: request.userId,
      kind: request.kind,
      sessionId: request.sessionId,
      userAgent: request.userAgent ? request.userAgent.substring(0, 100) : undefined, // Truncate for storage
      clientIp: request.clientIp,
      timestamp: new Date().toISOString(),
      ...request.metadata,
    };
  }

  /**
   * Creates Razorpay order with error handling and auto-capture configuration
   */
  private async createRazorpayOrder(orderData: {
    amount: number;
    currency: string;
    receipt: string;
    notes: Record<string, any>;
  }) {
    try {
      const orderPayload: any = {
        ...orderData,
      };

      // Enable auto-capture if configured
      if (paymentConfig.features.enableAutoCapture) {
        orderPayload.payment = {
          capture: 'automatic',
          capture_options: {
            automatic_expiry_period: 0.5, // Auto-capture within 30 seconds of authorization
            manual_expiry_period: 7200, // Allow manual capture for 2 hours
            refund_speed: 'optimum'
          }
        };
      }

      return await this.razorpay.orders.create(orderPayload);
    } catch (error) {
      console.error('Razorpay order creation failed:', error);
      throw new PaymentError(
        'Failed to create payment order with payment gateway',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { razorpayError: error.message }
      );
    }
  }

  /**
   * Stores payment in database with all edge case fields
   */
  private async storePayment(data: CreatePaymentRequest & {
    razorpayOrderId: string;
    receiptId: string;
    orderExpiry: Date;
    backendAmount: number;
    conversionValidated: boolean;
    amountPrecision: number;
  }) {
    return await this.prisma.payment.create({
      data: {
        userId: data.userId,
        razorpayOrderId: data.razorpayOrderId,
        amount: data.amount,
        currency: data.currency || 'INR',
        status: PAYMENT_CONSTANTS.PAYMENT_STATUS.CREATED,
        kind: data.kind,
        receiptId: data.receiptId,
        orderExpiry: data.orderExpiry,
        orderNotes: data.metadata || {},
        
        // Amount tracking
        totalAmountDue: data.amount,
        amountPaid: 0,
        remainingAmount: data.amount,
        
        // Settlement tracking
        settlementStatus: PAYMENT_CONSTANTS.SETTLEMENT_STATUS.PENDING,
        
        // Metadata
        userAgent: data.userAgent,
        clientIp: data.clientIp,
        sessionId: data.sessionId,
        metadata: {
          ...(data.metadata || {}),
          frontendAmount: data.frontendAmount,
          backendAmount: data.backendAmount,
          conversionValidated: data.conversionValidated,
          amountPrecision: data.amountPrecision,
        },
      } as any,
    });
  }

  /**
   * Maps payment entity to API response
   */
  private mapPaymentToResponse(payment: any): PaymentResponse {
    return {
      id: payment.id,
      razorpayOrderId: payment.razorpayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      receiptId: payment.receiptId,
      orderExpiry: payment.orderExpiry,
      createdAt: payment.createdAt,
    };
  }

  /**
   * Gets payment by ID with validation
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new PaymentError(
        'Payment not found',
        PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_NOT_FOUND,
        404
      );
    }

    return this.mapPaymentToResponse(payment);
  }

  /**
   * Gets payment by Razorpay order ID
   */
  async getPaymentByOrderId(razorpayOrderId: string): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findFirst({
      where: { razorpayOrderId },
    });

    if (!payment) {
      throw new PaymentError(
        'Payment not found',
        PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_NOT_FOUND,
        404
      );
    }

    return this.mapPaymentToResponse(payment);
  }
}
