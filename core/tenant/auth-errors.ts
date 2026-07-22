import { AppError } from "../shared/errors.js";

const ERROR_CONTRACT = {
  AUTH_REQUIRED: [401, "Authentication is required."],
  AUTH_CREDENTIAL_CONFLICT: [401, "Multiple authentication credentials are not allowed."],
  AUTH_INVALID: [401, "Authentication credentials are invalid."],
  CSRF_INVALID: [403, "Session request validation failed."],
  TENANT_INACTIVE: [403, "The tenant is inactive."],
  USER_INACTIVE: [403, "The user is inactive."],
  FORBIDDEN: [403, "The requested action is not permitted."],
  AUTH_DEPENDENCY_UNAVAILABLE: [503, "Authentication is temporarily unavailable."],
} as const;

export type AuthErrorCode = keyof typeof ERROR_CONTRACT;

export function authError(code: AuthErrorCode): AppError {
  const [statusCode, message] = ERROR_CONTRACT[code];
  return new AppError({ code, message, statusCode, details: [] });
}

export function publicKeyStartupError(): AppError {
  return new AppError({
    code: "JWT_PUBLIC_KEY_INVALID",
    message: "JWT_PUBLIC_KEY_PATH must reference a valid RSA public key file.",
    statusCode: 500,
    details: [],
  });
}

export function signingKeyStartupError(): AppError {
  return new AppError({
    code: "JWT_SIGNING_KEY_INVALID",
    message: "JWT signing key configuration is invalid.",
    statusCode: 500,
    details: [],
  });
}
