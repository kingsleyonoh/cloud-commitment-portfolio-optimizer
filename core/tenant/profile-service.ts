import { AppError } from "../shared/errors.js";
import { tenantProfile } from "./registration-profile.js";
import type { TenantProfileRepository } from "./profile-repository.js";
import type { TenantProfile } from "./registration-types.js";

export interface TenantProfileService {
  getCurrent(tenantId: string): Promise<TenantProfile>;
}

export function createTenantProfileService(
  repository: TenantProfileRepository,
): TenantProfileService {
  return {
    async getCurrent(tenantId) {
      let row;
      try {
        row = await repository.findActiveById(tenantId);
      } catch {
        throw unavailableError();
      }
      if (!row) {
        throw new AppError({
          code: "TENANT_PROFILE_NOT_FOUND",
          message: "The tenant profile was not found.",
          statusCode: 404,
          details: [],
        });
      }
      try {
        return tenantProfile(row);
      } catch {
        throw unavailableError();
      }
    },
  };
}

function unavailableError(): AppError {
  return new AppError({
    code: "TENANT_PROFILE_UNAVAILABLE",
    message: "The tenant profile is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
