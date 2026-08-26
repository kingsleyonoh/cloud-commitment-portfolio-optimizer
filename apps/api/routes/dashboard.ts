import type { FastifyInstance } from "fastify";

import type { DashboardService } from "../../../core/dashboard/dashboard-service.js";
import type { RequestContext } from "../../../core/tenant/request-context.js";
import { renderDashboardPage } from "../../web/dashboard-page.js";

export interface DashboardRuntime {
  service: DashboardService;
}

export function registerDashboardRoute(app: FastifyInstance, runtime: DashboardRuntime): void {
  app.get(
    "/dashboard",
    {
      preHandler: [
        app.authenticate,
        app.requireAction("imports.read"),
        app.requireAction("recommendations.read"),
      ],
    },
    async (request, reply) => {
      const summary = await runtime.service.summary(request.authContext as RequestContext);
      return reply.code(200).type("text/html; charset=utf-8").send(renderDashboardPage(summary));
    },
  );
}
