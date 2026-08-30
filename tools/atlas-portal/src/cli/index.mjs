#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compileAtlasPortal } from '../core/compile.mjs';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function usage() {
  return `Usage:
  atlas-portal dev --atlas <path> --profile <id> [--resource-root <path>] [--host <host>] [--port <port>]
  atlas-portal build --atlas <path> --profile <id> [--resource-root <path>] [--out-dir <path>]
  atlas-portal preview [--dir <generated-site>] [--host <host>] [--port <port>]`;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { resourceRoots: [], astroArguments: [] };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--') continue;
    const value = rest[index + 1];
    if (argument === '--atlas') options.atlas = value;
    else if (argument === '--profile') options.profile = value;
    else if (argument === '--resource-root') options.resourceRoots.push(value);
    else if (argument === '--out-dir' || argument === '--dir') options.outDir = value;
    else if (argument === '--host' || argument === '--port') options.astroArguments.push(argument, value);
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }

  return { command, options };
}

async function run() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!['dev', 'build', 'preview'].includes(command)) throw new Error(usage());
  if (command !== 'preview' && (!options.atlas || !options.profile)) throw new Error(usage());

  const environment = { ...process.env };
  if (options.outDir) environment.ATLAS_PORTAL_OUT_DIR = path.resolve(options.outDir);

  if (command !== 'preview') {
    const corpus = await compileAtlasPortal({
      atlasDirectory: path.resolve(options.atlas),
      profileId: options.profile,
      resourceRoots: options.resourceRoots.map((root) => path.resolve(root)),
    });
    const cacheDirectory = path.join(applicationRoot, '.cache');
    fs.mkdirSync(cacheDirectory, { recursive: true });
    const corpusPath = path.join(cacheDirectory, 'portal-corpus.json');
    fs.writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
    environment.ATLAS_PORTAL_CORPUS = corpusPath;
    console.log(`Atlas portal · ${corpus.atlas.title} · ${corpus.profile.id} · ${corpus.routes.length} routes`);
  }

  const child = spawn('pnpm', ['exec', 'astro', command, ...options.astroArguments], {
    cwd: applicationRoot,
    env: environment,
    stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Astro stopped with signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Astro exited with status ${code}`));
    });
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
