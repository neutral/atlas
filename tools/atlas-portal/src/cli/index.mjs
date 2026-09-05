#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compileAtlasPortal } from '../core/compile.mjs';
import { readPortalConfig } from '../core/config.mjs';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function usage() {
  return `Usage:
  atlas-portal dev --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--host <host>] [--port <port>]
  atlas-portal build --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--out-dir <path>]
  atlas-portal preview [--dir <generated-site>] [--host <host>] [--port <port>]`;
}

/** @param {string[]} argv */
export function parseArguments(argv) {
  const [command = '', ...rest] = argv;
  /** @type {{resourceRoots: string[], astroArguments: string[], help: boolean, atlas?: string, profile?: string, portalConfig?: string, outDir?: string}} */
  const options = { resourceRoots: [], astroArguments: [], help: false };
  const seen = new Set();
  /** @type {Record<string, string[]>} */
  const allowed = {
    dev: ['--atlas', '--profile', '--portal-config', '--resource-root', '--host', '--port'],
    build: ['--atlas', '--profile', '--portal-config', '--resource-root', '--out-dir'],
    preview: ['--dir', '--host', '--port'],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument) continue;
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (!allowed[command]?.includes(argument)) throw new Error(`Unknown argument for ${command}: ${argument}\n${usage()}`);
    if (seen.has(argument) && argument !== '--resource-root') throw new Error(`${argument} can be supplied only once.`);
    seen.add(argument);
    const value = rest[++index];
    if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.`);
    if (argument === '--atlas') options.atlas = value;
    else if (argument === '--profile') options.profile = value;
    else if (argument === '--portal-config') options.portalConfig = value;
    else if (argument === '--resource-root') options.resourceRoots.push(value);
    else if (argument === '--out-dir' || argument === '--dir') options.outDir = value;
    else options.astroArguments.push(argument, value);
  }
  if (command === '--help' || command === '-h') options.help = true;
  return { command, options };
}

export async function run(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (options.help) { console.log(usage()); return; }
  if (!['dev', 'build', 'preview'].includes(command)) throw new Error(usage());


  const environment = { ...process.env };
  if (options.outDir) environment.ATLAS_PORTAL_OUT_DIR = path.resolve(options.outDir);
  /** @type {string | undefined} */
  let cacheDirectory;
  const cleanup = () => { if (cacheDirectory) fs.rmSync(cacheDirectory, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    if (command !== 'preview') {
      if (!options.atlas || !options.profile || !options.portalConfig) throw new Error(usage());
      const corpus = await compileAtlasPortal({
        atlasDirectory: path.resolve(options.atlas),
        profileId: options.profile,
        portal: readPortalConfig(path.resolve(options.portalConfig)),
        resourceRoots: options.resourceRoots.map((root) => path.resolve(root)),
      });
      cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-'));
      const corpusPath = path.join(cacheDirectory, 'portal-corpus.json');
      fs.writeFileSync(corpusPath, `${JSON.stringify(corpus)}\n`);
      environment.ATLAS_PORTAL_CORPUS = corpusPath;
      console.log(`Atlas Portal · ${corpus.portal.name} · ${corpus.profile.id} · ${corpus.routes.length} routes`);
    }
    const child = spawn(pnpm, ['exec', 'astro', command, ...options.astroArguments], {
      cwd: applicationRoot, env: environment, stdio: 'inherit',
    });
    /** @type {Promise<void>} */
    const completion = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (signal) reject(new Error(`Astro stopped with signal ${signal}`));
        else if (code === 0) resolve();
        else reject(new Error(`Astro exited with status ${code}`));
      });
    });
    await completion;
  } finally {
    process.off('exit', cleanup);
    cleanup();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
