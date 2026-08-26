import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import {
  API_KEY_ACTION_POLICY,
  AUTH_ACTIONS,
  ROLE_ACTION_POLICY,
  canPerformAuthAction,
  isAuthAction,
  type AuthAction,
  type PolicyDecision,
} from "../../core/tenant/rbac.js";
import { USER_ROLES, type UserRole } from "../../core/tenant/request-context.js";
import { PROTECTED_ENDPOINT_ACTIONS } from "../../core/tenant/protected-route-actions.js";

const prd = readFileSync("docs/cloud-commitment-portfolio-optimizer_prd.md", "utf8");
const roleNames: Record<string, UserRole> = {
  "Tenant Admin": "tenant_admin",
  "FinOps Analyst": "finops_analyst",
  "Finance Approver": "finance_approver",
  "Read-only Auditor": "read_only_auditor",
};

function rolesMatrix(): { actions: string[]; rows: Map<UserRole, string[]> } {
  const section = prd
    .split("#### Roles × Resource Actions")[1]!
    .split("#### Accepted-Schema API-Key Actor Policy")[0]!;
  const lines = section.split(/\r?\n/u).filter((line) => line.startsWith("|"));
  const actions = lines[0]!
    .split("|")
    .slice(2, -1)
    .map((cell) => cell.trim());
  const rows = new Map<UserRole, string[]>();
  for (const line of lines.slice(2)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const role = roleNames[cells[0]!];
    if (role) rows.set(role, cells.slice(1));
  }
  return { actions, rows };
}

function expectedDecision(cell: string): PolicyDecision {
  if (cell.startsWith("✓ P1")) return "allow_p1";
  if (cell.startsWith("✓ P2")) return "allow_future_p2";
  if (cell.startsWith("✓ P3")) return "allow_future_p3";
  return "deny";
}

type EndpointInventoryRow = Readonly<{
  method: string;
  path: string;
  auth: string;
}>;

function endpointInventoryRows(): EndpointInventoryRow[] {
  const section = prd.split("### Endpoint Inventory")[1]!.split("**OpenAPI ownership:**")[0]!;
  return section
    .split(/\r?\n/u)
    .filter((line) => /^\| (GET|POST|PATCH|PUT|DELETE) \|/u.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { method: cells[0]!, path: cells[1]!.replaceAll("`", ""), auth: cells[2]! };
    });
}

function isJwtOrApiKeyProtected({ auth }: EndpointInventoryRow): boolean {
  if (/\bJWT\b|\bAPI key\b/u.test(auth)) return true;
  if (/\bPublic\b|\bRefresh(?:-| )cookie\b|\bendpoint-specific\b|\bsession auth\b/iu.test(auth)) {
    return false;
  }
  throw new Error(`Unclassified endpoint auth mode: ${auth}`);
}

function protectedEndpointKeys(): string[] {
  return endpointInventoryRows()
    .filter(isJwtOrApiKeyProtected)
    .map(({ method, path }) => `${method} ${path}`)
    .sort();
}

const matrix = rolesMatrix();
const expectedActions = matrix.actions.flatMap((action) =>
  action === "api_keys.read_rotate" ? ["api_keys.read_manage", action] : [action],
);

const IMPLEMENTED_PHASE_2_ACTIONS: Record<UserRole, ReadonlySet<AuthAction>> = {
  tenant_admin: new Set([
    "scenarios.read_write",
    "recommendations.request_approval",
    "recommendations.approve_reject",
    "approvals.read",
    "reports.read",
    "backtests.read_run",
    "audit_log.read",
    "notifications.read",
    "notification_preferences.write",
    "ecosystem_adapters.configure",
  ]),
  finops_analyst: new Set([
    "scenarios.read_write",
    "recommendations.request_approval",
    "backtests.read_run",
    "notifications.read",
    "notification_preferences.write",
  ]),
  finance_approver: new Set([
    "scenarios.read_write",
    "recommendations.read",
    "recommendations.approve_reject",
    "approvals.read",
    "backtests.read_run",
    "notifications.read",
    "notification_preferences.write",
  ]),
  read_only_auditor: new Set([
    "scenarios.read_write",
    "backtests.read_run",
    "audit_log.read",
    "notifications.read",
  ]),
};

