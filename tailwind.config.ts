import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./apps/web/**/*.{ts,html,hbs}",
    "./core/reports/templates/**/*.hbs",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#07111f",
          900: "#0b1627",
          800: "#12243a",
        },
        risk: {
          low: "#1f8f5f",
          medium: "#b7791f",
          high: "#c2410c",
          critical: "#991b1b",
        },
        trust: {
          blue: "#2563eb",
          slate: "#334155",
          paper: "#f8fafc",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Roboto Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
