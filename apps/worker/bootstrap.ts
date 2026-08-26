import type { AppConfig } from "../../core/config/env.js";
import { getEnvironmentConfig } from "../../core/config/env.js";
import { createForecastRepository } from "../../core/forecasting/forecast-repository.js";
import { createForecastWorker } from "../../core/forecasting/forecast-worker.js";
import { getDbPool, type DbPoolResource } from "../../core/shared/db.js";
import { getJobQueue, type JobQueue } from "../../core/shared/jobQueue.js";
import type { Logger } from "../../core/shared/logger.js";
import { getLogger } from "../../core/shared/logger.js";
import { getObjectStore, type ObjectStore } from "../../core/shared/objectStore.js";
import { buildWorker, type BuildWorkerOptions, type WorkerApplication } from "./app.js";
import { createWorkerRuntimeCloser, type WorkerResourceName } from "./resources.js";

export interface RunningWorker {
  close(): Promise<void>;
}

export interface BootstrapWorkerOptions {
  getConfig?: () => Promise<Readonly<AppConfig>>;
  getLogger?: () => Promise<Logger>;
  getQueue?: () => Promise<JobQueue>;
  getDatabase?: (config: AppConfig["database"]) => Promise<DbPoolResource>;
  getObjectStore?: (rootPath: string) => Promise<ObjectStore>;
  buildApplication?: (options: BuildWorkerOptions) => WorkerApplication;
  createCloser?: (
    worker: WorkerApplication | undefined,
    initialized: ReadonlySet<WorkerResourceName>,
  ) => () => Promise<void>;
}

export async function bootstrapWorker(
  options: BootstrapWorkerOptions = {},
): Promise<RunningWorker> {
  const initialized = new Set<WorkerResourceName>();
  let worker: WorkerApplication | undefined;
  let close: (() => Promise<void>) | undefined;
  try {
    const config = await (options.getConfig ?? getEnvironmentConfig)();
    initialized.add("environment");
    const logger = await (options.getLogger ?? getLogger)();
    initialized.add("logger");
    const queue = await (options.getQueue ?? getJobQueue)();
    initialized.add("jobQueue");
    const database = await (options.getDatabase ?? getDbPool)(config.database);
    initialized.add("database");
    const objectStore = await (options.getObjectStore ?? getObjectStore)(
      config.storage.objectStoragePath,
    );
    initialized.add("objectStore");
    worker = (options.buildApplication ?? buildWorker)({
      queue,
      logger,
      forecasts: createForecastWorker(createForecastRepository(database.pool), objectStore, {
        minHistoryDays: config.forecasting.minHistoryDays,
      }),
    });
    close = (options.createCloser ?? createWorkerRuntimeCloser)(worker, initialized);
    await worker.start();
    return { close };
  } catch (error) {
    close ??= (options.createCloser ?? createWorkerRuntimeCloser)(worker, initialized);
    await closeAfterFailure(close, error);
    throw error;
  }
}

async function closeAfterFailure(close: () => Promise<void>, primary: unknown): Promise<void> {
  try {
    await close();
  } catch (cleanup) {
    throw new AggregateError([primary, cleanup], "Worker startup and cleanup failed.", {
      cause: primary,
    });
  }
}
