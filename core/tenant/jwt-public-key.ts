import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { NodeEnvironment } from "../config/env-schema.js";
import { publicKeyStartupError } from "./auth-errors.js";

const PUBLIC_PEM_PATTERN =
  /^-----BEGIN (?:RSA )?PUBLIC KEY-----[\s\S]+-----END (?:RSA )?PUBLIC KEY-----\s*$/u;

export async function loadJwtPublicKey(path: string): Promise<KeyObject> {
  try {
    const resolved = resolve(path);
    const file = await stat(resolved);
    if (!file.isFile()) throw publicKeyStartupError();
    const pem = await readFile(resolved, "utf8");
    if (!PUBLIC_PEM_PATTERN.test(pem)) throw publicKeyStartupError();
    const key = createPublicKey(pem);
    if (
      key.type !== "public" ||
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw publicKeyStartupError();
    }
    return key;
  } catch {
    throw publicKeyStartupError();
  }
}

/**
 * Production always requires a validated key. Development and tests may omit the
 * path only to run public routes; protected JWT tests inject an ephemeral public
 * key or supply a temporary public-key file. A supplied path is always validated.
 */
export async function resolveJwtPublicKey(input: {
  nodeEnv: NodeEnvironment;
  publicKeyPath: string;
}): Promise<KeyObject | null> {
  if (!input.publicKeyPath) {
    if (input.nodeEnv === "production") throw publicKeyStartupError();
    return null;
  }
  return loadJwtPublicKey(input.publicKeyPath);
}
