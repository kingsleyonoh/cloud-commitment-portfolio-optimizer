# syntax=docker/dockerfile:1.7
# TypeScript application/migration build and the Zig package artifact boundary are active.

FROM node:22-alpine AS node-deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM alpine:3.20 AS zig
ARG ZIG_VERSION=0.14.1
ENV ZIG_ARCHIVE_SIZE=49086504
ENV ZIG_SHA256=24aeeec8af16c381934a6cd7d95c807a8cb2cf7df9fa40d359aa884195c4716c
RUN apk add --no-cache curl xz tar
WORKDIR /tmp
RUN curl --proto '=https' --tlsv1.2 -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o zig.tar.xz \
  && test "$(wc -c < zig.tar.xz)" -eq "$ZIG_ARCHIVE_SIZE" \
  && echo "$ZIG_SHA256  zig.tar.xz" | sha256sum -c - \
  && tar -xf zig.tar.xz \
  && mv "zig-x86_64-linux-${ZIG_VERSION}" /zig
ENV PATH="/zig:${PATH}"

FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=node-deps /app/node_modules ./node_modules
COPY . .
COPY --from=zig /zig /zig
ENV PATH="/zig:${PATH}"
RUN npm run build
RUN zig build -Doptimize=ReleaseSafe

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/zig-out ./zig-out
COPY --from=build /app/db ./db
COPY --from=build /app/tests/fixtures ./tests/fixtures
COPY --from=build /app/core/reports/templates ./dist/core/reports/templates
COPY --from=build /app/core/notifications/templates ./dist/core/notifications/templates
USER app
EXPOSE 8080
CMD ["node", "dist/apps/api/server.js"]
