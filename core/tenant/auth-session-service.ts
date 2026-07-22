import { randomUUID } from "node:crypto";

import { AppError } from "../shared/errors.js";
import type { ArgonExecutor } from "./argon-executor.js";
import { authError } from "./auth-errors.js";
import type { AuthLoginRepository } from "./auth-login-repository.js";
import type { AuthLogoutRepository } from "./auth-logout-repository.js";
import type { AuthRefreshRepository } from "./auth-refresh-repository.js";
import {
  createOpaqueSecret,
  digestSecret,
  isCanonicalOpaqueSecret,
} from "./auth-session-crypto.js";
import type { AuthSessionLimiter } from "./auth-session-limiter.js";
import { loginAccountBucket } from "./auth-session-limiter.js";
import type { AccessSigner, SessionIssue } from "./auth-session-types.js";
import { isAllowedPasswordPhc, verifyPassword } from "./password-credential.js";

export class AuthRateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 1) {
    super({
      code: "RATE_LIMITED",
      message: "Too many authentication requests.",
      statusCode: 429,
      details: [],
    });
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

export interface AuthSessionService {
  login(input: {
    tenantId: string;
    email: string;
    password: string;
    clientIp: string;
    requestId: string;
  }): Promise<SessionIssue>;
  refresh(input: {
    refreshToken: string;
    csrfToken: string;
    clientIp: string;
    requestId: string;
  }): Promise<SessionIssue>;
  logout(input: { refreshToken: string; csrfToken: string; requestId: string }): Promise<void>;
}

export function createAuthSessionService(input: {
  loginRepository: AuthLoginRepository;
  refreshRepository: AuthRefreshRepository;
  logoutRepository: AuthLogoutRepository;
  limiter: AuthSessionLimiter;
  argonExecutor: ArgonExecutor;
  dummyPasswordHash: string;
  accessLifetimeSeconds: number;
  sign: AccessSigner;
}): AuthSessionService {
  return {
    login: (request) => login(input, request),
    refresh: (request) => refresh(input, request),
    logout: (request) => logout(input, request),
  };
}

async function login(
  runtime: Parameters<typeof createAuthSessionService>[0],
  request: Parameters<AuthSessionService["login"]>[0],
): Promise<SessionIssue> {
  const admission = await runtime.limiter.admitLogin(
    loginAccountBucket(request.tenantId, request.email),
    request.clientIp,
  );
  if (!admission.allowed) throw new AuthRateLimitError(admission.retryAfterSeconds);
  const candidate = await runtime.loginRepository.findCandidate(request.tenantId, request.email);
  const realHash = candidate?.passwordHash;
  const selectedHash = isAllowedPasswordPhc(realHash) ? realHash : runtime.dummyPasswordHash;
  const verified = await verifyPassword(selectedHash, request.password, runtime.argonExecutor);
  if (!candidate || !realHash || selectedHash !== realHash || !verified) {
    throw authError("AUTH_INVALID");
  }
  const refreshToken = createOpaqueSecret();
  const csrfToken = createOpaqueSecret();
  const result = await runtime.loginRepository.issue({
    tenantId: request.tenantId,
    email: request.email,
    expectedPasswordHash: realHash,
    requestId: request.requestId,
    familyId: randomUUID(),
    tokenId: randomUUID(),
    tokenDigest: digestSecret(refreshToken),
    csrfDigest: digestSecret(csrfToken),
    refreshToken,
    csrfToken,
    accessLifetimeSeconds: runtime.accessLifetimeSeconds,
    sign: runtime.sign,
  });
  if (result.kind === "issued") return result.issue;
  if (result.kind === "tenant_inactive") throw authError("TENANT_INACTIVE");
  if (result.kind === "user_inactive") throw authError("USER_INACTIVE");
  throw authError("AUTH_INVALID");
}

async function refresh(
  runtime: Parameters<typeof createAuthSessionService>[0],
  request: Parameters<AuthSessionService["refresh"]>[0],
): Promise<SessionIssue> {
  const ipAdmission = await runtime.limiter.admitRefreshIp(request.clientIp);
  if (!ipAdmission.allowed) throw new AuthRateLimitError(ipAdmission.retryAfterSeconds);
  if (!isCanonicalOpaqueSecret(request.refreshToken)) throw authError("AUTH_INVALID");
  const presentedDigest = digestSecret(request.refreshToken);
  const familyId = await runtime.refreshRepository.findFamilyId(presentedDigest);
  if (!familyId) throw authError("AUTH_INVALID");
  const familyAdmission = await runtime.limiter.admitRefreshFamily(familyId);
  if (!familyAdmission.allowed) throw new AuthRateLimitError(familyAdmission.retryAfterSeconds);
  const refreshToken = createOpaqueSecret();
  const csrfToken = createOpaqueSecret();
  const result = await runtime.refreshRepository.rotate({
    familyId,
    presentedDigest,
    presentedCsrfDigest: digestSecret(request.csrfToken),
    requestId: request.requestId,
    childId: randomUUID(),
    childTokenDigest: digestSecret(refreshToken),
    childCsrfDigest: digestSecret(csrfToken),
    refreshToken,
    csrfToken,
    accessLifetimeSeconds: runtime.accessLifetimeSeconds,
    sign: runtime.sign,
  });
  if (result.kind === "issued") return result.issue;
  if (result.kind === "csrf_invalid") throw authError("CSRF_INVALID");
  if (result.kind === "tenant_inactive") throw authError("TENANT_INACTIVE");
  if (result.kind === "user_inactive") throw authError("USER_INACTIVE");
  throw authError("AUTH_INVALID");
}

async function logout(
  runtime: Parameters<typeof createAuthSessionService>[0],
  request: Parameters<AuthSessionService["logout"]>[0],
): Promise<void> {
  if (!isCanonicalOpaqueSecret(request.refreshToken)) return;
  const presentedDigest = digestSecret(request.refreshToken);
  const familyId = await runtime.logoutRepository.findFamilyId(presentedDigest);
  if (!familyId) return;
  const result = await runtime.logoutRepository.logout({
    familyId,
    presentedDigest,
    presentedCsrfDigest: digestSecret(request.csrfToken),
    requestId: request.requestId,
  });
  if (result.kind === "csrf_invalid") throw authError("CSRF_INVALID");
}
