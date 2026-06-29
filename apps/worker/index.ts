import { loadConfigFromEnv } from "../../core/shared/config.js";

function main(): void {
  const config = loadConfigFromEnv();
  console.log(
    JSON.stringify({
      module: "worker",
      status: "ready",
      redis_url_configured: config.database.redisUrl.length > 0,
      optimizer_timeout_seconds: config.optimizer.timeoutSeconds,
    }),
  );
}

main();
