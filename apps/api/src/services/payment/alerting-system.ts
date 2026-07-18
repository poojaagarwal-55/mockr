import { PrismaClient } from '@prisma/client';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertType =
  | 'webhook_processing_failure'
  | 'signature_verification_failure'
  | 'reconciliation_failure'
  | 'financial_discrepancy'
  | 'dependency_failure'
  | 'zombie_payment_detected'
  | 'bank_reversal_detected'
  | 'abuse_pattern_detected'
  | 'settlement_mismatch'
  | 'high_failure_rate'
  | 'system_degraded';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata: Record<string, any>;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

export interface AlertRule {
  type: AlertType;
  severity: AlertSeverity;
  threshold?: number;
  windowMinutes?: number;
  enabled: boolean;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'log';
  config: Record<string, any>;
  enabled: boolean;
}

export class AlertingSystem {
  private readonly prisma: PrismaClient;
  private readonly rules: Map<AlertType, AlertRule>;
  private readonly channels: AlertChannel[];

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.rules = this.initializeRules();
    this.channels = this.initializeChannels();
  }

  private initializeRules(): Map<AlertType, AlertRule> {
    const rules = new Map<AlertType, AlertRule>();

    // Critical alerts
    rules.set('webhook_processing_failure', {
      type: 'webhook_processing_failure',
      severity: 'critical',
      threshold: 5, // 5 failures in window
      windowMinutes: 15,
      enabled: true,
    });

    rules.set('signature_verification_failure', {
      type: 'signature_verification_failure',
      severity: 'critical',
      threshold: 10, // 10 failures in window
      windowMinutes: 5,
      enabled: true,
    });

    rules.set('reconciliation_failure', {
      type: 'reconciliation_failure',
      severity: 'critical',
      threshold: 1, // Any failure
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('financial_discrepancy', {
      type: 'financial_discrepancy',
      severity: 'critical',
      threshold: 1, // Any discrepancy
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('dependency_failure', {
      type: 'dependency_failure',
      severity: 'critical',
      threshold: 1, // Any dependency down
      windowMinutes: 5,
      enabled: true,
    });

    // Warning alerts
    rules.set('zombie_payment_detected', {
      type: 'zombie_payment_detected',
      severity: 'warning',
      threshold: 1,
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('bank_reversal_detected', {
      type: 'bank_reversal_detected',
      severity: 'warning',
      threshold: 1,
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('abuse_pattern_detected', {
      type: 'abuse_pattern_detected',
      severity: 'warning',
      threshold: 5,
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('settlement_mismatch', {
      type: 'settlement_mismatch',
      severity: 'warning',
      threshold: 1,
      windowMinutes: 60,
      enabled: true,
    });

    rules.set('high_failure_rate', {
      type: 'high_failure_rate',
      severity: 'warning',
      threshold: 20, // 20% failure rate
      windowMinutes: 60,
      enabled: true,
    });

    // Info alerts
    rules.set('system_degraded', {
      type: 'system_degraded',
      severity: 'info',
      threshold: 1,
      windowMinutes: 15,
      enabled: true,
    });

    return rules;
  }

  private initializeChannels(): AlertChannel[] {
    const channels: AlertChannel[] = [];

    // Always log alerts
    channels.push({
      type: 'log',
      config: {},
      enabled: true,
    });

    // Email channel (if configured)
    if (process.env.ALERT_EMAIL_TO) {
      channels.push({
        type: 'email',
        config: {
          to: process.env.ALERT_EMAIL_TO,
          from: process.env.ALERT_EMAIL_FROM || 'alerts@mockr.com',
        },
        enabled: true,
      });
    }

    // Slack channel (if configured)
    if (process.env.ALERT_SLACK_WEBHOOK_URL) {
      channels.push({
        type: 'slack',
        config: {
          webhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
        },
        enabled: true,
      });
    }

    // Custom webhook channel (if configured)
    if (process.env.ALERT_WEBHOOK_URL) {
      channels.push({
        type: 'webhook',
        config: {
          url: process.env.ALERT_WEBHOOK_URL,
          headers: {
            'Content-Type': 'application/json',
            Authorization: process.env.ALERT_WEBHOOK_AUTH || '',
          },
        },
        enabled: true,
      });
    }

    return channels;
  }

  async triggerAlert(
    type: AlertType,
    title: string,
    message: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const rule = this.rules.get(type);
    if (!rule || !rule.enabled) {
      return;
    }

    // Check if we should trigger based on threshold
    if (rule.threshold && rule.windowMinutes) {
      const shouldTrigger = await this.checkThreshold(
        type,
        rule.threshold,
        rule.windowMinutes
      );
      if (!shouldTrigger) {
        return;
      }
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      type,
      severity: rule.severity,
      title,
      message,
      metadata,
      timestamp: new Date(),
      acknowledged: false,
    };

    // Send to all enabled channels
    await Promise.all(
      this.channels
        .filter((channel) => channel.enabled)
        .map((channel) => this.sendToChannel(alert, channel))
    );

    // Store alert in database (if you want to track alerts)
    await this.storeAlert(alert);
  }

  private async checkThreshold(
    type: AlertType,
    threshold: number,
    windowMinutes: number
  ): Promise<boolean> {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    // Count recent occurrences based on alert type
    let count = 0;

    switch (type) {
      case 'webhook_processing_failure':
        count = await this.prisma.payment_webhook_events.count({
          where: {
            processingError: { not: null },
            createdAt: { gte: windowStart },
          },
        });
        break;

      case 'signature_verification_failure':
        // This would need a separate tracking table
        // For now, return true to always trigger
        return true;

      case 'zombie_payment_detected':
        count = await this.prisma.zombiePaymentRecord.count({
          where: {
            createdAt: { gte: windowStart },
            manualReviewRequired: true,
          },
        });
        break;

      case 'bank_reversal_detected':
        count = await this.prisma.payment.count({
          where: {
            bankReversalDetected: true,
            bankReversalDate: { gte: windowStart },
          },
        });
        break;

      case 'abuse_pattern_detected':
        count = await this.prisma.userPaymentAttempt.count({
          where: {
            suspiciousPattern: true,
            createdAt: { gte: windowStart },
          },
        });
        break;

      default:
        return true; // Always trigger for other types
    }

    return count >= threshold;
  }

  private async sendToChannel(alert: Alert, channel: AlertChannel): Promise<void> {
    try {
      switch (channel.type) {
        case 'log':
          this.sendToLog(alert);
          break;
        case 'email':
          await this.sendToEmail(alert, channel.config);
          break;
        case 'slack':
          await this.sendToSlack(alert, channel.config);
          break;
        case 'webhook':
          await this.sendToWebhook(alert, channel.config);
          break;
      }
    } catch (error) {
      console.error(`Failed to send alert to ${channel.type}:`, error);
    }
  }

  private sendToLog(alert: Alert): void {
    const logLevel = alert.severity === 'critical' ? 'error' : 'warn';
    console[logLevel](`[ALERT] ${alert.title}`, {
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      metadata: alert.metadata,
      timestamp: alert.timestamp,
    });
  }

  private async sendToEmail(alert: Alert, config: Record<string, any>): Promise<void> {
    // Email sending implementation would go here
    // For now, just log that we would send an email
    console.log(`[EMAIL ALERT] Would send email to ${config.to}:`, {
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      body: alert.message,
    });

    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    // Example:
    // await emailService.send({
    //   to: config.to,
    //   from: config.from,
    //   subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
    //   html: this.formatEmailBody(alert),
    // });
  }

  private async sendToSlack(alert: Alert, config: Record<string, any>): Promise<void> {
    const color = {
      critical: '#FF0000',
      warning: '#FFA500',
      info: '#0000FF',
    }[alert.severity];

    const payload = {
      attachments: [
        {
          color,
          title: alert.title,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Type',
              value: alert.type,
              short: true,
            },
            {
              title: 'Timestamp',
              value: alert.timestamp.toISOString(),
              short: false,
            },
          ],
          footer: 'Payment System Alerts',
          ts: Math.floor(alert.timestamp.getTime() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }

  private async sendToWebhook(
    alert: Alert,
    config: Record<string, any>
  ): Promise<void> {
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send webhook alert:', error);
    }
  }

  private async storeAlert(alert: Alert): Promise<void> {
    // Store alert in a dedicated alerts table (if you create one)
    // For now, just log to audit system
    console.log('[ALERT STORED]', alert);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Helper methods for common alert scenarios

  async alertWebhookFailure(webhookEventId: string, error: string): Promise<void> {
    await this.triggerAlert(
      'webhook_processing_failure',
      'Webhook Processing Failed',
      `Failed to process webhook event: ${error}`,
      { webhookEventId, error }
    );
  }

  async alertSignatureFailure(signature: string, source: string): Promise<void> {
    await this.triggerAlert(
      'signature_verification_failure',
      'Signature Verification Failed',
      `Invalid signature detected from ${source}`,
      { source, signaturePrefix: signature.substring(0, 10) }
    );
  }

  async alertReconciliationFailure(jobId: string, error: string): Promise<void> {
    await this.triggerAlert(
      'reconciliation_failure',
      'Reconciliation Job Failed',
      `Reconciliation job ${jobId} failed: ${error}`,
      { jobId, error }
    );
  }

  async alertFinancialDiscrepancy(
    type: string,
    expected: number,
    actual: number
  ): Promise<void> {
    await this.triggerAlert(
      'financial_discrepancy',
      'Financial Discrepancy Detected',
      `${type}: Expected ${expected}, but found ${actual}`,
      { type, expected, actual, difference: actual - expected }
    );
  }

  async alertDependencyFailure(dependency: string, error: string): Promise<void> {
    await this.triggerAlert(
      'dependency_failure',
      `${dependency} Dependency Failed`,
      `Critical dependency ${dependency} is down: ${error}`,
      { dependency, error }
    );
  }

  async alertZombiePayment(paymentId: string, ageHours: number): Promise<void> {
    await this.triggerAlert(
      'zombie_payment_detected',
      'Zombie Payment Detected',
      `Payment ${paymentId} has been stuck for ${ageHours} hours`,
      { paymentId, ageHours }
    );
  }

  async alertBankReversal(paymentId: string, amount: number): Promise<void> {
    await this.triggerAlert(
      'bank_reversal_detected',
      'Bank Reversal Detected',
      `Payment ${paymentId} (₹${amount / 100}) was reversed by bank`,
      { paymentId, amount }
    );
  }

  async alertAbusePattern(userId: string, patternType: string): Promise<void> {
    await this.triggerAlert(
      'abuse_pattern_detected',
      'Abuse Pattern Detected',
      `User ${userId} showing suspicious pattern: ${patternType}`,
      { userId, patternType }
    );
  }

  async alertSettlementMismatch(
    paymentId: string,
    capturedAmount: number,
    settledAmount: number
  ): Promise<void> {
    await this.triggerAlert(
      'settlement_mismatch',
      'Settlement Mismatch Detected',
      `Payment ${paymentId}: Captured ₹${capturedAmount / 100}, Settled ₹${settledAmount / 100}`,
      { paymentId, capturedAmount, settledAmount }
    );
  }

  async alertHighFailureRate(failureRate: number, period: string): Promise<void> {
    await this.triggerAlert(
      'high_failure_rate',
      'High Payment Failure Rate',
      `Payment failure rate is ${failureRate.toFixed(2)}% in the last ${period}`,
      { failureRate, period }
    );
  }

  async alertSystemDegraded(component: string, reason: string): Promise<void> {
    await this.triggerAlert(
      'system_degraded',
      'System Performance Degraded',
      `${component} is experiencing degraded performance: ${reason}`,
      { component, reason }
    );
  }
}
