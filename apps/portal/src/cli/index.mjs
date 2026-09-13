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
const astroManifestPath = fileURLToPath(import.meta.resolve('astro/package.json'));
const astroManifest = JSON.parse(fs.readFileSync(astroManifestPath, 'utf8'));
const astroCli = path.resolve(path.dirname(astroManifestPath), astroManifest.bin.astro);

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
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let refreshTimer;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let stopping = false;
  const stop = () => { stopping = true; child?.kill('SIGTERM'); };
  const cleanup = () => { clearInterval(refreshTimer); if (cacheDirectory) fs.rmSync(cacheDirectory, { recursive: true, force: true }); };
  process.once('exit', cleanup);
  try {
    if (command !== 'preview') {
      if (!options.atlas || !options.profile || !options.portalConfig) throw new Error(usage());
      const compile = () => compileAtlasPortal({
        atlasDirectory: path.resolve(/** @type {string} */ (options.atlas)),
        profileId: /** @type {string} */ (options.profile),
        portal: readPortalConfig(path.resolve(/** @type {string} */ (options.portalConfig))),
        resourceRoots: options.resourceRoots.map((root) => path.resolve(root)),
      });
      const corpus = await compile();
      cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-portal-'));
      const corpusPath = path.join(cacheDirectory, 'portal-corpus.json');
      fs.writeFileSync(corpusPath, `${JSON.stringify(corpus)}\n`);
      environment.ATLAS_PORTAL_CORPUS = corpusPath;
      if (command === 'dev') {
        let generation = corpus.generation, refreshing = false, previousError = '';
        refreshTimer = setInterval(async () => {
          if (refreshing) return;
          refreshing = true;
          try {
            const next = await compile();
            if (next.generation !== generation || previousError) {
              fs.writeFileSync(`${corpusPath}.next`, `${JSON.stringify(next)}\n`);
              fs.renameSync(`${corpusPath}.next`, corpusPath);
              generation = next.generation; previousError = '';
              child?.send({ type: 'atlas-corpus-changed' });
              console.log(`Atlas Portal refreshed · ${next.routes.length} routes`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== previousError) console.error(`Atlas Portal refresh failed: ${message}`);
            previousError = message;
            // Revoke the stale corpus. The browser receives an explicit build error until valid source returns.
            if (fs.existsSync(corpusPath)) { fs.rmSync(corpusPath, { force: true }); child?.send({ type: 'atlas-corpus-changed' }); }
          } finally { refreshing = false; }
        }, 750);
      }
      console.log(`Atlas Portal · ${corpus.portal.name} · ${corpus.profile.id} · ${corpus.routes.length} routes`);
    }
    child = spawn(process.execPath, command === 'dev' ? [fileURLToPath(new URL('./dev.mjs', import.meta.url)), ...options.astroArguments] : [astroCli, command, ...options.astroArguments], {
      cwd: applicationRoot, env: environment, stdio: command === 'dev' ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    /** @type {Promise<void>} */
    const completion = new Promise((resolve, reject) => {
      child?.on('error', reject);
      child?.on('exit', (code, signal) => {
        if (stopping) resolve();
        else if (signal) reject(new Error(`Astro stopped with signal ${signal}`));
        else if (code === 0) resolve();
        else reject(new Error(`Astro exited with status ${code}`));
      });
    });
    await completion;
  } finally {
    process.off('exit', cleanup);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    cleanup();
  }
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
