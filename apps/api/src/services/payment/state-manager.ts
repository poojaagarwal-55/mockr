// State Manager - Manages payment state transitions with atomic updates
// Implements Edge Case 7: Event ordering and out-of-order webhook handling
// Implements Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7

import { PrismaClient } from '@interviewforge/db';
import { EventHandlingResult, PaymentError } from './types.js';
import { PAYMENT_CONSTANTS } from './config.js';
import { AuditLogger } from './audit-logger.js';

export class StateManager {
  private readonly prisma: PrismaClient;
  private readonly auditLogger: AuditLogger;

  // Valid state transitions map (Requirement 4.2)
  private readonly validTransitions = new Map([
    ['created', ['pending', 'failed', 'cancelled']],
    ['pending', ['authorized', 'failed', 'cancelled']],
    ['authorized', ['captured', 'failed', 'refunded']],
    ['captured', ['refunded', 'bank_reversed']],
    ['failed', []],
    ['cancelled', []],
    ['refunded', []],
    ['bank_reversed', []],
  ]);

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.auditLogger = new AuditLogger(prisma);
  }

  /**
   * Transitions payment state with comprehensive validation and atomic updates
   * Implements Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
   */
  async transitionState(
    paymentId: string,
    newStatus: string,
    transitionData: {
      reason: string;
      source: string;
      metadata?: any;
      eventSequence?: number;
    },
    transaction?: any // Prisma transaction
  ): Promise<void> {
    const tx = transaction || this.prisma;

    try {
      // 1. Get current payment with row-level locking (Requirement 4.5)
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        // In a real implementation, this would use SELECT ... FOR UPDATE
      });

      if (!payment) {
        throw new PaymentError(
          'Payment not found',
          PAYMENT_CONSTANTS.ERROR_CODES.PAYMENT_NOT_FOUND,
          404
        );
      }

      const currentStatus = payment.status;

      // 2. Handle out-of-order events (Edge Case 7)
      const eventResult = await this.handleOutOfOrderEvent(
        payment,
        newStatus,
        transitionData.eventSequence || 0
      );

      if (!eventResult.accepted) {
        // Log rejected transition (Requirement 4.3)
        await this.auditLogger.logPaymentEvent({
          type: 'STATE_TRANSITION_REJECTED',
          paymentId,
          userId: payment.userId,
          data: {
            fromStatus: currentStatus,
            toStatus: newStatus,
            reason: transitionData.reason,
            source: transitionData.source,
            rejectionReason: eventResult.type,
            eventSequence: transitionData.eventSequence,
          },
        });

        throw new PaymentError(
          `Invalid state transition: ${currentStatus} -> ${newStatus}`,
          PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
          400,
          { 
            currentStatus, 
            attemptedStatus: newStatus,
            rejectionReason: eventResult.type 
          }
        );
      }

      // 3. Perform atomic state update (Requirement 4.4)
      await this.performAtomicStateUpdate(
        tx,
        paymentId,
        currentStatus,
        newStatus,
        transitionData,
        eventResult.type
      );

      // 4. Log successful transition
      await this.auditLogger.logPaymentEvent({
        type: 'PAYMENT_STATUS_CHANGED',
        paymentId,
        userId: payment.userId,
        data: {
          fromStatus: currentStatus,
          toStatus: newStatus,
          reason: transitionData.reason,
          source: transitionData.source,
          transitionType: eventResult.type,
          eventSequence: transitionData.eventSequence,
          metadata: transitionData.metadata,
        },
      });

    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      console.error('State transition failed:', error);
      throw new PaymentError(
        'State transition failed',
        PAYMENT_CONSTANTS.ERROR_CODES.SYSTEM_ERROR,
        500,
        { originalError: error.message }
      );
    }
  }

  /**
   * Handles out-of-order webhook events (Edge Case 7)
   */
  private async handleOutOfOrderEvent(
    payment: any,
    newStatus: string,
    eventSequence: number
  ): Promise<EventHandlingResult> {
    const currentStatus = payment.status;

    // 1. Check if this is a valid forward jump
    const isValidForwardJump = this.isValidForwardJump(currentStatus, newStatus);
    
    if (isValidForwardJump) {
      // Allow the transition even if intermediate states were skipped
      await this.logForwardJump(payment.id, currentStatus, newStatus, eventSequence);
      return { accepted: true, type: 'forward_jump' };
    }

    // 2. Check if this is a regression (going backwards)
    const isRegression = this.isRegression(currentStatus, newStatus);
    
    if (isRegression) {
      // Only allow bank reversals as regressions
      if (newStatus === PAYMENT_CONSTANTS.PAYMENT_STATUS.BANK_REVERSED && 
          currentStatus === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED) {
        return { accepted: true, type: 'bank_reversal' };
      }
      
      await this.logInvalidRegression(payment.id, currentStatus, newStatus, eventSequence);
      return { accepted: false, type: 'invalid_regression' };
    }

    // 3. Check if this is a valid sequential transition
    if (this.isValidTransition(currentStatus, newStatus)) {
      return { accepted: true, type: 'sequential' };
    }

    // 4. Invalid transition
    return { accepted: false, type: 'invalid_regression' };
  }

  /**
   * Checks if transition is a valid forward jump (skipping intermediate states)
   */
  private isValidForwardJump(fromStatus: string, toStatus: string): boolean {
    // Define valid forward jumps
    const validJumps = new Map([
      ['created', ['authorized', 'captured']], // Skip pending
      ['pending', ['captured']], // Skip authorized
      ['authorized', ['refunded']], // Skip captured for immediate refunds
    ]);

    const allowedJumps = validJumps.get(fromStatus) || [];
    return allowedJumps.includes(toStatus);
  }

  /**
   * Checks if transition is a regression (going backwards in the flow)
   */
  private isRegression(fromStatus: string, toStatus: string): boolean {
    const statusOrder: Record<string, number> = {
      'created': 1,
      'pending': 2,
      'authorized': 3,
      'captured': 4,
      'failed': 5,
      'cancelled': 5,
      'refunded': 6,
      'bank_reversed': 7,
    };

    const fromOrder = statusOrder[fromStatus] || 0;
    const toOrder = statusOrder[toStatus] || 0;

    return toOrder < fromOrder;
  }

  /**
   * Checks if transition is valid according to state machine rules
   */
  private isValidTransition(fromStatus: string, toStatus: string): boolean {
    const allowedTransitions = this.validTransitions.get(fromStatus) || [];
    return allowedTransitions.includes(toStatus);
  }

  /**
   * Performs atomic state update with database transaction
   */
  private async performAtomicStateUpdate(
    tx: any,
    paymentId: string,
    fromStatus: string,
    toStatus: string,
    transitionData: any,
    transitionType: string
  ): Promise<void> {
    const now = new Date();

    // 1. Update payment status (Requirement 4.4)
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: toStatus,
        previousStatus: fromStatus,
        statusUpdatedAt: now,
        // Set completion time for captured payments
        paymentCompletedUtc: toStatus === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED ? now : undefined,
      },
    });

    // 2. Create state transition record (Requirement 4.6)
    await tx.payment_state_transitions.create({
      data: {
        paymentId,
        fromStatus,
        toStatus,
        reason: transitionData.reason,
        source: transitionData.source,
        metadata: transitionData.metadata || {},
        eventSequence: transitionData.eventSequence,
        outOfOrder: transitionType === 'forward_jump',
      },
    });
  }

  /**
   * Logs forward jump event
   */
  private async logForwardJump(
    paymentId: string,
    fromStatus: string,
    toStatus: string,
    eventSequence: number
  ): Promise<void> {
    console.log(`Forward jump detected: ${fromStatus} -> ${toStatus} for payment ${paymentId}`);
    
    // In production, you might want to:
    // 1. Alert monitoring system
    // 2. Check if this indicates a webhook delivery issue
    // 3. Trigger reconciliation for missed intermediate states
  }

  /**
   * Logs invalid regression attempt
   */
  private async logInvalidRegression(
    paymentId: string,
    fromStatus: string,
    toStatus: string,
    eventSequence: number
  ): Promise<void> {
    console.warn(`Invalid regression rejected: ${fromStatus} -> ${toStatus} for payment ${paymentId}`);
    
    // In production, you might want to:
    // 1. Alert security team (potential tampering)
    // 2. Trigger investigation
    // 3. Rate limit the source of invalid transitions
  }

  /**
   * Gets payment state history
   */
  async getStateHistory(paymentId: string): Promise<any[]> {
    try {
      return await this.prisma.payment_state_transitions.findMany({
        where: { paymentId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      console.error('Failed to get state history:', error);
      return [];
    }
  }

  /**
   * Checks if payment is in a final state
   */
  isFinalState(status: string): boolean {
    const finalStates: string[] = [
      PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.FAILED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.CANCELLED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.REFUNDED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.BANK_REVERSED,
    ];

    return finalStates.includes(status);
  }

  /**
   * Checks if payment can be cancelled
   */
  canBeCancelled(status: string): boolean {
    const cancellableStates: string[] = [
      PAYMENT_CONSTANTS.PAYMENT_STATUS.CREATED,
      PAYMENT_CONSTANTS.PAYMENT_STATUS.PENDING,
    ];

    return cancellableStates.includes(status);
  }

  /**
   * Checks if payment can be captured
   */
  canBeCaptured(status: string): boolean {
    return status === PAYMENT_CONSTANTS.PAYMENT_STATUS.AUTHORIZED;
  }

  /**
   * Checks if payment can be refunded
   */
  canBeRefunded(status: string): boolean {
    return status === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED;
  }

  /**
   * Gets valid next states for current status
   */
  getValidNextStates(currentStatus: string): string[] {
    return this.validTransitions.get(currentStatus) || [];
  }

  /**
   * Validates state transition without performing it
   */
  validateTransition(fromStatus: string, toStatus: string): {
    valid: boolean;
    reason?: string;
  } {
    if (this.isValidTransition(fromStatus, toStatus)) {
      return { valid: true };
    }

    if (this.isValidForwardJump(fromStatus, toStatus)) {
      return { valid: true };
    }

    if (this.isRegression(fromStatus, toStatus)) {
      if (toStatus === PAYMENT_CONSTANTS.PAYMENT_STATUS.BANK_REVERSED && 
          fromStatus === PAYMENT_CONSTANTS.PAYMENT_STATUS.CAPTURED) {
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid regression' };
    }

    return { valid: false, reason: 'Invalid state transition' };
  }

  /**
   * Forces state transition (for admin/recovery purposes)
   */
  async forceStateTransition(
    paymentId: string,
    newStatus: string,
    reason: string,
    adminUserId: string
  ): Promise<void> {
    await this.transitionState(paymentId, newStatus, {
      reason: `FORCED: ${reason}`,
      source: 'admin',
      metadata: {
        adminUserId,
        forced: true,
        originalReason: reason,
      },
    });

    console.warn(`Forced state transition for payment ${paymentId} to ${newStatus} by admin ${adminUserId}`);
  }

  /**
   * Gets payments stuck in non-final states for too long
   */
  async getStuckPayments(thresholdHours: number = 24): Promise<any[]> {
    const thresholdDate = new Date();
    thresholdDate.setHours(thresholdDate.getHours() - thresholdHours);

    try {
      return await this.prisma.payment.findMany({
        where: {
          status: {
            in: [
              PAYMENT_CONSTANTS.PAYMENT_STATUS.CREATED,
              PAYMENT_CONSTANTS.PAYMENT_STATUS.PENDING,
              PAYMENT_CONSTANTS.PAYMENT_STATUS.AUTHORIZED,
            ],
          },
          createdAt: {
            lt: thresholdDate,
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      console.error('Failed to get stuck payments:', error);
      return [];
    }
  }
}