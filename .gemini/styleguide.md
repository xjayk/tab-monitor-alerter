# Tab Monitor Alerter - Style Guide

## 1. Language & Architecture
* **Language**: JavaScript (ES6+). Use async/await, destructuring, and arrow functions.
* **Environment**: Chrome Extension Manifest V3. 
* **Separation of Concerns**: 
  * `background.js`: Service worker logic and event listeners.
  * `content-*.js`: DOM manipulation and page-level execution.
  * `popup.js` / `offscreen.js`: UI and offscreen document handling.
  * `src/utils.js`: Reusable helper functions.

## 2. Testing
* **Unit Tests**: Written with Vitest (`vitest.config.js`). Maintain coverage for pure functions and utilities.
* **Integration Tests**: Written with Playwright (`playwright.config.js`). All new extension workflows must include corresponding tests in `tests/integration/`.

## 3. Linting & Formatting
* Adhere strictly to the rules defined in `eslint.config.js`.
* Ensure all code passes lint checks prior to submitting a pull request.
