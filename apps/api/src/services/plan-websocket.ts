// ============================================
// Plan Update WebSocket Server
// ============================================
// Handles real-time plan status updates for admin panel enhancements.
// Implements JWT authentication, rate limiting, and user-specific broadcasting.
// Follows security guidelines from AGENTS.md.

import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { z } from "zod";
import {
  AUTHENTICATION_FAILED_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  isConnectivityIssue,
} from "../lib/user-facing-errors.js";

// ============================================
// Types and Interfaces
// ============================================

export interface PlanUpdateEvent {
  type: 'PLAN_UPDATED';
  userId: string;
  planData: {
    plan: string;
    expiresAt: Date | null;
    entitlements: any;
    wallet?: {
      free: number;
      monthly: number;
      purchased: number;
      total: number;
    };
    usage?: {
      resumeAnalysisUsed: number;
      resumeImproveAiUsed: number;
      latexAiTokensUsed: number;
      tutorTokensUsed: number;
    };
    updateReason?: string;
    timestamp?: Date;
    metadata?: any;
  };
  timestamp: Date;
}

export interface WebSocketManager {
  broadcastPlanUpdate(userId: string, planData: any): void;
  subscribeToUserUpdates(userId: string, callback: (event: PlanUpdateEvent) => void): void;
  unsubscribeFromUserUpdates(userId: string): void;
  getConnectionCount(): number;
  getUserConnections(userId: string): number;
}

// ============================================
// Validation Schemas
// ============================================

const planUpdatePayloadSchema = z.object({
  type: z.literal('PLAN_UPDATED'),
  planData: z.object({
    plan: z.string(),
    expiresAt: z.date().nullable(),
    entitlements: z.any()
  })
});

// ============================================
// Connection Management
// ============================================

interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail: string;
  lastActivity: number;
}

class ConnectionManager {
  private userConnections = new Map<string, Set<AuthenticatedSocket>>();
  private socketToUser = new Map<string, string>();

  addConnection(socket: AuthenticatedSocket): void {
    const { userId } = socket;
    
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    
    this.userConnections.get(userId)!.add(socket);
    this.socketToUser.set(socket.id, userId);
    
    console.log(`[PlanWS] User ${userId.slice(0, 8)} connected. Total connections: ${this.getTotalConnections()}`);
  }

  removeConnection(socket: AuthenticatedSocket): void {
    const userId = this.socketToUser.get(socket.id);
    if (!userId) return;

    const userSockets = this.userConnections.get(userId);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) {
        this.userConnections.delete(userId);
      }
    }
    
    this.socketToUser.delete(socket.id);
    
    console.log(`[PlanWS] User ${userId.slice(0, 8)} disconnected. Total connections: ${this.getTotalConnections()}`);
  }

  getUserConnections(userId: string): Set<AuthenticatedSocket> {
    return this.userConnections.get(userId) || new Set();
  }

  getTotalConnections(): number {
    let total = 0;
    for (const sockets of this.userConnections.values()) {
      total += sockets.size;
    }
    return total;
  }

  getUserConnectionCount(userId: string): number {
    return this.getUserConnections(userId).size;
  }

  // Clean up stale connections (called periodically)
  cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [userId, sockets] of this.userConnections.entries()) {
      for (const socket of sockets) {
        if (now - socket.lastActivity > staleThreshold) {
          console.log(`[PlanWS] Cleaning up stale connection for user ${userId.slice(0, 8)}`);
          socket.disconnect(true);
          this.removeConnection(socket);
        }
      }
    }
  }
}

// ============================================
// WebSocket Manager Implementation
// ============================================

class PlanWebSocketManager implements WebSocketManager {
  public connectionManager = new ConnectionManager();
  private io: SocketIOServer | null = null;

  setServer(io: SocketIOServer): void {
    this.io = io;
    
    // Clean up stale connections every 5 minutes
    setInterval(() => {
      this.connectionManager.cleanupStaleConnections();
    }, 5 * 60 * 1000);
  }

