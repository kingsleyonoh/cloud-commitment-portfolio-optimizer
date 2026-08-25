const importErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "details"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "array", maxItems: 0 },
      },
    },
  },
} as const;

const importControlTotalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "provider",
    "service_code",
    "region",
    "month",
    "line_count",
    "usage_quantity",
    "on_demand_cost_cents",
    "realized_cost_cents",
    "commitment_applied_cents",
  ],
  properties: {
    provider: { type: "string", enum: ["aws", "azure", "gcp"] },
    service_code: { type: "string" },
    region: { type: "string" },
    month: { type: "string", pattern: "^[0-9]{4}-(?:0[1-9]|1[0-2])$" },
    line_count: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" },
    usage_quantity: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,19})\\.[0-9]{8}$" },
    on_demand_cost_cents: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" },
    realized_cost_cents: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" },
    commitment_applied_cents: {
      type: "string",
      pattern: "^(?:0|[1-9][0-9]{0,18})$",
    },
  },
} as const;

export const importCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "format", "object_uri", "cloud_account_id", "control_totals"],
  properties: {
    source: { type: "string", const: "synthetic" },
    format: { type: "string", const: "csv" },
    object_uri: { type: "string", minLength: 1, maxLength: 2048 },
    cloud_account_id: { type: "string", format: "uuid" },
    control_totals: { type: "array", items: importControlTotalSchema, maxItems: 1000 },
  },
} as const;

export const importsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    source: { type: "string", const: "synthetic" },
    format: { type: "string", const: "csv" },
    status: {
      type: "string",
      enum: ["queued", "processing", "completed", "failed", "quarantined", "cancelled"],
    },
    cloud_account_id: { type: "string", format: "uuid" },
  },
} as const;

export const importBatchSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "cloud_account_id",
    "source",
    "format",
    "status",
    "object_uri",
    "schema_version",
    "line_count",
    "error_details",
    "parser_warnings",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    cloud_account_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    source: { type: "string", enum: ["synthetic", "aws_cur", "azure_export", "gcp_export"] },
    format: {
      type: "string",
      enum: ["csv", "parquet", "json_api_snapshot", "native_cur", "manual_override"],
    },
    status: {
      type: "string",
      enum: ["queued", "processing", "completed", "failed", "quarantined", "cancelled"],
    },
    object_uri: { type: "string" },
    schema_version: { type: "string" },
    line_count: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
    error_details: { type: "object", additionalProperties: true },
    parser_warnings: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    created_by_user_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const importsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["imports", "next_cursor"],
  properties: {
    imports: { type: "array", items: importBatchSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const importPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
  },
} as const;

export const importsResponseSchemas = {
  400: importErrorSchema,
  401: importErrorSchema,
  403: importErrorSchema,
  404: importErrorSchema,
  409: importErrorSchema,
  413: importErrorSchema,
  429: importErrorSchema,
  503: importErrorSchema,
} as const;
