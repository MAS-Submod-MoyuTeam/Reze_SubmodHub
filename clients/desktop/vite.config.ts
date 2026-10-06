import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@wails-bindings': path.resolve(__dirname, '../../cmd/client/SubmodHub/frontend/bindings/github.com/reze/submodhub/cmd/client'),
      },
    },
    server: {
      proxy: { '/api': { target: process.env.SUBMODHUB_API_TARGET || 'http://100.72.137.92:18082', changeOrigin: true } },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
