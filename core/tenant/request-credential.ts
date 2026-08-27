import type { FastifyRequest } from "fastify";

import { authError } from "./auth-errors.js";

export type RequestCredential = Readonly<
  | { kind: "api_key"; value: string }
  | { kind: "jwt"; value: string }
  | { kind: "access_cookie"; value: string }
>;

type RequestHeaders = Readonly<
  Record<string, string | readonly string[] | undefined> | FastifyRequest["headers"]
>;

export function selectRequestCredential(
  headers: RequestHeaders,
  accessCookie?: string,
): RequestCredential {
  const apiKey = singleHeader(headers["x-api-key"]);
  const authorization = singleHeader(headers.authorization);
  const cookiePresent = accessCookie !== undefined;
  const count = Number(apiKey.present) + Number(authorization.present) + Number(cookiePresent);
  if (count > 1) throw authError("AUTH_CREDENTIAL_CONFLICT");
  if (count === 0) throw authError("AUTH_REQUIRED");
  if (apiKey.present) {
    if (!apiKey.value || apiKey.value.trim() !== apiKey.value) throw authError("AUTH_INVALID");
    return Object.freeze({ kind: "api_key", value: apiKey.value });
  }
  if (cookiePresent) {
    if (!accessCookie || accessCookie.trim() !== accessCookie) throw authError("AUTH_INVALID");
    return Object.freeze({ kind: "access_cookie", value: accessCookie });
  }
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization.value ?? "");
  if (!match?.[1]) throw authError("AUTH_INVALID");
  return Object.freeze({ kind: "jwt", value: match[1] });
}

function singleHeader(input: string | readonly string[] | undefined): {
  present: boolean;
  value?: string;
} {
  if (input === undefined) return { present: false };
  if (Array.isArray(input)) {
    if (input.length !== 1) throw authError("AUTH_INVALID");
    return { present: true, value: input[0] };
  }
  return { present: true, value: input as string };
}
