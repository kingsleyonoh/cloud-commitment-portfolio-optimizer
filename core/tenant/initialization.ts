import { Client } from "pg";

import type { ArgonExecutor } from "./argon-executor.js";
import {
  createApiKeyCredential,
  FIRST_RUN_API_KEY_NOTE,
  validateApiKeyPrefix,
} from "./api-key-credential.js";
import { normalizeTenantInput, type NormalizedTenantInput } from "./identity.js";
import {
  insertFreshAdmin,
  verifyInitializedAdmin,
  type PreparedFirstRunAdmin,
} from "./initialization-admin.js";
import { validateApiKeyRotationChains } from "./initialization-rotation-chain.js";
import { readInitializationRotationState } from "./initialization-rotation-state.js";
import { lockInitialization } from "./initialization-lock.js";
import { isFreshFirstRunState, readFirstRunState } from "./initialization-state.js";
import { hashPassword } from "./password-credential.js";
import { readPasswordFile } from "./password-policy.js";

export interface FirstRunTenantConfig {
  defaultTenantName: string;
  defaultAdminEmail: string;
  defaultAdminName: string;
  defaultAdminPasswordFile?: string;
  apiKeyPrefix: string;
}

export interface PreparedFirstRunInput {
  tenant: NormalizedTenantInput;
  admin: PreparedFirstRunAdmin | null;
  apiKeyPrefix: string;
}

interface InitializationIdentifiers {
  tenantId: string;
  apiKeyId: string;
  adminUserId: string | null;
}

export type FirstRunInitializationResult =
  | ({ created: true; apiKey: string } & InitializationIdentifiers)
  | ({ created: false } & InitializationIdentifiers);

export class FirstRunInitializationError extends Error {
  readonly code: "INITIALIZATION_STATE_AMBIGUOUS" | "INITIALIZATION_FAILED";

  constructor(code: FirstRunInitializationError["code"], message: string) {
    super(message);
    this.name = "FirstRunInitializationError";
    this.code = code;
  }
}

const AMBIGUOUS_MESSAGE = "First-run initialization state is ambiguous; no changes were made.";
const FAILED_MESSAGE = "First-run initialization failed; no partial application rows were kept.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;

async function normalizedAdmin(
  config: FirstRunTenantConfig,
  executor: ArgonExecutor,
): Promise<PreparedFirstRunAdmin | null> {
  const email = config.defaultAdminEmail.normalize("NFC").trim().toLowerCase();
  const name = config.defaultAdminName.normalize("NFC").trim();
  const passwordFile = config.defaultAdminPasswordFile?.normalize("NFC").trim() ?? "";
  if (!email && !name && !passwordFile) return null;
  if (!email || !name || !passwordFile || !EMAIL_PATTERN.test(email)) {
    throw new FirstRunInitializationError("INITIALIZATION_FAILED", FAILED_MESSAGE);
  }
  const password = await readPasswordFile(passwordFile);
  const passwordHash = await hashPassword(password, executor);
  return { email, name, passwordHash };
}

export async function prepareFirstRunInput(
  config: FirstRunTenantConfig,
  executor: ArgonExecutor,
): Promise<PreparedFirstRunInput> {
  try {
    return {
      tenant: normalizeTenantInput({ name: config.defaultTenantName }),
      admin: await normalizedAdmin(config, executor),
      apiKeyPrefix: validateApiKeyPrefix(config.apiKeyPrefix),
    };
  } catch (error) {
    if (error instanceof FirstRunInitializationError) throw error;
    throw new FirstRunInitializationError("INITIALIZATION_FAILED", FAILED_MESSAGE);
  }
}

interface ExistingStateRow extends InitializationIdentifiers {
  tenantMatches: boolean;
  keyMatches: boolean;
}

