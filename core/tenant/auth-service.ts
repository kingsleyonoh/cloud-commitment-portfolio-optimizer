import { hashApiKeyCredential } from "./api-key-auth.js";
import { authError } from "./auth-errors.js";
import { assertAccessCookieProof, type AccessCookieProof } from "./auth-session-csrf.js";
import type { AuthRepository } from "./auth-repository.js";
import {
  createApiKeyRequestContext,
  createUserRequestContext,
  type RequestContext,
} from "./request-context.js";
import type { RequestCredential } from "./request-credential.js";
import {
  validateCookieJwtClaims,
  validateJwtClaims,
  validateJwtProtectedHeader,
  type JwtClaimPolicy,
} from "./jwt-validation.js";

export type JwtVerifier = (token: string) => unknown;

export interface AuthenticationService {
  authenticate(
    credential: RequestCredential,
    requestId: string,
    accessProof?: AccessCookieProof,
  ): Promise<RequestContext>;
}

export function createAuthenticationService(input: {
  repository: AuthRepository;
  verifyJwt: JwtVerifier;
  jwtPolicy: JwtClaimPolicy;
}): AuthenticationService {
  return {
    authenticate: (credential, requestId, accessProof) =>
      credential.kind === "api_key"
        ? authenticateApiKey(input.repository, credential.value, requestId)
        : authenticateJwt(input, credential, requestId, accessProof),
  };
}

async function authenticateApiKey(
  repository: AuthRepository,
  plaintext: string,
  requestId: string,
): Promise<RequestContext> {
  const keyHash = hashApiKeyCredential(plaintext);
  const identity = await dependencyQuery(() => repository.findApiKeyIdentity(keyHash));
  if (!identity) throw authError("AUTH_INVALID");
  if (!identity.tenantActive) throw authError("TENANT_INACTIVE");
  return createApiKeyRequestContext({
    tenantId: identity.tenantId,
    apiKeyId: identity.apiKeyId,
    requestId,
  });
}

async function authenticateJwt(
  input: {
    repository: AuthRepository;
    verifyJwt: JwtVerifier;
    jwtPolicy: JwtClaimPolicy;
  },
  credential: Extract<RequestCredential, { kind: "jwt" | "access_cookie" }>,
  requestId: string,
  accessProof?: AccessCookieProof,
): Promise<RequestContext> {
  const token = credential.value;
  validateJwtProtectedHeader(token);
  let payload: unknown;
  try {
    payload = input.verifyJwt(token);
  } catch {
    throw authError("AUTH_INVALID");
  }
  let identity;
  if (credential.kind === "access_cookie") {
    const assertion = validateCookieJwtClaims(payload, input.jwtPolicy);
    if (!accessProof) throw authError("CSRF_INVALID");
    assertAccessCookieProof(accessProof, assertion.csrfHash);
    const findIdentity = input.repository.findCookieUserIdentity;
    if (!findIdentity) throw authError("AUTH_INVALID");
    identity = await dependencyQuery(() => findIdentity(assertion));
  } else {
    const assertion = validateJwtClaims(payload, input.jwtPolicy);
    identity = await dependencyQuery(() => input.repository.findUserIdentity(assertion));
  }
  if (!identity) throw authError("AUTH_INVALID");
  if (!identity.userActive) throw authError("USER_INACTIVE");
  if (!identity.tenantActive) throw authError("TENANT_INACTIVE");
  return createUserRequestContext({
    tenantId: identity.tenantId,
    actorUserId: identity.actorUserId,
    role: identity.role,
    requestId,
  });
}

async function dependencyQuery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
  }
}
