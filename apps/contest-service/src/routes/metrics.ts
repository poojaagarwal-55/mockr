import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';
import { getContestServiceMetrics } from '../lib/metrics.js';

/**
 * Lightweight operational metrics for local/staging load tests.
 *
 * Exposed by default outside production. In production, set METRICS_ENABLED=true
 * only when the service is bound internally or otherwise protected upstream.
 */
export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV === 'production' && !env.METRICS_ENABLED) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Metrics endpoint is disabled',
      });
    }

    return reply.send(await getContestServiceMetrics());
  });
}
