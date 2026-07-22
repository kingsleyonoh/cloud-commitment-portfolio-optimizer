import type { UserRole } from "./request-context.js";

export interface SessionCookiePolicy {
  secure: boolean;
  publicOrigin: string;
  accessName: string;
  refreshName: string;
  csrfName: string;
  accessLifetimeSeconds: number;
}

export interface SessionMetadata {
  user_id: string;
  tenant_id: string;
  role: UserRole;
  access_expires_at: string;
  refresh_idle_expires_at: string;
  refresh_absolute_expires_at: string;
}

export interface SessionIssue {
  session: SessionMetadata;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface AccessClaimsInput {
  userId: string;
  tenantId: string;
  role: UserRole;
  familyId: string;
  csrfHash: string;
  issuedAt: number;
  expiresAt: number;
}

export type AccessSigner = (input: AccessClaimsInput) => string;

export type LoginTransactionResult =
  | { kind: "issued"; issue: SessionIssue }
  | { kind: "invalid" }
  | { kind: "user_inactive" }
  | { kind: "tenant_inactive" };

export type RefreshTransactionResult =
  | { kind: "issued"; issue: SessionIssue }
  | { kind: "invalid" }
  | { kind: "csrf_invalid" }
  | { kind: "user_inactive" }
  | { kind: "tenant_inactive" };

export type LogoutTransactionResult = { kind: "complete" } | { kind: "csrf_invalid" };
