// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openAtlas, localSourceTargets } from 'atlas-reference-validator';
import { compileAtlasPortal } from './core/compile.mjs';
import { readPortalConfig } from './core/config.mjs';

const applicationRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
function installationRoots() {
  const launcher = process.env.ATLAS_LAUNCHER;
  if (launcher === undefined) return [applicationRoot];
  if (!path.isAbsolute(launcher)) throw new Error('ATLAS_LAUNCHER must be an absolute installed launcher path.');
  return [applicationRoot, path.dirname(path.dirname(fs.realpathSync(launcher)))];
}

function optionsFromView(view) {
  if (!view.validation.valid || !view.validation.complete) throw new Error('Export requires a complete valid Atlas. Inspect diagnostics and repair the source first.');
  const model = view.validation.normalized;
  return { name: model.atlas.title, profiles: model.publicationProfiles.map(profile => ({ id: profile.id, title: profile.title, summary: profile.summary, selection: profile.selection })) };
}

export function publicationOptions({ repositoryRoot, atlasPath }) {
  return optionsFromView(openAtlas(path.resolve(repositoryRoot, atlasPath)));
}

function destinationCheck(destination, atlasRoot, targets = []) {
  if (!path.isAbsolute(destination)) throw new Error('Export destination must be absolute.');
  const output = path.resolve(destination);
  if ([atlasRoot, ...installationRoots(), ...targets].some(target => contains(target, output) || contains(output, target))) throw new Error('Export destination intersects Atlas content, a registered local source, or the installation. Choose a separate destination.');
  if (fs.lstatSync(output, { throwIfNoEntry: false })) throw new Error(`Export destination already exists: ${output}. Choose a new --out-dir (or atlas open --export-dir); existing files are never replaced.`);
  let ancestor = path.dirname(output);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!fs.statSync(ancestor).isDirectory()) throw new Error('Export destination parent must be a directory.');
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('Export destination ancestors must use canonical paths without symbolic links.');
  return output;
}

export async function prepareExport({ repositoryRoot, atlasPath, profileId, outputDirectory, name, portal, resourceRoots = [] }) {
  const atlasRoot = path.resolve(repositoryRoot, atlasPath);
  const view = openAtlas(atlasRoot);
  const options = optionsFromView(view);
  const profile = options.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error(profileId ? `Publication profile not found: ${profileId}` : 'Select a publication profile. Resource access does not grant permission to publish.');
  const targets = localSourceTargets(view);
  const output = destinationCheck(outputDirectory, atlasRoot, targets);
  const compileOptions = { atlasDirectory: atlasRoot, profileId, portal: portal ?? { name: name ?? options.name }, resourceRoots };
  const corpus = await compileAtlasPortal(compileOptions);
  if (view.freshness().status !== 'fresh') throw new Error('Atlas source changed during export preparation. Prepare and review the current selection again.');
  const summary = { exportId: randomUUID(), profile, outputDirectory: output, name: corpus.portal.name, counts: corpus.counts,
    routes: corpus.routes.map(route => route.path), resources: corpus.resources.map(resource => ({ id: resource.id, title: resource.title, uri: resource.uri, availability: resource.availability })),
    omittedChecks: profile.selection.checks, generation: corpus.generation,
    notice: 'Only this publication profile is selected. Resource access does not grant publication permission. Checks have no Portal routes. Apply creates a static site; it does not deploy it.' };
  return { summary, corpus, compileOptions, atlasRoot, targets, viewDigest: view.identity.digest };
}

