import { createServer } from "node:http";

const host = "127.0.0.1";
const port = parsePort(process.env.E2E_FIXTURE_PORT ?? "0");
const mode = process.env.E2E_FIXTURE_MODE ?? "ready";

if (mode === "exit-before-ready") {
  process.stderr.write("fixture child failed intentionally\n");
  process.exitCode = 23;
  process.disconnect?.();
} else if (mode === "never-ready") {
  const heartbeat = setInterval(() => undefined, 1_000);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    process.exitCode = 0;
    disconnectIpc();
  };
  process.once("message", (message) => {
    if (message?.type === "shutdown") stop();
  });
  process.once("disconnect", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} else if (mode === "ready") {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end('{"status":"ready"}\n');
      return;
    }

    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>E2E Harness Ready</title>
    <link rel="icon" href="data:,">
  </head>
  <body>
    <main>
      <h1>E2E harness ready</h1>
      <p data-testid="transport-contract">Real Chromium → localhost HTTP → deterministic fixture</p>
    </main>
  </body>
</html>`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found\n");
  });

  server.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    process.disconnect?.();
  });
  server.listen(port, host, () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      process.stderr.write("fixture server did not receive a TCP address\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify({ event: "listening", host, port: address.port })}\n`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
      process.exitCode = error === undefined ? 0 : 1;
      disconnectIpc();
    });
  };
  process.once("message", (message) => {
    if (message?.type === "shutdown") stop();
  });
  process.once("disconnect", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} else {
  process.stderr.write(`unknown fixture mode: ${mode}\n`);
  process.exitCode = 2;
  process.disconnect?.();
}

function disconnectIpc() {
  if (process.connected) process.disconnect();
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid E2E fixture port: ${value}`);
  }
  return parsed;
}
