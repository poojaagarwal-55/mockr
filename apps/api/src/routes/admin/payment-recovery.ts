// Admin Payment Recovery Routes - Manual webhook recovery and payment reconciliation

import { FastifyInstance } from 'fastify';
import { WebhookRecoveryService } from '../../services/payment/webhook-recovery-service.js';
import { prisma } from '../../lib/prisma.js';

export default async function adminPaymentRecoveryRoutes(fastify: FastifyInstance) {
  const webhookRecovery = new WebhookRecoveryService(prisma);

  // Middleware to ensure admin access
  fastify.addHook('preHandler', async (request, reply) => {
    // Add your admin authentication logic here
    // For now, we'll use a simple header check
    const adminKey = request.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Trigger webhook recovery for all stuck payments
  fastify.post('/admin/payments/recover-webhooks', async (request, reply) => {
    try {
      await webhookRecovery.recoverMissedWebhooks();
      return reply.send({ 
        success: true, 
        message: 'Webhook recovery triggered successfully' 
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Manual webhook recovery failed');
      return reply.status(500).send({ 
        success: false, 
        error: 'Webhook recovery failed' 
      });
    }
  });

  // Recover a specific payment by ID
  fastify.post('/admin/payments/:paymentId/recover', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    
    try {
      const success = await webhookRecovery.recoverSpecificPayment(paymentId);
      
      if (success) {
        return reply.send({ 
          success: true, 
          message: `Payment ${paymentId} recovered successfully` 
        });
      } else {
        return reply.status(404).send({ 
          success: false, 
          error: 'Payment not found or could not be recovered' 
        });
      }
    } catch (error) {
      fastify.log.error({ err: error, paymentId }, 'Manual payment recovery failed');
      return reply.status(500).send({ 
        success: false, 
        error: 'Payment recovery failed' 
      });
    }
  });

  // Get stuck payments that need recovery
  fastify.get('/admin/payments/stuck', async (request, reply) => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const stuckPayments = await prisma.payment.findMany({
        where: {
          status: {
            in: ['created', 'authorized', 'pending']
          },
          razorpayPaymentId: {
            not: null
          },
          createdAt: {
            lt: fiveMinutesAgo
          }
        },
        select: {
          id: true,
          userId: true,
          razorpayPaymentId: true,
          razorpayOrderId: true,
          amount: true,
          status: true,
          kind: true,
          createdAt: true,
          metadata: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 20
      });

      return reply.send({
        success: true,
        data: {
          count: stuckPayments.length,
          payments: stuckPayments
        }
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch stuck payments');
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch stuck payments' 
      });
    }
  });

  // Clear cache for a specific user
  fastify.post('/admin/cache/clear/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    
    try {
      const { invalidateUserPlanCache } = await import('../../services/cache.js');
      await invalidateUserPlanCache(userId);
      
      return reply.send({ 
        success: true, 
        message: `Cache cleared for user ${userId}` 
      });
    } catch (error) {
      fastify.log.error({ err: error, userId }, 'Failed to clear cache for user');
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to clear cache' 
      });
    }
  });
}
