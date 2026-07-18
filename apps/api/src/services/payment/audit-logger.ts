// Audit Logger - Immutable audit logging with hash chains for compliance
// Implements Edge Case 12: Compliance/Legal Logging with tamper-proof audit trails

import { PrismaClient } from '@interviewforge/db';
import { createHash } from 'crypto';
import { PaymentAuditEvent, AuditRecord, IntegrityCheckResult, IntegrityIssue } from './types.js';
import { PAYMENT_CONSTANTS } from './config.js';

type HashableAuditRecord = Pick<
  AuditRecord,
  'sequence' | 'timestamp' | 'eventType' | 'paymentId' | 'userId' | 'data' | 'previousHash'
>;

export class AuditLogger {
  private readonly prisma: PrismaClient;
  private auditSequence: number = 0;
  private readonly sequenceInitialized: Promise<void>;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.sequenceInitialized = this.initializeSequence();
  }

  /**
   * Initialize audit sequence from database
   */
  private async initializeSequence(): Promise<void> {
    try {
      const lastAuditLog = await this.prisma.payment_audit_logs.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      
      this.auditSequence = lastAuditLog ? lastAuditLog.sequence : 0;
    } catch (error) {
      console.error('Failed to initialize audit sequence:', error);
      this.auditSequence = 0;
    }
  }

  /**
   * Logs payment event with tamper-proof hash chain
   */
  async logPaymentEvent(event: PaymentAuditEvent): Promise<void> {
    try {
      await this.sequenceInitialized;

      const auditRecord = await this.createAuditRecord(event);
      
      // Store in append-only table
      await this.prisma.payment_audit_logs.create({
        data: {
          paymentId: auditRecord.paymentId,
          eventType: auditRecord.eventType,
          eventData: auditRecord.data as any,
          sequence: auditRecord.sequence,
          previousHash: auditRecord.previousHash,
          hash: auditRecord.hash,
          sanitizedData: auditRecord.sanitizedData as any,
          userId: auditRecord.userId,
          sessionId: this.extractSessionId(auditRecord.data),
          clientIp: this.maskIpAddress(this.extractClientIp(auditRecord.data)),
          userAgent: this.hashUserAgent(this.extractUserAgent(auditRecord.data)),
        },
      });

      console.log(`Audit log created: ${auditRecord.eventType} for payment ${auditRecord.paymentId}`);
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't throw - audit logging should not break payment flow
    }
  }

  /**
   * Creates audit record with hash chain
   */
  private async createAuditRecord(event: PaymentAuditEvent): Promise<AuditRecord> {
    const sequence = ++this.auditSequence;
    const previousHash = await this.getLatestHash();
    
    const record: HashableAuditRecord = {
      sequence,
      timestamp: new Date().toISOString(),
      eventType: event.type,
      paymentId: event.paymentId,
      userId: this.maskUserId(event.userId),
      data: event.data || {},
      previousHash,
    };

    // Calculate tamper-proof hash
    const hash = this.calculateRecordHash(record);
    
    return {
      ...record,
      hash,
      sanitizedData: this.sanitizeEventData(event.data || {}),
    };
  }

  /**
   * Calculates tamper-proof hash for audit record
   */
  private calculateRecordHash(record: HashableAuditRecord): string {
    const hashInput = [
      record.sequence,
      record.timestamp,
      record.eventType,
      record.paymentId,
      record.userId,
      JSON.stringify(record.data),
      record.previousHash || '',
    ].join('|');

    return createHash(PAYMENT_CONSTANTS.HASH_ALGORITHM)
      .update(hashInput)
      .digest('hex');
  }

  /**
   * Gets the latest hash from the chain
   */
  private async getLatestHash(): Promise<string | null> {
    try {
      const latestRecord = await this.prisma.payment_audit_logs.findFirst({
        orderBy: { sequence: 'desc' },
        select: { hash: true },
      });
      
      return latestRecord?.hash || null;
    } catch (error) {
      console.error('Failed to get latest hash:', error);
      return null;
    }
  }

  /**
   * Verifies audit integrity by checking hash chain
   */
  async verifyAuditIntegrity(fromSequence?: number): Promise<IntegrityCheckResult> {
    try {
      const records = await this.prisma.payment_audit_logs.findMany({
        where: fromSequence ? { sequence: { gte: fromSequence } } : {},
        orderBy: { sequence: 'asc' },
      });

      const issues: IntegrityIssue[] = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        // Verify hash
        const expectedHash = this.calculateRecordHash({
          sequence: record.sequence,
          timestamp: record.createdAt.toISOString(),
          eventType: record.eventType,
          paymentId: record.paymentId,
          userId: record.userId || '',
          data: this.normalizeEventData(record.eventData),
          previousHash: record.previousHash,
        });

        if (record.hash !== expectedHash) {
          issues.push({
            sequence: record.sequence,
            type: 'hash_mismatch',
            expected: expectedHash,
            actual: record.hash,
          });
        }

        // Verify chain continuity
        if (i > 0 && record.previousHash !== records[i - 1].hash) {
          issues.push({
            sequence: record.sequence,
            type: 'chain_break',
            expected: records[i - 1].hash,
            actual: record.previousHash || '',
          });
        }
      }

      return {
        verified: issues.length === 0,
        recordsChecked: records.length,
        issues,
      };
    } catch (error) {
      console.error('Audit integrity verification failed:', error);
      return {
        verified: false,
        recordsChecked: 0,
        issues: [],
      };
    }
  }

  /**
   * Sanitizes event data by removing sensitive information
   */
  private sanitizeEventData(data: any): any {
    const sanitized = { ...data };
    
    // Remove or mask sensitive fields
    if (sanitized.razorpaySignature) {
      sanitized.razorpaySignature = sanitized.razorpaySignature.substring(0, 8) + '...';
    }
    
    if (sanitized.clientIp) {
      sanitized.clientIp = this.maskIpAddress(sanitized.clientIp);
    }
    
    if (sanitized.userAgent) {
      sanitized.userAgent = this.hashUserAgent(sanitized.userAgent);
    }

    if (sanitized.razorpayKeySecret) {
      delete sanitized.razorpayKeySecret;
    }

    if (sanitized.webhookSecret) {
      delete sanitized.webhookSecret;
    }

    // Remove any field that might contain PII
    const piiFields = ['email', 'phone', 'contact', 'name', 'address'];
    piiFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Ensures DB JSON values are normalized for hashing logic.
   */
  private normalizeEventData(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }

    return { value };
  }

  /**
   * Masks user ID for privacy while keeping it useful for debugging
   */
  private maskUserId(userId: string): string {
    if (!userId) return '';
    
    // Keep first 8 characters for debugging, hash the rest
    return userId.substring(0, 8) + '...' + 
           createHash('sha256').update(userId).digest('hex').substring(0, 8);
  }

  /**
   * Masks IP address for privacy
   */
  private maskIpAddress(ip?: string): string | undefined {
    if (!ip) return undefined;
    
    // For IPv4, mask last octet: 192.168.1.xxx
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }
    
    // For IPv6, mask last 64 bits
    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length >= 4) {
        return parts.slice(0, 4).join(':') + '::xxxx';
      }
    }
    
    return 'xxx.xxx.xxx.xxx';
  }

  /**
   * Hashes user agent for privacy while maintaining uniqueness
   */
  private hashUserAgent(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    
    return createHash('sha256').update(userAgent).digest('hex').substring(0, 16);
  }

  /**
   * Extracts session ID from event data
   */
  private extractSessionId(data: any): string | undefined {
    return data.sessionId || data.session_id;
  }

  /**
   * Extracts client IP from event data
   */
  private extractClientIp(data: any): string | undefined {
    return data.clientIp || data.client_ip || data.ip;
  }

  /**
   * Extracts user agent from event data
   */
  private extractUserAgent(data: any): string | undefined {
    return data.userAgent || data.user_agent;
  }

  /**
   * Gets audit logs for a specific payment
   */
  async getPaymentAuditLogs(paymentId: string): Promise<any[]> {
    try {
      return await this.prisma.payment_audit_logs.findMany({
        where: { paymentId },
        orderBy: { sequence: 'asc' },
      });
    } catch (error) {
      console.error('Failed to get payment audit logs:', error);
      return [];
    }
  }

  /**
   * Gets audit logs within a date range
   */
  async getAuditLogsByDateRange(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      return await this.prisma.payment_audit_logs.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { sequence: 'asc' },
      });
    } catch (error) {
      console.error('Failed to get audit logs by date range:', error);
      return [];
    }
  }

  /**
   * Archives old audit logs (for compliance with retention policies)
   */
  async archiveOldLogs(retentionDays: number = 2555): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // In a real implementation, you would move these to cold storage
      // For now, we'll just count them
      const oldLogs = await this.prisma.payment_audit_logs.count({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      console.log(`Found ${oldLogs} audit logs older than ${retentionDays} days for archival`);
      return oldLogs;
    } catch (error) {
      console.error('Failed to archive old logs:', error);
      return 0;
    }
  }

  /**
   * Gets audit statistics
   */
  async getAuditStatistics(): Promise<{
    totalRecords: number;
    recordsByEventType: Record<string, number>;
    oldestRecord: Date | null;
    newestRecord: Date | null;
    integrityStatus: 'verified' | 'issues_found' | 'not_checked';
  }> {
    try {
      const [totalRecords, recordsByType, oldestRecord, newestRecord] = await Promise.all([
        this.prisma.payment_audit_logs.count(),
        this.prisma.payment_audit_logs.groupBy({
          by: ['eventType'],
          _count: { eventType: true },
        }),
        this.prisma.payment_audit_logs.findFirst({
          orderBy: { sequence: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.payment_audit_logs.findFirst({
          orderBy: { sequence: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      const recordsByEventType = recordsByType.reduce((acc, item) => {
        acc[item.eventType] = item._count.eventType;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalRecords,
        recordsByEventType,
        oldestRecord: oldestRecord?.createdAt || null,
        newestRecord: newestRecord?.createdAt || null,
        integrityStatus: 'not_checked', // Would be set by periodic integrity checks
      };
    } catch (error) {
      console.error('Failed to get audit statistics:', error);
      return {
        totalRecords: 0,
        recordsByEventType: {},
        oldestRecord: null,
        newestRecord: null,
        integrityStatus: 'not_checked',
      };
    }
  }
}