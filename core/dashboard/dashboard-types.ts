export interface DashboardImportStatus {
  status: string;
  count: number;
  latestAt: string | null;
}

export interface DashboardRecommendationStatus {
  status: string;
  riskBand: string;
  count: number;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
}

export interface DashboardRecentRecommendation {
  id: string;
  recommendationType: string;
  provider: string;
  instrument: string;
  expectedSavingsCents: string;
  p95DownsideLossCents: string;
  riskBand: string;
  status: string;
  createdAt: string;
}

export interface DashboardTenant {
  displayName: string;
  defaultCurrency: string;
  riskBudgetCents: string;
  timezone: string;
}

export interface DashboardSummary {
  tenant: DashboardTenant;
  role: string;
  importStatuses: readonly DashboardImportStatus[];
  recommendationStatuses: readonly DashboardRecommendationStatus[];
  recentRecommendations: readonly DashboardRecentRecommendation[];
}
