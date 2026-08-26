import type { FastifyInstance } from "fastify";
import type { DependencyHealth } from "../../../core/shared/db.js";
import type { ObjectStoreHealth } from "../../../core/shared/objectStore.js";

export type DatabaseProbe = () => Promise<DependencyHealth>;

export interface HealthRouteOptions {
  databaseProbe: DatabaseProbe;
  databaseTimeoutMs: number;
  objectStoreProbe?: () => Promise<ObjectStoreHealth>;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/db", async (_request, reply) => {
    if (await isDatabaseReady(options.databaseProbe, options.databaseTimeoutMs)) {
      return { status: "ok" };
    }
    return reply.code(503).send({ status: "unavailable" });
  });
  app.get("/health/ready", async (_request, reply) => {
    const dependencies = await readiness(options);
    const statuses = dependencyStatuses(dependencies);
    if (Object.values(dependencies).every((dependency) => dependency.ready)) {
      return { status: "ok", dependencies: statuses };
    }
    return reply.code(503).send({ status: "unavailable", dependencies: statuses });
  });
}

async function readiness(
  options: HealthRouteOptions,
): Promise<{ database: DependencyHealth; object_store: ObjectStoreHealth }> {
  const [database, objectStore] = await Promise.all([
    boundedProbe(options.databaseProbe, options.databaseTimeoutMs),
    options.objectStoreProbe
      ? boundedProbe(options.objectStoreProbe, options.databaseTimeoutMs)
      : Promise.resolve({ ready: true } satisfies ObjectStoreHealth),
  ]);
  return { database, object_store: objectStore };
}

function dependencyStatuses(
  dependencies: Readonly<Record<string, DependencyHealth>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, dependency]) => [
      name,
      dependency.ready ? "ok" : "unavailable",
    ]),
  );
}

async function isDatabaseReady(probe: DatabaseProbe, timeoutMs: number): Promise<boolean> {
  return (await boundedProbe(probe, timeoutMs)).ready;
}

async function boundedProbe(
  probe: () => Promise<DependencyHealth>,
  timeoutMs: number,
): Promise<DependencyHealth> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(probe),
      new Promise<DependencyHealth>((resolve) => {
        timer = setTimeout(() => resolve({ ready: false }), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    return { ready: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
