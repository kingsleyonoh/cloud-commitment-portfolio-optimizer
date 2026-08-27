import { expect, test } from "@playwright/test";
import { startE2eServer } from "./helpers/server.js";

test("the E2E server rejects unknown routes over real HTTP", async () => {
  const server = await startE2eServer();
  try {
    const response = await fetch(`${server.url}/not-a-route`);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not Found\n");
  } finally {
    await server.stop();
  }
});
