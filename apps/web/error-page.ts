export type ErrorPageKind = "not-found" | "internal-error";

export interface ErrorPageOptions {
  kind: ErrorPageKind;
  reference?: string;
}

const PRODUCT_NAME = "Cloud Commitment Portfolio Optimizer";
const STYLES = `
:root{color-scheme:dark;--ink:#f6f4ee;--muted:#aaa9a3;--line:#343631;--accent:#d6ff72;--panel:#171914}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0d0f0c;color:var(--ink);font:16px/1.6 system-ui,sans-serif}
body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 80% 10%,#28331c 0,transparent 36rem);pointer-events:none}
main{position:relative;display:grid;align-content:center;min-height:100vh;max-width:64rem;margin:auto;padding:clamp(2rem,8vw,7rem)}
.eyebrow{margin:0 0 1.25rem;color:var(--accent);font:700 .75rem/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}
h1{max-width:12ch;margin:0;font:600 clamp(3rem,9vw,7rem)/.94 Georgia,serif;letter-spacing:-.04em}
.message{max-width:38rem;margin:2rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.2rem)}
.reference{width:fit-content;margin:3rem 0 0;padding:.65rem .85rem;border:1px solid var(--line);background:var(--panel);font: .78rem/1.2 ui-monospace,monospace;color:var(--muted)}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

const copy: Record<
  ErrorPageKind,
  { title: string; heading: string; message: string; code: string }
> = {
  "not-found": {
    title: "Page not found",
    heading: "Page not found",
    message: "This address does not point to an available optimizer workspace.",
    code: "404 / ROUTE_NOT_FOUND",
  },
  "internal-error": {
    title: "Service error",
    heading: "Something went wrong",
    message: "The request could not be completed safely. Please retain the reference below.",
    code: "500 / REQUEST_FAILED",
  },
};

export function renderErrorPage(options: ErrorPageOptions): string {
  const content = copy[options.kind];
  const reference = options.reference
    ? `<p class="reference">Reference: ${escapeHtml(options.reference)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>${content.title} | ${PRODUCT_NAME}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<p class="eyebrow">${PRODUCT_NAME} · ${content.code}</p>
<h1>${content.heading}</h1>
<p class="message">${content.message}</p>
${reference}
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
