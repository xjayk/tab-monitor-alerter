import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The extension root is this directory (manifest.json lives here).
export const extensionPath = path.resolve(__dirname);

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,

  use: {
    // Extensions require a persistent context — configured per-test via
    // the shared fixture in tests/integration/fixtures.js.
    // On CI, inject --headless=new so Chromium runs without a display.
    launchOptions: {
      args: process.env.CI ? ['--headless=new'] : [],
    },
  },

  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
