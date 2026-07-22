import { AppError } from "../shared/errors.js";
import type { ArgonExecutor } from "./argon-executor.js";
import { authError } from "./auth-errors.js";
import { hashPassword } from "./password-credential.js";
import { normalizePassword, PasswordInputError } from "./password-policy.js";
import type { UserRequestContext } from "./request-context.js";
import type { UserPasswordRepository } from "./user-password-repository.js";
import { parseUserId } from "./users-input.js";

export type PasswordHasher = (password: string) => Promise<string>;

export interface UserPasswordService {
  setPassword(context: UserRequestContext, targetUserId: unknown, body: unknown): Promise<void>;
}

export function createUserPasswordService(
  repository: UserPasswordRepository,
  executor: ArgonExecutor,
  passwordHasher: PasswordHasher = (password) => hashPassword(password, executor),
): UserPasswordService {
  return {
    async setPassword(context, targetUserId, body) {
      const id = parseUserId(targetUserId);
      const password = parsePasswordBody(body);
      let passwordHash: string;
      try {
        passwordHash = await passwordHasher(password);
      } catch {
        throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
      }
      await repository.setPassword({
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        targetUserId: id,
        requestId: context.requestId,
        passwordHash,
      });
    },
  };
}

function parsePasswordBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("password" in record)) throw invalid();
  try {
    return normalizePassword(record.password);
  } catch (error) {
    if (error instanceof PasswordInputError) throw invalid();
    throw error;
  }
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
