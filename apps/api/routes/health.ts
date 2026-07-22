import type { FastifyInstance } from "fastify";
import type { DependencyHealth } from "../../../core/shared/db.js";

export type DatabaseProbe = () => Promise<DependencyHealth>;

export interface HealthRouteOptions {
  databaseProbe: DatabaseProbe;
  databaseTimeoutMs: number;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/db", async (_request, reply) => {
    if (await isDatabaseReady(options.databaseProbe, options.databaseTimeoutMs)) {
      return { status: "ok" };
    }
    return reply.code(503).send({ status: "unavailable" });
  });
}

async function isDatabaseReady(probe: DatabaseProbe, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(probe),
      new Promise<DependencyHealth>((resolve) => {
        timer = setTimeout(() => resolve({ ready: false }), timeoutMs);
      }),
    ]);
    return result.ready;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
