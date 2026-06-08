/** Vite build config — outputs React bundle to ../static so FastAPI can serve it unchanged. */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  // Base path must match where FastAPI mounts static files (/static/).
  // This ensures built asset URLs like /static/assets/index-abc.js resolve correctly.
  base: '/static/',
  build: {
    outDir: '../static',
    // Preserve manifest, icons, and sw.js — only overwrite send.html and assets/
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: './send.html',
    },
  },
  server: {
    port: 5173,
    // In dev mode, proxy all API calls to the Python backend so CORS is not an issue
    proxy: {
      '/messages': 'http://localhost:8000',
      '/send':       { target: 'http://localhost:8000', changeOrigin: true },
      '/send-image': 'http://localhost:8000',
      '/send-file':  'http://localhost:8000',
      '/snippets':   'http://localhost:8000',
      '/clipboard':  'http://localhost:8000',
      '/me':         'http://localhost:8000',
      '/events':     'http://localhost:8000',
      '/version':    'http://localhost:8000',
      '/login':      'http://localhost:8000',
      '/logout':     'http://localhost:8000',
      '/auth':       'http://localhost:8000',
      '/health':     'http://localhost:8000',
      '/webhook':    'http://localhost:8000',
    },
  },
});
