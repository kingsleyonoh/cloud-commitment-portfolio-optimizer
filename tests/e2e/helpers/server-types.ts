export type FixtureMode = "ready" | "slow-ready" | "exit-before-ready" | "never-ready";
export type ServerTarget = "fixture" | "application";

export interface StartServerOptions {
  port?: number;
  startupTimeoutMs?: number;
  mode?: FixtureMode;
  target?: ServerTarget;
  environment?: Readonly<Record<string, string>>;
}

export interface RunningServer {
  url: string;
  port: number;
  pid: number;
  stop: () => Promise<void>;
}

export interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ReadySignal {
  event: "listening";
  host: string;
  port: number;
}

export interface ChildOutput {
  stdout: string;
  stderr: string;
}

export const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const STOP_TIMEOUT_MS = 2_000;

export class ServerStartError extends Error {
  readonly pid: number | null;

  constructor(message: string, pid: number | null, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServerStartError";
    this.pid = pid;
  }
}
