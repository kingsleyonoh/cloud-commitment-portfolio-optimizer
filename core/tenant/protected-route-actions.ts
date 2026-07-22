import type { AuthAction } from "./rbac.js";

export type ProtectedEndpointAction = Readonly<{
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  action: AuthAction;
}>;

export const PROTECTED_ENDPOINT_ACTIONS = [
  { method: "GET", path: "/tenants/me", action: "tenant_profile.read" },
  { method: "GET", path: "/api/users", action: "users.read_manage" },
  { method: "POST", path: "/api/users", action: "users.read_manage" },
  { method: "PATCH", path: "/api/users/{id}", action: "users.read_manage" },
  {
    method: "PUT",
    path: "/api/users/{id}/credentials/password",
    action: "users.read_manage",
  },
  { method: "GET", path: "/api/api-keys", action: "api_keys.read_manage" },
  { method: "POST", path: "/api/api-keys/rotate", action: "api_keys.read_rotate" },
  { method: "POST", path: "/api/cloud-accounts", action: "cloud_accounts.create_update" },
  { method: "GET", path: "/api/cloud-accounts", action: "cloud_accounts.read" },
  { method: "PATCH", path: "/api/cloud-accounts/{id}", action: "cloud_accounts.create_update" },
  {
    method: "POST",
    path: "/api/cloud-accounts/{id}/deactivate",
    action: "cloud_accounts.deactivate",
  },
  { method: "POST", path: "/api/imports", action: "imports.write" },
  { method: "GET", path: "/api/imports", action: "imports.read" },
  { method: "GET", path: "/api/imports/{id}", action: "imports.read" },
  { method: "POST", path: "/api/price-tables", action: "price_tables.create_activate" },
  {
    method: "POST",
    path: "/api/price-tables/{id}/activate",
    action: "price_tables.create_activate",
  },
  { method: "GET", path: "/api/price-tables", action: "price_tables.read" },
  { method: "GET", path: "/api/forecast-models", action: "forecast_models.read" },
  { method: "POST", path: "/api/forecast-models", action: "forecast_models.write" },
  { method: "GET", path: "/api/forecast-runs", action: "forecast_runs.read" },
  { method: "POST", path: "/api/forecast-runs", action: "forecast_runs.run" },
  { method: "GET", path: "/api/forecast-runs/{id}", action: "forecast_runs.read" },
  { method: "GET", path: "/api/scenarios", action: "scenarios.read_write" },
  { method: "POST", path: "/api/scenarios", action: "scenarios.read_write" },
  { method: "GET", path: "/api/scenarios/{id}", action: "scenarios.read_write" },
  { method: "GET", path: "/api/optimizer-policies", action: "optimizer_policies.read" },
  { method: "POST", path: "/api/optimizer-policies", action: "optimizer_policies.write" },
  {
    method: "PATCH",
    path: "/api/optimizer-policies/{id}",
    action: "optimizer_policies.write",
  },
  { method: "POST", path: "/api/optimizer-runs", action: "optimizer_runs.run" },
  { method: "GET", path: "/api/optimizer-runs/{id}", action: "optimizer_runs.read" },
  { method: "GET", path: "/api/recommendations", action: "recommendations.read" },
  { method: "GET", path: "/api/recommendations/{id}", action: "recommendations.read" },
  {
    method: "POST",
    path: "/api/recommendations/{id}/request-approval",
    action: "recommendations.request_approval",
  },
  { method: "GET", path: "/api/approvals", action: "approvals.read" },
  { method: "GET", path: "/api/approvals/{id}", action: "approvals.read" },
  {
    method: "POST",
    path: "/api/approvals/{id}/approve",
    action: "recommendations.approve_reject",
  },
  {
    method: "POST",
    path: "/api/approvals/{id}/reject",
    action: "recommendations.approve_reject",
  },
  { method: "GET", path: "/api/backtests", action: "backtests.read_run" },
  { method: "POST", path: "/api/backtests", action: "backtests.read_run" },
  { method: "GET", path: "/api/backtests/{id}", action: "backtests.read_run" },
  {
    method: "GET",
    path: "/api/reports/{source_type}/{source_id}",
    action: "reports.read",
  },
  { method: "GET", path: "/api/audit-log", action: "audit_log.read" },
  {
    method: "GET",
    path: "/api/integrations/status",
    action: "ecosystem_adapters.configure",
  },
  { method: "GET", path: "/api/notifications", action: "notifications.read" },
  {
    method: "POST",
    path: "/api/notifications/{id}/read",
    action: "notifications.read",
  },
  {
    method: "GET",
    path: "/api/settings/notifications",
    action: "notification_preferences.write",
  },
  {
    method: "PUT",
    path: "/api/settings/notifications",
    action: "notification_preferences.write",
  },
  {
    method: "POST",
    path: "/api/integrations/test-event",
    action: "ecosystem_adapters.configure",
  },
] as const satisfies readonly ProtectedEndpointAction[];
