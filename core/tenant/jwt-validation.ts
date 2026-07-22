import { authError } from "./auth-errors.js";
import { isUserRole, type UserRole } from "./request-context.js";

export interface JwtClaimPolicy {
  issuer: string;
  audience: string;
  maxLifetimeSeconds: number;
  clockToleranceSeconds: number;
}

export interface VerifiedJwtAssertions {
  userId: string;
  tenantId: string;
  role: UserRole;
}

export interface VerifiedCookieJwtAssertions extends VerifiedJwtAssertions {
  familyId: string;
  csrfHash: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function validateJwtProtectedHeader(token: string): Readonly<{ typ: "JWT"; alg: "RS256" }> {
  try {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => !SEGMENT_PATTERN.test(segment))) {
      throw authError("AUTH_INVALID");
    }
    const encoded = segments[0]!;
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) throw authError("AUTH_INVALID");
    const headerText = decoded.toString("utf8");
    if (jsonKeyCount(headerText, "typ") !== 1 || jsonKeyCount(headerText, "alg") !== 1) {
      throw authError("AUTH_INVALID");
    }
    const header: unknown = JSON.parse(headerText);
    if (!isRecord(header)) throw authError("AUTH_INVALID");
    const keys = Object.keys(header).sort();
    if (keys.length !== 2 || keys[0] !== "alg" || keys[1] !== "typ") {
      throw authError("AUTH_INVALID");
    }
    if (header.typ !== "JWT" || header.alg !== "RS256") throw authError("AUTH_INVALID");
    return Object.freeze({ typ: "JWT", alg: "RS256" });
  } catch {
    throw authError("AUTH_INVALID");
  }
}

export function validateJwtClaims(
  payload: unknown,
  policy: JwtClaimPolicy,
  nowSeconds = Date.now() / 1000,
): Readonly<VerifiedJwtAssertions> {
  try {
    if (!isRecord(payload)) throw authError("AUTH_INVALID");
    if (payload.iss !== policy.issuer || payload.aud !== policy.audience) {
      throw authError("AUTH_INVALID");
    }
    if (!isCanonicalUuid(payload.sub) || !isCanonicalUuid(payload.tenant_id)) {
      throw authError("AUTH_INVALID");
    }
    if (!isUserRole(payload.role)) throw authError("AUTH_INVALID");
    if (typeof payload.jti !== "string" || payload.jti.trim().length === 0) {
      throw authError("AUTH_INVALID");
    }
    const issuedAt = numericDate(payload.iat);
    const expiresAt = numericDate(payload.exp);
    const notBefore = payload.nbf === undefined ? undefined : numericDate(payload.nbf);
    if (
      issuedAt > nowSeconds + policy.clockToleranceSeconds ||
      expiresAt < nowSeconds - policy.clockToleranceSeconds ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > policy.maxLifetimeSeconds ||
      (notBefore !== undefined && notBefore > nowSeconds + policy.clockToleranceSeconds)
    ) {
      throw authError("AUTH_INVALID");
    }
    return Object.freeze({
      userId: payload.sub,
      tenantId: payload.tenant_id,
      role: payload.role,
    });
  } catch {
    throw authError("AUTH_INVALID");
  }
}

export function validateCookieJwtClaims(
  payload: unknown,
  policy: JwtClaimPolicy,
  nowSeconds = Date.now() / 1000,
): Readonly<VerifiedCookieJwtAssertions> {
  try {
    const assertions = validateJwtClaims(payload, policy, nowSeconds);
    if (
      !isRecord(payload) ||
      !isCanonicalUuid(payload.sid) ||
      !isCanonicalHash(payload.csrf_hash)
    ) {
      throw authError("AUTH_INVALID");
    }
    return Object.freeze({
      ...assertions,
      familyId: payload.sid,
      csrfHash: payload.csrf_hash,
    });
  } catch {
    throw authError("AUTH_INVALID");
  }
}

function isCanonicalHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

function jsonKeyCount(json: string, key: "typ" | "alg"): number {
  const pattern = key === "typ" ? /"typ"\s*:/gu : /"alg"\s*:/gu;
  return json.match(pattern)?.length ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function numericDate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw authError("AUTH_INVALID");
  return value;
}
