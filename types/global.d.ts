import type { preHandlerHookHandler } from "fastify";
import type { AuthAction } from "../core/tenant/rbac.js";
import type { RequestContext } from "../core/tenant/request-context.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext: RequestContext | null;
  }

  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    requireAction(action: AuthAction): preHandlerHookHandler;
  }
}

export {};
