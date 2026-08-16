import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import pkg from '../package.json';

// Standalone PWA viewer build (static site, deploy anywhere).
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../pwa-dist',
    emptyOutDir: true,
  },
});