  broadcastPlanUpdate(userId: string, planData: any): void {
    if (!this.io) {
      console.warn('[PlanWS] Cannot broadcast - server not initialized');
      return;
    }

    const userConnections = this.connectionManager.getUserConnections(userId);
    if (userConnections.size === 0) {
      console.log(`[PlanWS] No active connections for user ${userId.slice(0, 8)}`);
      return;
    }

    const event: PlanUpdateEvent = {
      type: 'PLAN_UPDATED',
      userId,
      planData: {
        plan: planData.plan,
        expiresAt: planData.expiresAt,
        entitlements: planData.entitlements,
        wallet: planData.wallet, // Include wallet data
        usage: planData.usage,   // Include usage data
        updateReason: planData.updateReason,
        timestamp: planData.timestamp,
        metadata: planData.metadata
      },
      timestamp: new Date()
    };

    console.log(`[PlanWS] Broadcasting plan update to ${userConnections.size} connections for user ${userId.slice(0, 8)}`, {
      plan: planData.plan,
      wallet: planData.wallet,
      updateReason: planData.updateReason
    });

    for (const socket of userConnections) {
      try {
        socket.emit('plan:updated', event);
        socket.lastActivity = Date.now();
      } catch (error) {
        console.error(`[PlanWS] Failed to emit to socket ${socket.id}:`, error);
        this.connectionManager.removeConnection(socket);
      }
    }
  }

  subscribeToUserUpdates(userId: string, callback: (event: PlanUpdateEvent) => void): void {
    // This method is for programmatic subscriptions, not used in current implementation
    console.log(`[PlanWS] Subscription registered for user ${userId.slice(0, 8)}`);
  }

  unsubscribeFromUserUpdates(userId: string): void {
    // This method is for programmatic subscriptions, not used in current implementation
    console.log(`[PlanWS] Subscription removed for user ${userId.slice(0, 8)}`);
  }

  getConnectionCount(): number {
    return this.connectionManager.getTotalConnections();
  }

  getUserConnections(userId: string): number {
    return this.connectionManager.getUserConnectionCount(userId);
  }
}

// ============================================
// Global WebSocket Manager Instance
// ============================================

export const planWebSocketManager = new PlanWebSocketManager();

// ============================================
// WebSocket Server Creation
// ============================================

