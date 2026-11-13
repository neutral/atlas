import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Results and screenshots go to the repository's ignored tmp/ unless ATLAS_BROWSER_RESULTS names a folder.
const results = process.env.ATLAS_BROWSER_RESULTS ?? fileURLToPath(new URL('../../tmp/portal-browser/', import.meta.url));

/** Playwright's own Chromium when it is installed; otherwise the newest headless shell in its cache. */
function chromium() {
  if (process.env.ATLAS_CHROMIUM) return process.env.ATLAS_CHROMIUM;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const shells = readdirSync(cache).filter(name => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const shell of shells) {
    const folder = path.join(cache, shell);
    const platform = readdirSync(folder).find(name => name.startsWith('chrome-headless-shell'));
    const binary = platform && path.join(folder, platform, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
    if (binary && existsSync(binary)) return binary;
  }
  return undefined;
}

export default defineConfig({
  testDir: fileURLToPath(new URL('./tests/', import.meta.url)),
  testMatch: '*.browser.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: path.join(results, 'results'),
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath: chromium() },
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
  },
});
