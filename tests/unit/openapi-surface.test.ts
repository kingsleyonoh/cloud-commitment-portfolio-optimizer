import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { PROTECTED_ENDPOINT_ACTIONS } from "../../core/tenant/protected-route-actions.js";

describe("OpenAPI surface contract", () => {
  it("documents every protected endpoint with a security declaration and concrete response refs", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    for (const endpoint of PROTECTED_ENDPOINT_ACTIONS) {
      const route = operation(document, endpoint.path, endpoint.method.toLowerCase());
      expect(route, `${endpoint.method} ${endpoint.path}`).toContain("security:");
      expect(route).toContain("operationId:");
      expect(route).toMatch(/#\/components\/(?:responses\/Error|schemas\/\w*Error)/u);
      expect(route).not.toContain("TODO");
    }
  });

  it("documents the public and health endpoints without placeholder responses", async () => {
    const document = await readFile("openapi.yaml", "utf8");
    for (const path of [
      "/api/auth/login",
      "/api/auth/refresh",
      "/api/auth/logout",
      "/health",
      "/health/db",
      "/health/ready",
    ]) {
      const route =
        path === "/api/auth/login"
          ? section(document, `  ${path}:`, "  /api/auth/refresh:")
          : path === "/api/auth/refresh"
            ? section(document, `  ${path}:`, "  /api/auth/logout:")
            : path === "/api/auth/logout"
              ? section(document, `  ${path}:`, "  /api/tenants/register:")
              : operation(document, path, "get");
      expect(route, path).not.toContain("TODO");
      expect(route).toContain("operationId:");
      expect(route).toContain("responses:");
    }
  });
});

function operation(document: string, path: string, method: string): string {
  const pathStart = document.indexOf(`  ${path}:`);
  expect(pathStart).toBeGreaterThanOrEqual(0);
  const nextPath = document.indexOf("\n  /", pathStart + 1);
  const pathSection = document.slice(pathStart, nextPath < 0 ? document.length : nextPath);
  const methodStart = pathSection.search(new RegExp(`\\n {4}${method}:`, "u"));
  expect(methodStart, `${method} ${path}`).toBeGreaterThanOrEqual(0);
  const methodBodyStart = methodStart + 1;
  const nextMethod = pathSection.slice(methodBodyStart + 1).search(/\n {4}[a-z][a-z-]*:/u);
  return pathSection.slice(
    methodBodyStart,
    nextMethod < 0 ? pathSection.length : methodBodyStart + 1 + nextMethod,
  );
}

function section(document: string, startMarker: string, endMarker?: string): string {
  const start = document.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endMarker ? document.indexOf(endMarker, start + startMarker.length) : -1;
  return document.slice(start, end < 0 ? document.length : end);
}
