export type NotificationStatus = "unread" | "read" | "archived" | "dismissed";
export type NotificationUrgency = "low" | "medium" | "high";
export type NotificationChannel = "in_app" | "email";
export type NotificationSourceType =
  "import_batch" | "recommendation" | "approval" | "backtest_run" | "ecosystem_event" | "system";

export type NotificationRecord = Readonly<{
  id: string;
  tenantId: string;
  recipientUserId: string;
  eventType: string;
  sourceType: NotificationSourceType;
  sourceId: string | null;
  templateId: string;
  urgency: NotificationUrgency;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type Notification = Readonly<{
  id: string;
  event_type: string;
  source_type: NotificationSourceType;
  source_id: string | null;
  template_id: string;
  urgency: NotificationUrgency;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type NotificationListPage = Readonly<{
  notifications: readonly Notification[];
  next_cursor: string | null;
  unread_count: number;
}>;

export type NotificationListInput = Readonly<{
  limit: number;
  cursor?: string;
  status?: NotificationStatus;
  eventType?: string;
}>;

export type NotificationCursorBoundary = Readonly<{ createdAt: string; id: string }>;

export type NotificationPreferenceRecord = Readonly<{
  id: string;
  tenantId: string;
  userId: string;
  eventType: string;
  channel: NotificationChannel;
  urgency: NotificationUrgency;
  enabled: boolean;
  lockedByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type NotificationPreference = Readonly<{
  id: string;
  event_type: string;
  channel: NotificationChannel;
  urgency: NotificationUrgency;
  enabled: boolean;
  locked_by_admin: boolean;
  created_at: string;
  updated_at: string;
}>;

export type NotificationPreferenceInput = Readonly<{
  eventType: string;
  channel: NotificationChannel;
  urgency: NotificationUrgency;
  enabled: boolean;
  lockedByAdmin?: boolean;
}>;

export type NotificationEvent = Readonly<{
  tenantId: string;
  eventType: string;
  eventId: string;
  sourceType: NotificationSourceType;
  sourceId: string | null;
  templateName: string;
  urgency: NotificationUrgency;
  payload: Record<string, unknown>;
  recipientUserIds?: readonly string[];
  recipientRoles?: readonly string[];
}>;
