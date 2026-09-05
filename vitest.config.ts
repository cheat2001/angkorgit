import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@angkorgit/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@/shared/highlight': path.resolve(__dirname, 'apps/desktop/src/shared/highlight.ts'),
      'highlight.js': path.resolve(__dirname, 'apps/desktop/node_modules/highlight.js'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
