import { tenantFixtures } from "./tenants.js";

export interface ApiKeyMetadataFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly note: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

function metadataFixture(fixture: ApiKeyMetadataFixture): ApiKeyMetadataFixture {
  return Object.freeze(fixture);
}

export const apiKeyMetadataFixtures = Object.freeze([
  metadataFixture({
    id: "51111111-1111-4111-8111-111111111111",
    tenantId: tenantFixtures.acme.id,
    note: "Acme automation metadata",
    createdAt: "2026-01-11T09:15:00.000Z",
    revokedAt: null,
  }),
  metadataFixture({
    id: "52222222-2222-4222-8222-222222222222",
    tenantId: tenantFixtures.globex.id,
    note: "Globex archived integration metadata",
    createdAt: "2026-02-12T10:30:00.000Z",
    revokedAt: "2026-03-14T11:45:00.000Z",
  }),
] as const satisfies readonly ApiKeyMetadataFixture[]);
