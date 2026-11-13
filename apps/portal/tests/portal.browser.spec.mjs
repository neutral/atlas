import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPortal } from '../src/server.mjs';
import { exportPortal } from '../src/export.mjs';
import { startEditor } from '../../editor/src/server.mjs';

// The Portal, Editor and an export, each loaded with the offline-notes example: the main
// keyboard paths, focus, dismissal, hydration and axe. Screenshots land beside the results.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const example = path.join(repo, 'examples/offline-notes');
const results = process.env.ATLAS_BROWSER_RESULTS ?? path.join(repo, 'tmp/portal-browser');
const shots = path.join(results, 'screenshots');
let scratch, reader, editor, empty, site, siteURL;
const problems = new WeakMap();

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
  scratch = await mkdtemp(path.join(results, 'run-'));
  process.env.ATLAS_STATE_HOME ??= path.join(scratch, 'state');
  const copy = path.join(scratch, 'atlas');
  await cp(example, copy, { recursive: true });
  reader = await startPortal(example);
  editor = await startEditor(copy, { exportDirectory: path.join(scratch, 'editor-export') });
  await mkdir(path.join(scratch, 'empty'));
  empty = await startEditor(path.join(scratch, 'empty'));
  const output = path.join(scratch, 'site');
  await exportPortal(example, output, { trees: ['product', 'architecture'], sources: ['sources/brief.md'] });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };
  site = http.createServer(async (request, response) => {
    const file = path.join(output, decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/$/, '/index.html'));
    try { const body = await readFile(file); response.writeHead(200, { 'Content-Type': `${types[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8` }); response.end(body); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  siteURL = `http://127.0.0.1:${site.address().port}/`;
});
test.afterAll(async () => {
  await reader?.close(); await editor?.close(); await empty?.close(); site?.close();
  await rm(scratch, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  problems.set(page, []);
  page.on('pageerror', error => problems.get(page).push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) problems.get(page).push(message.text()); });
});
test.afterEach(async ({ page }) => {
  expect(problems.get(page), 'no errors, warnings or hydration mismatches').toEqual([]);
});

const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
async function noViolations(page, include) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  expect(violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([]);
}
async function focusName(page) {
  return page.evaluate(() => { const node = document.activeElement; return node?.getAttribute('aria-label') ?? node?.textContent?.trim() ?? ''; });
}
async function focusShown(page) {
  const style = await page.evaluate(() => { const node = document.activeElement; const css = getComputedStyle(node); return `${css.outlineStyle} ${css.outlineWidth} ${css.outlineColor}`; });
  expect(style).toBe('solid 2px rgb(61, 98, 136)');
}

test('the reader opens, walks the Tree and the reading pane by keyboard, and shows focus', async ({ page }) => {
  await page.goto(reader.url);
  await expect(page.getByRole('heading', { level: 1, name: 'Product experience' })).toBeVisible();
  await expect(page.getByText('3 Points')).toBeVisible();
  await shot(page, 'reader-1440');
  await noViolations(page);
  const order = [];
  for (let step = 0; step < 9; step++) { await page.keyboard.press('Tab'); order.push(await focusName(page)); }
  expect(order.slice(0, 5)).toEqual(['Atlas home', 'Search Atlas', 'Review sources', 'Style', 'Refresh']);
  expect(order).toContain('Read overview');
  await page.getByRole('button', { name: /^Point\s*Offline work stays on the current device$/ }).focus();
  await focusShown(page);
  await page.keyboard.press('Enter');
  const pane = page.getByRole('complementary', { name: 'Reading pane' });
  await expect(pane.getByRole('heading', { level: 2, name: 'Offline work stays on the current device' })).toBeVisible();
  await expect(page).toHaveURL(/\?tree=product&point=offline-work$/);
  await expect(pane.getByText('Uncertainty', { exact: true })).toBeVisible();
  await shot(page, 'reader-point-1440');
  await noViolations(page);
  await pane.getByRole('button', { name: 'Focus reading' }).press('Enter');
  await expect(page.getByRole('region', { name: 'Tree navigator' })).toBeHidden();
  await shot(page, 'reader-focus-1440');
  await pane.getByRole('button', { name: 'Show Tree' }).press('Enter');
  await pane.getByRole('link', { name: /^Read Fictional product brief/ }).first().click();
  await expect(pane.getByRole('heading', { level: 2, name: 'Fictional product brief' })).toBeVisible();
  await expect(pane.getByText('Reading source…')).toBeHidden();
  await expect(pane.getByRole('button', { name: 'Exact source text' })).toBeVisible();
  await shot(page, 'reader-source-1440');
  await pane.getByRole('button', { name: 'Back' }).click();
  await expect(pane.getByRole('heading', { level: 2, name: 'Offline work stays on the current device' })).toBeVisible();
  await pane.getByRole('button', { name: 'Close reading pane' }).click();
  await expect(pane).toBeHidden();
  await page.getByRole('textbox', { name: 'Find in this Tree' }).fill('receipt');
  await expect(page.getByText(/^\d of 3 Points$/)).toBeVisible();
  await expect(page.locator('.node.context').first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('3 Points')).toBeVisible();
});

