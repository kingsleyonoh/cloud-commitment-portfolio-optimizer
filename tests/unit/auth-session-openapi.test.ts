import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("documents exact session cookie schemes, headers, routes, statuses, and non-secret bodies", async () => {
  const document = await readFile("openapi.yaml", "utf8");
  const login = section(document, "  /api/auth/login:", "  /api/auth/refresh:");
  const refresh = section(document, "  /api/auth/refresh:", "  /api/auth/logout:");
  const logout = section(document, "  /api/auth/logout:", "  /api/tenants/register:");
  const schemas = section(document, "    AuthLoginRequest:", "    ApiKeyRotationRequest:");

  for (const scheme of ["AccessCookie", "RefreshCookie", "CsrfCookie"]) {
    expect(document).toContain(`    ${scheme}:`);
  }
  expect(document).toContain("name: __Host-ccpo_access");
  expect(document).toContain("name: __Host-ccpo_refresh");
  expect(document).toContain("name: __Host-ccpo_csrf");
  expect(login).toContain("security: []");
  expect(login).toContain("name: Origin");
  expect(login).toContain("name: Sec-Fetch-Site");
  expect(refresh).toContain("name: X-CSRF-Token");
  expect(refresh).toContain("RefreshCookie: []");
  expect(logout).toContain('"204":');
  for (const status of ["400", "401", "403", "413", "503"]) {
    expect(login).toContain(`"${status}":`);
    expect(refresh).toContain(`"${status}":`);
    expect(logout).toContain(`"${status}":`);
  }
  expect(login).toContain('"200":');
  expect(refresh).toContain('"200":');
  expect(login).toContain('"429":');
  expect(refresh).toContain('"429":');
  expect(schemas).toContain("writeOnly: true");
  expect(schemas).not.toMatch(/(?:example:|access_token|refresh_token|csrf_token)/u);
});

it("documents access-cookie compatibility and conditional CSRF on every current protected route", async () => {
  const document = await readFile("openapi.yaml", "utf8");
  const protectedSurface = section(document, "  /tenants/me:", "  /health:");
  const usersStart = document.indexOf("  /api/users:");
  const unsafeOperations = [
    section(document, "    post:", "  /api/users/{id}:", usersStart),
    section(document, "  /api/users/{id}:", "  /api/users/{id}/credentials/password:"),
    section(document, "  /api/users/{id}/credentials/password:", "  /api/api-keys:"),
    section(document, "  /api/api-keys/rotate:", "  /health:"),
  ];

  expect(protectedSurface.match(/- AccessCookie: \[\]/gu)).toHaveLength(7);
  for (const operation of unsafeOperations) {
    expect(operation).toContain("name: Origin");
    expect(operation).toContain("name: Sec-Fetch-Site");
    expect(operation).toContain("name: X-CSRF-Token");
  }
});

function section(document: string, startMarker: string, endMarker: string, fromIndex = 0): string {
  const start = document.indexOf(startMarker, fromIndex);
  const end = document.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return document.slice(start, end);
}
