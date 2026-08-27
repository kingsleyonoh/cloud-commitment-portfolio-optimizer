import { authError } from "./auth-errors.js";
import {
  digestSecretBase64url,
  isCanonicalOpaqueSecret,
  safeStringEqual,
} from "./auth-session-crypto.js";

export type SessionHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface AccessCookieProof {
  method: string;
  headers: SessionHeaders;
  csrfCookie: string | undefined;
  expectedOrigin: string;
}

export function assertCanonicalCookie(
  rawCookie: string | undefined,
  name: string,
  parsedValue: string | undefined,
  code: "AUTH_INVALID" | "CSRF_INVALID",
): string | undefined {
  const count = (rawCookie ?? "")
    .split(";")
    .filter((part) => part.split("=", 1)[0]?.trim() === name).length;
  if ((parsedValue === undefined && count !== 0) || (parsedValue !== undefined && count !== 1)) {
    throw authError(code);
  }
  return parsedValue;
}

export function assertSameOrigin(headers: SessionHeaders, expectedOrigin: string): void {
  const origin = oneHeader(headers.origin);
  const fetchSite = optionalOneHeader(headers["sec-fetch-site"]);
  if (!origin || origin !== expectedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    throw authError("CSRF_INVALID");
  }
}

export function assertDoubleSubmit(
  headers: SessionHeaders,
  csrfCookie: string | undefined,
): string {
  const csrfHeader = oneHeader(headers["x-csrf-token"]);
  if (
    !csrfHeader ||
    !isCanonicalOpaqueSecret(csrfCookie) ||
    !isCanonicalOpaqueSecret(csrfHeader) ||
    !safeStringEqual(csrfCookie, csrfHeader)
  ) {
    throw authError("CSRF_INVALID");
  }
  return csrfHeader;
}

export function assertAccessCookieProof(proof: AccessCookieProof, csrfHash: string): void {
  if (!isUnsafe(proof.method)) return;
  assertSameOrigin(proof.headers, proof.expectedOrigin);
  const csrf = assertDoubleSubmit(proof.headers, proof.csrfCookie);
  if (!safeStringEqual(digestSecretBase64url(csrf), csrfHash)) {
    throw authError("CSRF_INVALID");
  }
}

function isUnsafe(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function oneHeader(input: string | readonly string[] | undefined): string | undefined {
  if (typeof input !== "string" || !input || input.includes(",")) return undefined;
  return input;
}

function optionalOneHeader(input: string | readonly string[] | undefined): string | undefined {
  if (input === undefined) return undefined;
  return oneHeader(input) ?? "invalid";
}
