import { open } from "node:fs/promises";

export const PASSWORD_MIN_SCALARS = 15;
export const PASSWORD_MAX_SCALARS = 128;
export const PASSWORD_MAX_UTF8_BYTES = 512;
export const PASSWORD_FILE_MAX_BYTES = 1024;

export class PasswordInputError extends Error {
  constructor() {
    super("Password input is invalid.");
    this.name = "PasswordInputError";
  }
}

export function normalizePassword(value: unknown): string {
  if (typeof value !== "string" || hasInvalidScalar(value)) throw new PasswordInputError();
  const normalized = value.normalize("NFC");
  const scalarCount = [...normalized].length;
  const encodedLength = Buffer.byteLength(normalized, "utf8");
  if (
    scalarCount < PASSWORD_MIN_SCALARS ||
    scalarCount > PASSWORD_MAX_SCALARS ||
    encodedLength > PASSWORD_MAX_UTF8_BYTES
  ) {
    throw new PasswordInputError();
  }
  return normalized;
}

export async function readPasswordFile(path: string): Promise<string> {
  if (typeof path !== "string" || path.length === 0) throw new PasswordInputError();
  let handle;
  try {
    handle = await open(path, "r");
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > PASSWORD_FILE_MAX_BYTES) {
      throw new PasswordInputError();
    }
    const buffer = Buffer.alloc(PASSWORD_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > PASSWORD_FILE_MAX_BYTES) throw new PasswordInputError();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    return normalizePassword(removeOneTerminalLineEnding(decoded));
  } catch (error) {
    if (error instanceof PasswordInputError) throw error;
    throw new PasswordInputError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function removeOneTerminalLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function hasInvalidScalar(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0xd800 && codePoint <= 0xdfff;
  });
}
