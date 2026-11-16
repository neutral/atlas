import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const sheet = await fs.readFile(new URL('../assets/sheet.css', import.meta.url), 'utf8');
const reader = await fs.readFile(new URL('../assets/reader.js', import.meta.url), 'utf8');

test('the sheet holds its inks and faces, loads nothing from elsewhere and moves nothing', () => {
  const tokens = Object.fromEntries([...sheet.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
  assert.deepEqual({ paper: tokens['--paper'], ink: tokens['--ink'], blue9: tokens['--blue-9'], blue7: tokens['--blue-7'], blue5: tokens['--blue-5'], blue3: tokens['--blue-3'], blue1: tokens['--blue-1'], blue0: tokens['--blue-0'], red: tokens['--red'] },
    { paper: '#ffffff', ink: '#15191e', blue9: '#1f3a5a', blue7: '#3d6288', blue5: '#5a7a9b', blue3: '#b9cadb', blue1: '#edf2f7', blue0: '#f6f8fb', red: '#b0412a' });
  assert.match(tokens['--sans'], /^-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', system-ui, sans-serif$/);
  assert.match(tokens['--mono'], /^ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace$/);
  for (const name of Object.keys(tokens)) assert.ok(sheet.includes(`var(${name}`), `${name} is used`);
  assert.match(sheet, /color-scheme: light;/);
  assert.doesNotMatch(sheet, /prefers-color-scheme|@import|@font-face|url\(/, 'one scheme, and no font, image or sheet from elsewhere');
  assert.doesNotMatch(sheet, /transition|animation|@keyframes|scroll-behavior/, 'nothing animates');
  assert.match(sheet, /:focus-visible \{ outline: 2px solid var\(--blue-7\); outline-offset: 2px; \}/);
  assert.doesNotMatch(sheet, /outline:\s*(?:none|0)\b/, 'the focus line is never removed');
  const sizes = [...sheet.matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]));
  assert.ok(sizes.length > 20 && Math.min(...sizes) >= 10, 'nothing is set below 10px');
  const colours = new Set(sheet.replace(/:root \{[^}]*\}/, '').match(/#[0-9a-f]{3,8}\b/gi) ?? []);
  assert.deepEqual([...colours], [], 'every colour is one of the inks');
});

test('the reader\'s script is small, is one module, and reaches nothing but its own Atlas', () => {
  const zipped = gzipSync(reader, { level: 9 }).length;
  assert.ok(zipped <= 6 * 1024, `reader.js is ${zipped} bytes gzipped; it stays within 6 KB`);
  assert.deepEqual(reader.match(/^import\b.*$/gm), null, 'it imports nothing when it starts');
  assert.deepEqual(reader.match(/\bimport\(([^)]*)\)/g), ["import('./search.js')"], 'the Library\'s search is loaded when the field is first used');
  assert.doesNotMatch(reader, /https?:\/\/|\beval\b|new Function|document\.write|localStorage|sessionStorage|document\.cookie|setAttribute\('style'|\.style\.cssText/, 'no address outside, nothing run from text, nothing kept');
  assert.equal((reader.match(/history\.(?:pushState|replaceState)/g) ?? []).join(), 'history.replaceState', 'opening and closing rewrite the address in place');
});
