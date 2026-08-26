export type ForecastProvider = "aws";
export type ForecastMethod = "seasonal_naive";
export type ForecastModelStatus = "draft" | "active" | "archived";
export type ForecastRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ForecastModelRecord = Readonly<{
  id: string;
  name: string;
  providerScope: readonly ForecastProvider[];
  serviceScope: readonly string[];
  horizonMonths: number;
  method: ForecastMethod;
  config: Record<string, unknown>;
  status: ForecastModelStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ForecastModel = Readonly<{
  id: string;
  name: string;
  provider_scope: readonly ForecastProvider[];
  service_scope: readonly string[];
  horizon_months: number;
  method: ForecastMethod;
  config: Record<string, unknown>;
  status: ForecastModelStatus;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}>;

export type ForecastRunRecord = Readonly<{
  id: string;
  forecastModelId: string;
  status: ForecastRunStatus;
  inputWindowStart: string;
  inputWindowEnd: string;
  horizonMonths: number;
  randomSeed: string;
  outputUri: string | null;
  qualityMetrics: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}>;

export type ForecastWorkerModel = Readonly<{
  id: string;
  tenantId: string;
  providerScope: readonly ForecastProvider[];
  serviceScope: readonly string[];
  method: ForecastMethod;
  config: Record<string, unknown>;
}>;

export type ForecastWorkerRun = ForecastRunRecord &
  Readonly<{
    tenantId: string;
    model: ForecastWorkerModel;
  }>;

export type ForecastUsageMonth = Readonly<{
  month: string;
  provider: ForecastProvider;
  serviceCode: string;
  region: string;
  onDemandCostCents: string;
  realizedCostCents: string;
  usageQuantity: string;
  lineItemCount: number;
}>;

export type ForecastRun = Readonly<{
  id: string;
  forecast_model_id: string;
  status: ForecastRunStatus;
  input_window_start: string;
  input_window_end: string;
  horizon_months: number;
  random_seed: string;
  output_uri: string | null;
  quality_metrics: Record<string, unknown>;
  error_details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}>;

export type ForecastCursorBoundary = Readonly<{
  createdAt: string;
  id: string;
}>;

export type ForecastModelListInput = Readonly<{
  limit: number;
  cursor?: ForecastCursorBoundary;
  status?: ForecastModelStatus;
  method?: ForecastMethod;
}>;

export type ForecastRunListInput = Readonly<{
  limit: number;
  cursor?: ForecastCursorBoundary;
  status?: ForecastRunStatus;
  forecastModelId?: string;
}>;

export type ForecastModelListPage = Readonly<{
  forecast_models: readonly ForecastModel[];
  next_cursor: string | null;
}>;

export type ForecastRunListPage = Readonly<{
  forecast_runs: readonly ForecastRun[];
  next_cursor: string | null;
}>;

export type ForecastModelCreateInput = Readonly<{
  name: string;
  providerScope: readonly ForecastProvider[];
  serviceScope: readonly string[];
  horizonMonths: number;
  method: ForecastMethod;
  config: Record<string, unknown>;
}>;

export type ForecastRunCreateInput = Readonly<{
  forecastModelId: string;
  inputWindowStart: string;
  inputWindowEnd: string;
  horizonMonths: number;
  randomSeed: string;
}>;
