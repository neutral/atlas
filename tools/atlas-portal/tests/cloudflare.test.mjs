import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/cloudflare/cli.mjs';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Cloudflare arguments preserve explicit publication inputs', () => {
  const parsed = parseArguments([
    'deploy',
    '--atlas', '/project/atlas',
    '--profile', 'internal-view',
    '--resource-root', '/project',
    '--resource-root', '/shared',
    '--config', '/project/wrangler.jsonc',
    '--out-dir', '/project/site',
    '--name', 'project-atlas',
    '--dry-run',
  ]);

  assert.equal(parsed.command, 'deploy');
  assert.deepEqual(parsed.options, {
    atlas: '/project/atlas',
    profile: 'internal-view',
    resourceRoots: ['/project', '/shared'],
    config: '/project/wrangler.jsonc',
    outDir: '/project/site',
    name: 'project-atlas',
    dryRun: true,
    help: false,
  });
});

test('default Wrangler configuration serves only generated static assets', () => {
  const configuration = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'wrangler.jsonc'), 'utf8'));
  assert.equal(configuration.compatibility_date, '2026-08-27');
  assert.deepEqual(configuration.assets, {
    directory: './dist',
    not_found_handling: '404-page',
    html_handling: 'auto-trailing-slash',
  });
  assert.equal(configuration.main, undefined);
});

test('Cloudflare headers harden responses and cache fingerprinted assets', () => {
  const headers = fs.readFileSync(path.join(applicationRoot, 'public/_headers'), 'utf8');
  for (const expected of [
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy:',
    '/_astro/*',
    'Cache-Control: public, max-age=31536000, immutable',
  ]) assert.match(headers, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('framework documentation contains no corpus-specific deployment notes', () => {
  const files = [
    path.join(applicationRoot, 'README.md'),
    ...fs.readdirSync(path.join(applicationRoot, 'docs')).map((name) => path.join(applicationRoot, 'docs', name)),
  ];
  for (const file of files) {
    assert.equal(/meta[- ]atlas/iu.test(fs.readFileSync(file, 'utf8')), false, path.relative(applicationRoot, file));
  }
});
