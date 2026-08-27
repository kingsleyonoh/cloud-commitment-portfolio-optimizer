import type { Pool, PoolClient, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import { authError } from "./auth-errors.js";
import { insertLoginDeniedAudit, insertLoginSuccessAudit } from "./auth-session-audit.js";
import type { AccessSigner, LoginTransactionResult, SessionIssue } from "./auth-session-types.js";
import type { UserRole } from "./request-context.js";

export interface LoginCandidate {
  tenantId: string;
  userId: string;
  role: UserRole;
  tenantActive: boolean;
  userActive: boolean;
  passwordHash: string | null;
}

export interface LoginIssueInput {
  tenantId: string;
  email: string;
  expectedPasswordHash: string;
  requestId: string;
  familyId: string;
  tokenId: string;
  tokenDigest: Buffer;
  csrfDigest: Buffer;
  refreshToken: string;
  csrfToken: string;
  accessLifetimeSeconds: number;
  sign: AccessSigner;
}

interface CandidateRow extends QueryResultRow, LoginCandidate {}
interface TimeRow extends QueryResultRow {
  issuedAt: number;
  expiresAt: number;
  accessExpiresAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface AuthLoginRepository {
  findCandidate(tenantId: string, email: string): Promise<LoginCandidate | null>;
  issue(input: LoginIssueInput): Promise<LoginTransactionResult>;
}

export function createAuthLoginRepository(pool: Pool): AuthLoginRepository {
  return {
    async findCandidate(tenantId, email) {
      try {
        const result = await pool.query<CandidateRow>(
          `SELECT t.id AS "tenantId", u.id AS "userId", u.role,
             t.is_active AS "tenantActive", u.is_active AS "userActive",
             c.password_hash AS "passwordHash"
           FROM tenants t JOIN users u ON u.tenant_id=t.id
           LEFT JOIN user_auth_credentials c ON c.tenant_id=u.tenant_id AND c.user_id=u.id
           WHERE t.id=$1 AND u.email=$2 LIMIT 2`,
          [tenantId, email],
        );
        return result.rows.length === 1 ? Object.freeze({ ...result.rows[0]! }) : null;
      } catch {
        throw unavailable();
      }
    },
    async issue(input) {
      const client = await connect(pool);
      return loginTransaction(client, input);
    },
  };
}

async function loginTransaction(
  client: PoolClient,
  input: LoginIssueInput,
): Promise<LoginTransactionResult> {
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await evaluateLockedLogin(client, input);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function evaluateLockedLogin(
  client: PoolClient,
  input: LoginIssueInput,
): Promise<LoginTransactionResult> {
  const locked = await lockLoginProof(client, input);
  if (!locked || locked.passwordHash !== input.expectedPasswordHash) return { kind: "invalid" };
  const inactive = !locked.tenantActive
    ? "tenant_inactive"
    : !locked.userActive
      ? "user_inactive"
      : null;
  if (inactive) {
    await insertLoginDeniedAudit(client, {
      tenantId: input.tenantId,
      userId: locked.id,
      reason: inactive,
      requestId: input.requestId,
    });
    return { kind: inactive };
  }
  const issue = await insertSession(client, input, locked);
  await insertLoginSuccessAudit(client, {
    tenantId: input.tenantId,
    userId: locked.id,
    requestId: input.requestId,
  });
  return { kind: "issued", issue };
}

async function lockLoginProof(client: PoolClient, input: LoginIssueInput) {
  const tenant = await client.query<{ active: boolean }>(
    "SELECT is_active AS active FROM tenants WHERE id=$1 FOR UPDATE",
    [input.tenantId],
  );
  const user = await client.query<{ id: string; role: UserRole; active: boolean }>(
    `SELECT id, role, is_active AS active FROM users
     WHERE tenant_id=$1 AND email=$2 FOR UPDATE`,
    [input.tenantId, input.email],
  );
  const identity = user.rows[0];
  if (tenant.rowCount !== 1 || !identity) return null;
  const credential = await client.query<{ passwordHash: string }>(
    `SELECT password_hash AS "passwordHash" FROM user_auth_credentials
     WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE`,
    [input.tenantId, identity.id],
  );
  return {
    id: identity.id,
    role: identity.role,
    userActive: identity.active,
    tenantActive: tenant.rows[0]!.active,
    passwordHash: credential.rows[0]?.passwordHash,
  };
}

async function insertSession(
  client: PoolClient,
  input: LoginIssueInput,
  identity: { id: string; role: UserRole },
): Promise<SessionIssue> {
  const time = await sessionTime(client, input.accessLifetimeSeconds);
  await client.query(
    `INSERT INTO auth_refresh_families
       (id,tenant_id,user_id,absolute_expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4::timestamptz,transaction_timestamp(),transaction_timestamp())`,
    [input.familyId, input.tenantId, identity.id, time.absoluteExpiresAt],
  );
  await client.query(
    `INSERT INTO auth_refresh_tokens
       (id,tenant_id,family_id,parent_token_id,token_digest,csrf_digest,idle_expires_at,
        created_at,updated_at)
     VALUES ($1,$2,$3,NULL,$4,$5,$6::timestamptz,transaction_timestamp(),transaction_timestamp())`,
    [
      input.tokenId,
      input.tenantId,
      input.familyId,
      input.tokenDigest,
      input.csrfDigest,
      time.idleExpiresAt,
    ],
  );
  const accessToken = input.sign({
    userId: identity.id,
    tenantId: input.tenantId,
    role: identity.role,
    familyId: input.familyId,
    csrfHash: input.csrfDigest.toString("base64url"),
    issuedAt: time.issuedAt,
    expiresAt: time.expiresAt,
  });
  return issue(input, identity, time, accessToken);
}

async function sessionTime(client: PoolClient, lifetime: number): Promise<TimeRow> {
  const result = await client.query<TimeRow>(
    `SELECT floor(extract(epoch FROM transaction_timestamp()))::int AS "issuedAt",
      floor(extract(epoch FROM transaction_timestamp()+$1::int*interval '1 second'))::int AS "expiresAt",
      to_char((transaction_timestamp()+$1::int*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "accessExpiresAt",
      to_char((transaction_timestamp()+interval '7 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "idleExpiresAt",
      to_char((transaction_timestamp()+interval '30 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "absoluteExpiresAt"`,
    [lifetime],
  );
  if (!result.rows[0]) throw unavailable();
  return result.rows[0];
}

function issue(
  input: LoginIssueInput,
  identity: { id: string; role: UserRole },
  time: TimeRow,
  accessToken: string,
): SessionIssue {
  return {
    accessToken,
    refreshToken: input.refreshToken,
    csrfToken: input.csrfToken,
    session: {
      user_id: identity.id,
      tenant_id: input.tenantId,
      role: identity.role,
      access_expires_at: time.accessExpiresAt,
      refresh_idle_expires_at: time.idleExpiresAt,
      refresh_absolute_expires_at: time.absoluteExpiresAt,
    },
  };
}

async function connect(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch {
    throw unavailable();
  }
}
function unavailable() {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
