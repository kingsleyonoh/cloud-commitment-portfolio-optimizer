import { describe, expect, it } from "vitest";

import { parseApiKeyRotationBody } from "../../core/tenant/api-key-rotation-input.js";

const API_KEY_ID = "11111111-1111-4111-8111-111111111111";

describe("targeted API-key rotation input", () => {
  it("accepts only the closed selected-key body and maps an omitted note to null", () => {
    expect(parseApiKeyRotationBody({ api_key_id: API_KEY_ID })).toEqual({
      apiKeyId: API_KEY_ID,
      note: null,
    });
    expect(
      parseApiKeyRotationBody({ api_key_id: API_KEY_ID, note: "Cafe\u0301 successor" }),
    ).toEqual({ apiKeyId: API_KEY_ID, note: "Café successor" });
  });

  it.each([
    {},
    null,
    [],
    { api_key_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { api_key_id: "11111111-1111-4111-7111-111111111111" },
    { api_key_id: API_KEY_ID, note: null },
    { api_key_id: API_KEY_ID, note: "" },
    { api_key_id: API_KEY_ID, note: "   " },
    { api_key_id: API_KEY_ID, note: " padded" },
    { api_key_id: API_KEY_ID, note: "padded " },
    { api_key_id: API_KEY_ID, note: "bad\u0000note" },
    { api_key_id: API_KEY_ID, note: "bad\u0085note" },
    { api_key_id: API_KEY_ID, note: "x".repeat(201) },
    { api_key_id: API_KEY_ID, tenant_id: API_KEY_ID },
    { api_key_id: API_KEY_ID, version: "v1" },
    { api_key_id: API_KEY_ID, idempotency_key: "forbidden" },
    { api_key_id: API_KEY_ID, old_api_key: "forbidden" },
  ])("rejects invalid/open body %# before generation", (body) => {
    expect(() => parseApiKeyRotationBody(body)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", statusCode: 400, details: [] }),
    );
  });
});
