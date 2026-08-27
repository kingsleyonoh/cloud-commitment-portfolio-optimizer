export interface AppErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  details?: readonly unknown[];
}

export interface ErrorFallback {
  code?: string;
  message?: string;
  statusCode?: number;
  correlationId?: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: readonly unknown[];
  };
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: readonly unknown[];

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? [];
  }
}

export function normalizeError(error: unknown, fallback: ErrorFallback = {}): AppError {
  if (error instanceof AppError) return error;
  const details = fallback.correlationId ? [{ reference: fallback.correlationId }] : [];
  return new AppError({
    code: fallback.code ?? "INTERNAL_ERROR",
    message: fallback.message ?? "An unexpected error occurred.",
    statusCode: fallback.statusCode ?? 500,
    details,
  });
}

export function toErrorEnvelope(error: unknown, correlationId?: string): ErrorEnvelope {
  const normalized = normalizeError(error, correlationId ? { correlationId } : {});
  return {
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  };
}
