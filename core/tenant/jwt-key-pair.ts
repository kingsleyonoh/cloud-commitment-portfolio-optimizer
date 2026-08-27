import { createPrivateKey, createPublicKey, timingSafeEqual, type KeyObject } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { NodeEnvironment } from "../config/env-schema.js";
import { signingKeyStartupError } from "./auth-errors.js";
import { resolveJwtPublicKey } from "./jwt-public-key.js";

const PRIVATE_PEM_PATTERN =
  /^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/u;

export interface JwtKeyPair {
  publicKey: KeyObject | null;
  privateKey: KeyObject | null;
}

export async function resolveJwtKeyPair(input: {
  nodeEnv: NodeEnvironment;
  publicKeyPath: string;
  privateKeyPath: string;
}): Promise<JwtKeyPair> {
  const publicKey = await resolveJwtPublicKey({
    nodeEnv: input.nodeEnv,
    publicKeyPath: input.publicKeyPath,
  });
  if (!input.privateKeyPath) {
    if (input.nodeEnv === "production") throw signingKeyStartupError();
    return { publicKey, privateKey: null };
  }
  if (!publicKey) throw signingKeyStartupError();
  const privateKey = await loadPrivateKey(input.privateKeyPath);
  assertMatchingPair(publicKey, privateKey);
  return { publicKey, privateKey };
}

async function loadPrivateKey(path: string): Promise<KeyObject> {
  try {
    const resolved = resolve(path);
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw signingKeyStartupError();
    const pem = await readFile(resolved, "utf8");
    if (!PRIVATE_PEM_PATTERN.test(pem)) throw signingKeyStartupError();
    const key = createPrivateKey(pem);
    if (
      key.type !== "private" ||
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw signingKeyStartupError();
    }
    return key;
  } catch {
    throw signingKeyStartupError();
  }
}

function assertMatchingPair(publicKey: KeyObject, privateKey: KeyObject): void {
  try {
    const expected = publicKey.export({ type: "spki", format: "der" });
    const actual = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw signingKeyStartupError();
    }
  } catch {
    throw signingKeyStartupError();
  }
}
