# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS node-deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM alpine:3.20 AS zig
ARG ZIG_VERSION=0.14.0
RUN apk add --no-cache curl xz tar
WORKDIR /tmp
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" -o zig.tar.xz   && tar -xf zig.tar.xz   && mv "zig-linux-x86_64-${ZIG_VERSION}" /zig
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
USER app
EXPOSE 8080
CMD ["node", "dist/apps/api/server.js"]
