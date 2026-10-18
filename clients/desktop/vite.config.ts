import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

const currentDir = import.meta.dirname ?? path.resolve('.');
const repoRoot = path.resolve(currentDir, '../..');

// The repository-root VERSION file is the single source of truth for the
// release version; it is compiled into the bundle so this standalone desktop
// entry does not depend on the Wails Vite config for `__APP_VERSION__`.
const versionFile = path.join(repoRoot, 'VERSION');
const appVersion = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : '0.0.0-dev';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      dedupe: ['@wailsio/runtime'],
      alias: {
        '@': path.resolve(currentDir, '.'),
        '@wails-bindings': path.resolve(currentDir, '../../cmd/client/SubmodHub/frontend/bindings/github.com/reze/submodhub/cmd/client'),
      },
    },
    server: {
      proxy: { '/api': { target: process.env.SUBMODHUB_API_TARGET || 'https://rezehub.0721play.icu', changeOrigin: true } },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
