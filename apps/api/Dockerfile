# apps/api/Dockerfile
# Build timestamp: 2026-05-02T23:45:00Z
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies (needed for native modules like bcrypt)
RUN apk add --no-cache python3 make g++

# Copy root manifest files
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy packages (shared, db)
COPY packages/ ./packages/

# Copy API app (including tsconfig.json)
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/

# Install ALL workspace dependencies from root
RUN npm ci --workspace=apps/api --workspace=packages/db --workspace=packages/shared --include-workspace-root

# Generate Prisma Client so it's available in node_modules
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# Build workspace packages (so dist/index.js exists for production node)
RUN cd packages/db && npx tsc || true
RUN cd packages/shared && npx tsc || true
# Patch shared package.json so Node runtime resolves dist/index.js (not src/index.ts)
RUN node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('packages/shared/package.json','utf8')); p.main='./dist/index.js'; fs.writeFileSync('packages/shared/package.json',JSON.stringify(p,null,2))"

# Build TypeScript
RUN npm run build --workspace=apps/api

# ── Production Image ──
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# Copy node_modules (includes all workspace deps and Prisma)
COPY --from=builder /app/node_modules/ ./node_modules/

# Copy packages
COPY --from=builder /app/packages/ ./packages/

# Copy built API
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist/ ./apps/api/dist/

# Copy LaTeX template files (loaded at runtime via fs.readFileSync)
COPY --from=builder /app/apps/api/src/services/templates_tmp/ ./apps/api/dist/services/templates_tmp/

# Set env vars
ENV NODE_ENV=production
ENV API_PORT=8080
ENV API_HOST=0.0.0.0

EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
