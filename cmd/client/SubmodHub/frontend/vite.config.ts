import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wails from "@wailsio/runtime/plugins/vite";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../../");
const desktopRoot = path.join(repoRoot, "clients/desktop");
const browserMode = process.env.VITE_BROWSER_MODE === "1";

export default defineConfig({
  root: desktopRoot,
  plugins: [react(), tailwindcss(), ...(browserMode ? [] : [wails(path.resolve(__dirname, "bindings"))])],
  resolve: { alias: { "@": desktopRoot, "@wails-bindings": path.resolve(__dirname, "bindings/github.com/reze/submodhub/cmd/client") } },
  server: {
    host: "127.0.0.1", port: Number(process.env.WAILS_VITE_PORT) || 9245, strictPort: true,
    proxy: browserMode ? {
      "/local": "http://127.0.0.1:18083",
      "/api": "http://100.72.137.92:18082",
    } : undefined,
  },
  build: { outDir: path.join(__dirname, "dist"), emptyOutDir: true },
});
