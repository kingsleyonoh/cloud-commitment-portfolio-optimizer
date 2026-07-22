import { AppError } from "./errors.js";
import { createManagedCache, type ManagedCache } from "./lifecycle.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogAttributes = Readonly<Record<string, unknown>>;

export interface LogSink {
  write(record: string, level?: LogLevel): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface Logger {
  debug(event: string, attributes?: LogAttributes): Promise<void>;
  info(event: string, attributes?: LogAttributes): Promise<void>;
  warn(event: string, attributes?: LogAttributes): Promise<void>;
  error(event: string, attributes?: LogAttributes): Promise<void>;
  child(context: LogAttributes): Logger;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface LoggerOptions {
  sink?: LogSink;
  clock?: () => Date;
  context?: LogAttributes;
}

interface LoggerState {
  sink: LogSink;
  clock: () => Date;
  closed: boolean;
}

const SENSITIVE_KEY =
  /(?:authorization|cookie|set.?cookie|password|passwd|secret|token|csrf|digest|phc|claims?|headers?|request.?body|email|client.?ip|raw.?ip|api.?key|dsn|database.?url|redis.?url|connection.?url|private.?key)/iu;
const CONNECTION_URL = /\b(?:postgres(?:ql)?|redis(?:s)?|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]+/giu;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/giu;
const SECRET_ASSIGNMENT =
  /\b(authorization|cookie|credential|password|passwd|secret|token|api.?key|client.?secret|private.?key)(\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const VERSIONED_API_KEY = /\b[a-z][a-z0-9]{0,15}_live_v1_[A-Za-z0-9_-]{43}\b/gu;
const STORED_API_KEY_HASH = /\b[0-9a-f]{64}\b/giu;

export function createLogger(options: LoggerOptions = {}): Logger {
  const state: LoggerState = {
    sink: options.sink ?? createProcessLogSink(),
    clock: options.clock ?? (() => new Date()),
    closed: false,
  };
  return buildLogger(state, options.context ?? {});
}

export function createLoggerCache(factory: () => Logger | Promise<Logger>): ManagedCache<Logger> {
  return createManagedCache(factory, (logger) => logger.close());
}

function buildLogger(state: LoggerState, context: LogAttributes): Logger {
  const emit = (level: LogLevel, event: string, attributes: LogAttributes = {}) =>
    emitRecord(state, context, level, event, attributes);
  return {
    debug: (event, attributes) => emit("debug", event, attributes),
    info: (event, attributes) => emit("info", event, attributes),
    warn: (event, attributes) => emit("warn", event, attributes),
    error: (event, attributes) => emit("error", event, attributes),
    child: (childContext) => buildLogger(state, { ...context, ...childContext }),
    flush: () => flushLogger(state),
    close: () => closeLoggerState(state),
  };
}

async function emitRecord(
  state: LoggerState,
  context: LogAttributes,
  level: LogLevel,
  event: string,
  attributes: LogAttributes,
): Promise<void> {
  assertLoggerOpen(state);
  const record = {
    ...redactRecord(attributes),
    ...redactRecord(context),
    timestamp: state.clock().toISOString(),
    level,
    event: redactString(event),
  };
  await state.sink.write(JSON.stringify(record), level);
}

async function flushLogger(state: LoggerState): Promise<void> {
  assertLoggerOpen(state);
  await state.sink.flush?.();
}

async function closeLoggerState(state: LoggerState): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  let failure: unknown;
  try {
    await state.sink.flush?.();
  } catch (error) {
    failure = error;
  }
  try {
    await state.sink.close?.();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

function redactRecord(input: LogAttributes): Record<string, unknown> {
  return redactObject(input, new WeakSet<object>());
}

function redactObject(input: object, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(input)) return { circular: "[REDACTED]" };
  seen.add(input);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(value, seen);
  }
  return output;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) return { name: value.name, message: "[REDACTED_ERROR]" };
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value && typeof value === "object") return redactObject(value, seen);
  return value;
}

function redactString(value: string): string {
  return value
    .replace(CONNECTION_URL, "[REDACTED_URL]")
    .replace(BEARER_VALUE, "[REDACTED]")
    .replace(VERSIONED_API_KEY, "[REDACTED_CREDENTIAL]")
    .replace(STORED_API_KEY_HASH, "[REDACTED_HASH]")
    .replace(SECRET_ASSIGNMENT, "$1$2[REDACTED]");
}

function assertLoggerOpen(state: LoggerState): void {
  if (state.closed) {
    throw new AppError({
      code: "LOGGER_CLOSED",
      message: "The logger is closed.",
      statusCode: 503,
    });
  }
}

function createProcessLogSink(): LogSink {
  return {
    write(record, level = "info") {
      const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
      return new Promise<void>((resolve, reject) => {
        stream.write(`${record}\n`, (error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const loggerCache = createLoggerCache(async () => createLogger());

export function getLogger(): Promise<Logger> {
  return loggerCache.get();
}

export function closeLogger(): Promise<void> {
  return loggerCache.close();
}
