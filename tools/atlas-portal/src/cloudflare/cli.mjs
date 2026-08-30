#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const portalCli = path.join(applicationRoot, 'src/cli/index.mjs');
const defaultConfig = path.join(applicationRoot, 'wrangler.jsonc');
const defaultOutput = path.join(applicationRoot, 'dist');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function usage() {
  return `Usage:
  atlas-portal-cloudflare build --atlas <path> --profile <id> [--resource-root <path>] [--config <path>] [--out-dir <path>]
  atlas-portal-cloudflare dev --atlas <path> --profile <id> [--resource-root <path>] [--config <path>] [--out-dir <path>] [--host <host>] [--port <port>] [--name <name>]
  atlas-portal-cloudflare deploy --atlas <path> --profile <id> [--resource-root <path>] [--config <path>] [--out-dir <path>] [--name <name>] [--dry-run]`;
}

function optionValue(arguments_, index, argument) {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.\n${usage()}`);
  return value;
}

export function parseArguments(arguments_) {
  const [command, ...rest] = arguments_;
  const options = { resourceRoots: [], dryRun: false, help: false };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--') continue;
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    const value = optionValue(rest, index, argument);
    if (argument === '--atlas') options.atlas = value;
    else if (argument === '--profile') options.profile = value;
    else if (argument === '--resource-root') options.resourceRoots.push(value);
    else if (argument === '--config') options.config = value;
    else if (argument === '--out-dir') options.outDir = value;
    else if (argument === '--host') options.host = value;
    else if (argument === '--port') options.port = value;
    else if (argument === '--name') options.name = value;
    else throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    index += 1;
  }

  return { command, options };
}

function runProcess(command, arguments_, cwd, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, env: environment, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} stopped with signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

export async function run(arguments_) {
  const { command, options } = parseArguments(arguments_);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!['build', 'dev', 'deploy'].includes(command) || !options.atlas || !options.profile) throw new Error(usage());
  if (command !== 'deploy' && options.dryRun) throw new Error('--dry-run is available only for cloudflare:deploy.');

  const config = path.resolve(options.config ?? defaultConfig);
  const output = path.resolve(options.outDir ?? defaultOutput);
  if (!fs.existsSync(config) || !fs.statSync(config).isFile()) throw new Error(`Wrangler configuration not found: ${config}`);

  const buildArguments = [
    portalCli,
    'build',
    '--atlas', path.resolve(options.atlas),
    '--profile', options.profile,
    '--out-dir', output,
  ];
  for (const root of options.resourceRoots) buildArguments.push('--resource-root', path.resolve(root));

  console.log(`Building Atlas Portal assets for Cloudflare: ${output}`);
  await runProcess(process.execPath, buildArguments, applicationRoot);
  if (command === 'build') return;

  const configDirectory = path.dirname(config);
  const wranglerLogDirectory = path.join(configDirectory, '.wrangler/logs');
  fs.mkdirSync(wranglerLogDirectory, { recursive: true });
  const wranglerEnvironment = {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? wranglerLogDirectory,
    WRANGLER_LOG_SANITIZE: process.env.WRANGLER_LOG_SANITIZE ?? 'true',
    WRANGLER_SEND_ERROR_REPORTS: process.env.WRANGLER_SEND_ERROR_REPORTS ?? 'false',
    WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS ?? 'false',
  };
  if (command === 'dev') {
    wranglerEnvironment.CLOUDFLARE_CF_FETCH_ENABLED = process.env.CLOUDFLARE_CF_FETCH_ENABLED ?? 'false';
    wranglerEnvironment.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME ?? path.join(configDirectory, '.wrangler/config');
    wranglerEnvironment.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME ?? path.join(configDirectory, '.wrangler/cache');
  }
  const wranglerArguments = ['exec', 'wrangler', command, '--cwd', configDirectory, '--config', config];
  if (command === 'dev') wranglerArguments.push('--local');
  if (options.host) wranglerArguments.push('--ip', options.host);
  if (options.port) wranglerArguments.push('--port', options.port);
  if (options.name) wranglerArguments.push('--name', options.name);
  if (options.dryRun) wranglerArguments.push('--dry-run');
  else if (command === 'deploy') wranglerArguments.push('--strict');

  await runProcess(pnpm, wranglerArguments, applicationRoot, wranglerEnvironment);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
