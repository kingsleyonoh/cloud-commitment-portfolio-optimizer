import type { AppConfig } from "../../core/config/env.js";
import type { DbPoolResource } from "../../core/shared/db.js";
import type { Logger } from "../../core/shared/logger.js";
import { createArgonExecutor, type ArgonExecutor } from "../../core/tenant/argon-executor.js";
import type { ProtectedUsersLimiter } from "../../core/tenant/protected-users-limiter.js";
import { createUserPasswordRepository } from "../../core/tenant/user-password-repository.js";
import { createUserPasswordService } from "../../core/tenant/user-password-service.js";
import { createUsersRepository } from "../../core/tenant/users-repository.js";
import { createUsersService } from "../../core/tenant/users-service.js";
import type { BuildAppOptions } from "./app.js";

export function createUsersRuntime(
  database: DbPoolResource,
  logger: Logger,
  limiter: ProtectedUsersLimiter,
  auth: Readonly<AppConfig["auth"]>,
  sharedArgonExecutor?: ArgonExecutor,
): NonNullable<BuildAppOptions["users"]> {
  const argonExecutor =
    sharedArgonExecutor ??
    createArgonExecutor({
      concurrency: auth.argonConcurrency ?? 2,
      queueLimit: auth.argonQueueLimit ?? 32,
    });
  return {
    limiter,
    service: createUsersService(createUsersRepository(database.pool), logger),
    passwordService: createUserPasswordService(
      createUserPasswordRepository(database.pool),
      argonExecutor,
    ),
    ...(sharedArgonExecutor ? {} : { closePasswordExecutor: () => argonExecutor.close() }),
  };
}
