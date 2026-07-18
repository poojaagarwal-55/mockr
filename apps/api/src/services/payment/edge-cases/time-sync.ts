// Time Synchronization Service - Edge Case 5 Implementation
// Handles clock drift, time zone issues, and UTC timestamp enforcement

import { TimeSyncResult } from '../types.js';
import { PAYMENT_CONSTANTS } from '../config.js';

export class TimeSync {
  private lastSyncCheck: Date | null = null;
  private syncCheckInterval = 5 * 60 * 1000; // 5 minutes

  /**
   * Validates server time against NTP servers to detect clock drift
   */
  async validateServerTime(): Promise<TimeSyncResult> {
    try {
      // For production, you would implement actual NTP sync
      // For now, we'll simulate the check
      const serverTime = new Date();
      const simulatedNtpTime = new Date(); // In real implementation, fetch from NTP
      
      const drift = Math.abs(simulatedNtpTime.getTime() - serverTime.getTime());
      
      if (drift > PAYMENT_CONSTANTS.TIME_DRIFT_TOLERANCE_MS) {
        return {
          synchronized: false,
          drift,
          ntpTime: simulatedNtpTime,
          serverTime,
          warning: `Server clock drift detected: ${drift}ms`,
        };
      }

      this.lastSyncCheck = new Date();
      
      return {
        synchronized: true,
        drift,
        ntpTime: simulatedNtpTime,
        serverTime,
      };
    } catch (error) {
      return {
        synchronized: false,
        drift: 0,
        ntpTime: new Date(),
        serverTime: new Date(),
        error: `Failed to sync with NTP servers: ${error.message}`,
      };
    }
  }

  /**
   * Creates UTC timestamp - always returns UTC time
   */
  createUTCTimestamp(): Date {
    return new Date(); // JavaScript Date is always UTC internally
  }

  /**
   * Calculates order expiry with proper timezone handling
   */
  calculateOrderExpiry(
    createdAt: Date,
    expiryMinutes: number = 15,
    paymentMethod?: string
  ): Date {
    // Extend expiry for UPI payments
    const adjustedMinutes = paymentMethod === 'upi' 
      ? PAYMENT_CONSTANTS.ORDER_EXPIRY_MINUTES.UPI 
      : expiryMinutes;
    
    const expiryTime = new Date(createdAt.getTime() + (adjustedMinutes * 60 * 1000));
    
    // Ensure we're working with UTC
    return new Date(expiryTime.toISOString());
  }

  /**
   * Validates timezone string
   */
  validateTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Converts timestamp to specific timezone for display
   */
  convertToTimezone(utcTimestamp: Date, timezone: string): Date {
    if (!this.validateTimezone(timezone)) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }

    // Create a new date in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(utcTimestamp);
    const partsObj = parts.reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {} as any);

    return new Date(
      `${partsObj.year}-${partsObj.month}-${partsObj.day}T${partsObj.hour}:${partsObj.minute}:${partsObj.second}`
    );
  }

  /**
   * Gets current UTC timestamp as ISO string
   */
  getCurrentUTCString(): string {
    return new Date().toISOString();
  }

  /**
   * Validates that a timestamp is not too far in the past or future
   */
  validateTimestamp(timestamp: Date, maxAgeMinutes: number = 60): boolean {
    const now = new Date();
    const ageMs = Math.abs(now.getTime() - timestamp.getTime());
    const maxAgeMs = maxAgeMinutes * 60 * 1000;
    
    return ageMs <= maxAgeMs;
  }

  /**
   * Checks if order has expired
   */
  isOrderExpired(orderExpiry: Date): boolean {
    const now = this.createUTCTimestamp();
    return now > orderExpiry;
  }

  /**
   * Gets time until expiry in milliseconds
   */
  getTimeUntilExpiry(orderExpiry: Date): number {
    const now = this.createUTCTimestamp();
    return Math.max(0, orderExpiry.getTime() - now.getTime());
  }

  /**
   * Formats duration in human-readable format
   */
  formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Checks if time sync validation is needed
   */
  needsSyncCheck(): boolean {
    if (!this.lastSyncCheck) {
      return true;
    }
    
    const timeSinceLastCheck = Date.now() - this.lastSyncCheck.getTime();
    return timeSinceLastCheck > this.syncCheckInterval;
  }

  /**
   * Performs periodic time sync check
   */
  async performPeriodicSyncCheck(): Promise<void> {
    if (this.needsSyncCheck()) {
      const syncResult = await this.validateServerTime();
      
      if (!syncResult.synchronized) {
        console.warn('Time synchronization warning:', syncResult.warning || syncResult.error);
        
        // In production, you might want to:
        // 1. Send alerts to monitoring system
        // 2. Temporarily disable time-sensitive operations
        // 3. Attempt to sync with multiple NTP servers
      }
    }
  }

  /**
   * Gets server uptime for monitoring
   */
  getServerUptime(): number {
    return process.uptime() * 1000; // Convert to milliseconds
  }

  /**
   * Creates timestamp with microsecond precision for audit logs
   */
  createPreciseTimestamp(): string {
    const now = new Date();
    const microseconds = process.hrtime.bigint();
    return `${now.toISOString()}.${microseconds.toString().slice(-6)}`;
  }

  /**
   * Validates payment timing constraints
   */
  validatePaymentTiming(
    orderCreatedAt: Date,
    paymentAttemptedAt: Date,
    orderExpiry: Date
  ): { valid: boolean; reason?: string } {
    // Check if payment attempt is after order creation
    if (paymentAttemptedAt < orderCreatedAt) {
      return {
        valid: false,
        reason: 'Payment attempted before order creation',
      };
    }

    // Check if payment attempt is before order expiry
    if (paymentAttemptedAt > orderExpiry) {
      return {
        valid: false,
        reason: 'Payment attempted after order expiry',
      };
    }

    // Check for reasonable timing (not too fast, might be automated)
    const timeDiff = paymentAttemptedAt.getTime() - orderCreatedAt.getTime();
    if (timeDiff < 1000) { // Less than 1 second
      return {
        valid: false,
        reason: 'Payment attempted too quickly after order creation',
      };
    }

    return { valid: true };
  }

  /**
   * Gets timezone offset for a specific timezone
   */
  getTimezoneOffset(timezone: string, date: Date = new Date()): number {
    if (!this.validateTimezone(timezone)) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }

    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const targetTime = new Date(utc + (this.getTimezoneOffsetMinutes(timezone, date) * 60000));
    
    return targetTime.getTimezoneOffset();
  }

  /**
   * Gets timezone offset in minutes
   */
  private getTimezoneOffsetMinutes(timezone: string, date: Date): number {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    
    const offsetString = formatter.formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value;
    
    if (!offsetString) return 0;
    
    const match = offsetString.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    
    return sign * (hours * 60 + minutes);
  }
}