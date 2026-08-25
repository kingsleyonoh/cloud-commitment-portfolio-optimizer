export type PriceTableProvider = "aws";
export type PriceTableInstrument = "aws_compute_savings_plan";
export type PriceTableStatus = "draft" | "active" | "superseded" | "blocked";
export type PriceTablePaymentOption = "no_upfront" | "partial_upfront" | "all_upfront";

export type PriceTableVersionRecord = Readonly<{
  id: string;
  provider: PriceTableProvider;
  instrument: PriceTableInstrument;
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUri: string;
  status: PriceTableStatus;
  checksum: string;
  itemCount: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PriceTableVersion = Readonly<{
  id: string;
  provider: PriceTableProvider;
  instrument: PriceTableInstrument;
  version_label: string;
  effective_from: string;
  effective_to: string | null;
  source_uri: string;
  status: PriceTableStatus;
  checksum: string;
  item_count: string;
  created_at: string;
  updated_at: string;
}>;

export type PriceTableListPage = Readonly<{
  price_tables: readonly PriceTableVersion[];
  next_cursor: string | null;
}>;

export type PriceTableCursorBoundary = Readonly<{
  createdAt: string;
  id: string;
}>;

export type PriceTableListInput = Readonly<{
  limit: number;
  cursor?: PriceTableCursorBoundary;
  provider?: PriceTableProvider;
  instrument?: PriceTableInstrument;
  status?: PriceTableStatus;
}>;

export type PriceTableItemInput = Readonly<{
  sku: string;
  region: string;
  termMonths: 12 | 36;
  paymentOption: PriceTablePaymentOption;
  hourlyRateCents: string;
  upfrontCents: string;
  coverageRules: Record<string, unknown>;
}>;

export type PriceTableCreateInput = Readonly<{
  provider: PriceTableProvider;
  instrument: PriceTableInstrument;
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUri: string;
  items: readonly PriceTableItemInput[];
  checksum: string;
}>;
