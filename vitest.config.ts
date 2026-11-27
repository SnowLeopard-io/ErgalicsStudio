import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/studio/src', import.meta.url)),
      '@ergalics/plugin-sdk/types': fileURLToPath(new URL('./packages/plugin-sdk/src/types/index.ts', import.meta.url)),
      '@ergalics/plugin-sdk/tools': fileURLToPath(new URL('./packages/plugin-sdk/src/tools/index.ts', import.meta.url)),
      '@ergalics/plugin-sdk/plot': fileURLToPath(new URL('./packages/plugin-sdk/src/plot/index.ts', import.meta.url)),
      '@ergalics/plugin-sdk/bridges': fileURLToPath(new URL('./packages/plugin-sdk/src/bridges/index.ts', import.meta.url)),
      '@ergalics/plugin-sdk': fileURLToPath(new URL('./packages/plugin-sdk/src/index.ts', import.meta.url)),
      '@ergalics/plugin-signing/crypto': fileURLToPath(new URL('./packages/plugin-signing/src/crypto-primitives.ts', import.meta.url)),
      '@ergalics/plugin-signing': fileURLToPath(new URL('./packages/plugin-signing/src/index.ts', import.meta.url)),
      '@ergalics/plugins/builtin': fileURLToPath(new URL('./packages/plugins/src/builtin/index.ts', import.meta.url)),
      '@ergalics/plugins/categories': fileURLToPath(new URL('./packages/plugins/src/categories.ts', import.meta.url)),
      '@ergalics/plugins/marketplace': fileURLToPath(new URL('./packages/plugins/src/marketplace.ts', import.meta.url)),
      '@ergalics/plugins/demo-packages': fileURLToPath(new URL('./packages/plugins/src/marketplace-demo-packages.ts', import.meta.url)),
      '@ergalics/plugins': fileURLToPath(new URL('./packages/plugins/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    restoreMocks: true,
  },
});
