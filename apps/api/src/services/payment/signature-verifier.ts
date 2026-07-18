// Signature Verifier - Cryptographic verification of payment data
// Implements Edge Case 6: Secret rotation with multiple valid secrets
// Implements Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7

import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaClient } from '@interviewforge/db';
import { paymentConfig, PAYMENT_CONSTANTS } from './config.js';
import { SecretManager } from './edge-cases/secret-manager.js';
import { AuditLogger } from './audit-logger.js';

export class SignatureVerifier {
  private readonly secretManager: SecretManager;
  private readonly auditLogger?: AuditLogger;

  constructor(prisma?: PrismaClient) {
    this.secretManager = new SecretManager(prisma);
    this.auditLogger = prisma ? new AuditLogger(prisma) : undefined;
  }

  /**
   * Verifies Razorpay payment signature using HMAC-SHA256
   * Implements Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
   */
  async verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): Promise<boolean> {
    try {
      // 1. Validate signature format (Requirement 3.5)
      if (!this.validateSignatureFormat(signature)) {
        await this.logSecurityEvent('invalid_signature_format', {
          orderId,
          paymentId,
          signatureLength: signature.length,
        });
        return false;
      }

      // 2. Generate expected signature
      const payload = `${orderId}|${paymentId}`;
      
      // 3. Try verification with multiple secrets (Edge Case 6: Secret rotation)
      const verificationResult = await this.verifyWithMultipleSecrets(
        payload,
        signature,
        'webhook_secret'
      );

      if (verificationResult.valid) {
        // Log successful verification (Requirement 3.4 - but don't expose details)
        await this.logSecurityEvent('signature_verified', {
          orderId,
          paymentId,
          secretAge: verificationResult.secretAge,
        });
        return true;
      } else {
        // Log failed verification (Requirement 3.4)
        await this.logSecurityEvent('signature_verification_failed', {
          orderId,
          paymentId,
          error: verificationResult.error,
        });
        return false;
      }

    } catch (error) {
      console.error('Signature verification error:', error);
      await this.logSecurityEvent('signature_verification_error', {
        orderId,
        paymentId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Verifies webhook signature with comprehensive validation
   */
  async verifyWebhookSignature(
    payload: string,
    signature: string
  ): Promise<boolean> {
    try {
      // Validate signature format
      if (!this.validateSignatureFormat(signature)) {
        await this.logSecurityEvent('invalid_webhook_signature_format', {
          signatureLength: signature.length,
        });
        return false;
      }

      // Verify with multiple secrets for rotation support
      const verificationResult = await this.verifyWithMultipleSecrets(
        payload,
        signature,
        'webhook_secret'
      );

      if (verificationResult.valid) {
        await this.logSecurityEvent('webhook_signature_verified', {
          secretAge: verificationResult.secretAge,
        });
        return true;
      } else {
        await this.logSecurityEvent('webhook_signature_verification_failed', {
          error: verificationResult.error,
        });
        return false;
      }

    } catch (error) {
      console.error('Webhook signature verification error:', error);
      await this.logSecurityEvent('webhook_signature_verification_error', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Validates signature format before cryptographic verification
   */
  private validateSignatureFormat(signature: string): boolean {
    // Razorpay signatures are hex strings of specific length
    const hexPattern = /^[a-f0-9]+$/i;
    
    // Check if it's a valid hex string
    if (!hexPattern.test(signature)) {
      return false;
    }

    // Check length (SHA256 HMAC produces 64 character hex string)
    if (signature.length !== 64) {
      return false;
    }

    return true;
  }

  /**
   * Verifies signature with multiple active secrets (for rotation support)
   */
  private async verifyWithMultipleSecrets(
    payload: string,
    signature: string,
    secretType: 'webhook_secret'
  ): Promise<{ valid: boolean; secretAge?: number; error?: string }> {
    try {
      const validation = await this.secretManager.validateWithMultipleSecrets(
        payload,
        signature,
        secretType
      );

      return {
        valid: validation.valid,
        secretAge: validation.secretAge,
        error: validation.error,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown signature verification error',
      };
    }
  }

  /**
   * Verifies signature with a specific secret using constant-time comparison
   */
  private verifySignatureWithSecret(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    try {
      // Generate expected signature using HMAC-SHA256 (Requirement 3.1)
      const expectedSignature = createHmac(PAYMENT_CONSTANTS.SIGNATURE_ALGORITHM, secret)
        .update(payload)
        .digest('hex');

      // Use constant-time comparison to prevent timing attacks (Requirement 3.6)
      return this.constantTimeCompare(signature, expectedSignature);
    } catch (error) {
      console.error('Signature verification with secret failed:', error);
      return false;
    }
  }

  /**
   * Constant-time comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    try {
      // Convert strings to buffers for timing-safe comparison
      const bufferA = Buffer.from(a, 'hex');
      const bufferB = Buffer.from(b, 'hex');

      // Ensure both buffers are the same length
      if (bufferA.length !== bufferB.length) {
        return false;
      }

      // Use Node.js built-in timing-safe comparison
      return timingSafeEqual(bufferA, bufferB);
    } catch (error) {
      // If conversion fails, strings are not valid hex
      return false;
    }
  }

  /**
   * Generates signature for testing purposes
   */
  generateSignature(payload: string, secret?: string): string {
    const secretToUse = secret || paymentConfig.razorpay.webhookSecret;
    return createHmac(PAYMENT_CONSTANTS.SIGNATURE_ALGORITHM, secretToUse)
      .update(payload)
      .digest('hex');
  }

  /**
   * Validates signature strength and format
   */
  validateSignatureStrength(signature: string): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check length
    if (signature.length !== 64) {
      issues.push('Invalid signature length');
    }

    // Check if it's valid hex
    if (!/^[a-f0-9]+$/i.test(signature)) {
      issues.push('Signature contains invalid characters');
    }

    // Check for common weak patterns
    if (signature === '0'.repeat(64)) {
      issues.push('Signature appears to be all zeros');
    }

    if (signature === 'f'.repeat(64)) {
      issues.push('Signature appears to be all ones');
    }

    // Check for repeated patterns
    const firstQuarter = signature.substring(0, 16);
    if (signature === firstQuarter.repeat(4)) {
      issues.push('Signature contains repeated patterns');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Logs security events without exposing sensitive details
   */
  private async logSecurityEvent(eventType: string, data: any): Promise<void> {
    try {
      // Remove sensitive data before logging
      const sanitizedData = { ...data };
      delete sanitizedData.signature;
      delete sanitizedData.secret;

      console.log(`Security event: ${eventType}`, sanitizedData);

      if (this.auditLogger && sanitizedData.paymentId) {
        await this.auditLogger.logPaymentEvent({
          type: `SECURITY_${eventType.toUpperCase()}`,
          paymentId: String(sanitizedData.paymentId),
          userId: String(sanitizedData.userId || 'system'),
          data: sanitizedData,
        });
      }

      // In production, you would also:
      // 1. Send to security monitoring system
      // 2. Trigger alerts for failed verifications
      // 3. Rate limit based on failure patterns
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  /**
   * Checks if signature verification rate limits are exceeded
   */
  async checkVerificationRateLimit(identifier: string): Promise<boolean> {
    // This would integrate with rate limiting system
    // For now, always allow
    return true;
  }

  /**
   * Gets signature verification statistics for monitoring
   */
  async getVerificationStats(): Promise<{
    totalVerifications: number;
    successfulVerifications: number;
    failedVerifications: number;
    successRate: number;
  }> {
    // This would query audit logs for statistics
    // For now, return mock data
    return {
      totalVerifications: 0,
      successfulVerifications: 0,
      failedVerifications: 0,
      successRate: 0,
    };
  }

  /**
   * Validates webhook payload structure before signature verification
   */
  validateWebhookPayload(payload: any): boolean {
    try {
      // Basic structure validation
      if (!payload || typeof payload !== 'object') {
        return false;
      }

      // Check required fields
      const requiredFields = ['entity', 'account_id', 'event', 'created_at'];
      for (const field of requiredFields) {
        if (!(field in payload)) {
          return false;
        }
      }

      // Validate event format
      if (typeof payload.event !== 'string' || !payload.event.includes('.')) {
        return false;
      }

      // Validate timestamp
      if (typeof payload.created_at !== 'number' || payload.created_at <= 0) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extracts payment ID from webhook payload safely
   */
  extractPaymentIdFromWebhook(payload: any): string | null {
    try {
      if (payload.payload?.payment?.entity?.id) {
        return payload.payload.payment.entity.id;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extracts order ID from webhook payload safely
   */
  extractOrderIdFromWebhook(payload: any): string | null {
    try {
      if (payload.payload?.payment?.entity?.order_id) {
        return payload.payload.payment.entity.order_id;
      }
      if (payload.payload?.order?.entity?.id) {
        return payload.payload.order.entity.id;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}