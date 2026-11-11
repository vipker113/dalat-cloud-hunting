# syntax=docker/dockerfile:1
FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# 1. Install dependencies across workspace
COPY package.json bun.lock* ./
COPY packages/protocol/package.json ./packages/protocol/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN bun install

# 2. Copy full workspace source and build 3D Web Frontend
COPY packages ./packages
COPY apps ./apps
RUN bun run build

# 3. Runtime configuration
ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567

# Persistent storage directory for Polaroid photo walls & wind-chime wishes
RUN mkdir -p /app/apps/server/data
VOLUME ["/app/apps/server/data"]

CMD ["bun", "run", "start"]