async function existingState(
  client: Client,
  input: PreparedFirstRunInput,
): Promise<InitializationIdentifiers | null> {
  const counts = await readFirstRunState(client, FIRST_RUN_API_KEY_NOTE);
  if (isFreshFirstRunState(counts)) return null;
  const expectedOrigins = 1 + counts.succeededRegistrationCount;
  if (
    counts.markerCount !== 1 ||
    counts.registrationCount !== counts.succeededRegistrationCount ||
    counts.tenantCount !== expectedOrigins ||
    counts.keyCount < expectedOrigins
  ) {
    throw new FirstRunInitializationError("INITIALIZATION_STATE_AMBIGUOUS", AMBIGUOUS_MESSAGE);
  }
  try {
    const state = await readInitializationRotationState(client, FIRST_RUN_API_KEY_NOTE);
    const currentKeys = validateApiKeyRotationChains(state);
    const currentMarkerId = currentKeys.get(state.markerKeyId);
    if (!currentMarkerId) {
      throw new Error("The initialization marker has no current key.");
    }
    return verifySingleState(client, input, currentMarkerId);
  } catch {
    throw new FirstRunInitializationError("INITIALIZATION_STATE_AMBIGUOUS", AMBIGUOUS_MESSAGE);
  }
}

async function verifySingleState(
  client: Client,
  input: PreparedFirstRunInput,
  currentApiKeyId: string,
): Promise<InitializationIdentifiers> {
  const tenant = input.tenant;
  const result = await client.query<ExistingStateRow>(
    `
    SELECT t.id AS "tenantId", $6::uuid AS "apiKeyId", NULL::text AS "adminUserId",
      t.name = $2 AND t.legal_name = $3 AND t.full_legal_name = $4
        AND t.display_name = $5 AND t.address = '{}'::jsonb AND t.registration = '{}'::jsonb
        AND t.contact_email IS NULL AND t.contact_phone IS NULL AND t.support_url IS NULL
        AND t.finance_owner_email IS NULL AND t.wordmark IS NULL
        AND t.default_currency = 'USD' AND t.timezone = 'UTC'
        AND t.risk_budget_cents = 0 AND t.is_active AS "tenantMatches",
      k.tenant_id = t.id AND k.key_hash ~ '^[0-9a-f]{64}$' AS "keyMatches"
    FROM tenants t JOIN api_keys k ON k.note = $1
  `,
    [
      FIRST_RUN_API_KEY_NOTE,
      tenant.name,
      tenant.legalName,
      tenant.fullLegalName,
      tenant.displayName,
      currentApiKeyId,
    ],
  );
  const row = result.rows[0];
  if (!row?.tenantMatches || !row.keyMatches) {
    throw new FirstRunInitializationError("INITIALIZATION_STATE_AMBIGUOUS", AMBIGUOUS_MESSAGE);
  }
  if (!input.admin) return row;
  const adminUserId = await verifyInitializedAdmin(client, row.tenantId, input.admin);
  if (!adminUserId) {
    throw new FirstRunInitializationError("INITIALIZATION_STATE_AMBIGUOUS", AMBIGUOUS_MESSAGE);
  }
  return { ...row, adminUserId };
}

async function createState(
  client: Client,
  input: PreparedFirstRunInput,
): Promise<FirstRunInitializationResult> {
  const credential = createApiKeyCredential(input.apiKeyPrefix);
  const tenant = input.tenant;
  const tenantResult = await client.query<{ id: string }>(
    `
    INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
    VALUES ($1, $2, $3, $4) RETURNING id
  `,
    [tenant.name, tenant.legalName, tenant.fullLegalName, tenant.displayName],
  );
  const tenantId = tenantResult.rows[0]!.id;
  const adminUserId = await insertFreshAdmin(client, tenantId, input.admin);
  const keyResult = await client.query<{ id: string }>(
    `
    INSERT INTO api_keys (tenant_id, key_hash, note) VALUES ($1, $2, $3) RETURNING id
  `,
    [tenantId, credential.keyHash, FIRST_RUN_API_KEY_NOTE],
  );
  return {
    created: true,
    tenantId,
    apiKeyId: keyResult.rows[0]!.id,
    adminUserId,
    apiKey: credential.plaintext,
  };
}

export async function initializeFirstRun(
  databaseUrl: string,
  input: PreparedFirstRunInput,
): Promise<FirstRunInitializationResult> {
  const client = new Client({ connectionString: databaseUrl });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await lockInitialization(client);
    const existing = await existingState(client, input);
    const result = existing
      ? { created: false as const, ...existing }
      : await createState(client, input);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof FirstRunInitializationError) throw error;
    throw new FirstRunInitializationError("INITIALIZATION_FAILED", FAILED_MESSAGE);
  } finally {
    await client.end().catch(() => undefined);
  }
}
