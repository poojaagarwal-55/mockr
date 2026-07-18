// Secret Manager - Edge Case 6 Implementation
// Handles API key rotation with multiple valid secrets temporarily

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { PrismaClient } from '@interviewforge/db';
import { paymentConfig } from '../config.js';

export interface SecretInfo {
  id: string;
  secretType: string;
  secretValueEncrypted: string;
  isActive: boolean;
  validFrom: Date;
  validUntil: Date | null;
  rotationReason: string | null;
  createdBy: string;
}

export interface SecretValidationResult {
  valid: boolean;
  secretId?: string;
  secretAge?: number;
  error?: string;
}

export class SecretManager {
  private readonly prisma: PrismaClient | undefined;
  private readonly encryptionKey: string;
  private activeSecrets: Map<string, SecretInfo> = new Map();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma;
    this.encryptionKey = paymentConfig.encryption.key;
  }

  /**
   * Rotates a secret with overlap period for zero-downtime deployment
   */
  async rotateSecret(
    secretType: 'razorpay_key' | 'webhook_secret',
    newSecretValue: string,
    reason: string
  ): Promise<void> {
    if (!this.prisma) {
      console.warn('Secret rotation requires database connection');
      return;
    }

    try {
      // 1. Encrypt new secret
      const encryptedSecret = this.encrypt(newSecretValue);

      // 2. Store new secret
      const newSecret = await this.prisma.paymentSecretRotation.create({
        data: {
          secretType,
          secretValueEncrypted: encryptedSecret,
          isActive: true,
          validFrom: new Date(),
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hour overlap
          rotationReason: reason,
          createdBy: 'system',
        },
      });

      // 3. Mark old secrets for expiry (but keep them valid for overlap period)
      await this.prisma.paymentSecretRotation.updateMany({
        where: {
          secretType,
          isActive: true,
          id: { not: newSecret.id },
        },
        data: {
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hour grace period
        },
      });

      // 4. Update in-memory cache
      await this.refreshSecretCache();

      // 5. Log rotation event
      console.log(`Secret rotated: ${secretType}, reason: ${reason}, overlap: 24 hours`);

    } catch (error) {
      console.error('Secret rotation failed:', error);
      throw error;
    }
  }

  /**
   * Validates signature with multiple active secrets
   */
  async validateWithMultipleSecrets(
    payload: string,
    signature: string,
    secretType: 'webhook_secret'
  ): Promise<SecretValidationResult> {
    try {
      const activeSecrets = await this.getActiveSecrets(secretType);

      for (const secret of activeSecrets) {
        const decryptedSecret = this.decrypt(secret.secretValueEncrypted);
        
        if (this.verifySignature(payload, signature, decryptedSecret)) {
          return {
            valid: true,
            secretId: secret.id,
            secretAge: Date.now() - secret.validFrom.getTime(),
          };
        }
      }

      return {
        valid: false,
        error: 'Signature validation failed with all active secrets',
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Gets all active secrets for a type
   */
  private async getActiveSecrets(secretType: string): Promise<SecretInfo[]> {
    if (!this.prisma) {
      // Fallback to configured secret
      return [{
        id: 'default',
        secretType,
        secretValueEncrypted: this.encrypt(paymentConfig.razorpay.webhookSecret),
        isActive: true,
        validFrom: new Date(),
        validUntil: null,
        rotationReason: null,
        createdBy: 'system',
      }];
    }

    try {
      const secrets = await this.prisma.paymentSecretRotation.findMany({
        where: {
          secretType,
          isActive: true,
          validFrom: { lte: new Date() },
          OR: [
            { validUntil: null },
            { validUntil: { gte: new Date() } },
          ],
        },
        orderBy: { validFrom: 'desc' },
      });

      return secrets.map(secret => ({
        id: secret.id,
        secretType: secret.secretType,
        secretValueEncrypted: secret.secretValueEncrypted,
        isActive: secret.isActive,
        validFrom: secret.validFrom,
        validUntil: secret.validUntil,
        rotationReason: secret.rotationReason,
        createdBy: secret.createdBy,
      }));
    } catch (error) {
      console.error('Failed to get active secrets:', error);
      return [];
    }
  }

  /**
   * Encrypts secret value using AES-256
   */
  private encrypt(value: string): string {
    try {
      const iv = randomBytes(16);
      const key = this.getKeyBuffer();
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

      return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt secret');
    }
  }

  /**
   * Decrypts secret value using AES-256
   */
  private decrypt(encryptedValue: string): string {
    try {
      const [ivHex, cipherHex] = encryptedValue.split(':');
      if (!ivHex || !cipherHex) {
        throw new Error('Encrypted secret format invalid');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const encryptedBuffer = Buffer.from(cipherHex, 'hex');
      const key = this.getKeyBuffer();
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt secret');
    }
  }

  /**
   * Derives a stable 32-byte key from configured secret material.
   */
  private getKeyBuffer(): Buffer {
    return createHash('sha256').update(this.encryptionKey).digest();
  }

  /**
   * Verifies signature with a specific secret
   */
  private verifySignature(payload: string, signature: string, secret: string): boolean {
    try {
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const given = Buffer.from(signature, 'hex');
      const expected = Buffer.from(expectedSignature, 'hex');

      if (given.length !== expected.length) {
        return false;
      }

      return timingSafeEqual(given, expected);
    } catch (error) {
      return false;
    }
  }

  /**
   * Refreshes in-memory secret cache
   */
  private async refreshSecretCache(): Promise<void> {
    try {
      this.activeSecrets.clear();
      
      const secretTypes: Array<'razorpay_key' | 'webhook_secret'> = ['razorpay_key', 'webhook_secret'];
      
      for (const secretType of secretTypes) {
        const secrets = await this.getActiveSecrets(secretType);
        secrets.forEach(secret => {
          this.activeSecrets.set(`${secretType}_${secret.id}`, secret);
        });
      }
    } catch (error) {
      console.error('Failed to refresh secret cache:', error);
    }
  }

  /**
   * Cleans up expired secrets
   */
  async cleanupExpiredSecrets(): Promise<number> {
    if (!this.prisma) {
      return 0;
    }

    try {
      const result = await this.prisma.paymentSecretRotation.updateMany({
        where: {
          isActive: true,
          validUntil: { lt: new Date() },
        },
        data: {
          isActive: false,
        },
      });

      console.log(`Cleaned up ${result.count} expired secrets`);
      return result.count;
    } catch (error) {
      console.error('Failed to cleanup expired secrets:', error);
      return 0;
    }
  }

  /**
   * Gets secret rotation history
   */
  async getRotationHistory(secretType?: string): Promise<any[]> {
    if (!this.prisma) {
      return [];
    }

    try {
      return await this.prisma.paymentSecretRotation.findMany({
        where: secretType ? { secretType } : {},
        select: {
          id: true,
          secretType: true,
          isActive: true,
          validFrom: true,
          validUntil: true,
          rotationReason: true,
          createdBy: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Failed to get rotation history:', error);
      return [];
    }
  }

  /**
   * Checks if secret rotation is needed
   */
  async needsRotation(secretType: string, maxAgeHours: number = 24 * 30): Promise<boolean> {
    if (!this.prisma) {
      return false;
    }

    try {
      const latestSecret = await this.prisma.paymentSecretRotation.findFirst({
        where: {
          secretType,
          isActive: true,
        },
        orderBy: { validFrom: 'desc' },
      });

      if (!latestSecret) {
        return true; // No secrets found, rotation needed
      }

      const ageHours = (Date.now() - latestSecret.validFrom.getTime()) / (1000 * 60 * 60);
      return ageHours > maxAgeHours;
    } catch (error) {
      console.error('Failed to check rotation need:', error);
      return false;
    }
  }

  /**
   * Schedules automatic secret rotation
   */
  async scheduleRotation(): Promise<void> {
    // Check every 24 hours
    setInterval(async () => {
      try {
        const secretTypes: Array<'razorpay_key' | 'webhook_secret'> = ['razorpay_key', 'webhook_secret'];
        
        for (const secretType of secretTypes) {
          if (await this.needsRotation(secretType)) {
            console.log(`Secret rotation needed for ${secretType}`);
            // In production, this would trigger an alert or automated rotation
          }
        }

        // Cleanup expired secrets
        await this.cleanupExpiredSecrets();
      } catch (error) {
        console.error('Scheduled rotation check failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }
}