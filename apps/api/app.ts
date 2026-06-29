import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "../../core/shared/config.js";

export interface BuildAppOptions {
  config?: AppConfig;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  return Fastify({
    logger: {
      level: config.app.logLevel,
      redact: ["req.headers.authorization", "req.headers.x-api-key"],
    },
  });
}
