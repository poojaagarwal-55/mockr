export type ErrorCategory =
  | 'network_error'
  | 'card_declined'
  | 'insufficient_funds'
  | 'invalid_card'
  | 'expired_card'
  | 'authentication_failed'
  | 'rate_limit_exceeded'
  | 'order_expired'
  | 'duplicate_payment'
  | 'system_error'
  | 'validation_error'
  | 'fraud_detected'
  | 'bank_error'
  | 'upi_timeout'
  | 'unknown_error';

export interface UserFriendlyError {
  category: ErrorCategory;
  title: string;
  message: string;
  userAction: string;
  technicalDetails?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportContact?: string;
}

export class PaymentErrorHandler {
  private readonly supportEmail: string;
  private readonly supportPhone: string;

  constructor(
    supportEmail: string = 'support@mockr.com',
    supportPhone: string = '+91-1800-XXX-XXXX'
  ) {
    this.supportEmail = supportEmail;
    this.supportPhone = supportPhone;
  }

  handleRazorpayError(error: any): UserFriendlyError {
    const errorCode = error?.error?.code || error?.code;
    const errorDescription = error?.error?.description || error?.description || error?.message;
    const errorReason = error?.error?.reason || error?.reason;

    // Map Razorpay error codes to user-friendly messages
    switch (errorCode) {
      case 'BAD_REQUEST_ERROR':
        return this.createError(
          'validation_error',
          'Invalid Payment Request',
          'The payment request contains invalid information. Please check your details and try again.',
          'Please verify your payment details and try again.',
          true,
          errorDescription
        );

      case 'GATEWAY_ERROR':
      case 'SERVER_ERROR':
        return this.createError(
          'network_error',
          'Payment Gateway Error',
          'We are experiencing technical difficulties with our payment provider. Please try again in a few minutes.',
          'Please wait a few minutes and try again. If the problem persists, contact support.',
          true,
          errorDescription,
          60
        );

      case 'AUTHENTICATION_ERROR':
        return this.createError(
          'authentication_failed',
          'Authentication Failed',
          'Your payment could not be authenticated. Please verify your card details.',
          'Please check your card details and try again. You may need to contact your bank.',
          true,
          errorDescription
        );

      default:
        // Check error reason for more specific handling
        return this.handleRazorpayReason(errorReason, errorDescription);
    }
  }

  private handleRazorpayReason(reason: string, description: string): UserFriendlyError {
    if (!reason) {
      return this.createError(
        'unknown_error',
        'Payment Failed',
        'Your payment could not be processed. Please try again or use a different payment method.',
        'Please try again or contact support if the problem persists.',
        true,
        description
      );
    }

    const reasonLower = reason.toLowerCase();

    // Card declined reasons
    if (
      reasonLower.includes('declined') ||
      reasonLower.includes('do_not_honor') ||
      reasonLower.includes('card_declined')
    ) {
      return this.createError(
        'card_declined',
        'Card Declined',
        'Your card was declined by your bank. This could be due to insufficient funds, card limits, or security restrictions.',
        'Please try a different card or contact your bank for more information.',
        true,
        description
      );
    }

    // Insufficient funds
    if (
      reasonLower.includes('insufficient') ||
      reasonLower.includes('balance') ||
      reasonLower.includes('funds')
    ) {
      return this.createError(
        'insufficient_funds',
        'Insufficient Funds',
        'Your account does not have sufficient funds to complete this payment.',
        'Please add funds to your account or use a different payment method.',
        true,
        description
      );
    }

    // Invalid card
    if (
      reasonLower.includes('invalid') ||
      reasonLower.includes('incorrect') ||
      reasonLower.includes('card_number')
    ) {
      return this.createError(
        'invalid_card',
        'Invalid Card Details',
        'The card details you entered are invalid. Please check your card number, expiry date, and CVV.',
        'Please verify your card details and try again.',
        true,
        description
      );
    }

    // Expired card
    if (reasonLower.includes('expired') || reasonLower.includes('expiry')) {
      return this.createError(
        'expired_card',
        'Card Expired',
        'Your card has expired. Please use a different card.',
        'Please use a card with a valid expiry date.',
        true,
        description
      );
    }

    // Bank error
    if (
      reasonLower.includes('bank') ||
      reasonLower.includes('issuer') ||
      reasonLower.includes('acquirer')
    ) {
      return this.createError(
        'bank_error',
        'Bank Error',
        'Your bank is unable to process this payment at the moment.',
        'Please try again later or contact your bank for assistance.',
        true,
        description,
        300
      );
    }

    // UPI timeout
    if (reasonLower.includes('upi') && reasonLower.includes('timeout')) {
      return this.createError(
        'upi_timeout',
        'UPI Payment Timeout',
        'Your UPI payment request timed out. This could be due to network issues or app delays.',
        'Please try again. Make sure you approve the payment in your UPI app within 5 minutes.',
        true,
        description
      );
    }

    // Fraud/security
    if (
      reasonLower.includes('fraud') ||
      reasonLower.includes('security') ||
      reasonLower.includes('risk')
    ) {
      return this.createError(
        'fraud_detected',
        'Security Check Failed',
        'This transaction was flagged by our security system. This is to protect your account.',
        'Please contact support to verify your identity and complete the payment.',
        false,
        description
      );
    }

    // Default unknown error
    return this.createError(
      'unknown_error',
      'Payment Failed',
      'Your payment could not be processed. Please try again or use a different payment method.',
      'Please try again or contact support if the problem persists.',
      true,
      description
    );
  }

