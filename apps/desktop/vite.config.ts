import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@angkorgit/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@angkorgit/design-system': path.resolve(__dirname, '../../packages/design-system/src/index.ts'),
    },
  },
  // Tauri expects a fixed port in dev
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
