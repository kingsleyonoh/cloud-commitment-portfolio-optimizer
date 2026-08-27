import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AppError } from "./errors.js";
import { createManagedCache, type ManagedCache } from "./lifecycle.js";

export interface DuckdbHealth {
  ready: boolean;
  code?: string;
}

export interface DuckdbEngine {
  execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  close(): Promise<void>;
}

export interface DuckdbSession extends DuckdbEngine {
  readonly workspacePath: string;
}

export interface DuckdbAnalytics {
  openSession(): Promise<DuckdbSession>;
  health(): Promise<DuckdbHealth>;
  close(): Promise<void>;
}

export type DuckdbEngineFactory = (workspacePath: string) => Promise<DuckdbEngine>;
export type DuckdbAnalyticsFactory = () => DuckdbAnalytics | Promise<DuckdbAnalytics>;

export interface DuckdbManagerOptions {
  tempRoot: string;
  engineFactory: DuckdbEngineFactory;
}

export function createDuckdbAnalyticsCache(
  factory: DuckdbAnalyticsFactory,
): ManagedCache<DuckdbAnalytics> {
  return createManagedCache(factory, (manager) => manager.close());
}

export function createUnavailableDuckdbAnalytics(): DuckdbAnalytics {
  return {
    async openSession() {
      throw unavailableError();
    },
    async health() {
      return { ready: false, code: "DUCKDB_ADAPTER_UNAVAILABLE" };
    },
    async close() {},
  };
}

export function createDuckdbAnalyticsManager(options: DuckdbManagerOptions): DuckdbAnalytics {
  const sessions = new Set<DuckdbSession>();
  let closed = false;
  return {
    async openSession() {
      if (closed) throw managerClosedError();
      await mkdir(options.tempRoot, { recursive: true });
      const workspace = await mkdtemp(join(resolve(options.tempRoot), "session-"));
      try {
        const engine = await options.engineFactory(workspace);
        const session = createSession(engine, workspace, () => sessions.delete(session));
        sessions.add(session);
        return session;
      } catch (error) {
        await rm(workspace, { recursive: true, force: true });
        throw error;
      }
    },
    async health() {
      if (closed) return { ready: false, code: "DUCKDB_MANAGER_CLOSED" };
      return { ready: true };
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...sessions].map((session) => session.close()));
    },
  };
}

function createSession(
  engine: DuckdbEngine,
  workspacePath: string,
  onClose: () => void,
): DuckdbSession {
  let closed = false;
  return {
    workspacePath,
    async execute(sql, parameters) {
      assertSessionOpen(closed);
      await engine.execute(sql, parameters);
    },
    async query<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) {
      assertSessionOpen(closed);
      return engine.query<T>(sql, parameters);
    },
    async close() {
      if (closed) return;
      closed = true;
      let failure: unknown;
      try {
        await engine.close();
      } catch (error) {
        failure = error;
      }
      try {
        await rm(workspacePath, { recursive: true, force: true });
      } catch (error) {
        failure ??= error;
      } finally {
        onClose();
      }
      if (failure) throw failure;
    },
  };
}

function assertSessionOpen(closed: boolean): void {
  if (closed) throw managerClosedError();
}

function unavailableError(): AppError {
  return new AppError({
    code: "DUCKDB_ADAPTER_UNAVAILABLE",
    message: "The DuckDB analytics adapter is unavailable.",
    statusCode: 503,
  });
}

function managerClosedError(): AppError {
  return new AppError({
    code: "DUCKDB_MANAGER_CLOSED",
    message: "The DuckDB analytics manager is closed.",
    statusCode: 503,
  });
}

const duckdbAnalyticsCache = createDuckdbAnalyticsCache(createUnavailableDuckdbAnalytics);

export function getDuckdbAnalytics(): Promise<DuckdbAnalytics> {
  return duckdbAnalyticsCache.get();
}

export function closeDuckdbAnalytics(): Promise<void> {
  return duckdbAnalyticsCache.close();
}
