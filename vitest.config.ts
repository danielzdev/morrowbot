import { defineConfig } from 'vitest/config';

const REAL_CHROME_TESTS = [
  'apps/browser-extension/src/e2e.test.ts',
  'apps/browser-extension/src/cdp/driver.test.ts',
  'apps/browser-extension/src/cdp/driver-secrets.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: ['**/node_modules/**', ...REAL_CHROME_TESTS],
          testTimeout: 20_000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'browser-chrome',
          include: REAL_CHROME_TESTS,
          testTimeout: 60_000,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
