import { EnvironmentValidationError, type EnvironmentSource } from "./env-schema.js";

export function value(source: EnvironmentSource, key: string, fallback = ""): string {
  return source[key]?.trim() || fallback;
}

export function required(source: EnvironmentSource, key: string, fallback = ""): string {
  const result = value(source, key, fallback);
  if (!result) throw new EnvironmentValidationError(`${key} is required.`);
  return result;
}

export function oneOf<const T extends readonly string[]>(
  source: EnvironmentSource,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const result = value(source, key, fallback);
  if (!allowed.includes(result)) {
    throw new EnvironmentValidationError(`${key} must be one of: ${allowed.join(", ")}.`);
  }
  return result;
}

export function booleanValue(source: EnvironmentSource, key: string, fallback: boolean): boolean {
  const result = value(source, key, String(fallback));
  if (result !== "true" && result !== "false") {
    throw new EnvironmentValidationError(`${key} must be true or false.`);
  }
  return result === "true";
}

export function numberValue(
  source: EnvironmentSource,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = Number(value(source, key, String(fallback)));
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new EnvironmentValidationError(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

export function integerValue(
  source: EnvironmentSource,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = numberValue(source, key, fallback, minimum, maximum);
  if (!Number.isSafeInteger(result)) {
    throw new EnvironmentValidationError(`${key} must be a whole number.`);
  }
  return result;
}

export function urlValue(
  source: EnvironmentSource,
  key: string,
  fallback: string,
  protocols: readonly string[],
): string {
  const result = required(source, key, fallback);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new EnvironmentValidationError(`${key} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new EnvironmentValidationError(`${key} uses an unsupported URL protocol.`);
  }
  return result;
}

export function optionalUrl(source: EnvironmentSource, key: string): string {
  const result = value(source, key);
  if (!result) return "";
  try {
    new URL(result);
  } catch {
    throw new EnvironmentValidationError(`${key} must be a valid URL when provided.`);
  }
  return result;
}

export function requireEnabledCredential(enabled: boolean, credential: string, key: string): void {
  if (enabled && !credential) {
    throw new EnvironmentValidationError(`${key} is required when its adapter is enabled.`);
  }
}

export function networkFallback(production: boolean, development: string): string {
  return production ? "" : development;
}
