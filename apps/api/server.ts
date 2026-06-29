import { buildApp } from "./app.js";
import { loadConfigFromEnv } from "../../core/shared/config.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const app = buildApp({ config });
  await app.listen({ host: "0.0.0.0", port: config.app.port });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