export async function buildCorpus(corpus, outputDirectory) {
  const cache = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atlas-export-'));
  try {
    const prebuilt = path.join(applicationRoot, 'prebuilt', 'render.mjs');
    if (fs.existsSync(prebuilt)) {
      const { renderSite } = await import(pathToFileURL(prebuilt).href);
      await renderSite(corpus, outputDirectory);
      return;
    }
    // Source/developer packages compile in disposable storage. Installed bundles carry a prebuilt renderer.
    const staging = path.join(cache, 'app');
    fs.mkdirSync(staging);
    for (const name of ['src', 'public', 'astro.config.mjs', 'tsconfig.json', 'package.json']) fs.cpSync(path.join(applicationRoot, name), path.join(staging, name), { recursive: true });
    fs.symlinkSync(path.join(applicationRoot, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
    const corpusPath = path.join(cache, 'corpus.json');
    fs.writeFileSync(corpusPath, JSON.stringify(corpus));
    const manifestPath = fileURLToPath(import.meta.resolve('astro/package.json'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cli = path.resolve(path.dirname(manifestPath), manifest.bin.astro);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'build'], { cwd: staging, env: { ...process.env, ATLAS_PORTAL_CORPUS: corpusPath, ATLAS_PORTAL_OUT_DIR: outputDirectory }, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', chunk => { log += chunk; });
      child.stderr.on('data', chunk => { log += chunk; });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Site generation failed (${code}).\n${log}`)));
    });
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
}

export async function applyExport(prepared) {
  const { summary, corpus, compileOptions, atlasRoot, targets } = prepared;
  const currentView = openAtlas(atlasRoot);
  destinationCheck(summary.outputDirectory, atlasRoot, localSourceTargets(currentView));
  if (!currentView.validation.complete || !currentView.validation.valid || currentView.identity.digest !== prepared.viewDigest) throw new Error('Atlas source changed after preview. Prepare and review the current selection before exporting.');
  const current = await compileAtlasPortal(compileOptions);
  if (current.generation !== corpus.generation) throw new Error('Publication content changed after preview. Prepare and review the current selection before exporting.');
  // Reserve an absent destination exclusively. Failed output remains explicit and is never mistaken for a finished site.
  fs.mkdirSync(path.dirname(summary.outputDirectory), { recursive: true });
  fs.mkdirSync(summary.outputDirectory);
  const marker = path.join(summary.outputDirectory, '.atlas-export-pending');
  fs.writeFileSync(marker, JSON.stringify(summary));
  const staging = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atlas-export-output-'));
  try {
    await buildCorpus(corpus, staging);
    fs.cpSync(staging, summary.outputDirectory, { recursive: true });
    fs.rmSync(marker, { force: true });
    return { ...summary, status: 'exported' };
  } catch (error) { throw new Error(`${error.message}\nIncomplete output remains at ${summary.outputDirectory}. Inspect it and choose a new destination before retrying.`); }
  finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

export async function startPreview(directory, { port = 0, bindAddress = '127.0.0.1', publicOrigin } = {}) {
  if (isIP(bindAddress) !== 4) throw new Error('Preview bindAddress must be an explicit IPv4 address.');
  if (bindAddress !== '127.0.0.1' && !publicOrigin) throw new Error('Nonloopback preview requires an explicit publicOrigin.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Preview port must be between 0 and 65535.');
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== publicOrigin) throw new Error('Preview publicOrigin must be an exact HTTP or HTTPS origin without credentials, path, query, or fragment.');
  }
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, 'index.html')) || fs.existsSync(path.join(root, '.atlas-export-pending'))) throw new Error('Preview requires a completed static site with index.html.');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
  let origin;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(request.method) || !request.url.startsWith('/') || request.url.startsWith('//')) throw new Error();
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      if (pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error();
      let filename = path.resolve(root, `.${pathname}`);
      if (!contains(root, filename)) throw new Error();
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      if (fs.realpathSync(filename) !== filename || !fs.statSync(filename).isFile()) throw new Error();
      response.setHeader('Content-Type', types[path.extname(filename)] ?? 'application/octet-stream');
      response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(filename));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bindAddress, resolve); });
  origin = publicOrigin ?? `http://${bindAddress}:${server.address().port}`;
  return { origin, url: `${origin}/`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export function exportUsage() {
  return `Usage: atlas export [PROJECT] [--atlas <relative-path>] --profile <id> --out-dir <absolute-path> [--name <title> | --portal-config <path>] [--resource-root <path>] [--cache-directory <absolute-path>] [--apply] [--preview] [--port <port>] [--bind <IPv4-address> --origin <public-origin>]
Without --apply, print the complete publication selection and destination preview.
--apply explicitly creates the static site. --preview serves the completed output on loopback.
An existing output directory is refused. Resource grants never expand publication selection.`;
}
export async function runExport(argv, { repositoryRoot, atlasPath } = {}) {
  if (argv.some(value => ['--help', '-h'].includes(value))) { console.log(exportUsage()); return; }
  const options = { resourceRoots: [] }; const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--apply', '--preview'].includes(flag)) { if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`); seen.add(flag); options[flag.slice(2)] = true; continue; }
    if (!['--profile', '--out-dir', '--name', '--portal-config', '--resource-root', '--port', '--bind', '--origin'].includes(flag)) throw new Error(`Unknown export option: ${flag}\n${exportUsage()}`);
    if (seen.has(flag) && flag !== '--resource-root') throw new Error(`Repeated option: ${flag}`);
    seen.add(flag); const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--resource-root') options.resourceRoots.push(path.resolve(value)); else options[flag.slice(2)] = value;
  }
  if (!options.profile || !options['out-dir']) throw new Error(exportUsage());
  if (options.name && options['portal-config']) throw new Error('Supply --name or --portal-config, not both.');
  if (options.preview && !options.apply) throw new Error('--preview requires --apply. Inspect the selection first, then explicitly apply.');
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer between 0 and 65535.');
  const prepared = await prepareExport({ repositoryRoot, atlasPath, profileId: options.profile, outputDirectory: path.resolve(options['out-dir']), name: options.name,
    ...(options['portal-config'] ? { portal: readPortalConfig(path.resolve(options['portal-config'])) } : {}), resourceRoots: options.resourceRoots });
  console.log(JSON.stringify(prepared.summary, null, 2));
  if (!options.apply) return prepared.summary;
  const result = await applyExport(prepared); console.log(`Exported site: ${result.outputDirectory}`);
  if (options.preview) {
    const service = await startPreview(result.outputDirectory, { port, bindAddress: options.bind, publicOrigin: options.origin }); console.log(`Preview: ${service.url}\nPress Ctrl+C to stop.`);
    const stop = async () => { await service.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
  return result;
}
