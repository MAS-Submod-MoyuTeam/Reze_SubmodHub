import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wails from "@wailsio/runtime/plugins/vite";
import fs from "node:fs";
import path from "node:path";

const currentDir = import.meta.dirname ?? path.resolve(".");
const repoRoot = path.resolve(currentDir, "../../../../");
const desktopRoot = path.join(repoRoot, "clients/desktop");
const browserMode = process.env.VITE_BROWSER_MODE === "1";

// The repository-root VERSION file is the single source of truth for the
// release version; it is compiled into the bundle so the client can display it
// without calling native code.
const versionFile = path.join(repoRoot, "VERSION");
const appVersion = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, "utf8").trim()
  : "0.0.0-dev";

export default defineConfig({
  root: desktopRoot,
  plugins: [react(), tailwindcss(), ...(browserMode ? [] : [wails(path.resolve(currentDir, "bindings"))])],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    dedupe: ['@wailsio/runtime'],
    alias: {
      "@": desktopRoot,
      "@wails-bindings": path.resolve(currentDir, "bindings/github.com/reze/submodhub/cmd/client"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
    proxy: browserMode
      ? {
          "/local": "http://127.0.0.1:18083",
          "/api": "https://rezehub.0721play.icu",
        }
      : undefined,
  },
  build: {
    outDir: path.join(currentDir, "dist"),
    emptyOutDir: true,
  },
});
