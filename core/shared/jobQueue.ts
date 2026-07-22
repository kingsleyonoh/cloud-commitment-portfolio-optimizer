import { AppError } from "./errors.js";
import { createManagedCache, type ManagedCache } from "./lifecycle.js";

export interface QueueHealth {
  ready: boolean;
  code?: string;
}

export interface EnqueueOptions {
  idempotencyKey: string;
}

export interface EnqueueResult {
  accepted: true;
  jobId: string;
}

export interface JobQueue {
  enqueue(
    name: string,
    payload: Readonly<Record<string, unknown>>,
    options: EnqueueOptions,
  ): Promise<EnqueueResult>;
  health(): Promise<QueueHealth>;
  close(): Promise<void>;
}

export type JobQueueFactory = () => JobQueue | Promise<JobQueue>;

export function createJobQueueCache(factory: JobQueueFactory): ManagedCache<JobQueue> {
  return createManagedCache(factory, (queue) => queue.close());
}

export function createDisabledJobQueue(): JobQueue {
  return {
    async enqueue(_name, _payload, options) {
      requireIdempotencyKey(options.idempotencyKey);
      throw new AppError({
        code: "QUEUE_ADAPTER_DISABLED",
        message: "The job queue adapter is disabled.",
        statusCode: 503,
      });
    },
    async health() {
      return { ready: false, code: "QUEUE_ADAPTER_DISABLED" };
    },
    async close() {},
  };
}

export function requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey.trim()) {
    throw new AppError({
      code: "QUEUE_IDEMPOTENCY_KEY_REQUIRED",
      message: "A non-empty queue idempotency key is required.",
      statusCode: 400,
    });
  }
}

const jobQueueCache = createJobQueueCache(createDisabledJobQueue);

export function getJobQueue(): Promise<JobQueue> {
  return jobQueueCache.get();
}

export function closeJobQueue(): Promise<void> {
  return jobQueueCache.close();
}