function expectedRoleDecision(role: UserRole, action: AuthAction): PolicyDecision {
  if (IMPLEMENTED_PHASE_2_ACTIONS[role].has(action)) return "allow_p1";
  const canonical = action === "api_keys.read_manage" ? "api_keys.read_rotate" : action;
  const index = matrix.actions.indexOf(canonical);
  return expectedDecision(matrix.rows.get(role)![index]!);
}

it("defines each canonical action plus the listing-specific key-management action once", () => {
  expect(AUTH_ACTIONS).toEqual(expectedActions);
  expect(new Set(AUTH_ACTIONS).size).toBe(AUTH_ACTIONS.length);
  expect(isAuthAction("tenant_profile.read")).toBe(true);
  expect(isAuthAction("future.unimplemented")).toBe(false);
  expect(canPerformAuthAction("tenant_admin", "future.unimplemented", "user")).toBe(false);
});

it("encodes every role/action cell explicitly with future cells default denied", () => {
  expect(Object.keys(ROLE_ACTION_POLICY).sort()).toEqual([...USER_ROLES].sort());
  for (const role of USER_ROLES) {
    expect(Object.keys(ROLE_ACTION_POLICY[role]).sort()).toEqual([...AUTH_ACTIONS].sort());
    for (const action of AUTH_ACTIONS) {
      const decision = expectedRoleDecision(role, action);
      expect(ROLE_ACTION_POLICY[role][action]).toBe(decision);
      expect(canPerformAuthAction(role, action, "user")).toBe(decision === "allow_p1");
    }
  }
});

it("uses a fixed API-key P1 automation allow-list without inherited analyst grants", () => {
  const expectedAllowed = [
    "tenant_profile.read",
    "cloud_accounts.read",
    "cloud_accounts.create_update",
    "imports.read",
    "imports.write",
    "price_tables.read",
    "forecast_models.read",
    "forecast_models.write",
    "forecast_runs.read",
    "forecast_runs.run",
    "optimizer_runs.read",
    "optimizer_runs.run",
    "recommendations.read",
    "recommendations.request_approval",
    "reports.read",
    "backtests.read_run",
  ];
  expect(Object.keys(API_KEY_ACTION_POLICY).sort()).toEqual([...AUTH_ACTIONS].sort());
  expect(AUTH_ACTIONS.filter((action) => API_KEY_ACTION_POLICY[action] === "allow_p1")).toEqual(
    expectedAllowed,
  );
  for (const action of AUTH_ACTIONS) {
    expect(canPerformAuthAction("finops_analyst", action, "api_key")).toBe(
      expectedAllowed.includes(action),
    );
  }
  expect(API_KEY_ACTION_POLICY["optimizer_policies.read"]).toBe("deny");
  expect(API_KEY_ACTION_POLICY["recommendations.request_approval"]).toBe("allow_p1");
  expect(API_KEY_ACTION_POLICY["backtests.read_run"]).toBe("allow_p1");
});

it("maps every protected PRD endpoint once to a canonical action", () => {
  const keys = PROTECTED_ENDPOINT_ACTIONS.map(({ method, path }) => `${method} ${path}`).sort();
  expect(keys).toEqual(protectedEndpointKeys());
  expect(new Set(keys).size).toBe(keys.length);
  for (const route of PROTECTED_ENDPOINT_ACTIONS) {
    expect(isAuthAction(route.action)).toBe(true);
  }
});

it("excludes only explicit public or endpoint-specific session auth from RBAC completeness", () => {
  const excluded = endpointInventoryRows().filter((row) => !isJwtOrApiKeyProtected(row));
  expect(excluded.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
    "GET /health",
    "GET /health/db",
    "GET /health/ready",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/refresh",
    "POST /api/tenants/register",
  ]);
  expect(excluded.every(({ auth }) => /Public|Refresh(?:-| )cookie/u.test(auth))).toBe(true);
  expect(protectedEndpointKeys()).toContain("PUT /api/users/{id}/credentials/password");
});

it("keeps action methods granular at governance-owned mutation boundaries", () => {
  const required: AuthAction[] = [
    "cloud_accounts.read",
    "cloud_accounts.create_update",
    "cloud_accounts.deactivate",
    "price_tables.read",
    "price_tables.create_activate",
    "users.read_manage",
    "api_keys.read_manage",
    "api_keys.read_rotate",
    "recommendations.request_approval",
    "recommendations.approve_reject",
    "approvals.read",
  ];
  expect(AUTH_ACTIONS).toEqual(expect.arrayContaining(required));
});
