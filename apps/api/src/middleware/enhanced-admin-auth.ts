// ============================================
// Enhanced Admin Authentication Middleware
// ============================================
// Multi-layer security for admin operations with comprehensive
// audit logging and rate limiting. Follows AGENTS.md security guidelines.

import { FastifyRequest, FastifyReply } from "fastify";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { isAdminEmail } from "../lib/admin.js";
import { z } from "zod";
import { randomUUID } from "crypto";

// ============================================
// Admin Email Configuration
// ============================================
// isAdminEmail is imported from lib/admin.ts — single source of truth.
// Admin emails are controlled via ADMIN_EMAILS env var (comma-separated)
// or fall back to the hardcoded primary owner in lib/admin.ts.

// ============================================
// Rate Limiting Configuration
// ============================================

export const ADMIN_RATE_LIMITS = {
  GENERAL: { requests: 100, window: 3600000 }, // 100/hour
  COUPON_REVOKE: { requests: 50, window: 3600000 }, // 50/hour
  BULK_OPERATIONS: { requests: 10, window: 3600000 }, // 10/hour
  SENSITIVE_OPERATIONS: { requests: 20, window: 3600000 }, // 20/hour
} as const;

/**
 * Create rate limiter for specific admin operation type
 */
function createAdminRateLimiter(type: keyof typeof ADMIN_RATE_LIMITS) {
  return (request: FastifyRequest, reply: FastifyReply): boolean => {
    const limit = ADMIN_RATE_LIMITS[type];
    const key = `admin:${type}:${request.user!.id}`;
    
    const result = checkRateLimit(key, limit.requests, limit.window);
    
    if (!result.allowed) {
      reply.status(429).send({
        error: "Too Many Requests",
        type,
        message: `Rate limit exceeded for ${type}. Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`,
        retryAfter: Math.ceil(result.retryAfterMs / 1000),
        remaining: result.remaining
      });
      return false;
    }
    
    return true;
  };
}

// ============================================
// Input Sanitization
// ============================================

/**
 * Sanitize object recursively to prevent injection attacks
 */
function sanitizeObject(obj: any, maxDepth = 10): any {
  if (maxDepth <= 0) return null;
  
  if (typeof obj === 'string') {
    return obj.trim().slice(0, 10000); // Prevent extremely long strings
  }
  
  if (Array.isArray(obj)) {
    return obj.slice(0, 1000).map(item => sanitizeObject(item, maxDepth - 1)); // Limit array size
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    const keys = Object.keys(obj).slice(0, 100); // Limit object keys
    
    for (const key of keys) {
      // Sanitize key name
      const sanitizedKey = key.replace(/[^\w\-_]/g, '').slice(0, 100);
      if (sanitizedKey) {
        sanitized[sanitizedKey] = sanitizeObject(obj[key], maxDepth - 1);
      }
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Input sanitization middleware
 */
export async function sanitizeInput(request: FastifyRequest): Promise<void> {
  if (request.body && typeof request.body === 'object') {
    request.body = sanitizeObject(request.body);
  }
  
  if (request.query && typeof request.query === 'object') {
    request.query = sanitizeObject(request.query);
  }
}

// ============================================
// Audit Logging
// ============================================

interface AuditLogEntry {
  adminId: string;
  adminEmail: string;
  action: string;
  method: string;
  path: string;
  ip: string;
  userAgent?: string;
  requestBody?: any;
  timestamp: Date;
  success: boolean;
  error?: string;
}

/**
 * Log admin action for audit trail
 */
function logAdminAction(
  request: FastifyRequest,
  success: boolean,
  error?: string
): void {
  const entry: AuditLogEntry = {
    adminId: request.user!.id.slice(0, 8) + '***', // Masked for security
    adminEmail: request.user!.email.slice(0, 3) + '***@' + request.user!.email.split('@')[1],
    action: `${request.method} ${request.url}`,
    method: request.method,
    path: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 200),
    requestBody: request.body ? sanitizeObject(request.body) : undefined,
    timestamp: new Date(),
    success,
    error
  };

  if (success) {
    request.log.info(entry, "Admin action completed");
  } else {
    request.log.warn(entry, "Admin action failed");
  }
}

// ============================================
// Enhanced Admin Authentication Middleware
// ============================================

/**
 * Enhanced admin authentication with multi-layer security
 */
export async function enhancedAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // 1. Standard JWT verification (using existing auth plugin)
    await request.server.authenticate(request, reply);
    
    // 2. Admin role verification
    const email = request.user?.email;
    if (!isAdminEmail(email)) {
      logAdminAction(request, false, "Non-admin attempted admin route");
      
      // Return 404 instead of 403 to not reveal admin routes exist
      reply.status(404).send({ error: "Not Found" });
      return;
    }

    // 3. Input sanitization
    await sanitizeInput(request);

    // 4. General admin rate limiting
    const rateLimitPassed = createAdminRateLimiter('GENERAL')(request, reply);
    if (!rateLimitPassed) {
      logAdminAction(request, false, "Rate limit exceeded");
      return;
    }

    // 5. Log successful authentication
    logAdminAction(request, true);

  } catch (error: any) {
    logAdminAction(request, false, error.message);
    
    if (!reply.sent) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Admin authentication failed"
      });
    }
  }
}

// ============================================
// Specialized Admin Middleware Functions
// ============================================

/**
 * Admin middleware for coupon revocation operations
 */
export async function adminCouponRevokeAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await enhancedAdminAuth(request, reply);
  
  if (reply.sent) return;
  
  const rateLimitPassed = createAdminRateLimiter('COUPON_REVOKE')(request, reply);
  if (!rateLimitPassed) {
    logAdminAction(request, false, "Coupon revoke rate limit exceeded");
  }
}

