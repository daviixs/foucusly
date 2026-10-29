import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function normalizeBase(value: string | undefined): string {
  const base = (value ?? "").trim();
  if (!base || base === "/") return "/";
  return `/${base.replace(/^\/+|\/+$/g, "")}/`;
}

/** GitHub Pages SPA fallback: serve index.html for unknown routes via 404.html. */
function spaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "foucusly-spa-404-fallback",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    }
  };
}

export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE),
  plugins: [react(), tailwindcss(), spaFallback()],
  server: { proxy: { "/api": "http://localhost:3001" } }
});
