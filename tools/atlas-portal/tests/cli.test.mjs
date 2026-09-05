import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/cli/index.mjs';
import { readPortalConfig, validatePortalConfig } from '../src/core/config.mjs';

const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cli = path.join(applicationRoot, 'src/cli/index.mjs');
const fixture = path.join(repositoryRoot, 'spec/examples/valid/publication-profile');

test('Portal naming requires explicit validated configuration', (t) => {
  for (const value of [undefined, null, [], {}, { name: '' }, { name: '  ' }, { name: 1 }, { name: 'Atlas', unknown: true }]) {
    assert.throws(() => validatePortalConfig(value), /Invalid Portal configuration/u);
  }
  assert.deepEqual(validatePortalConfig({ name: ' Atlas ' }), { name: 'Atlas' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'portal.json');
  assert.throws(() => readPortalConfig(filename), /Cannot read Portal configuration/u);
  fs.writeFileSync(filename, '{');
  assert.throws(() => readPortalConfig(filename), /Cannot read Portal configuration/u);
  const result = spawnSync(process.execPath, [cli, 'build', '--atlas', fixture, '--profile', 'public'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--portal-config/u);
});

test('Portal notices are optional nonempty text without inferred defaults', () => {
  for (const field of ['copyright', 'license']) {
    for (const value of ['', '  ', null, 2026, {}, []]) {
      assert.throws(() => validatePortalConfig({ name: 'Atlas', [field]: value }), new RegExp(field, 'u'));
    }
    assert.deepEqual(validatePortalConfig({ name: 'Atlas', [field]: ' Custom <text> & terms ' }), {
      name: 'Atlas', [field]: 'Custom <text> & terms',
    });
  }
});

test('CLI rejects missing, repeated, and command-inappropriate options', () => {
  for (const args of [
    ['build', '--portal-config'], ['build', '--portal-config', '--atlas'],
    ['build', '--atlas', 'one', '--atlas', 'two'], ['build', '--dir', 'output'],
    ['preview', '--atlas', 'source'], ['build', '--unknown', 'value'],
  ]) assert.throws(() => parseArguments(args));
  const result = parseArguments(['build', '--portal-config', 'portal.json', '--resource-root', 'one', '--resource-root', 'two']);
  assert.equal(result.options.portalConfig, 'portal.json');
  assert.deepEqual(result.options.resourceRoots, ['one', 'two']);
  assert.equal(parseArguments(['--help']).options.help, true);
});

test('concurrent CLI invocations isolate their corpus and clean failed-build caches', { skip: process.platform === 'win32' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-invocations-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  // Substitute only the Astro process. Both CLI invocations validate and compile real Atlas input.
  fs.writeFileSync(path.join(bin, 'pnpm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.PORTAL_TEST_BARRIER;
const id = process.env.PORTAL_TEST_ID;
const input = process.env.ATLAS_PORTAL_CORPUS;
fs.writeFileSync(path.join(root, id + '.ready'), input);
const started = Date.now();
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(root, 'First.ready')) || !fs.existsSync(path.join(root, 'Second.ready'))) {
    if (Date.now() - started > 10000) process.exit(2);
    return;
  }
  clearInterval(timer);
  const corpus = JSON.parse(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(path.join(root, id + '.result'), JSON.stringify({ input, name: corpus.portal.name }));
  process.exit(id === 'Second' ? 9 : 0);
}, 10);
`, { mode: 0o755 });
  async function invoke(name) {
    const config = path.join(directory, `${name}.json`);
    fs.writeFileSync(config, JSON.stringify({ name }));
    const child = spawn(process.execPath, [cli, 'build', '--atlas', fixture, '--profile', 'public', '--portal-config', config], {
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORTAL_TEST_BARRIER: directory, PORTAL_TEST_ID: name },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    return { status, output };
  }
  const [firstRun, secondRun] = await Promise.all([invoke('First'), invoke('Second')]);
  assert.equal(firstRun.status, 0, firstRun.output);
  assert.equal(secondRun.status, 1, secondRun.output);
  assert.match(secondRun.output, /Astro exited with status 9/u);
  const first = JSON.parse(fs.readFileSync(path.join(directory, 'First.result'), 'utf8'));
  const second = JSON.parse(fs.readFileSync(path.join(directory, 'Second.result'), 'utf8'));
  assert.equal(first.name, 'First');
  assert.equal(second.name, 'Second');
  assert.notEqual(first.input, second.input);
  for (const result of [first, second]) assert.equal(fs.existsSync(path.dirname(result.input)), false);
});
