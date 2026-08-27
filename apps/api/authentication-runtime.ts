import { randomBytes } from "node:crypto";

import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import { createArgonExecutor } from "../../core/tenant/argon-executor.js";
import { createAuthLoginRepository } from "../../core/tenant/auth-login-repository.js";
import { createAuthLogoutRepository } from "../../core/tenant/auth-logout-repository.js";
import { createAuthRefreshRepository } from "../../core/tenant/auth-refresh-repository.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import { createSessionCookiePolicy } from "../../core/tenant/auth-session-cookie.js";
import { createAuthSessionLimiter } from "../../core/tenant/auth-session-limiter.js";
import { resolveJwtKeyPair } from "../../core/tenant/jwt-key-pair.js";
import { hashPassword } from "../../core/tenant/password-credential.js";
import type { AuthenticationRuntime } from "./plugins/auth.js";

export async function closeAuthenticationRuntime(
  runtime: AuthenticationRuntime | undefined,
): Promise<void> {
  if (!runtime?.sessions) return;
  runtime.sessions.argonExecutor.close();
  await runtime.sessions.limiter.close();
}

export async function createAuthenticationRuntime(
  config: Readonly<AppConfig>,
  database: DbPoolResource,
): Promise<AuthenticationRuntime> {
  const keys = await resolveJwtKeyPair({
    nodeEnv: config.runtime.nodeEnv,
    publicKeyPath: config.auth.jwtPublicKeyPath,
    privateKeyPath: config.auth.jwtPrivateKeyPath ?? "",
  });
  const runtime = authenticationBase(config, database, keys);
  if (keys.privateKey) runtime.sessions = await createSessionDependencies(config, database);
  return runtime;
}

function authenticationBase(
  config: Readonly<AppConfig>,
  database: DbPoolResource,
  keys: Awaited<ReturnType<typeof resolveJwtKeyPair>>,
): AuthenticationRuntime {
  return {
    repository: createAuthRepository(database.pool),
    jwtPublicKey: keys.publicKey,
    jwtPrivateKey: keys.privateKey,
    jwtPolicy: {
      issuer: config.auth.jwtIssuer,
      audience: config.auth.jwtAudience,
      maxLifetimeSeconds: config.auth.jwtAccessTokenMaxLifetimeSeconds,
      clockToleranceSeconds: config.auth.jwtClockToleranceSeconds,
    },
    cookiePolicy: createSessionCookiePolicy({
      secure: config.auth.cookieSecure ?? false,
      publicBaseUrl: config.runtime.publicBaseUrl ?? "http://localhost:8080",
      accessLifetimeSeconds: config.auth.jwtAccessTokenMaxLifetimeSeconds,
    }),
  };
}

async function createSessionDependencies(
  config: Readonly<AppConfig>,
  database: DbPoolResource,
): Promise<NonNullable<AuthenticationRuntime["sessions"]>> {
  const argonExecutor = createArgonExecutor({
    concurrency: config.auth.argonConcurrency,
    queueLimit: config.auth.argonQueueLimit,
  });
  let limiter: Awaited<ReturnType<typeof createAuthSessionLimiter>> | undefined;
  try {
    limiter = await createAuthSessionLimiter({
      mode: config.auth.limiterMode ?? "local",
      redisUrl: config.queue.url,
    });
    const dummyPasswordHash = await hashPassword(
      randomBytes(32).toString("base64url"),
      argonExecutor,
    );
    return {
      loginRepository: createAuthLoginRepository(database.pool),
      refreshRepository: createAuthRefreshRepository(database.pool),
      logoutRepository: createAuthLogoutRepository(database.pool),
      limiter,
      argonExecutor,
      dummyPasswordHash,
      trustedProxyCidrs: config.auth.trustedProxyCidrs ?? [],
    };
  } catch (error) {
    argonExecutor.close();
    await limiter?.close().catch(() => undefined);
    throw error;
  }
}
