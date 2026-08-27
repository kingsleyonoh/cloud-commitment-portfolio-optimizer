import { Pool, type PoolConfig } from "pg";

import type { DatabaseConfig } from "../config/env.js";
import { AppError } from "./errors.js";
import { createManagedCache, type ManagedCache } from "./lifecycle.js";

export interface DependencyHealth {
  ready: boolean;
  code?: string;
}

export interface DbPoolResource {
  pool: Pool;
  health(): Promise<DependencyHealth>;
  close(): Promise<void>;
}

export type DbPoolFactory = () => DbPoolResource | Promise<DbPoolResource>;

export function createDbPoolCache(factory: DbPoolFactory): ManagedCache<DbPoolResource> {
  return createManagedCache(factory, (resource) => resource.close());
}

export function toPgPoolConfig(config: DatabaseConfig): PoolConfig {
  return {
    connectionString: config.url,
    max: config.pool.max,
    idleTimeoutMillis: config.pool.idleTimeoutMillis,
    connectionTimeoutMillis: config.pool.connectionTimeoutMillis,
  };
}

export function createAppDbPoolResource(config: DatabaseConfig): DbPoolResource {
  return createPgDbPoolResource(toPgPoolConfig(config));
}

export function createPgDbPoolResource(config: PoolConfig): DbPoolResource {
  const pool = new Pool(config);
  let closed = false;
  return {
    pool,
    async health() {
      if (closed) return { ready: false, code: "DB_POOL_CLOSED" };
      await pool.query("SELECT 1");
      return { ready: true };
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

let configuredPool: DatabaseConfig | undefined;
const dbPoolCache = createDbPoolCache(() => {
  if (!configuredPool) {
    throw new AppError({
      code: "DB_POOL_NOT_CONFIGURED",
      message: "The database pool has not been configured.",
      statusCode: 503,
    });
  }
  return createAppDbPoolResource(configuredPool);
});

export function getDbPool(config: DatabaseConfig): Promise<DbPoolResource> {
  configuredPool ??= structuredClone(config);
  return dbPoolCache.get();
}

export async function closeDbPool(): Promise<void> {
  try {
    await dbPoolCache.close();
  } finally {
    configuredPool = undefined;
  }
}
