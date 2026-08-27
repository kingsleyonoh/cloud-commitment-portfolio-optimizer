import { createHash, randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

import { authError } from "./auth-errors.js";

export interface AuthLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface AuthSessionLimiter {
  admitLogin(account: string, clientIp: string): Promise<AuthLimitDecision>;
  admitRefreshIp(clientIp: string): Promise<AuthLimitDecision>;
  admitRefreshFamily(familyId: string): Promise<AuthLimitDecision>;
  close(): Promise<void>;
}

export interface AuthLimiterConfig {
  mode: "local" | "redis";
  redisUrl: string;
  clock?: () => number;
  keyPrefix?: string;
}

type BucketStore = Map<string, number[]>;

const LOGIN_WINDOW = 15 * 60_000;
const REFRESH_WINDOW = 5 * 60_000;
const DUAL_SCRIPT = `
local t=redis.call('TIME'); local n=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local w=tonumber(ARGV[1]); local cutoff=n-w
for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',cutoff) end
local c1=redis.call('ZCARD',KEYS[1]); local c2=redis.call('ZCARD',KEYS[2])
local function retry(k)
 local o=redis.call('ZRANGE',k,0,0,'WITHSCORES');
 if #o==0 then return 1 end
 return math.max(1,math.ceil((tonumber(o[2])+w-n)/1000))
end
if c1>=tonumber(ARGV[2]) or c2>=tonumber(ARGV[3]) then
 local r1=0; local r2=0
 if c1>=tonumber(ARGV[2]) then r1=retry(KEYS[1]) end
 if c2>=tonumber(ARGV[3]) then r2=retry(KEYS[2]) end
 return {0,math.max(r1,r2)}
end
for i=1,2 do redis.call('ZADD',KEYS[i],n,ARGV[4]..':'..i); redis.call('PEXPIRE',KEYS[i],w*2) end
return {1,0}`;
const SINGLE_SCRIPT = `
local t=redis.call('TIME'); local n=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local w=tonumber(ARGV[1]); redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',n-w)
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) then
 local o=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES')
 return {0,math.max(1,math.ceil((tonumber(o[2])+w-n)/1000))}
end
redis.call('ZADD',KEYS[1],n,ARGV[3]); redis.call('PEXPIRE',KEYS[1],w*2); return {1,0}`;

export async function createAuthSessionLimiter(
  config: AuthLimiterConfig,
): Promise<AuthSessionLimiter> {
  if (config.mode === "local") return localLimiter(config.clock ?? Date.now);
  return redisLimiter(config.redisUrl, config.keyPrefix ?? "ccpo:auth-limit:v1:");
}

export function loginAccountBucket(tenantId: string, email: string): string {
  return digest("login-account", `${tenantId}\0${email}`);
}

function localLimiter(clock: () => number): AuthSessionLimiter {
  const buckets: BucketStore = new Map();
  let closed = false;
  const ready = () => {
    if (closed) throw unavailable();
  };
  return {
    async admitLogin(account, clientIp) {
      ready();
      return admitDual(
        buckets,
        accountKey(account),
        ipKey("login", clientIp),
        5,
        20,
        LOGIN_WINDOW,
        clock(),
      );
    },
    async admitRefreshIp(clientIp) {
      ready();
      return admitOne(buckets, ipKey("refresh", clientIp), 60, REFRESH_WINDOW, clock());
    },
    async admitRefreshFamily(familyId) {
      ready();
      return admitOne(buckets, familyKey(familyId), 10, REFRESH_WINDOW, clock());
    },
    async close() {
      closed = true;
      buckets.clear();
    },
  };
}

async function redisLimiter(url: string, prefix: string): Promise<AuthSessionLimiter> {
  const client = createClient({ url });
  let failed = false;
  client.on("error", () => (failed = true));
  try {
    await client.connect();
    await client.ping();
    if (failed) throw unavailable();
  } catch {
    client.destroy();
    throw unavailable();
  }
  return redisAdapter(client, prefix, () => failed);
}

function redisAdapter(
  client: RedisClientType,
  prefix: string,
  failed: () => boolean,
): AuthSessionLimiter {
  const evaluate = async (script: string, keys: string[], args: string[]) => {
    if (failed() || !client.isReady) throw unavailable();
    try {
      return decision(
        await client.eval(script, { keys: keys.map((key) => prefix + key), arguments: args }),
      );
    } catch {
      throw unavailable();
    }
  };
  return {
    admitLogin: (account, ip) =>
      evaluate(
        DUAL_SCRIPT,
        [accountKey(account), ipKey("login", ip)],
        [String(LOGIN_WINDOW), "5", "20", randomUUID()],
      ),
    admitRefreshIp: (ip) =>
      evaluate(SINGLE_SCRIPT, [ipKey("refresh", ip)], [String(REFRESH_WINDOW), "60", randomUUID()]),
    admitRefreshFamily: (family) =>
      evaluate(SINGLE_SCRIPT, [familyKey(family)], [String(REFRESH_WINDOW), "10", randomUUID()]),
    async close() {
      if (client.isOpen) await client.close();
    },
  };
}

function admitDual(
  buckets: BucketStore,
  first: string,
  second: string,
  firstLimit: number,
  secondLimit: number,
  window: number,
  now: number,
): AuthLimitDecision {
  const left = current(buckets, first, window, now);
  const right = current(buckets, second, window, now);
  const leftFull = left.length >= firstLimit;
  const rightFull = right.length >= secondLimit;
  if (leftFull || rightFull) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        leftFull ? retry(left, window, now) : 0,
        rightFull ? retry(right, window, now) : 0,
      ),
    };
  }
  left.push(now);
  right.push(now);
  buckets.set(first, left);
  buckets.set(second, right);
  return { allowed: true };
}

function admitOne(buckets: BucketStore, key: string, limit: number, window: number, now: number) {
  const entries = current(buckets, key, window, now);
  if (entries.length >= limit)
    return { allowed: false, retryAfterSeconds: retry(entries, window, now) };
  entries.push(now);
  buckets.set(key, entries);
  return { allowed: true };
}

function current(buckets: BucketStore, key: string, window: number, now: number): number[] {
  return (buckets.get(key) ?? []).filter((entry) => entry > now - window);
}

function retry(entries: number[], window: number, now: number): number {
  return entries.length === 0 ? 1 : Math.max(1, Math.ceil((entries[0]! + window - now) / 1000));
}

function accountKey(value: string): string {
  return `account:${value}`;
}
function ipKey(scope: string, value: string): string {
  return `ip:${scope}:${digest(scope, value)}`;
}
function familyKey(value: string): string {
  return `family:${digest("family", value)}`;
}
function digest(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}\0${value}`, "utf8").digest("hex");
}
function decision(value: unknown): AuthLimitDecision {
  if (!Array.isArray(value) || value.length !== 2) throw unavailable();
  const allowed = Number(value[0]);
  const retryAfterSeconds = Number(value[1]);
  if (![0, 1].includes(allowed) || !Number.isSafeInteger(retryAfterSeconds)) throw unavailable();
  return allowed === 1
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}
function unavailable() {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
