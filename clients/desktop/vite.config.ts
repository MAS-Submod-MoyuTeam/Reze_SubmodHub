import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

const currentDir = import.meta.dirname ?? path.resolve('.');

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
