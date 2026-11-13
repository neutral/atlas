import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { openAtlas } from '../../../library/src/model.mjs';
import { presentAtlas } from '../src/markdown.mjs';
import { tempDirectory } from '../../../tests/support/temp.mjs';

// The built Portal in public/ is what the service serves, exports copy and the package ships.
const portal = fileURLToPath(new URL('../', import.meta.url));
const built = path.join(portal, 'public');
const shipped = ['app.js', 'index.html', 'licenses.txt', 'prerender.mjs', 'style.css'];
const html = await fs.readFile(path.join(built, 'index.html'), 'utf8');
const tags = (markup, name) => [...markup.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(([tag]) => new Map([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key, value])));

// The hydrating script's budget, gzipped: React, react-dom, the React Aria components the
// Portal uses with their localized strings, and the Portal itself (handbook/practices/interface.md).
const scriptBudget = 170 * 1024;

test('public/ holds exactly the built reader, and one module script loads it within its budget', async () => {
  assert.deepEqual((await fs.readdir(built)).sort(), shipped);
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /<meta name="color-scheme" content="light">/u);
  const scripts = tags(html, 'script');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].get('type'), 'module'); assert.equal(scripts[0].get('src'), './app.js');
  assert.deepEqual(tags(html, 'link').filter(tag => tag.get('rel') === 'stylesheet').map(tag => tag.get('href')), ['./style.css']);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/u, 'No inline script: the service and exports forbid them');
  assert.doesNotMatch(html, /\son\w+\s*=/iu, 'No inline event handlers');
  assert.match(html, /<div id="root"><header class="topbar">[\s\S]*Opening the Atlas…[\s\S]*<\/div><!--\/root-->/u, 'The first paint is the prerendered opening state');
  const script = await fs.readFile(path.join(built, 'app.js'), 'utf8');
  assert.match(script, /^\/\*! Atlas Portal\. Bundled third-party code and its license texts: licenses\.txt beside this file\. \*\/\nimport\{searchRecords as \w+\}from"\.\/search\.js";/u, 'Search is the Library module served beside the reader');
  const licenses = await fs.readFile(path.join(built, 'licenses.txt'), 'utf8');
  for (const name of ['react', 'react-dom', 'scheduler', 'react-aria-components', 'react-aria', 'react-stately']) assert.match(licenses, new RegExp(`^${name} \\d+\\.\\d+\\.\\d+\\nLicense: `, 'mu'), `${name} needs its license text`);
  assert.doesNotMatch(script, /from"(?!\.\/search\.js")[^"]+"/u, 'Everything else is bundled');
  const gzipped = gzipSync(script).length;
  assert.ok(gzipped <= scriptBudget, `app.js is ${gzipped} bytes gzipped, over its ${scriptBudget}-byte budget`);
  assert.doesNotMatch(await fs.readFile(path.join(built, 'prerender.mjs'), 'utf8'), /from\s*"(?!node:)[^"]+"/u, 'The prerenderer needs only Node');
});

test('the stylesheet draws one light sheet with the sheet’s tokens, shows focus and respects reduced motion', async () => {
  const css = await fs.readFile(path.join(built, 'style.css'), 'utf8');
  assert.match(css, /color-scheme:\s*light/u);
  assert.doesNotMatch(css, /prefers-color-scheme/u, 'The sheet is drawn on white only');
  assert.doesNotMatch(css, /@import|@font-face|url\(/u, 'The reader loads no font or image');
  for (const [token, value] of Object.entries({ paper: '#fff', ink: '#15191e', 'blue-9': '#1f3a5a', 'blue-7': '#3d6288', 'blue-5': '#5a7a9b', 'blue-3': '#b9cadb', 'blue-1': '#edf2f7', 'blue-0': '#f6f8fb', red: '#b0412a', 'red-1': '#f9ece8' })) {
    assert.match(css, new RegExp(`--${token}:${value}(?:fff)?[;}]`, 'u'), `--${token}`);
  }
  assert.match(css, /:focus-visible,\[data-focus-visible\]\{outline:2px solid var\(--blue-7\);outline-offset:2px\}/u);
  assert.match(css, /prefers-reduced-motion:reduce/u);
  assert.doesNotMatch(css, /\.(?:button|node|ref|choice-button|choice-option|tick|expand-trigger)[^{,]*:(?:hover|focus)\b(?!-)/u, 'React Aria components are styled by their state attributes');
  for (const size of css.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/gu)) assert.ok(Number(size[1]) >= 10, `No text below 10px: ${size[0]}`);
});

test('an export prerenders its first page from the selection, with nothing to run inline', async () => {
  const { renderPortal } = await import(pathToFileURL(path.join(built, 'prerender.mjs')).href);
  const data = presentAtlas(await openAtlas(fileURLToPath(new URL('../../../examples/offline-notes', import.meta.url))));
  const page = await renderPortal(data, true);
  assert.match(page, /<h1 id="tree-title">Product experience<\/h1>/u);
  assert.match(page, /<span class="tag">Publication<\/span>/u);
  assert.equal([...page.matchAll(/<button[^>]*class="node /gu)].length, 4);
  assert.doesNotMatch(page, /<script/u, 'Nothing runs inline: exports forbid inline scripts');
  assert.match(await renderPortal(null, false), /Opening the Atlas…/u);
});

test('the committed build is current: rebuilding ui/ reproduces public/ byte for byte', async t => {
  const output = await tempDirectory('atlas-portal-build-');
  t.after(() => fs.rm(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(portal, 'scripts/build.mjs'), output], { cwd: portal, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const file of shipped) assert.ok((await fs.readFile(path.join(output, file))).equals(await fs.readFile(path.join(built, file))), `public/${file} is stale; run pnpm --filter @atlas/portal build`);
});
