import { describe, expect, it } from "vitest";

import {
  createTraceContext,
  formatTraceparent,
  parseTraceparent,
} from "../../core/observability/trace-context.js";

describe("trace context", () => {
  it("continues a valid W3C trace with a new span", () => {
    const context = createTraceContext(
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      () => "fedcba98-7654-3210-fedc-ba9876543210",
    );

    expect(context).toEqual({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "fedcba9876543210",
      flags: "01",
    });
    expect(formatTraceparent(context)).toBe(
      "00-0123456789abcdef0123456789abcdef-fedcba9876543210-01",
    );
  });

  it("rejects malformed and zero trace identifiers", () => {
    expect(parseTraceparent("bad")).toBeUndefined();
    expect(
      parseTraceparent("00-00000000000000000000000000000000-0123456789abcdef-01"),
    ).toBeUndefined();
    expect(
      parseTraceparent("00-0123456789abcdef0123456789abcdef-0000000000000000-01"),
    ).toBeUndefined();
  });
});
