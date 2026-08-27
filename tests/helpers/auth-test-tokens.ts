import { createSign, type KeyObject } from "node:crypto";

export interface TestTokenOptions {
  privateKey: KeyObject;
  payload: Readonly<Record<string, unknown>>;
  header?: Readonly<Record<string, unknown>>;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createEphemeralTestToken(options: TestTokenOptions): string {
  const header = encode(options.header ?? { typ: "JWT", alg: "RS256" });
  const payload = encode(options.payload);
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(options.privateKey).toString("base64url")}`;
}