test('search opens as a dialog, moves by arrow keys in its lists, and closes with Escape', async ({ page }) => {
  await page.goto(reader.url);
  await page.getByRole('button', { name: 'Search Atlas' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search Atlas' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('searchbox', { name: 'Search Points and Facets' })).toBeFocused();
  await page.keyboard.type('receipt');
  await expect(dialog.getByText(/^Results 1–\d+\./)).toBeVisible();
  await shot(page, 'search-1440');
  await noViolations(page);
  await page.keyboard.press('Tab');
  await focusShown(page);
  await page.keyboard.press('ArrowDown');
  const options = page.getByRole('listbox');
  await expect(options).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Product experience' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Owning Tree/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search Atlas' })).toBeFocused();
  await page.getByRole('button', { name: 'Search Atlas' }).click();
  await page.getByRole('searchbox', { name: 'Search Points and Facets' }).fill('receipt');
  await page.getByRole('dialog').getByRole('link').first().click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Reading pane' })).toBeVisible();
});

test('the Editor keeps unfinished typing until discard is explicit, and reviews a draft', async ({ page }) => {
  await page.goto(editor.url);
  await expect(page.getByText('Editor', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Point\s*Offline work stays on the current device$/ }).click();
  await page.getByRole('button', { name: 'Edit Point' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Point' });
  await expect(dialog).toBeVisible();
  await noViolations(page);
  await shot(page, 'editor-form-1440');
  await dialog.getByRole('textbox', { name: 'Title' }).first().fill('Offline work stays on this device');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('alert')).toContainText('You have unsaved changes.');
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await shot(page, 'editor-unsaved-1440');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toBeHidden();
  await expect(dialog.getByRole('textbox', { name: 'Title' }).first()).toHaveValue('Offline work stays on this device');
  await dialog.getByRole('button', { name: 'Save and review' }).click();
  const review = page.getByRole('dialog', { name: 'Review draft' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'File changes' }).click();
  await expect(review.getByText('△ After')).toBeVisible();
  await noViolations(page);
  await shot(page, 'editor-review-1440');
  await review.getByRole('button', { name: 'Apply draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft applied.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Point\s*Offline work stays on this device$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Drafts' }).click();
  await expect(page.getByRole('dialog', { name: 'Drafts and recovery' })).toBeVisible();
  await noViolations(page);
  await shot(page, 'editor-drafts-1440');
  await page.keyboard.press('Escape');
});

test('at 375px the sheet keeps to the screen and the pane opens as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(reader.url);
  await expect(page.getByRole('heading', { level: 1, name: 'Product experience' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, 'reader-375');
  await page.getByRole('button', { name: /^Base Point\s*Keep writing when the connection drops$/ }).click();
  await expect(page.getByRole('complementary', { name: 'Reading pane' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, 'reader-point-375');
  await noViolations(page);
  await expect(page.getByRole('button', { name: 'Search Atlas' })).toBeVisible();
  await page.getByRole('button', { name: 'Search Atlas' }).click();
  await page.getByRole('searchbox', { name: 'Search Points and Facets' }).fill('offline');
  await shot(page, 'search-375');
  await noViolations(page);
});

test('an export reads before its script runs and hydrates without a mismatch', async ({ browser, page }) => {
  const still = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const plain = await still.newPage();
  await plain.goto(siteURL);
  await expect(plain.getByRole('heading', { level: 1, name: 'Product experience' })).toBeVisible();
  await expect(plain.getByRole('button', { name: /^Base Point\s*Keep writing when the connection drops$/ })).toBeVisible();
  await shot(plain, 'export-without-script-1440');
  await still.close();
  await page.goto(siteURL);
  await expect(page.getByText('Publication', { exact: true })).toBeVisible();
  await noViolations(page);
  await page.goto(`${siteURL}?tree=product&point=offline-work`);
  const pane = page.getByRole('complementary', { name: 'Reading pane' });
  await expect(pane.getByRole('heading', { level: 2, name: 'Offline work stays on the current device' })).toBeVisible();
  await expect(pane.getByRole('link', { name: 'Read Fictional product brief in a new tab' }).first()).toHaveAttribute('href', /^sources\/[a-f0-9]{64}\.html$/);
  await shot(page, 'export-point-1440');
});

test('every Editor dialog opens from the title strip, reads without violations and closes', async ({ page }) => {
  await page.goto(editor.url);
  await expect(page.getByText('Editor', { exact: true })).toBeVisible();
  const open = async (button, title, name, act) => {
    await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    if (act) await act(dialog);
    await noViolations(page);
    await shot(page, name);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialog).toBeHidden();
  };
  await open('Review sources', 'Review source changes', 'editor-review-sources-1440', async dialog => {
    await dialog.getByRole('button', { name: 'Select all' }).click();
    await dialog.getByRole('button', { name: 'Review selected sources' }).click();
    await expect(dialog.getByText(/does not establish that they are false/u)).toBeVisible();
  });
  await open('Style', 'Atlas style', 'editor-style-1440');
  await open('Checks', 'Checks', 'editor-checks-1440');
  await open('Connect an agent', 'Connect an agent', 'editor-connect-1440');
  await open('Export site', 'Export site', 'editor-export-1440');
  await open('Drafts', 'Drafts and recovery', 'editor-drafts-empty-1440');
  await page.getByRole('banner').getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('button', { name: 'New Point' }).click();
  const form = page.getByRole('dialog', { name: 'New Point' });
  await expect(form.getByRole('button', { name: /Owning Tree/ })).toBeVisible();
  await noViolations(page);
  await shot(page, 'editor-new-point-1440');
  await form.getByRole('button', { name: 'Close dialog' }).click();
  await expect(form).toBeHidden();
});

test('an empty folder offers to create an Atlas, and a missing token is said plainly', async ({ page }) => {
  await page.goto(empty.url);
  await expect(page.getByRole('heading', { level: 1, name: 'Create an Atlas here' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search Atlas' })).toBeDisabled();
  await noViolations(page);
  await shot(page, 'editor-create-1440');
  await page.getByRole('button', { name: 'Create Atlas' }).click();
  await expect(page.getByRole('dialog', { name: 'Create Atlas' })).toBeVisible();
  await noViolations(page);
  await shot(page, 'editor-create-form-1440');
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const stranger = await context.newPage();
  await stranger.goto(new URL('/', reader.url).href);
  await expect(stranger.getByRole('heading', { level: 1, name: 'The Atlas could not be opened' })).toBeVisible();
  await expect(stranger.getByRole('alert')).toContainText('Open the service URL supplied at launch.');
  await shot(stranger, 'reader-unauthorized-1440');
  await context.close();
});
