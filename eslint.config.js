import js from '@eslint/js';
import globals from 'globals';

export default [
  // -------------------------------------------------------------------------
  // Base: apply ESLint recommended rules to all JS files
  // -------------------------------------------------------------------------
  js.configs.recommended,

  // -------------------------------------------------------------------------
  // Extension source files: background, content scripts, popup, offscreen
  // These run in a browser/extension context and have access to:
  //   - Standard browser globals (window, document, Audio, etc.)
  //   - The chrome.* extension API namespace
  // -------------------------------------------------------------------------
  {
    files: [
      'background.js',
      'content-main.js',
      'content-isolated.js',
      'popup.js',
      'offscreen.js',
      'src/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Chrome Extension API — not in standard browser globals
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      // Warn on console.log but allow console.warn/error for intentional diagnostics
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always'],
    },
  },

  // -------------------------------------------------------------------------
  // Unit test files: run in Node.js via Vitest, no browser globals needed
  // -------------------------------------------------------------------------
  {
    files: ['tests/*.js', 'tests/*.test.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      // Allow console in tests for debugging
      'no-console': 'off',
    },
  },

  // -------------------------------------------------------------------------
  // Integration test files: run in Node.js via Playwright
  // Need Node globals (process, etc.) — NOT browser globals.
  // -------------------------------------------------------------------------
  {
    files: ['tests/integration/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
    },
  },

  // -------------------------------------------------------------------------
  // Config files (this file, vitest config if added later)
  // -------------------------------------------------------------------------
  {
    files: ['*.config.js', '.eslintrc.*'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // -------------------------------------------------------------------------
  // Ignore build artifacts and dependencies
  // -------------------------------------------------------------------------
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
];
