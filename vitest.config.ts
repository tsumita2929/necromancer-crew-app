import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The page imports the dashboard's SDK, which the host provides at runtime. Tests
// swap in the doubles under test/stubs so the real page code runs unchanged.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // ui/ has its own react for the build; tests must use the one copy at the app root.
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@kirocrew/app-sdk/ui', replacement: path.resolve(import.meta.dirname, 'test/stubs/sdk-ui.tsx') },
      { find: '@kirocrew/app-sdk', replacement: path.resolve(import.meta.dirname, 'test/stubs/sdk.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
