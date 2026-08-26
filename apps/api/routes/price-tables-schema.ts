const priceTableErrorSchema = {
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

const priceTableItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sku",
    "region",
    "term_months",
    "payment_option",
    "hourly_rate_cents",
    "upfront_cents",
    "coverage_rules",
  ],
  properties: {
    sku: { type: "string", minLength: 1, maxLength: 512 },
    region: { type: "string", minLength: 1, maxLength: 128 },
    term_months: { type: "integer", enum: [12, 36] },
    payment_option: {
      type: "string",
      enum: ["no_upfront", "partial_upfront", "all_upfront", "monthly"],
    },
    hourly_rate_cents: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" },
    upfront_cents: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" },
    coverage_rules: { type: "object", additionalProperties: true },
  },
} as const;

const providerSchema = { type: "string", enum: ["aws", "azure", "gcp"] } as const;
const instrumentSchema = {
  type: "string",
  enum: [
    "aws_compute_savings_plan",
    "aws_reserved_instance",
    "azure_savings_plan",
    "azure_reservation",
    "gcp_committed_use_discount",
  ],
} as const;

export const priceTableCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "provider",
    "instrument",
    "version_label",
    "effective_from",
    "effective_to",
    "source_uri",
    "items",
  ],
  properties: {
    provider: providerSchema,
    instrument: instrumentSchema,
    version_label: { type: "string", minLength: 1, maxLength: 128 },
    effective_from: { type: "string", pattern: "^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$" },
    effective_to: {
      anyOf: [
        { type: "string", pattern: "^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$" },
        { type: "null" },
      ],
    },
    source_uri: { type: "string", minLength: 1, maxLength: 2048 },
    items: { type: "array", minItems: 1, maxItems: 5000, items: priceTableItemSchema },
  },
} as const;

export const priceTablesListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    provider: providerSchema,
    instrument: instrumentSchema,
    status: { type: "string", enum: ["draft", "active", "superseded", "blocked"] },
  },
} as const;

export const priceTableSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "provider",
    "instrument",
    "version_label",
    "effective_from",
    "effective_to",
    "source_uri",
    "status",
    "checksum",
    "item_count",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    provider: providerSchema,
    instrument: instrumentSchema,
    version_label: { type: "string" },
    effective_from: { type: "string" },
    effective_to: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_uri: { type: "string" },
    status: { type: "string", enum: ["draft", "active", "superseded", "blocked"] },
    checksum: { type: "string", pattern: "^[0-9a-f]{64}$" },
    item_count: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const priceTablesListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["price_tables", "next_cursor"],
  properties: {
    price_tables: { type: "array", items: priceTableSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const priceTablePathSchema = {
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

export const emptyBodySchema = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
} as const;

export const priceTablesResponseSchemas = {
  400: priceTableErrorSchema,
  401: priceTableErrorSchema,
  403: priceTableErrorSchema,
  404: priceTableErrorSchema,
  409: priceTableErrorSchema,
  413: priceTableErrorSchema,
  429: priceTableErrorSchema,
  503: priceTableErrorSchema,
} as const;
