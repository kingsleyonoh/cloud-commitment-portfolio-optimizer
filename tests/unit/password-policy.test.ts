import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PasswordInputError,
  normalizePassword,
  readPasswordFile,
} from "../../core/tenant/password-policy.js";

const temporaryDirectories: string[] = [];

function scalars(count: number, start = 0x61): string {
  return Array.from({ length: count }, (_, index) =>
    String.fromCodePoint(start + (index % 20)),
  ).join("");
}

async function temporaryFile(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-password-policy-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "credential");
  await writeFile(path, bytes);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("password policy", () => {
  it("normalizes NFC without trimming, truncating, or changing case and spaces", () => {
    const decomposed = `${scalars(13)}e\u0301 `;
    const normalized = normalizePassword(decomposed);

    expect(normalized).toBe(`${scalars(13)}é `);
    expect(normalized.startsWith("a")).toBe(true);
    expect(normalized.endsWith(" ")).toBe(true);
  });

  it("accepts exact scalar and UTF-8 bounds and rejects invalid scalar sequences", () => {
    expect([...normalizePassword(scalars(15))]).toHaveLength(15);
    expect([...normalizePassword(scalars(128))]).toHaveLength(128);
    expect(() => normalizePassword(scalars(14))).toThrow(PasswordInputError);
    expect(() => normalizePassword(scalars(129))).toThrow(PasswordInputError);
    expect(() => normalizePassword(`${scalars(15)}\ud800`)).toThrow(PasswordInputError);
    expect(() => normalizePassword(String.fromCodePoint(0x1f642).repeat(128))).not.toThrow();
    expect(() => normalizePassword(`${String.fromCodePoint(0x1f642).repeat(128)}a`)).toThrow(
      PasswordInputError,
    );
  });

  it("fatal-decodes a regular bounded file and removes at most one LF or CRLF", async () => {
    const value = scalars(15);
    const lf = await temporaryFile(Buffer.from(`${value}\n`, "utf8"));
    const crlf = await temporaryFile(Buffer.from(`${value}\r\n`, "utf8"));
    const twice = await temporaryFile(Buffer.from(`${value}\n\n`, "utf8"));

    expect(await readPasswordFile(lf)).toBe(value);
    expect(await readPasswordFile(crlf)).toBe(value);
    expect(await readPasswordFile(twice)).toBe(`${value}\n`);
  });

  it("rejects oversized, malformed UTF-8, missing, and non-regular secret paths", async () => {
    const oversized = await temporaryFile(Buffer.alloc(1025, 0x61));
    const malformed = await temporaryFile(Uint8Array.from([0xc3, 0x28]));
    const directory = await mkdtemp(join(tmpdir(), "ccpo-password-directory-"));
    temporaryDirectories.push(directory);

    await expect(readPasswordFile(oversized)).rejects.toBeInstanceOf(PasswordInputError);
    await expect(readPasswordFile(malformed)).rejects.toBeInstanceOf(PasswordInputError);
    await expect(readPasswordFile(join(directory, "absent"))).rejects.toBeInstanceOf(
      PasswordInputError,
    );
    await expect(readPasswordFile(directory)).rejects.toBeInstanceOf(PasswordInputError);
  });
});
