import { authError } from "./auth-errors.js";

export interface ArgonExecutorOptions {
  concurrency: number;
  queueLimit: number;
}

export interface ArgonExecutorSnapshot {
  active: number;
  queued: number;
  closed: boolean;
}

export interface ArgonExecutor {
  run<T>(operation: () => Promise<T>): Promise<T>;
  snapshot(): ArgonExecutorSnapshot;
  close(): void;
}

interface QueuedOperation<T = unknown> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface ExecutorState {
  options: ArgonExecutorOptions;
  active: number;
  closed: boolean;
  queue: QueuedOperation[];
}

export class ArgonExecutorConfigurationError extends Error {
  constructor() {
    super("Argon executor bounds are invalid.");
    this.name = "ArgonExecutorConfigurationError";
  }
}

export const MAX_ARGON_CONCURRENCY = 2;
export const MAX_ARGON_QUEUE_LIMIT = 32;

export function createArgonExecutor(options: ArgonExecutorOptions): ArgonExecutor {
  validateBounds(options);
  const state: ExecutorState = { options, active: 0, closed: false, queue: [] };
  return {
    run: <T>(operation: () => Promise<T>) => schedule(state, operation),
    snapshot: () => ({
      active: state.active,
      queued: state.queue.length,
      closed: state.closed,
    }),
    close: () => closeExecutor(state),
  };
}

function schedule<T>(state: ExecutorState, operation: () => Promise<T>): Promise<T> {
  if (state.closed) return Promise.reject(unavailable());
  return new Promise<T>((resolve, reject) => {
    const item: QueuedOperation<T> = { operation, resolve, reject };
    if (state.active < state.options.concurrency) {
      start(state, item as QueuedOperation);
      return;
    }
    if (state.queue.length >= state.options.queueLimit) {
      reject(unavailable());
      return;
    }
    state.queue.push(item as QueuedOperation);
  });
}

function start(state: ExecutorState, item: QueuedOperation): void {
  state.active += 1;
  void Promise.resolve()
    .then(item.operation)
    .then(item.resolve, () => item.reject(unavailable()))
    .finally(() => {
      state.active -= 1;
      drain(state);
    });
}

function drain(state: ExecutorState): void {
  while (!state.closed && state.active < state.options.concurrency && state.queue.length > 0) {
    start(state, state.queue.shift()!);
  }
}

function closeExecutor(state: ExecutorState): void {
  if (state.closed) return;
  state.closed = true;
  for (const item of state.queue.splice(0)) item.reject(unavailable());
}

function validateBounds(options: ArgonExecutorOptions): void {
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > MAX_ARGON_CONCURRENCY ||
    !Number.isSafeInteger(options.queueLimit) ||
    options.queueLimit < 0 ||
    options.queueLimit > MAX_ARGON_QUEUE_LIMIT
  ) {
    throw new ArgonExecutorConfigurationError();
  }
}

function unavailable(): Error {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
