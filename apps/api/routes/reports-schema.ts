import { recommendationErrorSchema, reportSummarySchema } from "./recommendations-schema.js";

const uuidSchema = { type: "string", format: "uuid" } as const;

export const reportPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source_type", "source_id"],
  properties: {
    source_type: { type: "string", enum: ["recommendation"] },
    source_id: uuidSchema,
  },
} as const;

export const reportSnapshotSchema = {
  allOf: [
    reportSummarySchema,
    {
      type: "object",
      required: ["snapshot_json"],
      properties: {
        snapshot_json: { type: "object", additionalProperties: true },
      },
    },
  ],
} as const;

export const reportResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["report_snapshot", "snapshot", "rendered_html"],
  properties: {
    report_snapshot: reportSnapshotSchema,
    snapshot: { type: "object", additionalProperties: true },
    rendered_html: { type: "string" },
  },
} as const;

export const reportsResponseSchemas = {
  400: recommendationErrorSchema,
  401: recommendationErrorSchema,
  403: recommendationErrorSchema,
  404: recommendationErrorSchema,
  429: recommendationErrorSchema,
  503: recommendationErrorSchema,
} as const;
