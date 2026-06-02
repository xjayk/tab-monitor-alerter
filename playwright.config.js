import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The extension root is this directory (manifest.json lives here).
export const extensionPath = path.resolve(__dirname);

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,

  // Extensions require a persistent context — configured per-test via
  // the shared fixture in tests/integration/fixtures.js.
  // Note: --headless=new is NOT used here. Extension support under
  // --headless=new is inconsistent on Linux CI runners. Instead, the CI
  // workflow runs tests via xvfb-run to provide a virtual display for
  // headed Chromium. See .github/workflows/test.yml.
  use: {},

  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
