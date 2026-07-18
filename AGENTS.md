# AGENTS.md — Mockr

## Security — Non-Negotiable

### Authentication & Authorization
- Every API route MUST verify the session token before doing anything else
- Use middleware — never repeat auth checks inside route handlers
- Never trust the client for user identity — always derive userId from the verified session, never from request body or query params
- Implement row-level security (RLS) in Supabase for all tables
- All admin routes must have a separate admin role check — never just isLoggedIn

### Input Validation
- Validate EVERY input with Zod before it touches business logic or the database
- Never pass raw request bodies to Prisma or SQL
- Validate file uploads: type (PDF only for resumes), size (max 5MB), MIME type check on server not just extension
- Sanitize all markdown before rendering — use DOMPurify on client, sanitize-html on server

### Code Execution Security (Critical)
- NEVER execute user-submitted code on the main application server
- ALL code execution goes through Judge0 exclusively
- Judge0 must run in an isolated Docker container with:
  - No network access inside the sandbox
  - CPU time limits (5 seconds hard limit)
  - Memory limits (256MB hard limit)
  - No filesystem access outside the sandbox
- Never log user code to application logs (privacy + security)
- Validate Judge0 responses — never trust the execution result without status checking

### API Security
- Rate limit every endpoint — especially auth, code execution, and AI endpoints
- Use different rate limit windows per endpoint type
- CORS: whitelist only your domain — never * in production
- All cookies: httpOnly: true, secure: true, sameSite: 'strict'

### Data Security
- Never log: passwords, tokens, API keys, resume content, code submissions, personal data
- Encrypt sensitive fields at rest (resume summaries, AI analysis) using AES-256
- Signed URLs for R2 files — never expose direct bucket URLs
- Signed URLs must have short expiry (1 hour max for resumes)
- Never return sensitive fields in API responses — use explicit select/include in Prisma, never return entire model objects
- PII in logs must be masked: user-${userId.slice(0,8)}... not full IDs

### Environment Variables
- Never hardcode secrets, API keys, or connection strings
- Every secret lives in .env and .env.example (with placeholder values)
- Validate all required env vars at startup — crash fast if missing

### WebSocket Security
- Authenticate WebSocket connections on handshake — not after
- Validate sessionId on every WebSocket message
- Rate limit WebSocket messages per connection
- Disconnect and log suspicious connections (too many messages, invalid payloads)
