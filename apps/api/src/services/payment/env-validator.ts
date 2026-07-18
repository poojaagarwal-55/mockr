import { z } from 'zod';

const paymentEnvSchema = z.object({
  // Razorpay
  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1, 'RAZORPAY_WEBHOOK_SECRET is required'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').optional(),

  // Encryption
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be valid hex'),
  PAYMENT_ENCRYPTION_KEY: z
    .string()
    .length(64, 'PAYMENT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .regex(/^[0-9a-f]{64}$/i, 'PAYMENT_ENCRYPTION_KEY must be valid hex'),

  // Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // App Config
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  API_PORT: z.string().regex(/^\d+$/, 'API_PORT must be a number').optional(),

  // Optional: Alerting
  ALERT_EMAIL_TO: z.string().email().optional(),
  ALERT_EMAIL_FROM: z.string().email().optional(),
  ALERT_SLACK_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_AUTH: z.string().optional(),

  // Optional: File Storage
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
});

export type PaymentEnv = z.infer<typeof paymentEnvSchema>;

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  env?: PaymentEnv;
}

export class EnvValidator {
  validate(): ValidationResult {
    try {
      const env = paymentEnvSchema.parse(process.env);
      const warnings = this.checkWarnings(env);

      return {
        valid: true,
        env,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map((err) => {
          const path = err.path.join('.');
          return `${path}: ${err.message}`;
        });

        return {
          valid: false,
          errors,
        };
      }

      return {
        valid: false,
        errors: ['Unknown validation error'],
      };
    }
  }

  private checkWarnings(env: PaymentEnv): string[] {
    const warnings: string[] = [];

    // Check if using test keys in production
    if (env.NODE_ENV === 'production') {
      if (env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
        warnings.push(
          'WARNING: Using Razorpay test keys in production environment!'
        );
      }

      if (env.JWT_SECRET.length < 64) {
        warnings.push(
          'WARNING: JWT_SECRET should be at least 64 characters in production'
        );
      }
    }

    // Check if Redis is configured
    if (!env.REDIS_URL) {
      warnings.push(
        'WARNING: REDIS_URL not configured. Rate limiting will use in-memory storage (not recommended for production)'
      );
    }

    // Check if alerting is configured
    if (
      !env.ALERT_EMAIL_TO &&
      !env.ALERT_SLACK_WEBHOOK_URL &&
      !env.ALERT_WEBHOOK_URL
    ) {
      warnings.push(
        'WARNING: No alerting channels configured. Critical alerts will only be logged.'
      );
    }

    // Check if file storage is configured
    if (!env.S3_ENDPOINT || !env.S3_BUCKET) {
      warnings.push(
        'INFO: S3 storage not configured. Receipt/invoice storage will be disabled.'
      );
    }

    return warnings;
  }

  validateOrThrow(): PaymentEnv {
    const result = this.validate();

    if (!result.valid) {
      const errorMessage = [
        'Payment system environment validation failed:',
        '',
        ...(result.errors || []),
        '',
        'Please check your .env file and ensure all required variables are set.',
      ].join('\n');

      throw new Error(errorMessage);
    }

    if (result.warnings && result.warnings.length > 0) {
      console.warn('\n⚠️  Environment Warnings:');
      result.warnings.forEach((warning) => console.warn(`  - ${warning}`));
      console.warn('');
    }

    console.log('✅ Payment system environment validation passed');

    return result.env!;
  }

  printValidationReport(): void {
    const result = this.validate();

    console.log('\n=== Payment System Environment Validation ===\n');

    if (result.valid) {
      console.log('✅ Status: VALID\n');

      if (result.warnings && result.warnings.length > 0) {
        console.log('⚠️  Warnings:');
        result.warnings.forEach((warning) => console.log(`  - ${warning}`));
        console.log('');
      }

      console.log('Required Variables:');
      console.log('  ✅ RAZORPAY_KEY_ID');
      console.log('  ✅ RAZORPAY_KEY_SECRET');
      console.log('  ✅ RAZORPAY_WEBHOOK_SECRET');
      console.log('  ✅ DATABASE_URL');
      console.log('  ✅ ENCRYPTION_KEY');
      console.log('  ✅ PAYMENT_ENCRYPTION_KEY');
      console.log('  ✅ JWT_SECRET');
      console.log('  ✅ SUPABASE_SERVICE_ROLE_KEY');

      console.log('\nOptional Variables:');
      console.log(
        `  ${result.env?.REDIS_URL ? '✅' : '❌'} REDIS_URL ${result.env?.REDIS_URL ? '' : '(not configured)'}`
      );
      console.log(
        `  ${result.env?.ALERT_EMAIL_TO ? '✅' : '❌'} ALERT_EMAIL_TO ${result.env?.ALERT_EMAIL_TO ? '' : '(not configured)'}`
      );
      console.log(
        `  ${result.env?.ALERT_SLACK_WEBHOOK_URL ? '✅' : '❌'} ALERT_SLACK_WEBHOOK_URL ${result.env?.ALERT_SLACK_WEBHOOK_URL ? '' : '(not configured)'}`
      );
      console.log(
        `  ${result.env?.S3_ENDPOINT ? '✅' : '❌'} S3_ENDPOINT ${result.env?.S3_ENDPOINT ? '' : '(not configured)'}`
      );
    } else {
      console.log('❌ Status: INVALID\n');
      console.log('Errors:');
      result.errors?.forEach((error) => console.log(`  ❌ ${error}`));
    }

    console.log('\n===========================================\n');
  }
}

// Export singleton instance
export const envValidator = new EnvValidator();

// Validate on module load (but don't throw in development)
if (process.env.NODE_ENV !== 'test') {
  const result = envValidator.validate();
  if (!result.valid && process.env.NODE_ENV === 'production') {
    envValidator.printValidationReport();
    process.exit(1);
  }
}
