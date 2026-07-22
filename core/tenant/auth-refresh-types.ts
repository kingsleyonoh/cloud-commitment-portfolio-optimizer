import type { QueryResultRow } from "pg";

import type { AccessSigner } from "./auth-session-types.js";
import type { UserRole } from "./request-context.js";

export interface RefreshRotateInput {
  familyId: string;
  presentedDigest: Buffer;
  presentedCsrfDigest: Buffer;
  requestId: string;
  childId: string;
  childTokenDigest: Buffer;
  childCsrfDigest: Buffer;
  refreshToken: string;
  csrfToken: string;
  accessLifetimeSeconds: number;
  sign: AccessSigner;
}

export interface RefreshRow extends QueryResultRow {
  tokenId: string;
  familyId: string;
  tenantId: string;
  userId: string;
  role: UserRole;
  userActive: boolean;
  tenantActive: boolean;
  csrfDigest: Buffer;
  used: boolean;
  idleValid: boolean;
  absoluteValid: boolean;
  revoked: boolean;
  absoluteExpiresAt: string;
}
