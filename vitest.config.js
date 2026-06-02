import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up unit tests in tests/ root — explicitly exclude the
    // integration subdirectory so Vitest never touches Playwright spec files.
    // Playwright has its own runner (playwright test) invoked separately.
    include: ['tests/*.test.js', 'tests/*.spec.js'],
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
