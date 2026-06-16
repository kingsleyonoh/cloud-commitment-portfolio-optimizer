# syntax=docker/dockerfile:1.7

# Cloud Commitment Portfolio Optimizer
# Multi-stage reference container for the TypeScript API/UI/worker and Zig optimizer binaries.

FROM node:22-alpine AS node-deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM alpine:3.20 AS zig-build
ARG ZIG_VERSION=0.14.0
WORKDIR /src
RUN apk add --no-cache curl xz tar
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz \
  && tar -C /opt -xf /tmp/zig.tar.xz \
  && ln -s "/opt/zig-linux-x86_64-${ZIG_VERSION}/zig" /usr/local/bin/zig
COPY build.zig build.zig.zon* ./
COPY core/optimizer ./core/optimizer
COPY core/replay ./core/replay
RUN if [ -f build.zig ]; then zig build test && zig build -Doptimize=ReleaseSafe; fi

FROM node:22-alpine AS app-build
WORKDIR /app
COPY --from=node-deps /app/node_modules ./node_modules
COPY . .
COPY --from=zig-build /src/zig-out ./zig-out
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=app-build /app/package*.json ./
COPY --from=app-build /app/node_modules ./node_modules
COPY --from=app-build /app/dist ./dist
COPY --from=app-build /app/zig-out ./zig-out
COPY --from=app-build /app/db ./db
USER app
EXPOSE 8080
CMD ["node", "dist/apps/api/server.js"]
