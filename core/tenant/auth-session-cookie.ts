import type { FastifyReply } from "fastify";

import type { SessionCookiePolicy, SessionIssue } from "./auth-session-types.js";

export function createSessionCookiePolicy(input: {
  secure: boolean;
  publicBaseUrl: string;
  accessLifetimeSeconds: number;
}): SessionCookiePolicy {
  const prefix = input.secure ? "__Host-" : "";
  return Object.freeze({
    secure: input.secure,
    publicOrigin: new URL(input.publicBaseUrl).origin,
    accessName: `${prefix}ccpo_access`,
    refreshName: `${prefix}ccpo_refresh`,
    csrfName: `${prefix}ccpo_csrf`,
    accessLifetimeSeconds: input.accessLifetimeSeconds,
  });
}

export function setSessionCookies(
  reply: FastifyReply,
  policy: SessionCookiePolicy,
  issue: SessionIssue,
  now = Date.now(),
): void {
  const accessMaxAge = remainingSeconds(issue.session.access_expires_at, now);
  const refreshMaxAge = Math.min(
    remainingSeconds(issue.session.refresh_idle_expires_at, now),
    remainingSeconds(issue.session.refresh_absolute_expires_at, now),
  );
  reply.setCookie(policy.accessName, issue.accessToken, options(policy, true, accessMaxAge));
  reply.setCookie(policy.refreshName, issue.refreshToken, options(policy, true, refreshMaxAge));
  reply.setCookie(policy.csrfName, issue.csrfToken, options(policy, false, refreshMaxAge));
}

export function clearSessionCookies(reply: FastifyReply, policy: SessionCookiePolicy): void {
  reply.clearCookie(policy.accessName, clearOptions(policy, true));
  reply.clearCookie(policy.refreshName, clearOptions(policy, true));
  reply.clearCookie(policy.csrfName, clearOptions(policy, false));
}

function options(
  policy: SessionCookiePolicy,
  httpOnly: boolean,
  maxAge: number,
): { path: "/"; secure: boolean; sameSite: "strict"; httpOnly: boolean; maxAge: number } {
  return { path: "/", secure: policy.secure, sameSite: "strict", httpOnly, maxAge };
}

function clearOptions(policy: SessionCookiePolicy, httpOnly: boolean) {
  return { path: "/" as const, secure: policy.secure, sameSite: "strict" as const, httpOnly };
}

function remainingSeconds(timestamp: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(timestamp) - now) / 1000));
}