export function createPlanWebSocketServer(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/ws/plans',
    cors: {
      origin: [
        "https://practers.com",
        "https://www.practers.com",
        process.env.FRONTEND_URL || "",
        process.env.CLIENT_URL || "",
      ].filter(Boolean),
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Set the server instance in the manager
  planWebSocketManager.setServer(io);

  // ============================================
  // Authentication Middleware
  // ============================================
  
  io.use(async (socket, next) => {
    try {
      // Extract token from query params or auth header
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token || typeof token !== 'string') {
        console.warn('[PlanWS] Connection rejected - no token provided');
        return next(new Error("Authentication required"));
      }

      // Verify JWT token with Supabase
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.auth.getUser(token);

      if (error) {
        if (isConnectivityIssue(error)) {
          console.warn('[PlanWS] Connection rejected - auth provider connectivity issue');
          return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
        }
        console.warn('[PlanWS] Connection rejected - auth failed');
        return next(new Error(AUTHENTICATION_FAILED_MESSAGE));
      }

      if (!data.user) {
        console.warn('[PlanWS] Connection rejected - auth failed');
        return next(new Error(AUTHENTICATION_FAILED_MESSAGE));
      }

      // Rate limit connection attempts per user
      const connectionRateLimit = checkRateLimit(
        `plan_ws_connect:${data.user.id}`,
        10, // 10 connections
        60000 // per minute
      );

      if (!connectionRateLimit.allowed) {
        console.warn(`[PlanWS] Connection rate limited for user ${data.user.id.slice(0, 8)}`);
        return next(new Error("Too many connection attempts"));
      }

      // Attach user info to socket
      (socket as AuthenticatedSocket).userId = data.user.id;
      (socket as AuthenticatedSocket).userEmail = data.user.email || '';
      (socket as AuthenticatedSocket).lastActivity = Date.now();

      console.log(`[PlanWS] User ${data.user.id.slice(0, 8)} authenticated successfully`);
      next();
    } catch (err) {
      console.error('[PlanWS] Authentication error:', err);
      if (isConnectivityIssue(err)) {
        return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
      }
      next(new Error(AUTHENTICATION_FAILED_MESSAGE));
    }
  });

  // ============================================
  // Connection Handler
  // ============================================
  
  io.on("connection", (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;
    const { userId, userEmail } = authSocket;

    // Add to connection manager
    planWebSocketManager.connectionManager.addConnection(authSocket);

    // Send connection confirmation
    socket.emit('plan:connected', {
      message: 'Connected to plan updates',
      timestamp: new Date()
    });

    // ============================================
    // Message Rate Limiting
    // ============================================
    
    const checkMessageRateLimit = (): boolean => {
      const messageRateLimit = checkRateLimit(
        `plan_ws_messages:${userId}`,
        100, // 100 messages
        60000 // per minute
      );

      if (!messageRateLimit.allowed) {
        socket.emit('error', {
          code: 'RATE_LIMITED',
          message: `Too many messages. Please wait ${Math.ceil(messageRateLimit.retryAfterMs / 1000)}s.`,
          retryAfter: Math.ceil(messageRateLimit.retryAfterMs / 1000)
        });
        return false;
      }

      return true;
    };

    // ============================================
    // Event Handlers
    // ============================================

    // Heartbeat/ping handler
    socket.on('ping', () => {
      if (!checkMessageRateLimit()) return;
      
      authSocket.lastActivity = Date.now();
      socket.emit('pong', { timestamp: new Date() });
    });

    // Subscribe to plan updates (explicit subscription)
    socket.on('plan:subscribe', () => {
      if (!checkMessageRateLimit()) return;
      
      authSocket.lastActivity = Date.now();
      socket.emit('plan:subscribed', {
        message: 'Subscribed to plan updates',
        userId: userId.slice(0, 8) + '***', // Masked for security
        timestamp: new Date()
      });
      
      console.log(`[PlanWS] User ${userId.slice(0, 8)} explicitly subscribed to plan updates`);
    });

    // Unsubscribe from plan updates
    socket.on('plan:unsubscribe', () => {
      if (!checkMessageRateLimit()) return;
      
      authSocket.lastActivity = Date.now();
      socket.emit('plan:unsubscribed', {
        message: 'Unsubscribed from plan updates',
        timestamp: new Date()
      });
      
      console.log(`[PlanWS] User ${userId.slice(0, 8)} unsubscribed from plan updates`);
    });

    // ============================================
    // Disconnect Handler
    // ============================================
    
    socket.on("disconnect", (reason) => {
      console.log(`[PlanWS] User ${userId.slice(0, 8)} disconnected: ${reason}`);
      planWebSocketManager.connectionManager.removeConnection(authSocket);
    });

    // ============================================
    // Error Handler
    // ============================================
    
    socket.on("error", (error) => {
      console.error(`[PlanWS] Socket error for user ${userId.slice(0, 8)}:`, error);
      authSocket.lastActivity = Date.now();
    });
  });

  // ============================================
  // Server Event Handlers
  // ============================================
  
  io.engine.on("connection_error", (err) => {
    console.error("[PlanWS] Connection error:", err.message);
  });

  console.log('[PlanWS] Plan WebSocket server initialized on path /ws/plans');
  return io;
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Broadcast plan update to a specific user
 */
export function broadcastPlanUpdate(userId: string, planData: any): void {
  planWebSocketManager.broadcastPlanUpdate(userId, planData);
}

/**
 * Get current connection statistics
 */
export function getWebSocketStats(): {
  totalConnections: number;
  getUserConnections: (userId: string) => number;
} {
  return {
    totalConnections: planWebSocketManager.getConnectionCount(),
    getUserConnections: (userId: string) => planWebSocketManager.getUserConnections(userId)
  };
}
