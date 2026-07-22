import type { Pool } from "pg";
import { AppError } from "../shared/errors.js";
import type { TenantAddress, TenantInput } from "./identity.js";
import { TenantInputValidationError } from "./identity.js";
import { prepareRegistrationRequest, RegistrationDigestError } from "./registration-digests.js";
import { createTenantRegistrationRepository } from "./registration-repository.js";
import type { TenantRegistrationBody, TenantRegistrationCreated } from "./registration-types.js";

export interface TenantRegistrationService {
  register(
    idempotencyKey: unknown,
    body: TenantRegistrationBody,
  ): Promise<TenantRegistrationCreated>;
}

export function createTenantRegistrationService(
  pool: Pool,
  apiKeyPrefix: string,
): TenantRegistrationService {
  const repository = createTenantRegistrationRepository(pool);
  return {
    async register(idempotencyKey, body) {
      try {
        const prepared = prepareRegistrationRequest(idempotencyKey, mapBody(body));
        return await repository.create(prepared, apiKeyPrefix);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (
          error instanceof TenantInputValidationError ||
          error instanceof RegistrationDigestError
        ) {
          throw validationError();
        }
        throw error;
      }
    },
  };
}

function mapBody(body: TenantRegistrationBody): TenantInput {
  const input: TenantInput = { name: body.name };
  assign(input, "legalName", body.legal_name);
  assign(input, "fullLegalName", body.full_legal_name);
  assign(input, "displayName", body.display_name);
  if (body.address !== undefined) input.address = mapAddress(body.address);
  if (body.registration !== undefined) input.registration = body.registration;
  assign(input, "contactEmail", body.contact_email);
  assign(input, "contactPhone", body.contact_phone);
  assign(input, "supportUrl", body.support_url);
  assign(input, "financeOwnerEmail", body.finance_owner_email);
  assign(input, "wordmark", body.wordmark);
  assign(input, "defaultCurrency", body.default_currency);
  assign(input, "timezone", body.timezone);
  assign(input, "riskBudgetCents", body.risk_budget_cents);
  return input;
}

function mapAddress(body: NonNullable<TenantRegistrationBody["address"]>): TenantAddress {
  const address: TenantAddress = {};
  assign(address, "line1", body.line1);
  assign(address, "line2", body.line2);
  assign(address, "locality", body.locality);
  assign(address, "region", body.region);
  assign(address, "postalCode", body.postal_code);
  assign(address, "countryCode", body.country_code);
  return address;
}

function assign<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function validationError(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Registration request is invalid.",
    statusCode: 400,
  });
}
