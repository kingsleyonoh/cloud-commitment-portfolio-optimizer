export type ScenarioStatus = "draft" | "ready" | "archived";

export type ScenarioRecord = Readonly<{
  id: string;
  name: string;
  description: string | null;
  baseForecastRunId: string | null;
  shockConfig: Record<string, unknown>;
  status: ScenarioStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type Scenario = Readonly<{
  id: string;
  name: string;
  description: string | null;
  base_forecast_run_id: string | null;
  shock_config: Record<string, unknown>;
  status: ScenarioStatus;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}>;

export type ScenarioCreateInput = Readonly<{
  name: string;
  description?: string;
  baseForecastRunId?: string;
  shockConfig: Record<string, unknown>;
}>;

export type ScenarioListInput = Readonly<{
  limit: number;
  status?: ScenarioStatus;
  cursor?: { createdAt: string; id: string };
}>;
