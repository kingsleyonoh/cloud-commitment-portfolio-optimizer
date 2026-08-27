export interface InitializationOrigin {
  keyId: string;
  tenantId: string;
}

export interface InitializationKeyRow {
  id: string;
  tenantId: string;
  keyHash?: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface InitializationAuditRow {
  tenantId: string;
  actorUserId: string | null;
  actorTenantId?: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  createdAt: string;
  oldValues: unknown;
  newValues: unknown;
}

export interface InitializationRotationState {
  origins: InitializationOrigin[];
  keys: InitializationKeyRow[];
  audits: InitializationAuditRow[];
}

interface CanonicalLink {
  oldId: string;
  replacementId: string;
}

const AMBIGUOUS = "Initialization rotation history is ambiguous.";

export function validateApiKeyRotationChains(
  state: InitializationRotationState,
): Map<string, string> {
  const keys = uniqueMap(state.keys, (row) => row.id);
  const origins = uniqueMap(state.origins, (row) => row.keyId);
  const links = state.audits.map((row) => canonicalLink(row, keys));
  const outgoing = groupUnique(links, (link) => link.oldId);
  const incoming = groupUnique(links, (link) => link.replacementId);
  validateDegrees(keys, origins, outgoing, incoming);
  const currentByOrigin = walkOrigins(origins, keys, outgoing);
  const visited = new Set<string>();
  for (const origin of origins.values()) walk(origin.keyId, keys, outgoing, visited);
  if (visited.size !== keys.size || links.length !== outgoing.size) ambiguous();
  return currentByOrigin;
}

function canonicalLink(
  audit: InitializationAuditRow,
  keys: ReadonlyMap<string, InitializationKeyRow>,
): CanonicalLink {
  requireCanonicalAuditHeader(audit);
  const oldKey = keys.get(audit.entityId!);
  const oldValues = exactObject(audit.oldValues, ["created_at", "revoked_at"]);
  const newValues = exactObject(audit.newValues, ["result", "revoked_at", "replacement"]);
  const replacement = exactObject(newValues.replacement, ["id", "created_at", "revoked_at"]);
  const replacementId = stringValue(replacement.id);
  const replacementKey = keys.get(replacementId);
  const revokedAt = stringValue(newValues.revoked_at);
  if (
    !oldKey ||
    !replacementKey ||
    oldKey.tenantId !== audit.tenantId ||
    replacementKey.tenantId !== audit.tenantId ||
    oldKey.id === replacementKey.id ||
    oldValues.created_at !== oldKey.createdAt ||
    oldValues.revoked_at !== null ||
    newValues.result !== "succeeded" ||
    oldKey.revokedAt !== revokedAt ||
    audit.createdAt !== revokedAt ||
    replacement.created_at !== replacementKey.createdAt ||
    replacement.revoked_at !== null
  ) {
    ambiguous();
  }
  return { oldId: oldKey.id, replacementId };
}

function requireCanonicalAuditHeader(audit: InitializationAuditRow): void {
  if (
    audit.actorType !== "user" ||
    !audit.actorUserId ||
    (audit.actorTenantId !== undefined && audit.actorTenantId !== audit.tenantId) ||
    audit.action !== "api_key.rotated" ||
    audit.entityType !== "api_key" ||
    !audit.entityId ||
    !audit.requestId ||
    audit.requestId.trim() !== audit.requestId
  ) {
    ambiguous();
  }
}

function validateDegrees(
  keys: ReadonlyMap<string, InitializationKeyRow>,
  origins: ReadonlyMap<string, InitializationOrigin>,
  outgoing: ReadonlyMap<string, CanonicalLink>,
  incoming: ReadonlyMap<string, CanonicalLink>,
): void {
  for (const origin of origins.values()) {
    const key = keys.get(origin.keyId);
    if (!key || key.tenantId !== origin.tenantId || incoming.has(origin.keyId)) ambiguous();
  }
  for (const key of keys.values()) {
    if (key.keyHash !== undefined && !/^[0-9a-f]{64}$/u.test(key.keyHash)) ambiguous();
    if ((key.revokedAt === null) === outgoing.has(key.id)) ambiguous();
    if (!origins.has(key.id) && !incoming.has(key.id)) ambiguous();
  }
}

function walkOrigins(
  origins: ReadonlyMap<string, InitializationOrigin>,
  keys: ReadonlyMap<string, InitializationKeyRow>,
  outgoing: ReadonlyMap<string, CanonicalLink>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const origin of origins.values()) {
    const visited = new Set<string>();
    let current = origin.keyId;
    while (outgoing.has(current)) {
      if (visited.has(current)) ambiguous();
      visited.add(current);
      current = outgoing.get(current)!.replacementId;
    }
    const key = keys.get(current);
    if (!key || key.revokedAt !== null || key.tenantId !== origin.tenantId) ambiguous();
    result.set(origin.keyId, current);
  }
  return result;
}

function walk(
  originId: string,
  keys: ReadonlyMap<string, InitializationKeyRow>,
  outgoing: ReadonlyMap<string, CanonicalLink>,
  visited: Set<string>,
): void {
  let current: string | undefined = originId;
  const chain = new Set<string>();
  while (current) {
    if (chain.has(current) || visited.has(current) || !keys.has(current)) ambiguous();
    chain.add(current);
    visited.add(current);
    current = outgoing.get(current)?.replacementId;
  }
}

function uniqueMap<T>(values: T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (!id || result.has(id)) ambiguous();
    result.set(id, value);
  }
  return result;
}

function groupUnique<T>(values: T[], key: (value: T) => string): Map<string, T> {
  return uniqueMap(values, key);
}

function exactObject(value: unknown, expectedKeys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) ambiguous();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("\0") !== [...expectedKeys].sort().join("\0")) ambiguous();
  return record;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) ambiguous();
  return value;
}

function ambiguous(): never {
  throw new Error(AMBIGUOUS);
}
