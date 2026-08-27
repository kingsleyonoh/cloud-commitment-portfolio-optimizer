export const CLOUD_ACCOUNT_PROVIDERS = ["aws", "azure", "gcp"] as const;

export type CloudAccountProvider = (typeof CLOUD_ACCOUNT_PROVIDERS)[number];

export type CloudAccountRecord = Readonly<{
  id: string;
  provider: CloudAccountProvider;
  externalRef: string;
  displayName: string;
  currency: string;
  tags: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type CloudAccount = Readonly<{
  id: string;
  provider: CloudAccountProvider;
  external_ref: string;
  display_name: string;
  currency: string;
  tags: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}>;

export type CloudAccountListPage = Readonly<{
  cloud_accounts: readonly CloudAccount[];
  next_cursor: string | null;
}>;

export type CloudAccountCreateInput = Readonly<{
  provider: CloudAccountProvider;
  externalRef: string;
  displayName: string;
  currency: string;
  tags: Record<string, unknown>;
}>;

export type CloudAccountPatchChanges = Readonly<{
  externalRef?: string;
  displayName?: string;
  currency?: string;
  tags?: Record<string, unknown>;
}>;

export type CloudAccountPatchInput = Readonly<{
  expectedUpdatedAt: string;
  changes: CloudAccountPatchChanges;
}>;

export type CloudAccountCursorBoundary = Readonly<{
  createdAt: string;
  id: string;
}>;

export type CloudAccountListInput = Readonly<{
  limit: number;
  cursor?: CloudAccountCursorBoundary;
  provider?: CloudAccountProvider;
  isActive?: boolean;
}>;
