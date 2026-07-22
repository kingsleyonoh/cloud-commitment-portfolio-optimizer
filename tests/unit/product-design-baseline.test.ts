import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");

function readBaseline(name: "PRODUCT.md" | "DESIGN.md"): string {
  try {
    return readFileSync(resolve(projectRoot, name), "utf8");
  } catch {
    return "";
  }
}

const product = readBaseline("PRODUCT.md");
const design = readBaseline("DESIGN.md");
const combined = `${product}\n${design}`;

function readHexToken(name: string): string {
  const match = design.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "iu"));
  return match?.[1] ?? "#000000";
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

it("provides both canonical root-level baseline documents", () => {
  expect(product.length).toBeGreaterThan(1_000);
  expect(design.length).toBeGreaterThan(1_000);
});

it("defines the complete product UX contract", () => {
  for (const heading of [
    "Audiences and Jobs",
    "Decision Workflow",
    "Explain Before Automate",
    "Tenant, Audit, and Replay Boundaries",
    "States and Error Semantics",
    "Responsive and Mobile Priorities",
    "Privacy and Accessibility Expectations",
    "Success Metrics",
    "Non-Goals",
    "PRD Traceability",
  ]) {
    expect(product).toContain(`## ${heading}`);
  }
});

it("traces product decisions to every governing PRD surface", () => {
  for (const reference of [
    "PRD §1",
    "PRD §2",
    "PRD §5b",
    "PRD §8",
    "PRD §10b",
    "PRD §12",
    "PRD §15",
  ]) {
    expect(product).toContain(reference);
  }
  for (const principle of [
    "Tenant-scoped by default",
    "Standalone-first optimizer",
    "Risk-bounded savings over headline savings",
    "Replayable economics",
    "Explain before automate",
  ]) {
    expect(product).toContain(principle);
  }
});

it("defines named user-visible states and stable error semantics", () => {
  for (const state of [
    "loading",
    "empty",
    "import quarantined",
    "forecast low confidence",
    "optimizer infeasible",
    "recommendation blocked",
    "approval expired",
    "adapter disabled",
    "adapter retrying",
    "permission denied",
    "network unavailable",
  ]) {
    expect(product.toLowerCase()).toContain(state);
  }
  expect(product).toContain("VALIDATION_ERROR");
  expect(product).toContain("404");
});

it("defines a distinctive and implementation-ready interaction system", () => {
  for (const heading of [
    "Aesthetic Thesis",
    "Design Feasibility and Impact Index",
    "Typography",
    "Color and Tokens",
    "Layout and Density",
    "Data Visualization",
    "Tables",
    "Forms",
    "HTMX Interaction Patterns",
    "Responsive Behavior",
    "Accessibility",
    "Loading, Empty, and Error States",
    "Motion",
    "Trust, Audit, and Provenance",
    "Anti-Generic Constraints",
    "Evidence Plan",
  ]) {
    expect(design).toContain(`## ${heading}`);
  }
  expect(design).toMatch(/DFII[^\n]*\b(?:8|9|1[0-5])\b/u);
  expect(design).toContain("--color-");
  expect(design).toContain("--space-");
  expect(design).not.toMatch(/\bInter\b|\bRoboto\b|purple-on-white SaaS gradient/iu);
});

it("does not make excluded product claims", () => {
  for (const forbiddenClaim of [
    "automatically purchases cloud commitments",
    "executes live cloud purchases",
    "sends email and SMS directly",
    "Invoice Reconciliation is enabled",
    "queues optimizer actions offline",
    "reconciles customer invoices",
  ]) {
    expect(combined).not.toContain(forbiddenClaim);
  }
});

it("sets numeric quality thresholds for every required evidence lane", () => {
  for (const threshold of [
    /desktop viewport \| 1440px/iu,
    /tablet viewport \| 1024px/iu,
    /mobile viewport \| 390px/iu,
    /touch target minimum \| >= 44px/iu,
    /text resize \| 200%/iu,
    /narrow reflow \| 320 css px at 400% zoom/iu,
    /dashboard javascript \| < 180 kb gzip/iu,
    /dashboard lcp \| < 2\.5s/iu,
    /unredacted sensitive identifiers \| 0/iu,
    /console errors \| 0/iu,
    /failed same-origin requests \| 0/iu,
    /critical or serious accessibility violations \| 0/iu,
    /p0\/p1 frontend-polish findings \| 0/iu,
  ]) {
    expect(design).toMatch(threshold);
  }
});

it("keeps sensitive reports non-cacheable and separates text resize from WCAG reflow", () => {
  expect(product).toContain("Sensitive reports are not browser/CDN cached.");
  expect(combined).toContain("text resize to 200%");
  expect(combined).toContain("400% zoom / 320 CSS px reflow");
  expect(product).not.toContain("Sensitive reports are not browser/CDN cached by default");
});

it("keeps semantic status colors readable as body text on the raised dark surface", () => {
  const raisedSurface = readHexToken("--color-ink-900");
  for (const token of [
    "--color-cyan-400",
    "--color-amber-400",
    "--color-teal-500",
    "--color-red-500",
  ]) {
    expect(contrastRatio(readHexToken(token), raisedSurface), token).toBeGreaterThanOrEqual(4.5);
  }
});

it("labels the evidence plan as future validation rather than completed proof", () => {
  expect(design).toContain("Evidence status: planned — not yet produced");
  expect(design).toContain("MOBILE_VIEWPORT_PASS");
  expect(design).toContain("PRIVACY_MATRIX_PASS");
  expect(design).toContain("BUNDLE_DYNAMIC_IMPORT_AUDIT_PASS");
  expect(design).toContain("FRONTEND_IMPECCABLE_AUDIT_PASS");
  expect(design).toContain("FRONTEND_IMPECCABLE_POLISH_PASS");
  expect(design).not.toMatch(/Evidence status: (?:pass|passed|complete)/iu);
});
