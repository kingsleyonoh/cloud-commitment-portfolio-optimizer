import { tenantFixtures } from "./tenants.js";

export const canonicalUserRoles = Object.freeze([
  "tenant_admin",
  "finops_analyst",
  "finance_approver",
  "read_only_auditor",
] as const);

export type UserFixtureRole = (typeof canonicalUserRoles)[number];

export interface UserFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserFixtureRole;
  readonly isActive: boolean;
}

function userFixture(fixture: UserFixture): UserFixture {
  return Object.freeze(fixture);
}

export const userFixtures = Object.freeze([
  userFixture({
    id: "31111111-1111-4111-8111-111111111111",
    tenantId: tenantFixtures.acme.id,
    email: "admin-user@acme-users.example",
    name: "Avery Acme Administrator",
    role: "tenant_admin",
    isActive: true,
  }),
  userFixture({
    id: "31222222-2222-4222-8222-222222222222",
    tenantId: tenantFixtures.acme.id,
    email: "analyst-user@acme-users.example",
    name: "Ari Acme Analyst",
    role: "finops_analyst",
    isActive: true,
  }),
  userFixture({
    id: "42111111-1111-4111-8111-111111111111",
    tenantId: tenantFixtures.globex.id,
    email: "approver-user@globex-users.example",
    name: "Élodie Globex Approver",
    role: "finance_approver",
    isActive: true,
  }),
  userFixture({
    id: "42222222-2222-4222-8222-222222222222",
    tenantId: tenantFixtures.globex.id,
    email: "auditor-user@globex-users.example",
    name: "Bastien Globex Auditor",
    role: "read_only_auditor",
    isActive: false,
  }),
] as const satisfies readonly UserFixture[]);
