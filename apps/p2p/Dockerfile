# apps/p2p/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json turbo.json tsconfig.base.json ./

COPY packages/ ./packages/

COPY apps/p2p/package.json apps/p2p/tsconfig.json ./apps/p2p/
COPY apps/p2p/src/ ./apps/p2p/src/

RUN npm ci --workspace=apps/p2p --workspace=packages/db --workspace=packages/shared --include-workspace-root

RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

RUN cd packages/db && npx tsc || true
RUN cd packages/shared && npx tsc || true
RUN node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('packages/shared/package.json','utf8')); p.main='./dist/index.js'; fs.writeFileSync('packages/shared/package.json',JSON.stringify(p,null,2))"

RUN npm run build --workspace=apps/p2p

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

COPY --from=builder /app/node_modules/ ./node_modules/

COPY --from=builder /app/packages/ ./packages/

COPY --from=builder /app/apps/p2p/package.json ./apps/p2p/
COPY --from=builder /app/apps/p2p/dist/ ./apps/p2p/dist/

ENV NODE_ENV=production
ENV PORT=8080
ENV P2P_PORT=8080
ENV P2P_HOST=0.0.0.0

EXPOSE 8080

CMD ["node", "apps/p2p/dist/index.js"]
