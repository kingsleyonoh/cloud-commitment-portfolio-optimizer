import { spawn } from "node:child_process";

const CREDENTIAL_SHAPE = /\b[a-z][a-z0-9]{0,15}_live_v1_[A-Za-z0-9_-]{43}\b/gu;
const HASH_SHAPE = /\b[0-9a-f]{64}\b/gu;

export interface SafeSetupCliResult {
  exitCode: number | null;
  credentialCount: number;
  stdout: string;
  stderr: string;
  stderrContainedCredential: boolean;
}

export async function runSafeSetupCli(
  databaseUrl: string,
  migrationsDirectory: string,
): Promise<SafeSetupCliResult> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required for the CLI integration test.");
  const child = spawn(
    process.execPath,
    [npmCli, "run", "--silent", "setup", "--", `--migrations-dir=${migrationsDirectory}`],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        DEFAULT_TENANT_NAME: "CLI Portfolio",
        DEFAULT_ADMIN_EMAIL: "",
        DEFAULT_ADMIN_NAME: "",
        API_KEY_PREFIX: "ccpo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const rawStdout = Buffer.concat(stdoutChunks).toString("utf8");
  const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
  const stdoutCredentialMatches = rawStdout.match(CREDENTIAL_SHAPE) ?? [];
  const stderrContainedCredential = CREDENTIAL_SHAPE.test(rawStderr);
  CREDENTIAL_SHAPE.lastIndex = 0;
  const stdout = rawStdout
    .replace(CREDENTIAL_SHAPE, "[ONE_TIME_CREDENTIAL_REDACTED]")
    .replace(HASH_SHAPE, "[HASH_REDACTED]");
  const stderr = rawStderr
    .replace(CREDENTIAL_SHAPE, "[ONE_TIME_CREDENTIAL_REDACTED]")
    .replace(HASH_SHAPE, "[HASH_REDACTED]");
  stdoutChunks.length = 0;
  stderrChunks.length = 0;

  return {
    exitCode,
    credentialCount: stdoutCredentialMatches.length,
    stdout,
    stderr,
    stderrContainedCredential,
  };
}
