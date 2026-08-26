import { createHash, randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
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

export interface RedisJobQueueOptions {
  idempotencyTtlSeconds?: number;
  client?: RedisClientType;
}

export function createRedisJobQueue(
  redisUrl: string,
  options: RedisJobQueueOptions = {},
): JobQueue {
  const client = options.client ?? createClient({ url: redisUrl });
  client.on("error", () => undefined);
  const ttlSeconds = options.idempotencyTtlSeconds ?? 86_400;
  let connectOperation: Promise<void> | undefined;
  let closed = false;

  const connect = async (): Promise<void> => {
    if (closed) throw queueClosed();
    connectOperation ??= client.connect().then(() => undefined);
    try {
      await connectOperation;
    } catch (error) {
      connectOperation = undefined;
      throw error;
    }
  };

  return {
    async enqueue(name, payload, enqueueOptions) {
      requireIdempotencyKey(enqueueOptions.idempotencyKey);
      await connect();
      const key = idempotencyKey(name, enqueueOptions.idempotencyKey);
      const jobId = randomUUID();
      const existing = await client.get(key);
      if (existing) return { accepted: true, jobId: existing };
      const claimed = await client.set(key, jobId, { NX: true, EX: ttlSeconds });
      if (!claimed) {
        const concurrent = await client.get(key);
        if (concurrent) return { accepted: true, jobId: concurrent };
        throw new AppError({
          code: "QUEUE_UNAVAILABLE",
          message: "The job queue could not reserve an idempotency key.",
          statusCode: 503,
        });
      }
      await client.lPush(
        `ccpo:jobs:${name}`,
        JSON.stringify({ jobId, name, payload, enqueuedAt: new Date().toISOString() }),
      );
      await client.lTrim(`ccpo:jobs:${name}`, 0, 9_999);
      return { accepted: true, jobId };
    },
    async health() {
      try {
        await connect();
        await client.ping();
        return { ready: true };
      } catch {
        return { ready: false, code: "QUEUE_UNAVAILABLE" };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      connectOperation = undefined;
      if (client.isOpen) await client.quit();
    },
  };
}

function idempotencyKey(name: string, value: string): string {
  const digest = createHash("sha256").update(`${name}\0${value}`).digest("hex");
  return `ccpo:job:idempotency:${digest}`;
}

function queueClosed(): AppError {
  return new AppError({
    code: "QUEUE_UNAVAILABLE",
    message: "The job queue is closed.",
    statusCode: 503,
  });
}

const jobQueueCache = createJobQueueCache(() =>
  createRedisJobQueue(process.env.REDIS_URL ?? "redis://localhost:6379"),
);

export function getJobQueue(): Promise<JobQueue> {
  return jobQueueCache.get();
}

export function closeJobQueue(): Promise<void> {
  return jobQueueCache.close();
}
