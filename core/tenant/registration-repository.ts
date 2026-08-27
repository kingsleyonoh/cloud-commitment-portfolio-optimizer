import type { Pool, PoolClient } from "pg";
import { AppError } from "../shared/errors.js";
import { createApiKeyCredential } from "./api-key-credential.js";
import type { NormalizedTenantInput } from "./identity.js";
import type { PreparedRegistrationRequest } from "./registration-digests.js";
import {
  databaseAddress,
  tenantProfile,
  type RegistrationTenantRow,
} from "./registration-profile.js";
import type { TenantRegistrationCreated } from "./registration-types.js";

const INITIAL_KEY_NOTE = "Initial analyst automation key";

interface LedgerRow {
  requestSha256: Buffer;
  status: "pending" | "succeeded" | "failed";
  tenantId: string | null;
  apiKeyId: string | null;
}

export interface TenantRegistrationRepository {
  create(
    prepared: PreparedRegistrationRequest,
    apiKeyPrefix: string,
  ): Promise<TenantRegistrationCreated>;
}

export function createTenantRegistrationRepository(pool: Pool): TenantRegistrationRepository {
  return {
    async create(prepared, apiKeyPrefix) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch {
        throw dependencyUnavailable();
      }
      return runTransaction(client, prepared, apiKeyPrefix);
    },
  };
}

async function runTransaction(
  client: PoolClient,
  prepared: PreparedRegistrationRequest,
  apiKeyPrefix: string,
): Promise<TenantRegistrationCreated> {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await acquireRegistrationLock(client, prepared.idempotencyKeyHash);
    await rejectExisting(client, prepared);
    await insertPending(client, prepared);
    const credential = createApiKeyCredential(apiKeyPrefix);
    const tenant = await insertTenant(client, prepared.tenant);
    const apiKeyId = await insertApiKey(client, tenant.id, credential.keyHash);
    await succeedLedger(client, prepared.idempotencyKeyHash, tenant.id, apiKeyId);
    await client.query("COMMIT");
    transactionOpen = false;
    return { tenant: tenantProfile(tenant), apiKey: credential.plaintext };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw dependencyUnavailable();
  } finally {
    client.release();
  }
}

async function acquireRegistrationLock(client: PoolClient, digest: Buffer): Promise<void> {
  const lockId = digest.readBigInt64BE(0).toString();
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock($1::bigint) AS locked",
    [lockId],
  );
  if (!result.rows[0]?.locked) throw inProgress();
}

async function rejectExisting(
  client: PoolClient,
  prepared: PreparedRegistrationRequest,
): Promise<void> {
  const result = await client.query<LedgerRow>(
    `SELECT request_sha256 AS "requestSha256", status,
      tenant_id AS "tenantId", api_key_id AS "apiKeyId"
     FROM registration_requests WHERE idempotency_key_hash = $1 FOR UPDATE`,
    [prepared.idempotencyKeyHash],
  );
  const existing = result.rows[0];
  if (!existing) return;
  if (!existing.requestSha256.equals(prepared.requestSha256)) throw keyReused();
  if (existing.status === "pending") throw inProgress();
  if (existing.status === "failed") throw terminalFailure();
  throw nonReplayable(existing.tenantId!, existing.apiKeyId!);
}

async function insertPending(
  client: PoolClient,
  prepared: PreparedRegistrationRequest,
): Promise<void> {
  await client.query(
    `INSERT INTO registration_requests (idempotency_key_hash, request_sha256)
     VALUES ($1, $2)`,
    [prepared.idempotencyKeyHash, prepared.requestSha256],
  );
}

async function insertTenant(
  client: PoolClient,
  tenant: NormalizedTenantInput,
): Promise<RegistrationTenantRow> {
  const result = await client.query<RegistrationTenantRow>(
    `INSERT INTO tenants
      (name, legal_name, full_legal_name, display_name, address, registration,
       contact_email, contact_phone, support_url, finance_owner_email, wordmark,
       default_currency, timezone, risk_budget_cents)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::bigint)
     RETURNING id, name, legal_name AS "legalName", full_legal_name AS "fullLegalName",
       display_name AS "displayName", address, registration, contact_email AS "contactEmail",
       contact_phone AS "contactPhone", support_url AS "supportUrl",
       finance_owner_email AS "financeOwnerEmail", wordmark,
       default_currency AS "defaultCurrency", timezone,
       risk_budget_cents::text AS "riskBudgetCents", is_active AS "isActive",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    tenantParameters(tenant),
  );
  return result.rows[0]!;
}

function tenantParameters(tenant: NormalizedTenantInput): unknown[] {
  return [
    tenant.name,
    tenant.legalName,
    tenant.fullLegalName,
    tenant.displayName,
    JSON.stringify(databaseAddress(tenant.address)),
    JSON.stringify(tenant.registration),
    tenant.contactEmail,
    tenant.contactPhone,
    tenant.supportUrl,
    tenant.financeOwnerEmail,
    tenant.wordmark,
    tenant.defaultCurrency,
    tenant.timezone,
    tenant.riskBudgetCents,
  ];
}

async function insertApiKey(
  client: PoolClient,
  tenantId: string,
  keyHash: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, $3) RETURNING id",
    [tenantId, keyHash, INITIAL_KEY_NOTE],
  );
  return result.rows[0]!.id;
}

async function succeedLedger(
  client: PoolClient,
  digest: Buffer,
  tenantId: string,
  apiKeyId: string,
): Promise<void> {
  const result = await client.query(
    `UPDATE registration_requests SET status = 'succeeded', tenant_id = $2, api_key_id = $3
     WHERE idempotency_key_hash = $1 AND status = 'pending'`,
    [digest, tenantId, apiKeyId],
  );
  if (result.rowCount !== 1) throw dependencyUnavailable();
}

function inProgress(): AppError {
  return routeError("IDEMPOTENCY_IN_PROGRESS", "Registration is already in progress.");
}

function terminalFailure(): AppError {
  return routeError(
    "IDEMPOTENCY_TERMINAL_FAILURE",
    "Registration cannot be retried with this idempotency key.",
  );
}

function keyReused(): AppError {
  return routeError(
    "IDEMPOTENCY_KEY_REUSED",
    "Idempotency key was already used for a different request.",
  );
}

function nonReplayable(tenantId: string, apiKeyId: string): AppError {
  return new AppError({
    code: "IDEMPOTENCY_RESULT_NOT_REPLAYABLE",
    message: "Registration credentials cannot be replayed.",
    statusCode: 409,
    details: [{ tenant_id: tenantId, api_key_id: apiKeyId }],
  });
}

function routeError(code: string, message: string): AppError {
  return new AppError({ code, message, statusCode: 409 });
}

function dependencyUnavailable(): AppError {
  return new AppError({
    code: "REGISTRATION_DEPENDENCY_UNAVAILABLE",
    message: "Registration is temporarily unavailable.",
    statusCode: 503,
  });
}
