import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { verifySupabaseToken } from './supabase.js';
import { startSubmissionNotificationSubscriber } from './notification-bus.js';

/**
 * WebSocket Gateway
 * Handles real-time notifications for submission results
 * Authenticates connections and manages user subscriptions
 */

// Store active connections: userId -> WebSocket
const connections = new Map<string, WebSocket>();

/**
 * Register WebSocket routes
 */
export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  // Register WebSocket plugin
  await fastify.register(fastifyWebsocket);

  /**
   * WebSocket endpoint: /ws
   * Authenticate during handshake
   */
  fastify.get('/ws', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    
    try {
      // Authenticate via query parameter token
      const query = request.query as { token?: string };
      const token = query.token;
      
      if (!token) {
        socket.close(4001, 'Missing authentication token');
        return;
      }

      // Verify token
      const userId = await verifySupabaseToken(token);
      if (!userId) {
        socket.close(4002, 'Invalid authentication token');
        return;
      }

      // Store connection
      connections.set(userId, socket);
      console.log(`[WebSocket] User ${userId} connected (${connections.size} active)`);

      // Send welcome message
      socket.send(JSON.stringify({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
      }));

      // Handle messages from client
      socket.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          handleClientMessage(socket, userId, message);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });

      // Handle disconnection
      socket.on('close', () => {
        connections.delete(userId);
        console.log(`[WebSocket] User ${userId} disconnected (${connections.size} active)`);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error('[WebSocket] Socket error:', error);
        connections.delete(userId);
      });
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      socket.close(4003, 'Internal server error');
    }
  });
}

/**
 * Handle messages from client
 */
function handleClientMessage(socket: WebSocket, userId: string, message: any) {
  const { type, data } = message;

  switch (type) {
    case 'ping':
      socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    case 'subscribe':
      // Client can subscribe to specific contest updates
      console.log(`[WebSocket] User ${userId} subscribed to ${data?.contestId}`);
      break;

    default:
      console.warn(`[WebSocket] Unknown message type: ${type}`);
  }
}

/**
 * Send notification to specific user
 */
export function sendNotificationToUser(userId: string, notification: any) {
  const socket = connections.get(userId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(notification));
    console.log(`[WebSocket] Sent notification to user ${userId}`);
    return true;
  }
  return false;
}

/**
 * Broadcast notification to all connected users
 */
export function broadcastNotification(notification: any) {
  let sentCount = 0;
  connections.forEach((socket, userId) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(notification));
      sentCount++;
    }
  });
  console.log(`[WebSocket] Broadcast notification to ${sentCount} users`);
}

/**
 * Start heartbeat interval
 * Ping all connections every 30 seconds
 * Close dead connections
 */
export function startHeartbeat() {
  const interval = setInterval(() => {
    connections.forEach((socket, userId) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      } else {
        console.log(`[WebSocket] Removing dead connection for user ${userId}`);
        connections.delete(userId);
      }
    });
  }, 30000); // 30 seconds

  return interval;
}

/**
 * Stop heartbeat interval
 */
export function stopHeartbeat(interval: NodeJS.Timeout) {
  clearInterval(interval);
}

/**
 * Get connection stats
 */
export function getConnectionStats() {
  return {
    activeConnections: connections.size,
    users: Array.from(connections.keys()),
  };
}

export function getActiveConnectionCount() {
  return connections.size;
}

/**
 * Subscribe to the cross-instance notification bus so a verdict produced by the
 * worker on ANY instance is delivered over the user's socket on whichever
 * instance actually holds it. Falls back to in-process delivery when no TCP
 * queue Redis is configured. Result polling remains the reliable fallback.
 */
export async function subscribeToSubmissionNotifications() {
  return startSubmissionNotificationSubscriber((userId, notification) => {
    sendNotificationToUser(userId, notification);
  });
}

/**
 * Close all connections gracefully
 */
export function closeAllConnections() {
  connections.forEach((socket, userId) => {
    socket.close(1000, 'Server shutting down');
  });
  connections.clear();
  console.log('[WebSocket] All connections closed');
}
