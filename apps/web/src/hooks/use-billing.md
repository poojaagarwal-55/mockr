# useBilling Hook - WebSocket Integration

## Overview

The `useBilling` hook has been enhanced with real-time WebSocket support to provide instant plan updates to users. This implementation follows the design specifications from the admin-panel-enhancements spec.

## Features

### 1. WebSocket Connection Management
- Automatically connects to `/ws/plans` endpoint when user is authenticated
- Uses JWT token authentication from the session
- Supports both WebSocket and polling transports for maximum compatibility

### 2. Real-time Plan Updates
- Listens for `plan:updated` events from the server
- Immediately updates the billing snapshot when plan changes occur
- Triggers a full refresh to ensure all data is synchronized

### 3. Connection State Tracking
- Tracks connection state: `disconnected`, `connecting`, `connected`, `error`
- Exposed via the `connectionState` property in the hook return value
- Can be used by UI components to show connection status indicators

### 4. Automatic Reconnection
- Implements exponential backoff for reconnection attempts
- Maximum of 5 reconnection attempts before falling back to polling
- Reconnection delay increases with each attempt (2s, 4s, 6s, 8s, 10s)

### 5. Fallback Polling Mechanism
- Activates when WebSocket connection fails after max reconnection attempts
- Polls the `/billing/snapshot` endpoint every 5 seconds
- Automatically stops after 30 seconds or when WebSocket reconnects
- Only polls when WebSocket is not connected to avoid redundant requests

### 6. Proper Cleanup
- Disconnects WebSocket on component unmount
- Clears all timers and intervals
- Prevents memory leaks and zombie connections

## Usage

The hook maintains backward compatibility with existing code:

```typescript
// Basic usage (existing code continues to work)
const { snapshot, loading, error, refresh } = useBilling();

// With connection state (new feature)
const { snapshot, loading, error, refresh, connectionState } = useBilling();
```

## Connection States

- `disconnected`: WebSocket is not connected
- `connecting`: Attempting to establish WebSocket connection
- `connected`: WebSocket is connected and ready
- `error`: Connection error occurred

## Event Flow

### Initial Load
1. Hook mounts and fetches initial billing snapshot via HTTP
2. WebSocket connection is established with JWT authentication
3. Server sends `plan:connected` confirmation
4. Hook is ready to receive real-time updates

### Plan Update
1. User purchases or activates a plan
2. Server broadcasts `plan:updated` event to user's WebSocket connection
3. Hook receives event and updates local state immediately
4. Hook triggers full refresh to ensure data consistency

### Connection Failure
1. WebSocket connection fails or disconnects
2. Hook attempts reconnection with exponential backoff
3. After 5 failed attempts, fallback polling activates
4. Polling continues for 30 seconds or until WebSocket reconnects

## Security

- JWT token authentication on WebSocket handshake
- Token is passed via `auth` parameter, not query string
- Connection is automatically closed when session expires
- Rate limiting is enforced on the server side

## Performance

- WebSocket provides instant updates with minimal overhead
- Fallback polling is time-limited to avoid excessive requests
- Only one WebSocket connection per user session
- Automatic cleanup prevents resource leaks

## Requirements Satisfied

This implementation satisfies the following requirements from the spec:

- **2.1**: Real-time update events when plan is activated or purchased
- **2.2**: Immediate header refresh when congratulations popup appears
- **2.3**: Plan badge updates without page refresh
- **2.5**: Fallback polling mechanism (5 seconds for up to 30 seconds)
- **2.6**: User-specific plan update broadcasting

## Testing

The implementation can be tested by:

1. **Manual Testing**: Purchase a plan and observe immediate badge update
2. **Connection Testing**: Disconnect network and verify fallback polling
3. **Reconnection Testing**: Restore network and verify WebSocket reconnects
4. **Cleanup Testing**: Navigate away and verify WebSocket disconnects

## Future Enhancements

Potential improvements for future iterations:

- Visual connection status indicator in UI
- Retry button for failed connections
- Configurable polling intervals
- WebSocket heartbeat/ping mechanism
- Connection quality metrics
