export interface TenantAddressFixture {
  readonly line1: string;
  readonly line2?: string;
  readonly locality: string;
  readonly region?: string;
  readonly postal_code?: string;
  readonly country_code: string;
}

export type TenantRegistrationFixture = Readonly<Record<string, string>>;

export interface TenantFixture {
  readonly id: string;
  readonly name: string;
  readonly legalName: string;
  readonly fullLegalName: string;
  readonly displayName: string;
  readonly address: TenantAddressFixture;
  readonly registration: TenantRegistrationFixture;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly supportUrl: string;
  readonly financeOwnerEmail: string;
  readonly wordmark: string;
  readonly defaultCurrency: string;
  readonly timezone: string;
  readonly riskBudgetCents: number;
  readonly isActive: boolean;
}

function tenantFixture(fixture: TenantFixture): TenantFixture {
  Object.freeze(fixture.address);
  Object.freeze(fixture.registration);
  return Object.freeze(fixture);
}

export const tenantFixtures = Object.freeze({
  acme: tenantFixture({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme Commitment Lab",
    legalName: "Acme Commitment Lab LLC",
    fullLegalName: "Acme Commitment Portfolio Laboratory Limited Liability Company",
    displayName: "Acme Savings Control",
    address: {
      line1: "1200 Market Street, Suite 410, Portfolio Controls Wing, Commitment Analysis Centre",
      line2: "Acme-only leakage sentinel floor",
      locality: "Wilmington",
      region: "Delaware",
      postal_code: "19801",
      country_code: "US",
    },
    registration: { "US-DE": "DELAWARE FILE 004210" },
    contactEmail: "operations@acme-commitment.example",
    contactPhone: "+1 302 555 0142",
    supportUrl: "https://support.acme-commitment.example/help",
    financeOwnerEmail: "finance@acme-commitment.example",
    wordmark: "ACME COMMITMENT LAB®",
    defaultCurrency: "USD",
    timezone: "America/New_York",
    riskBudgetCents: 125_000,
    isActive: true,
  }),
  globex: tenantFixture({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Globex Nuage",
    legalName: "Globex Nuage S.A.S.",
    fullLegalName: "Société Globex d’Optimisation Nuagique par Actions Simplifiée",
    displayName: "Globex Économies — Paris",
    address: {
      line1: "184 avenue des Économies Distribuées, Bâtiment Émeraude",
      line2: "Sentinelle Globex uniquement",
      locality: "Paris",
      region: "Île-de-France",
      postal_code: "75013",
      country_code: "FR",
    },
    registration: { FR: "RCS PARIS 902 184 771" },
    contactEmail: "exploitation@globex-nuage.example",
    contactPhone: "+33 1 84 76 19 02",
    supportUrl: "https://assistance.globex-nuage.example/aide",
    financeOwnerEmail: "tresorerie@globex-nuage.example",
    wordmark: "GLOBEX NUAGE™",
    defaultCurrency: "EUR",
    timezone: "Europe/Paris",
    riskBudgetCents: 275_000,
    isActive: false,
  }),
} as const satisfies Record<string, TenantFixture>);
