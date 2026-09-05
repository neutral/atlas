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
  atlas-portal-cloudflare build --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--config <path>] [--out-dir <path>]
  atlas-portal-cloudflare dev --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--config <path>] [--out-dir <path>] [--host <host>] [--port <port>] [--name <name>]
  atlas-portal-cloudflare deploy --atlas <path> --profile <id> --portal-config <path> [--resource-root <path>] [--config <path>] [--out-dir <path>] [--name <name>] [--dry-run]`;
}

/** @param {string[]} arguments_ @param {number} index @param {string} argument */
function optionValue(arguments_, index, argument) {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value.\n${usage()}`);
  return value;
}

/** @param {string[]} arguments_ */
export function parseArguments(arguments_) {
  const [command = '', ...rest] = arguments_;
  /** @type {{resourceRoots: string[], dryRun: boolean, help: boolean, atlas?: string, profile?: string, portalConfig?: string, config?: string, outDir?: string, host?: string, port?: string, name?: string}} */
  const options = { resourceRoots: [], dryRun: false, help: false };
  const seen = new Set();

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument) continue;
    if (argument === '--') continue;
    if (seen.has(argument) && argument !== '--resource-root') throw new Error(`${argument} can be supplied only once.`);
    seen.add(argument);
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
    else if (argument === '--portal-config') options.portalConfig = value;
    else if (argument === '--resource-root') options.resourceRoots.push(value);
    else if (argument === '--config') options.config = value;
    else if (argument === '--out-dir') options.outDir = value;
    else if (argument === '--host') options.host = value;
    else if (argument === '--port') options.port = value;
    else if (argument === '--name') options.name = value;
    else throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    index += 1;
  }

  if (command === '--help' || command === '-h') options.help = true;
  return { command, options };
}

/** @param {string} command @param {string[]} arguments_ @param {string} cwd @param {NodeJS.ProcessEnv} [environment] @returns {Promise<void>} */
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

/** @param {string[]} arguments_ */
export async function run(arguments_) {
  const { command, options } = parseArguments(arguments_);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!['build', 'dev', 'deploy'].includes(command) || !options.atlas || !options.profile || !options.portalConfig) throw new Error(usage());
  if (command !== 'deploy' && options.dryRun) throw new Error('--dry-run is available only for cloudflare:deploy.');
  if (command !== 'dev' && (options.host || options.port)) throw new Error('--host and --port are available only for cloudflare:dev.');
  if (command === 'build' && options.name) throw new Error('--name sets the Worker name for cloudflare:dev or cloudflare:deploy.');

  const config = path.resolve(options.config ?? defaultConfig);
  const output = path.resolve(options.outDir ?? defaultOutput);
  if (!fs.existsSync(config) || !fs.statSync(config).isFile()) throw new Error(`Wrangler configuration not found: ${config}`);

  const buildArguments = [
    portalCli,
    'build',
    '--atlas', path.resolve(options.atlas),
    '--profile', options.profile,
    '--portal-config', path.resolve(options.portalConfig),
    '--out-dir', output,
  ];
  for (const root of options.resourceRoots) buildArguments.push('--resource-root', path.resolve(root));

  console.log(`Building Atlas Portal assets for Cloudflare: ${output}`);
  await runProcess(process.execPath, buildArguments, applicationRoot);
  if (command === 'build') return;

  const configDirectory = path.dirname(config);
  const wranglerLogDirectory = path.join(configDirectory, '.wrangler/logs');
  fs.mkdirSync(wranglerLogDirectory, { recursive: true });
  /** @type {NodeJS.ProcessEnv} */
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
