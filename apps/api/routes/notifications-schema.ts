const uuidSchema = { type: "string", format: "uuid" } as const;

const errorSchema = {
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
        details: { type: "array" },
      },
    },
  },
} as const;

const statusSchema = {
  type: "string",
  enum: ["unread", "read", "archived", "dismissed"],
} as const;
const urgencySchema = { type: "string", enum: ["low", "medium", "high"] } as const;
const channelSchema = { type: "string", enum: ["in_app", "email"] } as const;

export const notificationsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    status: statusSchema,
    event_type: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const notificationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "event_type",
    "source_type",
    "source_id",
    "template_id",
    "urgency",
    "title",
    "body",
    "payload",
    "status",
    "read_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: uuidSchema,
    event_type: { type: "string" },
    source_type: { type: "string" },
    source_id: { anyOf: [uuidSchema, { type: "null" }] },
    template_id: { type: "string" },
    urgency: urgencySchema,
    title: { type: "string" },
    body: { type: "string" },
    payload: { type: "object", additionalProperties: true },
    status: statusSchema,
    read_at: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const notificationsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["notifications", "next_cursor", "unread_count"],
  properties: {
    notifications: { type: "array", items: notificationSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
    unread_count: { type: "integer", minimum: 0 },
  },
} as const;

export const notificationPreferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "event_type",
    "channel",
    "urgency",
    "enabled",
    "locked_by_admin",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: uuidSchema,
    event_type: { type: "string" },
    channel: channelSchema,
    urgency: urgencySchema,
    enabled: { type: "boolean" },
    locked_by_admin: { type: "boolean" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const notificationPreferencesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["preferences"],
  properties: { preferences: { type: "array", items: notificationPreferenceSchema } },
} as const;

export const notificationPreferencesBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["preferences"],
  properties: {
    preferences: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["event_type", "channel", "urgency", "enabled"],
        properties: {
          event_type: { type: "string", minLength: 1, maxLength: 200 },
          channel: channelSchema,
          urgency: urgencySchema,
          enabled: { type: "boolean" },
          locked_by_admin: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const notificationPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const notificationsResponseSchemas = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  429: errorSchema,
  503: errorSchema,
} as const;
