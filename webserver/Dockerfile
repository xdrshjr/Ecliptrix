# syntax=docker/dockerfile:1
#
# Multi-stage build for the Ecliptrix account server.
#
# The runtime stage carries only the standalone bundle, production node_modules and
# the SQL migrations — no compiler, no devDependencies, no source. `better-sqlite3`
# ships prebuilt binaries for node:22-alpine, which is why the image stays small.

ARG NODE_VERSION=22

# ---------- deps ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# Build tools are only needed if the prebuilt better-sqlite3 binary is unavailable
# for this platform; keeping them in the deps stage keeps them out of runtime.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- builder ----------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8787 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrations are read from disk at boot, so they must exist in the image.
COPY --from=builder --chown=nextjs:nodejs /app/src/server/db/migrations ./migrations

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
USER nextjs

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `MIGRATIONS_DIR` points the resolver at the copy above; production runs with
# AUTO_MIGRATE=false so schema changes are an explicit deploy step.
ENV MIGRATIONS_DIR=/app/migrations

CMD ["node", "server.js"]
