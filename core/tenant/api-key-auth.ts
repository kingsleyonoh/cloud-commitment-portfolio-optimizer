import { createHash } from "node:crypto";

import { authError } from "./auth-errors.js";

const API_KEY_PATTERN = /^[a-z][a-z0-9]{0,15}_live_v1_[A-Za-z0-9_-]{43}$/u;

export function hashApiKeyCredential(plaintext: string): string {
  if (!API_KEY_PATTERN.test(plaintext)) throw authError("AUTH_INVALID");
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
