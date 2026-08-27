import { randomUUID } from "node:crypto";

export interface TraceContext {
  traceId: string;
  spanId: string;
  flags: string;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;

export function createTraceContext(traceparent?: string, id = randomUUID): TraceContext {
  const parent = traceparent ? parseTraceparent(traceparent) : undefined;
  return {
    traceId: parent?.traceId ?? id().replaceAll("-", "").padEnd(32, "0").slice(0, 32),
    spanId: id().replaceAll("-", "").slice(0, 16).padEnd(16, "0"),
    flags: parent?.flags ?? "01",
  };
}

export function parseTraceparent(value: string): TraceContext | undefined {
  const match = TRACEPARENT.exec(value);
  const traceId = match?.[1];
  const spanId = match?.[2];
  const flags = match?.[3];
  if (!traceId || !spanId || !flags || /^0+$|^f+$/u.test(traceId) || /^0+$|^f+$/u.test(spanId)) {
    return undefined;
  }
  return { traceId, spanId, flags };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.flags}`;
}
