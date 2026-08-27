import type { FastifyInstance } from "fastify";

import { renderLandingPage } from "../../web/landing-page.js";

export function registerLandingRoute(app: FastifyInstance): void {
  app.get("/", async (_request, reply) =>
    reply.code(200).type("text/html; charset=utf-8").send(renderLandingPage()),
  );
}
