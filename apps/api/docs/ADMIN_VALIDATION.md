# Admin Input Validation and Sanitization

## Overview

This document describes the input validation and sanitization implementation for admin operations in the Mockr API. The implementation follows security best practices outlined in `AGENTS.md` and provides comprehensive protection against injection attacks, malformed data, and security vulnerabilities.

## Architecture

### Components

1. **Validation Schemas** (`src/middleware/enhanced-admin-auth.ts`)
   - Zod-based schemas for all admin operations
   - Type-safe validation with detailed error messages
   - Automatic data transformation and sanitization

2. **Sanitization Middleware** (`src/middleware/enhanced-admin-auth.ts`)
   - Recursive object sanitization
   - Protection against injection attacks
   - Limits on string length, array size, and object depth

3. **Error Handling** (`src/middleware/enhanced-admin-auth.ts`)
   - Security-focused error masking
   - Comprehensive error tracking
   - Safe error responses that don't leak sensitive information

## Validation Schemas

### Coupon Revocation Schemas

#### `revokeAccessSchema`
Validates single user coupon revocation requests.

```typescript
{
  userId: string (UUID format),
  reason?: string (max 500 chars, trimmed)
}
```

**Usage:**
```typescript
const result = revokeAccessSchema.safeParse(request.body);
if (!result.success) {
  // Handle validation error
}
```

#### `bulkRevokeSchema`
Validates bulk coupon revocation requests.

```typescript
{
  userIds: string[] (1-100 UUIDs),
  reason?: string (max 500 chars, trimmed)
}
```

**Constraints:**
- Minimum 1 user ID
- Maximum 100 user IDs per request
- All IDs must be valid UUIDs

### Admin Operation Schemas

#### `grantCreditsSchema`
Validates credit grant operations.

```typescript
{
  email: string (valid email format),
  amount: number (1-10000),
  notes?: string (max 500 chars)
}
```

#### `patchCouponSchema`
Validates coupon status updates.

```typescript
{
  active: boolean
}
```

#### `userLookupSchema`
Validates user lookup queries.

```typescript
{
  email: string (valid email format)
}
```

#### `couponListQuerySchema`
Validates coupon list query parameters.

```typescript
{
  limit?: string (transformed to number, max 200),
  offset?: string (transformed to number),
  status?: "active" | "inactive" | "all",
  search?: string (transformed to uppercase)
}
```

## Input Sanitization

### `sanitizeInput(request: FastifyRequest)`

Automatically sanitizes request body and query parameters before processing.

**Features:**
- Recursive object sanitization
- String length limits (10,000 chars max)
- Array size limits (1,000 items max)
- Object key limits (100 keys max)
- Maximum depth protection (10 levels)
- Key name sanitization (removes special characters)

**Usage:**
```typescript
// Applied automatically in enhancedAdminAuth middleware
await sanitizeInput(request);
```

### `sanitizeObject(obj: any, maxDepth: number)`

Low-level sanitization function for nested objects.

**Protection Against:**
- Extremely long strings (DoS attacks)
- Large arrays (memory exhaustion)
- Deep nesting (stack overflow)
- Special characters in keys (injection attacks)

## Error Handling

### `AdminErrorTracker`

Centralized error tracking with security-focused logging.

**Features:**
- Unique error IDs for tracking
- Automatic PII masking
- Severity levels (low, medium, high, critical)
- Critical error alerting
- Production-safe stack traces

**Usage:**
```typescript
try {
  // Admin operation
} catch (error: any) {
  const errorId = AdminErrorTracker.track(error, {
    operation: 'revoke_coupon_access',
    component: 'admin_coupon_management',
    severity: 'medium',
    metadata: { couponId }
  }, request);

  return reply.status(500).send({
    error: "Internal Server Error",
    errorId,
    message: createSafeErrorResponse(error, errorId, 'revoke coupon access')
  });
}
```

### `createSafeErrorResponse(error, errorId, operation)`

Creates error responses that mask sensitive information in production.

**Production Mode:**
- Generic error messages
- No stack traces
- No internal details

**Development Mode:**
- Detailed error messages
- Full stack traces
- Debugging information

### `maskSensitiveData(data: any)`

Masks sensitive fields in objects for safe logging.

**Masked Fields:**
- Passwords → `***MASKED***`
- Tokens → `***MASKED***`
- Secrets → `***MASKED***`
- API Keys → `***MASKED***`
- User IDs → First 8 chars + `***`
- Emails → First 3 chars + `***@domain.com`

## Validation Helper Functions

### `validateRequestBody<T>(schema, body, reply)`

Validates request body and sends formatted error response if invalid.

**Returns:**
```typescript
{ success: true, data: T } | { success: false }
```

**Usage:**
```typescript
const validation = validateRequestBody(revokeAccessSchema, request.body, reply);
if (!validation.success) {
  return; // Error response already sent
}

const { userId, reason } = validation.data;
```

