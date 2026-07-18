// Currency Precision Handler - Edge Case 4 Implementation
// Handles ₹99.99 → 9999 paise mismatches and frontend vs backend validation

import { CurrencyValidationResult, CurrencyPrecisionError } from '../types.js';
import { PAYMENT_CONSTANTS } from '../config.js';

export class CurrencyPrecisionHandler {
  /**
   * Validates currency conversion from frontend amount to backend amount
   * Prevents precision loss and validates conversion accuracy
   */
  validateCurrencyConversion(
    frontendAmount: number,
    currency: string = 'INR'
  ): CurrencyValidationResult {
    const precision = PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
    const multiplier = Math.pow(10, precision);
    
    // Convert frontend amount to smallest currency unit
    const backendAmount = Math.round(frontendAmount * multiplier);
    
    // Validate precision by converting back
    const reconvertedAmount = backendAmount / multiplier;
    const precisionLoss = Math.abs(frontendAmount - reconvertedAmount);
    
    // Allow for minimal floating point errors (0.001)
    if (precisionLoss > 0.001) {
      return {
        valid: false,
        error: `Precision loss detected in currency conversion: ${precisionLoss}`,
        frontendAmount,
        backendAmount,
        precisionLoss,
      };
    }

    // Additional validation for edge cases
    if (backendAmount <= 0) {
      return {
        valid: false,
        error: 'Converted amount must be greater than zero',
        frontendAmount,
        backendAmount,
      };
    }

    // Check for unreasonably large amounts (potential overflow)
    if (backendAmount > Number.MAX_SAFE_INTEGER) {
      return {
        valid: false,
        error: 'Amount too large for safe processing',
        frontendAmount,
        backendAmount,
      };
    }

    return {
      valid: true,
      frontendAmount,
      backendAmount,
      precision,
      conversionValidated: true,
    };
  }

  /**
   * Validates backend amount for consistency
   */
  validateBackendAmount(
    backendAmount: number,
    currency: string = 'INR'
  ): CurrencyValidationResult {
    const precision = PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
    const multiplier = Math.pow(10, precision);
    
    // Convert to frontend amount for validation
    const frontendAmount = backendAmount / multiplier;
    
    if (backendAmount <= 0) {
      return {
        valid: false,
        error: 'Amount must be greater than zero',
        frontendAmount,
        backendAmount,
      };
    }

    if (!Number.isInteger(backendAmount)) {
      return {
        valid: false,
        error: 'Backend amount must be an integer (smallest currency unit)',
        frontendAmount,
        backendAmount,
      };
    }

    return {
      valid: true,
      frontendAmount,
      backendAmount,
      precision,
      conversionValidated: true,
    };
  }

  /**
   * Converts amount between different currencies (if needed in future)
   */
  convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ): CurrencyValidationResult {
    // For now, we only support same-currency validation
    if (fromCurrency !== toCurrency) {
      return {
        valid: false,
        error: 'Cross-currency conversion not supported',
        frontendAmount: amount,
        backendAmount: amount,
      };
    }

    return this.validateBackendAmount(amount, fromCurrency);
  }

  /**
   * Validates payment amount for specific currency rules
   */
  validatePaymentAmount(
    amount: number,
    currency: string = 'INR'
  ): void {
    const validation = this.validateBackendAmount(amount, currency);
    
    if (!validation.valid) {
      throw new CurrencyPrecisionError(validation.error!);
    }

    // Currency-specific validations
    switch (currency) {
      case 'INR':
        // Minimum amount for INR (₹1.00 = 100 paise)
        if (amount < 100) {
          throw new CurrencyPrecisionError('Minimum amount for INR is ₹1.00');
        }
        // Maximum amount for INR (₹1,00,000 = 10,000,000 paise)
        if (amount > 10000000) {
          throw new CurrencyPrecisionError('Maximum amount for INR is ₹1,00,000');
        }
        break;
        
      case 'USD':
        // Minimum amount for USD ($0.50 = 50 cents)
        if (amount < 50) {
          throw new CurrencyPrecisionError('Minimum amount for USD is $0.50');
        }
        break;
        
      case 'JPY':
        // JPY has no decimal places
        if (amount < 1) {
          throw new CurrencyPrecisionError('Minimum amount for JPY is ¥1');
        }
        break;
    }
  }

  /**
   * Formats amount for display based on currency
   */
  formatAmount(amount: number, currency: string = 'INR'): string {
    const precision = PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
    const multiplier = Math.pow(10, precision);
    const displayAmount = amount / multiplier;

    switch (currency) {
      case 'INR':
        return `₹${displayAmount.toFixed(precision)}`;
      case 'USD':
        return `$${displayAmount.toFixed(precision)}`;
      case 'EUR':
        return `€${displayAmount.toFixed(precision)}`;
      case 'JPY':
        return `¥${displayAmount.toFixed(0)}`;
      case 'KWD':
      case 'BHD':
      case 'OMR':
        return `${displayAmount.toFixed(3)} ${currency}`;
      default:
        return `${displayAmount.toFixed(precision)} ${currency}`;
    }
  }

  /**
   * Parses amount from string with currency validation
   */
  parseAmount(amountString: string, currency: string = 'INR'): number {
    // Remove currency symbols and whitespace
    const cleanAmount = amountString
      .replace(/[₹$€¥,\s]/g, '')
      .trim();

    const parsedAmount = parseFloat(cleanAmount);
    
    if (isNaN(parsedAmount)) {
      throw new CurrencyPrecisionError('Invalid amount format');
    }

    const precision = PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
    const multiplier = Math.pow(10, precision);
    
    return Math.round(parsedAmount * multiplier);
  }

  /**
   * Validates amount precision for specific currency
   */
  validateAmountPrecision(amount: number, currency: string = 'INR'): boolean {
    const precision = PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
    const multiplier = Math.pow(10, precision);
    const displayAmount = amount / multiplier;
    const reconstructedAmount = Math.round(displayAmount * multiplier);
    
    return reconstructedAmount === amount;
  }

  /**
   * Gets supported currencies
   */
  getSupportedCurrencies(): string[] {
    return Object.keys(PAYMENT_CONSTANTS.CURRENCY_PRECISION);
  }

  /**
   * Gets currency precision
   */
  getCurrencyPrecision(currency: string): number {
    return PAYMENT_CONSTANTS.CURRENCY_PRECISION[currency as keyof typeof PAYMENT_CONSTANTS.CURRENCY_PRECISION] || 2;
  }
}