  handleSystemError(error: Error): UserFriendlyError {
    const errorMessage = error.message.toLowerCase();

    // Rate limit exceeded
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return this.createError(
        'rate_limit_exceeded',
        'Too Many Attempts',
        'You have made too many payment attempts. Please wait before trying again.',
        'Please wait a few minutes before attempting another payment.',
        true,
        error.message,
        300
      );
    }

    // Order expired
    if (errorMessage.includes('expired') || errorMessage.includes('timeout')) {
      return this.createError(
        'order_expired',
        'Payment Session Expired',
        'Your payment session has expired. Please create a new order.',
        'Please start a new payment to continue.',
        true,
        error.message
      );
    }

    // Duplicate payment
    if (errorMessage.includes('duplicate') || errorMessage.includes('already')) {
      return this.createError(
        'duplicate_payment',
        'Duplicate Payment Detected',
        'This payment has already been processed. Please check your payment history.',
        'Please check your payment history. If you need assistance, contact support.',
        false,
        error.message
      );
    }

    // Network error
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout')
    ) {
      return this.createError(
        'network_error',
        'Network Error',
        'We could not connect to the payment service. Please check your internet connection.',
        'Please check your internet connection and try again.',
        true,
        error.message,
        30
      );
    }

    // Validation error
    if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      return this.createError(
        'validation_error',
        'Invalid Payment Details',
        'The payment information provided is invalid. Please check your details.',
        'Please verify your payment details and try again.',
        true,
        error.message
      );
    }

    // Default system error
    return this.createError(
      'system_error',
      'System Error',
      'We encountered an unexpected error while processing your payment. Our team has been notified.',
      'Please try again in a few minutes. If the problem persists, contact support.',
      true,
      error.message,
      60
    );
  }

  handleValidationError(fieldErrors: Record<string, string[]>): UserFriendlyError {
    const fields = Object.keys(fieldErrors);
    const firstField = fields[0];
    const firstError = fieldErrors[firstField]?.[0];

    return this.createError(
      'validation_error',
      'Invalid Payment Information',
      firstError || 'Please check your payment details and try again.',
      'Please correct the highlighted fields and try again.',
      true,
      JSON.stringify(fieldErrors)
    );
  }

  private createError(
    category: ErrorCategory,
    title: string,
    message: string,
    userAction: string,
    retryable: boolean,
    technicalDetails?: string,
    retryAfterSeconds?: number
  ): UserFriendlyError {
    return {
      category,
      title,
      message,
      userAction,
      technicalDetails,
      retryable,
      retryAfterSeconds,
      supportContact: `Email: ${this.supportEmail} | Phone: ${this.supportPhone}`,
    };
  }

  // Helper method to format error for API response
  formatErrorResponse(error: UserFriendlyError) {
    return {
      success: false,
      error: {
        category: error.category,
        title: error.title,
        message: error.message,
        userAction: error.userAction,
        retryable: error.retryable,
        retryAfterSeconds: error.retryAfterSeconds,
        supportContact: error.supportContact,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Helper method to get retry strategy
  getRetryStrategy(error: UserFriendlyError): {
    shouldRetry: boolean;
    retryAfterMs: number;
    maxRetries: number;
  } {
    if (!error.retryable) {
      return {
        shouldRetry: false,
        retryAfterMs: 0,
        maxRetries: 0,
      };
    }

    const retryAfterMs = (error.retryAfterSeconds || 30) * 1000;

    // Different retry strategies based on error category
    switch (error.category) {
      case 'network_error':
      case 'system_error':
        return {
          shouldRetry: true,
          retryAfterMs,
          maxRetries: 3,
        };

      case 'card_declined':
      case 'insufficient_funds':
        return {
          shouldRetry: true,
          retryAfterMs: 0, // User can retry immediately with different card
          maxRetries: 5,
        };

      case 'rate_limit_exceeded':
        return {
          shouldRetry: true,
          retryAfterMs,
          maxRetries: 1,
        };

      case 'bank_error':
      case 'upi_timeout':
        return {
          shouldRetry: true,
          retryAfterMs,
          maxRetries: 2,
        };

      default:
        return {
          shouldRetry: true,
          retryAfterMs: 30000,
          maxRetries: 3,
        };
    }
  }
}

// Export singleton instance
export const paymentErrorHandler = new PaymentErrorHandler();