### `validateRequestQuery<T>(schema, query, reply)`

Validates query parameters with automatic error responses.

**Usage:**
```typescript
const validation = validateRequestQuery(couponListQuerySchema, request.query, reply);
if (!validation.success) {
  return; // Error response already sent
}

const { limit, offset, status } = validation.data;
```

## Security Best Practices

### 1. Always Validate Input

```typescript
// ✅ GOOD
const result = revokeAccessSchema.safeParse(request.body);
if (!result.success) {
  return reply.status(400).send({ error: "Validation Error" });
}

// ❌ BAD
const { userId } = request.body; // No validation
```

### 2. Use Sanitization Middleware

```typescript
// ✅ GOOD - Applied automatically in enhancedAdminAuth
fastify.post("/admin/operation", {
  preHandler: enhancedAdminAuth
}, async (request, reply) => {
  // Input is already sanitized
});

// ❌ BAD - No sanitization
fastify.post("/admin/operation", async (request, reply) => {
  // Raw, unsanitized input
});
```

### 3. Mask Sensitive Data in Logs

```typescript
// ✅ GOOD
fastify.log.info({
  userId: userId.slice(0, 8) + '***',
  email: email.slice(0, 3) + '***@' + email.split('@')[1]
}, "Admin action");

// ❌ BAD
fastify.log.info({
  userId: userId,
  email: email
}, "Admin action");
```

### 4. Use Safe Error Responses

```typescript
// ✅ GOOD
return reply.status(500).send({
  error: "Internal Server Error",
  errorId,
  message: process.env.NODE_ENV === "production" 
    ? "Failed to process request" 
    : error.message
});

// ❌ BAD
return reply.status(500).send({
  error: error.message,
  stack: error.stack,
  details: internalDetails
});
```

### 5. Validate UUIDs

```typescript
// ✅ GOOD
const schema = z.object({
  userId: z.string().uuid("Invalid user ID format")
});

// ❌ BAD
const schema = z.object({
  userId: z.string() // Any string accepted
});
```

## Integration with Admin Routes

### Example: Coupon Revocation Endpoint

```typescript
fastify.post("/admin/coupons/:id/revoke-access", {
  preHandler: adminCouponRevokeAuth // Includes validation & sanitization
}, async (request, reply) => {
  const { id: couponId } = request.params as { id: string };
  
  try {
    // 1. Validate input
    const parsed = revokeAccessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation Error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { userId, reason } = parsed.data;

    // 2. Perform operation
    const revocation = await prisma.couponRevocation.create({
      data: {
        couponId,
        userId,
        revokedBy: request.user!.email,
        reason: reason || null
      }
    });

    // 3. Return masked response
    return reply.status(201).send({
      success: true,
      revocation: {
        id: revocation.id,
        userId: userId.slice(0, 8) + '***', // Masked
        revokedBy: request.user!.email,
        revokedAt: revocation.revokedAt
      }
    });

  } catch (error: any) {
    // 4. Track and mask errors
    const errorId = AdminErrorTracker.track(error, {
      operation: 'revoke_coupon_access',
      component: 'admin_coupon_management',
      severity: 'medium',
      metadata: { couponId }
    }, request);

    return reply.status(500).send(
      createSafeErrorResponse(error, errorId, 'revoke coupon access')
    );
  }
});
```

## Testing

### Manual Testing

```bash
# Test validation schemas
npx tsx src/middleware/__test-validation__.ts
```

### Integration Testing

```typescript
// Test with valid input
const response = await fastify.inject({
  method: 'POST',
  url: '/admin/coupons/123/revoke-access',
  headers: {
    authorization: `Bearer ${adminToken}`
  },
  payload: {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    reason: 'Test revocation'
  }
});

expect(response.statusCode).toBe(201);

// Test with invalid input
const response2 = await fastify.inject({
  method: 'POST',
  url: '/admin/coupons/123/revoke-access',
  headers: {
    authorization: `Bearer ${adminToken}`
  },
  payload: {
    userId: 'invalid-uuid',
    reason: 'Test'
  }
});

expect(response2.statusCode).toBe(400);
expect(response2.json().error).toBe('Validation Error');
```

## Requirements Coverage

This implementation satisfies the following requirements:

- **Requirement 6.3**: Zod validation for all input data before processing admin operations
- **Requirement 6.6**: Never log sensitive data (full user IDs, coupon codes, personal information)
- **Requirement 8.3**: Validate all user inputs and provide meaningful error messages for invalid data

## Related Documentation

- [Enhanced Admin Authentication](./ADMIN_AUTH.md)
- [Security Guidelines](../../AGENTS.md)
- [Admin Routes](../src/routes/admin.ts)
- [Enhanced Admin Middleware](../src/middleware/enhanced-admin-auth.ts)
