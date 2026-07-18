# Plan WebSocket Server

This WebSocket server provides real-time plan status updates for the admin panel enhancements feature.

## Features

- **JWT Authentication**: Verifies Supabase JWT tokens on connection
- **Rate Limiting**: Prevents abuse with connection and message rate limits
- **User-Specific Broadcasting**: Sends updates only to relevant users
- **Connection Management**: Tracks active connections and cleans up stale ones
- **Security**: Follows AGENTS.md security guidelines

## Usage

### Client Connection

Connect to the WebSocket server at `/ws/plans`:

```javascript
const socket = io('/ws/plans', {
  auth: {
    token: 'your-jwt-token'
  }
});

// Listen for connection confirmation
socket.on('plan:connected', (data) => {
  console.log('Connected to plan updates:', data);
});

// Listen for plan updates
socket.on('plan:updated', (event) => {
  console.log('Plan updated:', event);
  // Update UI with new plan data
});

// Handle errors
socket.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### Server-Side Broadcasting

Broadcast plan updates from the server:

```javascript
import { broadcastPlanUpdate } from './services/plan-websocket.js';

// Broadcast to a specific user
broadcastPlanUpdate(userId, {
  plan: 'PRO',
  expiresAt: new Date(),
  entitlements: { /* ... */ }
});
```

### Integration with Billing System

Use the plan update broadcaster for automatic updates:

```javascript
import { broadcastPlanPurchase } from './services/plan-update-broadcaster.js';

// After successful plan purchase
await broadcastPlanPurchase(userId, planKey, subscriptionId);
```

## Events

### Client → Server

- `ping`: Heartbeat to keep connection alive
- `plan:subscribe`: Explicitly subscribe to plan updates
- `plan:unsubscribe`: Unsubscribe from plan updates

### Server → Client

- `plan:connected`: Connection confirmation
- `plan:updated`: Plan status update
- `plan:subscribed`: Subscription confirmation
- `plan:unsubscribed`: Unsubscription confirmation
- `pong`: Heartbeat response
- `error`: Error messages

## Security Features

- **JWT Verification**: All connections must provide valid Supabase JWT
- **Rate Limiting**: 
  - 10 connections per minute per user
  - 100 messages per minute per connection
- **Connection Cleanup**: Stale connections removed after 5 minutes
- **Audit Logging**: All connections and errors are logged
- **Data Masking**: User IDs are masked in logs for privacy

## Rate Limits

- Connection attempts: 10 per minute per user
- WebSocket messages: 100 per minute per connection
- Automatic cleanup of stale connections every 5 minutes

## Error Handling

The server handles various error scenarios:

- Invalid or missing JWT tokens
- Rate limit exceeded
- Connection failures
- Stale connection cleanup

All errors are logged with appropriate detail levels while protecting sensitive information.

## Monitoring

Use the WebSocket stats function to monitor connections:

```javascript
import { getWebSocketStats } from './services/plan-websocket.js';

const stats = getWebSocketStats();
console.log('Total connections:', stats.totalConnections);
console.log('User connections:', stats.getUserConnections(userId));
```