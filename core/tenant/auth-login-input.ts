import { AppError } from "../shared/errors.js";
import { normalizePassword } from "./password-policy.js";
import { normalizeUserEmail, parseUserId } from "./users-input.js";

export interface LoginInput {
  tenantId: string;
  email: string;
  password: string;
}

export function parseLoginInput(input: unknown): LoginInput {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid();
    const value = input as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys.join(",") !== "email,password,tenant_id") throw invalid();
    if (typeof value.email !== "string") throw invalid();
    return {
      tenantId: parseUserId(value.tenant_id),
      email: normalizeUserEmail(value.email),
      password: normalizePassword(value.password),
    };
  } catch {
    throw invalid();
  }
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Session request is invalid.",
    statusCode: 400,
    details: [],
  });
}