/**
 * Admin middleware for bulk operations
 */
export async function adminBulkOperationAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await enhancedAdminAuth(request, reply);
  
  if (reply.sent) return;
  
  const rateLimitPassed = createAdminRateLimiter('BULK_OPERATIONS')(request, reply);
  if (!rateLimitPassed) {
    logAdminAction(request, false, "Bulk operation rate limit exceeded");
  }
}

/**
 * Admin middleware for sensitive operations
 */
export async function adminSensitiveOperationAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await enhancedAdminAuth(request, reply);
  
  if (reply.sent) return;
  
  const rateLimitPassed = createAdminRateLimiter('SENSITIVE_OPERATIONS')(request, reply);
  if (!rateLimitPassed) {
    logAdminAction(request, false, "Sensitive operation rate limit exceeded");
  }
}

// ============================================
// Validation Schemas
// ============================================

/**
 * Schema for revoking coupon access for a single user
 */
export const revokeAccessSchema = z.object({
  userId: z.string().uuid("Invalid user ID format"),
  reason: z.string()
    .max(500, "Reason too long")
    .optional()
    .transform(val => val?.trim())
});

/**
 * Schema for bulk revoking coupon access for multiple users
 */
export const bulkRevokeSchema = z.object({
  userIds: z.array(z.string().uuid())
    .min(1, "At least one user ID required")
    .max(100, "Too many users in bulk operation"),
  reason: z.string()
    .max(500, "Reason too long")
    .optional()
    .transform(val => val?.trim())
});

/**
 * Schema for granting credits to a user
 */
export const grantCreditsSchema = z.object({
  email: z.string().email("Invalid email format"),
  amount: z.number().int().min(1).max(10000, "Amount must be between 1 and 10000"),
  notes: z.string().max(500, "Notes too long").optional()
});

/**
 * Schema for toggling coupon active status
 */
export const patchCouponSchema = z.object({
  active: z.boolean()
});

/**
 * Schema for user lookup query
 */
export const userLookupSchema = z.object({
  email: z.string().email("Invalid email format")
});

/**
 * Schema for coupon list query parameters
 */
export const couponListQuerySchema = z.object({
  limit: z.string().optional().transform(val => Math.min(parseInt(val || "50"), 200)),
  offset: z.string().optional().transform(val => parseInt(val || "0")),
  status: z.enum(["active", "inactive", "all"]).optional(),
  search: z.string().optional().transform(val => val?.toUpperCase())
});

// ============================================
// Validation Helper Functions
// ============================================

/**
 * Validate request body against a Zod schema and return formatted error response
 */
export function validateRequestBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  reply: FastifyReply
): { success: true; data: T } | { success: false } {
  const result = schema.safeParse(body);
  
  if (!result.success) {
    reply.status(400).send({
      error: "Validation Error",
      details: result.error.flatten().fieldErrors,
      message: "Invalid request data"
    });
    return { success: false };
  }
  
  return { success: true, data: result.data };
}

/**
 * Validate request query parameters against a Zod schema
 */
export function validateRequestQuery<T>(
  schema: z.ZodSchema<T>,
  query: unknown,
  reply: FastifyReply
): { success: true; data: T } | { success: false } {
  const result = schema.safeParse(query);
  
  if (!result.success) {
    reply.status(400).send({
      error: "Validation Error",
      details: result.error.flatten().fieldErrors,
      message: "Invalid query parameters"
    });
    return { success: false };
  }
  
  return { success: true, data: result.data };
}

// ============================================
// Error Tracking
// ============================================

interface ErrorContext {
  userId?: string;
  adminId?: string;
  operation: string;
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

export class AdminErrorTracker {
  static track(error: Error, context: ErrorContext, request: FastifyRequest) {
    const errorId = randomUUID();
    
    const logEntry = {
      errorId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
      },
      context: {
        ...context,
        userId: context.userId?.slice(0, 8) + '***',
        adminId: context.adminId?.slice(0, 8) + '***'
      },
      request: {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent']?.slice(0, 200)
      }
    };

    request.log.error(logEntry, `${context.component} error: ${context.operation}`);
    
    // Alert on critical errors
    if (context.severity === 'critical') {
      console.error(`CRITICAL ADMIN ERROR ${errorId}:`, error.message);
    }
    
    return errorId;
  }
}

// ============================================
// Security Error Response Helpers
// ============================================

/**
 * Create a safe error response that masks sensitive information
 */
export function createSafeErrorResponse(
  error: Error,
  errorId: string,
  operation: string
): {
  error: string;
  errorId: string;
  message: string;
} {
  const isProduction = process.env.NODE_ENV === "production";
  
  return {
    error: "Internal Server Error",
    errorId,
    message: isProduction 
      ? `Failed to ${operation}` 
      : error.message
  };
}

/**
 * Mask sensitive data in objects for logging
 */
export function maskSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') return data;
  
  const masked = { ...data };
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'sessionId'];
  
  for (const key of Object.keys(masked)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      masked[key] = '***MASKED***';
    } else if (key.toLowerCase().includes('id') && typeof masked[key] === 'string') {
      // Mask IDs but keep first 8 chars for debugging
      masked[key] = masked[key].slice(0, 8) + '***';
    } else if (key.toLowerCase().includes('email') && typeof masked[key] === 'string') {
      // Mask email but keep domain
      const parts = masked[key].split('@');
      if (parts.length === 2) {
        masked[key] = parts[0].slice(0, 3) + '***@' + parts[1];
      }
    }
  }
  
  return masked;
}