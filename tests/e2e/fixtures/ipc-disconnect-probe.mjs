import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./http-server.mjs", import.meta.url));
const child = spawn(process.execPath, [fixturePath], {
  env: { ...process.env, E2E_FIXTURE_MODE: "ready", E2E_FIXTURE_PORT: "0" },
  shell: false,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  windowsHide: true,
});
let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});

const deadline = Date.now() + 5_000;
while (!stdout.includes("\n") && Date.now() < deadline) {
  await delay(10);
}
if (!stdout.includes("\n") || !child.pid) {
  throw new Error("fixture did not become ready");
}

const ready = JSON.parse(stdout.trim().split(/\r?\n/u)[0]);
const pid = child.pid;
child.disconnect();
await delay(750);
const stoppedAfterDisconnect = !isRunning(pid);
if (!stoppedAfterDisconnect) {
  process.kill(pid, "SIGKILL");
  const cleanupDeadline = Date.now() + 2_000;
  while (isRunning(pid) && Date.now() < cleanupDeadline) await delay(25);
}

process.stdout.write(`${JSON.stringify({ pid, ready, stoppedAfterDisconnect })}\n`);
process.exitCode = stoppedAfterDisconnect ? 0 : 1;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
