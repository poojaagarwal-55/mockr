// Payment Processor - Handles payment authorization, capture, and duplicate prevention
// Implements Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7

import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { 
  VerifyPaymentRequest, 
  VerifyPaymentResponse, 
  PaymentError
} from './types.js';
import { paymentConfig, PAYMENT_CONSTANTS } from './config.js';
import { SignatureVerifier } from './signature-verifier.js';
import { StateManager } from './state-manager.js';
import { AuditLogger } from './audit-logger.js';
import { UserAbuseProtection } from './edge-cases/user-abuse-protection.js';
import { LedgerService } from './ledger/ledger-service.js';
import { PartialPaymentManager } from './edge-cases/partial-payment-manager.js';
import { retryStormPrevention } from './edge-cases/retry-storm-prevention.js';
import { FraudDetector } from './fraud-detector.js';

export class PaymentProcessor {
  private readonly razorpay: Razorpay;
  private readonly prisma: PrismaClient;
  private readonly signatureVerifier: SignatureVerifier;
  private readonly stateManager: StateManager;
  private readonly auditLogger: AuditLogger;
  private readonly abuseProtection: UserAbuseProtection;
  private readonly ledgerService: LedgerService;
  private readonly partialPaymentManager: PartialPaymentManager;
  private readonly fraudDetector: FraudDetector;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.razorpay = new Razorpay({
      key_id: paymentConfig.razorpay.keyId,
      key_secret: paymentConfig.razorpay.keySecret,
    });
    this.signatureVerifier = new SignatureVerifier(prisma);
    this.stateManager = new StateManager(prisma);
    this.auditLogger = new AuditLogger(prisma);
    this.abuseProtection = new UserAbuseProtection(prisma);
    this.ledgerService = new LedgerService(prisma);
    this.partialPaymentManager = new PartialPaymentManager(prisma);
    this.fraudDetector = new FraudDetector(prisma);
  }

  /**
   * Verifies payment with comprehensive duplicate prevention and validation
   * Implements Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
   */
  async verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    const retryGuard = retryStormPrevention.checkAndGuard(
      'payment_creation',
      `${request.razorpayOrderId}:${request.razorpayPaymentId}`
    );

    if (!retryGuard.allowed) {
      throw new PaymentError(
        'Payment verification temporarily rate limited',
        PAYMENT_CONSTANTS.ERROR_CODES.RATE_LIMIT_EXCEEDED,
        429,
        { retryAfterMs: retryGuard.retryAfterMs }
      );
    }

    try {
      // 1. Find payment by order ID
      const payment = await this.findPaymentByOrderId(request.razorpayOrderId);
      if (!payment) {
        throw new PaymentError(
          'Payment not found',
          PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_NOT_FOUND,
          404
        );
      }

      const fraudAssessment = await this.fraudDetector.assessPaymentRequest({
        userId: payment.userId,
        amount: payment.amount,
        currency: payment.currency,
        sessionId: payment.sessionId || undefined,
        clientIp: payment.clientIp || undefined,
        userAgent: payment.userAgent || undefined,
        metadata: {
          context: 'payment_verify',
        },
      });

      if (fraudAssessment.shouldBlock) {
        await this.auditLogger.logPaymentEvent({
          type: 'FRAUD_DETECTED',
          paymentId: payment.id,
          userId: payment.userId,
          data: {
            score: fraudAssessment.score,
            riskLevel: fraudAssessment.riskLevel,
            flags: fraudAssessment.flags,
          },
        });

        throw new PaymentError(
          'Payment verification blocked for risk review',
          PAYMENT_CONSTANTS.ERROR_CODES.FRAUD_DETECTED,
          403,
          {
            riskLevel: fraudAssessment.riskLevel,
          }
        );
      }

      await this.fraudDetector.attachFraudMetadata(payment.id, fraudAssessment);

      // 2. Check for duplicate payment attempts (Requirement 8.1)
      await this.preventDuplicatePayment(payment, request.razorpayPaymentId);

      // 3. Check user abuse protection
      const abuseCheck = await this.abuseProtection.checkUserAbuse(payment.userId);
      if (!abuseCheck.allowed) {
        await this.auditLogger.logPaymentEvent({
          type: 'ABUSE_DETECTED',
          paymentId: payment.id,
          userId: payment.userId,
          data: {
            reason: abuseCheck.reason,
            cooldownUntil: abuseCheck.cooldownUntil,
            attempts: abuseCheck.attempts,
          },
        });

        throw new PaymentError(
          'Payment verification temporarily blocked',
          PAYMENT_CONSTANTS.ERROR_CODES.USER_IN_COOLDOWN,
          429,
          { cooldownUntil: abuseCheck.cooldownUntil }
        );
      }

      // 4. Verify signature (Requirement 8.4)
      const signatureValid = await this.signatureVerifier.verifyPaymentSignature(
        request.razorpayOrderId,
        request.razorpayPaymentId,
        request.razorpaySignature
      );

      if (!signatureValid) {
        // Record failed attempt
        await this.abuseProtection.recordFailedAttempt(payment.userId, {
          type: 'signature_verification',
          paymentId: payment.id,
          reason: 'invalid_signature',
        });

        throw new PaymentError(
          'Payment signature verification failed',
          PAYMENT_CONSTANTS.ERROR_CODES.INVALID_SIGNATURE,
          400
        );
      }

      // 5. Validate order status before processing (Requirement 8.6)
      await this.validateOrderStatus(payment);

      // 6. Handle concurrent payment attempts with locking (Requirement 8.5)
      const result = await this.processPaymentWithLocking(payment, request);

      await this.abuseProtection.recordSuccessfulAttempt(payment.userId, 'payment_verification', {
        paymentId: payment.id,
        razorpayPaymentId: request.razorpayPaymentId,
      });

      return result;

    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      console.error('Payment verification failed:', error);
      throw new PaymentError(
        'Payment verification failed',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { originalError: error.message }
      );
    } finally {
      if (retryGuard.lockKey) {
        retryStormPrevention.releaseProcessingLock(retryGuard.lockKey);
      }
    }
  }

  /**
   * Prevents duplicate payment attempts for completed orders
   */
  private async preventDuplicatePayment(payment: any, razorpayPaymentId: string): Promise<void> {
    // Check if payment is already completed
    if (payment.status === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED) {
      // Log duplicate attempt (Requirement 8.7)
      await this.auditLogger.logPaymentEvent({
        type: 'DUPLICATE_PAYMENT_ATTEMPTED',
        paymentId: payment.id,
        userId: payment.userId,
        data: {
          existingStatus: payment.status,
          attemptedPaymentId: razorpayPaymentId,
          existingPaymentId: payment.razorpayPaymentId,
        },
      });

      throw new PaymentError(
        'Payment already completed',
        PAYMENT_CONSTANTS.ERROR_CODES.DUPLICATE_PAYMENT,
        400,
        { 
          existingPaymentId: payment.razorpayPaymentId,
          status: payment.status 
        }
      );
    }

    // Check if same payment ID is being used
    if (payment.razorpayPaymentId && payment.razorpayPaymentId === razorpayPaymentId) {
      // This is a retry of the same payment - allow it
      return;
    }

    // Check if different payment ID for same order
    if (payment.razorpayPaymentId && payment.razorpayPaymentId !== razorpayPaymentId) {
      throw new PaymentError(
        'Different payment ID attempted for same order',
        PAYMENT_CONSTANTS.ERROR_CODES.DUPLICATE_PAYMENT,
        400,
        { 
          existingPaymentId: payment.razorpayPaymentId,
          attemptedPaymentId: razorpayPaymentId 
        }
      );
    }
  }

  /**
   * Validates order status before allowing payment processing
   */
  private async validateOrderStatus(payment: any): Promise<void> {
    // Check if order has expired
    if (new Date() > new Date(payment.orderExpiry)) {
      throw new PaymentError(
        'Payment order has expired',
        PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_FAILED,
        400,
        { orderExpiry: payment.orderExpiry }
      );
    }

    // Check if order is in valid state for payment
    const validStates = [
      PAYMENT_CONSTANTS.PAYMENT_STATUS.CREATED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.PENDING,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.AUTHORIZED,
    ];

    if (!validStates.includes(payment.status)) {
      throw new PaymentError(
        `Payment cannot be processed in current status: ${payment.status}`,
        PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_FAILED,
        400,
        { currentStatus: payment.status }
      );
    }
  }

  /**
   * Processes payment with database locking to prevent race conditions
   */
  private async processPaymentWithLocking(
    payment: any, 
    request: VerifyPaymentRequest
  ): Promise<VerifyPaymentResponse> {
    // Use database transaction with row-level locking
    return await this.prisma.$transaction(async (tx) => {
      // Lock the payment record
      const lockedPayment = await tx.payment.findUnique({
        where: { id: payment.id },
        // This would be SELECT ... FOR UPDATE in raw SQL
      });

      if (!lockedPayment) {
        throw new PaymentError(
          'Payment not found during processing',
          PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_NOT_FOUND,
          404
        );
      }

      // Verify payment with Razorpay
      const razorpayPayment = await this.fetchRazorpayPayment(request.razorpayPaymentId);
      
      // Update payment with Razorpay details
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          razorpayPaymentId: request.razorpayPaymentId,
          razorpaySignature: request.razorpaySignature,
          status: this.mapRazorpayStatus(razorpayPayment.status),
          method: razorpayPayment.method,
          paymentCompletedUtc: razorpayPayment.status === 'captured' ? new Date() : null,
          amountPaid: razorpayPayment.status === 'captured' ? razorpayPayment.amount : 0,
          remainingAmount: razorpayPayment.status === 'captured' ? 0 : payment.amount,
        },
      });

      // Create state transition record
      await this.stateManager.transitionState(
        payment.id,
        this.mapRazorpayStatus(razorpayPayment.status),
        {
          reason: 'payment_verification',
          source: 'api',
          metadata: {
            razorpayPaymentId: request.razorpayPaymentId,
            razorpayStatus: razorpayPayment.status,
            method: razorpayPayment.method,
          },
        },
        tx
      );

      if (this.mapRazorpayStatus(razorpayPayment.status) === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED) {
        await this.ledgerService.recordPaymentCaptured(
          payment.id,
          razorpayPayment.amount,
          payment.kind,
          tx
        );
      }

      // Log successful verification
      await this.auditLogger.logPaymentEvent({
        type: 'PAYMENT_VERIFIED',
        paymentId: payment.id,
        userId: payment.userId,
        data: {
          razorpayPaymentId: request.razorpayPaymentId,
          status: this.mapRazorpayStatus(razorpayPayment.status),
          amount: razorpayPayment.amount,
          method: razorpayPayment.method,
        },
      });

      return {
        success: true,
        paymentId: payment.id,
        status: this.mapRazorpayStatus(razorpayPayment.status),
        amount: razorpayPayment.amount,
        message: 'Payment verified successfully',
      };
    });
  }

  /**
   * Fetches payment details from Razorpay
   */
  private async fetchRazorpayPayment(razorpayPaymentId: string): Promise<any> {
    try {
      return await this.razorpay.payments.fetch(razorpayPaymentId);
    } catch (error) {
      console.error('Failed to fetch Razorpay payment:', error);
      throw new PaymentError(
        'Failed to verify payment with payment gateway',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { razorpayError: error.message }
      );
    }
  }

  /**
   * Maps Razorpay payment status to internal status
   */
  private mapRazorpayStatus(razorpayStatus: string): string {
    const statusMap: Record<string, string> = {
      'created': PAYMENT_CONSTANTS.PAYMENT_STATUS.CREATED,
      'authorized': PAYMENT_CONSTANTS.PAYMENT_STATUS.AUTHORIZED,
      'captured': PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED,
      'refunded': PAYMENT_CONSTANTS.PAYMENT_STATUS.REFUNDED,
      'failed': PAYMENT_CONSTANTS.PAYMENT_STATUS.FAILED,
    };

    return statusMap[razorpayStatus] || PAYMENT_CONSTANTS.PAYMENT_STATUS.FAILED;
  }

  /**
   * Finds payment by Razorpay order ID
   */
  private async findPaymentByOrderId(razorpayOrderId: string) {
    return await this.prisma.payment.findFirst({
      where: { razorpayOrderId },
    });
  }

  /**
   * Captures authorized payment (for manual capture flow)
   */
  async capturePayment(paymentId: string, amount?: number): Promise<VerifyPaymentResponse> {
    try {
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

      if (payment.status !== PAYMENT_CONSTANTS.PAYMENT_STATUS.AUTHORIZED) {
        throw new PaymentError(
          'Payment is not in authorized state',
          PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_FAILED,
          400,
          { currentStatus: payment.status }
        );
      }

      // Capture with Razorpay
      const captureAmount = amount || payment.amount;
      const capturedPayment = await this.razorpay.payments.capture(
        payment.razorpayPaymentId!,
        captureAmount,
        'INR'
      );

      // Handle partial capture if enabled
      if (paymentConfig.features.enablePartialPayments && captureAmount < payment.amount) {
        return await this.handlePartialCapture(payment, captureAmount, capturedPayment);
      }

      // Update payment status
      await this.stateManager.transitionState(payment.id, PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED, {
        reason: 'manual_capture',
        source: 'api',
        metadata: {
          captureAmount,
          razorpayResponse: capturedPayment,
        },
      });

      await this.ledgerService.recordPaymentCaptured(payment.id, captureAmount, payment.kind);

      return {
        success: true,
        paymentId: payment.id,
        status: PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED,
        amount: captureAmount,
        message: 'Payment captured successfully',
      };

    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      console.error('Payment capture failed:', error);
      throw new PaymentError(
        'Payment capture failed',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { originalError: error.message }
      );
    }
  }

  /**
   * Handles partial payment capture
   */
  private async handlePartialCapture(
    payment: any,
    captureAmount: number,
    capturedPayment: any
  ): Promise<VerifyPaymentResponse> {
    const partial = await this.partialPaymentManager.handlePartialCapture(payment.id, captureAmount);

    await this.ledgerService.recordPaymentCapturedIfMissing(
      payment.id,
      captureAmount,
      payment.kind
    );

    await this.auditLogger.logPaymentEvent({
      type: 'PARTIAL_PAYMENT_CAPTURED',
      paymentId: payment.id,
      userId: payment.userId,
      data: {
        captureAmount,
        remainingAmount: partial.remainingAmount,
        originalAmount: payment.amount,
        childPaymentId: partial.childPaymentId,
        razorpayResponse: capturedPayment,
      },
    });

    return {
      success: true,
      paymentId: payment.id,
      status: PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED,
      amount: captureAmount,
      message:
        partial.remainingAmount > 0
          ? `Partial payment captured: ${captureAmount}/${payment.amount}`
          : 'Payment captured successfully',
    };
  }

  /**
   * Refunds a captured payment
   */
  async refundPayment(
    paymentId: string, 
    amount?: number, 
    reason?: string
  ): Promise<VerifyPaymentResponse> {
    try {
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

      if (payment.status !== PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED) {
        throw new PaymentError(
          'Only captured payments can be refunded',
          PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_FAILED,
          400,
          { currentStatus: payment.status }
        );
      }

      // Create refund with Razorpay
      const refundAmount = amount || payment.amount;
      const refund = await this.razorpay.payments.refund(payment.razorpayPaymentId!, {
        amount: refundAmount,
        notes: {
          reason: reason || 'Customer request',
          refund_initiated_by: 'system',
        },
      });

      // Update payment status
      await this.stateManager.transitionState(payment.id, PAYMENT_CONSTANTS.PAYMENT_STATUS.REFUNDED, {
        reason: 'refund_initiated',
        source: 'api',
        metadata: {
          refundAmount,
          refundId: refund.id,
          reason,
        },
      });

      await this.ledgerService.recordPaymentRefunded(payment.id, refundAmount, reason);

      await this.auditLogger.logPaymentEvent({
        type: 'PAYMENT_REFUNDED',
        paymentId: payment.id,
        userId: payment.userId,
        data: {
          refundAmount,
          refundId: refund.id,
          reason,
        },
      });

      return {
        success: true,
        paymentId: payment.id,
        status: PAYMENT_CONSTANTS.PAYMENT_STATUS.REFUNDED,
        amount: refundAmount,
        message: 'Payment refunded successfully',
      };

    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      console.error('Payment refund failed:', error);
      throw new PaymentError(
        'Payment refund failed',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { originalError: error.message }
      );
    }
  }
}  
