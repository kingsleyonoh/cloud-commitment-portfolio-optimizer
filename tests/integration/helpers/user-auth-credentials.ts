function unpaddedBase64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/u, "");
}

export function syntheticCredentialVerifier(seed: number): string {
  const salt = unpaddedBase64(Buffer.alloc(16, seed));
  const digest = unpaddedBase64(Buffer.alloc(32, seed + 1));
  return ["", "argon2id", "v=19", "m=65536,t=3,p=1", salt, digest].join("$");
}
