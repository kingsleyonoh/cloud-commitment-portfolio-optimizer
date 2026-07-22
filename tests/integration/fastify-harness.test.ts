import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { tenantFixtures } from "../fixtures/tenants.js";

describe("Fastify integration harness", () => {
  it("exercises a real Fastify request lifecycle with tenant fixture context", async () => {
    const app = Fastify();
    app.get("/harness", async (request) => ({
      tenantId: request.headers["x-test-tenant-id"] ?? null,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/harness",
      headers: { "x-test-tenant-id": tenantFixtures.acme.id },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: tenantFixtures.acme.id });
  });

  it("keeps missing tenant context observable instead of inventing one", async () => {
    const app = Fastify();
    app.get("/harness", async (request, reply) => {
      const tenantId = request.headers["x-test-tenant-id"];
      if (!tenantId) return reply.code(400).send({ code: "TENANT_CONTEXT_REQUIRED" });
      return { tenantId };
    });

    const response = await app.inject({ method: "GET", url: "/harness" });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "TENANT_CONTEXT_REQUIRED" });
  });
});
