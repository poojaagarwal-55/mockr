import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { checkRateLimit } from '../lib/rate-limiter.js';
import { OrderManager } from '../services/payment/order-manager.js';
import { PaymentProcessor } from '../services/payment/payment-processor.js';
import {
  CreatePaymentRequest,
  PaymentError,
  PaymentResponse,
  VerifyPaymentRequest,
} from '../services/payment/types.js';
import { paymentErrorHandler } from '../services/payment/error-handler.js';

const createOrderSchema = z.object({
  kind: z.enum(['SUBSCRIPTION', 'CREDITS']),
  currency: z.string().trim().length(3).optional(),
  amount: z.number().int().positive().optional(),
  amountPaise: z.number().int().positive().optional(),
  amount_paise: z.number().int().positive().optional(),
  frontendAmount: z.number().positive().optional(),
  frontend_amount: z.number().positive().optional(),
  metadata: z.record(z.any()).optional(),
  sessionId: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
});

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1).optional(),
  razorpay_order_id: z.string().min(1).optional(),
  razorpayPaymentId: z.string().min(1).optional(),
  razorpay_payment_id: z.string().min(1).optional(),
  razorpaySignature: z.string().min(1).optional(),
  razorpay_signature: z.string().min(1).optional(),
});

const statusParamsSchema = z.object({
  paymentId: z.string().min(1),
});

function normalizeCreatePayload(
  body: z.infer<typeof createOrderSchema>,
  userId: string,
  userAgent?: string,
  clientIp?: string
): CreatePaymentRequest | null {
  const amount = body.amount ?? body.amountPaise ?? body.amount_paise;
  if (!amount) {
    return null;
  }

  return {
    userId,
    amount,
    currency: body.currency?.toUpperCase(),
    kind: body.kind,
    frontendAmount: body.frontendAmount ?? body.frontend_amount,
    metadata: body.metadata,
    userAgent,
    clientIp,
    sessionId: body.sessionId ?? body.session_id,
  };
}

function normalizeVerifyPayload(body: z.infer<typeof verifyPaymentSchema>): VerifyPaymentRequest | null {
  const razorpayOrderId = body.razorpayOrderId ?? body.razorpay_order_id;
  const razorpayPaymentId = body.razorpayPaymentId ?? body.razorpay_payment_id;
  const razorpaySignature = body.razorpaySignature ?? body.razorpay_signature;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return null;
  }

  return {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  };
}

function mapPaymentResponse(payment: PaymentResponse) {
  return {
    id: payment.id,
    razorpayOrderId: payment.razorpayOrderId,
    razorpay_order_id: payment.razorpayOrderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    receiptId: payment.receiptId,
    receipt_id: payment.receiptId,
    orderExpiry: payment.orderExpiry.toISOString(),
    order_expiry: payment.orderExpiry.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    created_at: payment.createdAt.toISOString(),
  };
}

function sendPaymentError(reply: any, error: unknown): void {
  if (error instanceof PaymentError) {
    // Handle known payment errors with user-friendly messages
    const userFriendlyError = paymentErrorHandler.handleSystemError(
      new Error(error.message)
    );
    
    reply.status(error.statusCode).send(
      paymentErrorHandler.formatErrorResponse(userFriendlyError)
    );
    return;
  }

  // Handle Razorpay errors
  if (error && typeof error === 'object' && 'error' in error) {
    const userFriendlyError = paymentErrorHandler.handleRazorpayError(error);
    reply.status(400).send(
      paymentErrorHandler.formatErrorResponse(userFriendlyError)
    );
    return;
  }

  // Handle generic errors
  const userFriendlyError = paymentErrorHandler.handleSystemError(
    error instanceof Error ? error : new Error('Payment operation failed')
  );
  
  reply.status(500).send(
    paymentErrorHandler.formatErrorResponse(userFriendlyError)
  );
}

export default async function paymentRoutes(fastify: FastifyInstance) {
  const orderManager = new OrderManager(prisma);
  const paymentProcessor = new PaymentProcessor(prisma);

  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/payments/orders', async (request, reply) => {
    const rl = checkRateLimit(`payments:create-order:${request.user!.id}`, 10, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment order request',
          details: parsed.error.flatten().fieldErrors,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const normalized = normalizeCreatePayload(
      parsed.data,
      request.user!.id,
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined,
      request.ip
    );

    if (!normalized) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Provide one of amount, amountPaise, or amount_paise',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const payment = await orderManager.createOrder(normalized);
      return reply.send({
        success: true,
        data: mapPaymentResponse(payment),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendPaymentError(reply, error);
    }
  });

  fastify.post('/payments/verify', async (request, reply) => {
    const rl = checkRateLimit(`payments:verify:${request.user!.id}`, 12, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = verifyPaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment verification request',
          details: parsed.error.flatten().fieldErrors,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const normalized = normalizeVerifyPayload(parsed.data);
    if (!normalized) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing order_id, payment_id, or signature',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const verification = await paymentProcessor.verifyPayment(normalized);
      return reply.send({
        success: verification.success,
        data: {
          paymentId: verification.paymentId,
          payment_id: verification.paymentId,
          status: verification.status,
          amount: verification.amount,
          message: verification.message,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendPaymentError(reply, error);
    }
  });

  fastify.get('/payments/:paymentId/status', async (request, reply) => {
    const rl = checkRateLimit(`payments:status:${request.user!.id}`, 60, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = statusParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment id',
          details: parsed.error.flatten().fieldErrors,
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const payment = await prisma.payment.findUnique({
        where: { id: parsed.data.paymentId },
        select: {
          id: true,
          userId: true,
          razorpayOrderId: true,
          amount: true,
          currency: true,
          status: true,
          receiptId: true,
          orderExpiry: true,
          createdAt: true,
        },
      });

      if (!payment) {
        return reply.status(404).send({ error: 'Payment not found' });
      }

      if (request.user!.id !== payment.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      return reply.send({
        success: true,
        data: mapPaymentResponse({
          id: payment.id,
          razorpayOrderId: payment.razorpayOrderId || '',
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          receiptId: payment.receiptId,
          orderExpiry: payment.orderExpiry,
          createdAt: payment.createdAt,
        }),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendPaymentError(reply, error);
    }
  });
}
