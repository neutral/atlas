#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assembleLibrary } from '../assemble-library.mjs';
import { archiveDirectory } from './archive.mjs';
import { collectInstalledInventory, inventoryMarkdown } from '../../tests/qualification/dependency-licenses/inventory.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const resources = path.dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(fs.readFileSync(path.join(resources, 'targets.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = value => value.split(path.sep).join('/');
const writeJSON = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
const internal = new Map([['atlas-reference-validator', 'library'], ['atlas-editor', 'apps/editor'], ['atlas-portal', 'apps/portal']]);

function resolveDependency(directory, name) {
  for (let current = directory; ; current = path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(current) === current) return null;
  }
}

/** Copy the locked production closure, retaining each resolved peer instance. */
export function copyRuntimeDependencies(app, repositoryRoot = root) {
  const packages = new Map();
  const optionalMissing = [];
  const visit = (source, preferredName) => {
    source = fs.realpathSync(source);
    if (packages.has(source)) return packages.get(source);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const own = internal.has(manifest.name);
    const short = `p${packages.size}`;
    const destination = own ? path.join(app, 'node_modules', manifest.name) : path.join(app, 'node_modules/.atlas', short, 'node_modules', manifest.name);
    const record = { source, destination, manifest, dependencies: {} };
    packages.set(source, record);
    if (manifest.name === 'atlas-reference-validator') assembleLibrary(destination, { repositoryRoot });
    else {
      fs.mkdirSync(destination, { recursive: true });
      const allowed = own ? new Set(['package.json', ...(manifest.files ?? [])]) : null;
      for (const name of fs.readdirSync(source).sort()) {
        if (name === 'node_modules' || name === '.git' || allowed && !allowed.has(name)) continue;
        fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, dereference: true });
      }
    }
    const dependencies = new Map();
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) dependencies.set(name, { range, optional: false });
    for (const [name, range] of Object.entries(manifest.optionalDependencies ?? {})) dependencies.set(name, { range, optional: true });
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) if (!dependencies.has(name)) dependencies.set(name, { range, optional: manifest.peerDependenciesMeta?.[name]?.optional === true });
    for (const [name, declaration] of [...dependencies].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      const resolved = internal.has(name) ? path.join(repositoryRoot, internal.get(name)) : resolveDependency(source, name);
      if (!resolved) {
        if (declaration.optional) { optionalMissing.push({ package: manifest.name, version: manifest.version, name }); continue; }
        throw new Error(`Missing locked dependency ${name} required by ${manifest.name}. Run the frozen workspace installation first.`);
      }
      const child = visit(resolved, name);
      record.dependencies[name] = child;
      const link = path.join(destination, 'node_modules', name);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(path.relative(path.dirname(link), child.destination), link);
    }
    return record;
  };
  for (const [name, relative] of internal) visit(path.join(repositoryRoot, relative), name);
  return { packages: [...packages.values()], optionalMissing };
}

function bundleInventory(app, records, destination) {
  const wrapper = path.join(app, 'node_modules/atlas-runtime');
  fs.mkdirSync(wrapper);
  writeJSON(path.join(wrapper, 'package.json'), { name: 'atlas-runtime', version: fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(), license: 'CC0-1.0 OR 0BSD', dependencies: Object.fromEntries([...internal.keys()].map(name => [name, records.find(item => item.manifest.name === name).manifest.version])) });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(wrapper, 'LICENSE'));
  const seen = new Set();
  function treeNode(record) {
    const node = { name: record.manifest.name, version: record.manifest.version, path: record.destination };
    if (!seen.has(record.destination)) {
      seen.add(record.destination);
      node.dependencies = Object.fromEntries(Object.entries(record.dependencies).map(([name, child]) => [name, treeNode(child)]));
    }
    return node;
  }
  const tree = [{ dependencies: { 'atlas-runtime': { name: 'atlas-runtime', version: records[0].manifest.version, path: wrapper, dependencies: Object.fromEntries([...internal.keys()].map(name => [name, treeNode(records.find(item => item.manifest.name === name))])) } } }];
  const report = collectInstalledInventory({ consumerRoot: app, packageName: 'atlas-runtime', tree, outputDirectory: destination });
  if (report.status === 'incomplete') throw new Error(`Bundle attribution inventory failed: ${JSON.stringify(report.issues)}`);
  // Keep the distributed inventory relocatable; original attribution bytes stay exact.
  const relativeReport = JSON.parse(JSON.stringify(report).replaceAll(app, '.'));
  writeJSON(path.join(destination, 'inventory.json'), relativeReport);
  fs.writeFileSync(path.join(destination, 'README.md'), inventoryMarkdown(relativeReport));
  return { packages: report.packageInstanceCount, attributions: report.attributionFileCount, metadataGaps: report.metadataGaps };
}

export async function assembleBundle({ output = path.join(root, 'distribution/artifacts'), target = `${process.platform}-${process.arch}` } = {}) {
  const runtime = targets.targets[target];
  if (!runtime) throw new Error(`Unknown target ${target}. Declared targets: ${Object.keys(targets.targets).join(', ')}.`);
  if (target !== `${process.platform}-${process.arch}`) throw new Error('Assembly runs on its target platform so native dependency selection is real. Use the declared CI matrix for another target.');
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  output = path.resolve(output);
  fs.mkdirSync(output, { recursive: true });
  const name = `atlas-${version}-${target}`;
  const directory = path.join(output, name);
  if (fs.existsSync(directory)) throw new Error(`Bundle output already exists: ${directory}. Select a new output directory.`);
  const download = path.join(output, runtime.archive);
  if (!fs.existsSync(download)) {
    const response = await fetch(`https://nodejs.org/dist/v${targets.nodeVersion}/${runtime.archive}`);
    if (!response.ok) throw new Error(`Node runtime download failed: HTTP ${response.status}`);
    fs.writeFileSync(download, Buffer.from(await response.arrayBuffer()));
  }
  if (hash(fs.readFileSync(download)) !== runtime.sha256) throw new Error(`Node runtime checksum mismatch: ${download}`);
  const extracted = fs.mkdtempSync(path.join(output, '.node-runtime-'));
  try {
    execFileSync('tar', ['-xzf', download, '-C', extracted]);
    const nodeRoot = path.join(extracted, runtime.archive.replace(/\.tar\.gz$/u, ''));
    fs.mkdirSync(path.join(directory, 'runtime/bin'), { recursive: true });
    fs.copyFileSync(path.join(nodeRoot, 'bin/node'), path.join(directory, 'runtime/bin/node'));
    fs.chmodSync(path.join(directory, 'runtime/bin/node'), 0o755);
    for (const file of ['LICENSE', 'README.md']) fs.copyFileSync(path.join(nodeRoot, file), path.join(directory, 'runtime', file));
  } finally { fs.rmSync(extracted, { recursive: true, force: true }); }
  const node = path.join(directory, 'runtime/bin/node');
  const actual = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
  if (actual !== `v${targets.nodeVersion}`) throw new Error(`Bundled runtime is ${actual}, expected ${targets.nodeVersion}.`);
  const app = path.join(directory, 'app');
  const graph = copyRuntimeDependencies(app);
  execFileSync(node, [path.join(app, 'node_modules/atlas-portal/src/prebuild/build.mjs')], {
    cwd: path.join(app, 'node_modules/atlas-portal'),
    env: { PATH: '/usr/bin:/bin', HOME: path.join(output, '.build-home'), NODE_OPTIONS: '', NODE_PATH: '', ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
  fs.rmSync(path.join(app, 'node_modules/atlas-portal/.astro'), { recursive: true, force: true });
  fs.rmSync(path.join(app, 'node_modules/atlas-portal/node_modules/.vite'), { recursive: true, force: true });
  const notices = bundleInventory(app, graph.packages, path.join(directory, 'notices'));
  fs.mkdirSync(path.join(directory, 'bin'));
  fs.copyFileSync(path.join(resources, 'launcher.sh'), path.join(directory, 'bin/atlas'));
  fs.chmodSync(path.join(directory, 'bin/atlas'), 0o755);
  fs.copyFileSync(path.join(resources, 'install.mjs'), path.join(directory, 'install.mjs'));
  for (const [file, flag] of [['install.sh', ''], ['uninstall.sh', '--remove ']]) {
    fs.writeFileSync(path.join(directory, file), `#!/bin/sh\nset -eu\natlas_script=$0\ncase "$atlas_script" in */*) ;; *) atlas_script=./$atlas_script ;; esac\natlas_directory=$(CDPATH= cd -P -- "\${atlas_script%/*}" && pwd)\nunset NODE_OPTIONS NODE_PATH\nexec "$atlas_directory/runtime/bin/node" "$atlas_directory/install.mjs" ${flag}"$@"\n`, { mode: 0o755 });
  }
  for (const file of ['LICENSE', 'LICENSE.CC0-1.0', 'LICENSE.0BSD']) fs.copyFileSync(path.join(root, file), path.join(directory, file));
  fs.copyFileSync(path.join(resources, 'USER-GUIDE.md'), path.join(directory, 'README.md'));
  fs.writeFileSync(path.join(directory, 'THIRD_PARTY.md'), '# Third-party material\n\nThe bundled Node runtime retains its original license and attribution in `runtime/LICENSE`. Resolved runtime packages retain their original files. `notices/README.md` and `notices/inventory.json` identify package instances, license metadata, original attributions, and metadata gaps. Atlas licenses do not relicense these materials. Registered or referenced project sources are outside the bundle and retain their own publication permissions.\n');
  const contents = [];
  function inspect(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const filename = path.join(current, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) inspect(filename, name);
      else if (entry.isSymbolicLink()) {
        const link = fs.readlinkSync(filename), resolved = fs.realpathSync(filename);
        if (path.isAbsolute(link) || !resolved.startsWith(`${directory}${path.sep}`)) throw new Error(`Bundle dependency escapes the artifact: ${name}`);
        contents.push({ path: name, link: portable(link) });
      } else contents.push({ path: name, sha256: hash(fs.readFileSync(filename)), mode: fs.statSync(filename).mode & 0o777 });
    }
  }
  inspect(directory);
  const applicationSHA256 = hash(JSON.stringify(contents.filter(entry => entry.path.startsWith('app/'))));
  const payloadName = `atlas-payload-${version}-${target}`;
  const payloadDirectory = path.join(output, payloadName);
  if (fs.existsSync(payloadDirectory)) throw new Error(`Payload output already exists: ${payloadDirectory}. Select a new output directory.`);
  fs.mkdirSync(payloadDirectory);
  const payloadContents = contents.filter(entry => !entry.path.startsWith('runtime/') && !['install.mjs', 'install.sh', 'uninstall.sh'].includes(entry.path)).map(entry => ({ ...entry }));
  for (const entry of payloadContents) {
    const destination = path.join(payloadDirectory, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (entry.link) fs.symlinkSync(entry.link, destination);
    else fs.copyFileSync(path.join(directory, entry.path), destination);
  }
  fs.writeFileSync(path.join(payloadDirectory, 'README.md'), '# Atlas application payload\n\nThis archive contains the same target-specific application, browser assets, dependencies, guides, and notices as the native Atlas bundle. It requires an explicitly supplied compatible Node runtime. Run `ATLAS_NODE=/absolute/path/to/node ./bin/atlas --help`. Supported shared runtimes are Node 22.23.2 or later on major 22, and Node 24. This payload has no native installer. Mount project content and durable drafts outside the payload; keep runtime and source grants explicit. `payload.json` records application identity and exact file contents.\n');
  const payloadReadme = payloadContents.find(entry => entry.path === 'README.md');
  payloadReadme.sha256 = hash(fs.readFileSync(path.join(payloadDirectory, 'README.md')));
  fs.writeFileSync(path.join(payloadDirectory, 'THIRD_PARTY.md'), '# Third-party material\n\nApplication dependencies retain their original manifests and license files. `notices/README.md` and `notices/inventory.json` identify exact package instances, original attributions, and metadata gaps. The host supplies and licenses the external Node runtime separately. Atlas licenses do not relicense those materials. Referenced project sources retain their own terms and publication permissions.\n');
  payloadContents.find(entry => entry.path === 'THIRD_PARTY.md').sha256 = hash(fs.readFileSync(path.join(payloadDirectory, 'THIRD_PARTY.md')));
  const payloadManifest = { contract: 'atlas.payload/1', version, target, applicationSHA256, node: { supportedMajors: [22, 24], minimum22: '22.23.2' }, contents: payloadContents };
  writeJSON(path.join(payloadDirectory, 'payload.json'), payloadManifest);
  const payloadArchive = path.join(output, `${payloadName}.tar.gz`);
  archiveDirectory(payloadDirectory, payloadArchive);
  const payloadIdentity = { version, target, archive: path.basename(payloadArchive), applicationSHA256, sha256: hash(fs.readFileSync(payloadArchive)), byteLength: fs.statSync(payloadArchive).size };
  writeJSON(path.join(output, `${payloadName}.json`), payloadIdentity);
  const manifest = { contract: 'atlas.bundle/1', version, target, applicationSHA256, payload: payloadIdentity, node: { version: targets.nodeVersion, archive: runtime.archive, sha256: runtime.sha256 }, dependencyLockSHA256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), notices, optionalDependenciesAbsent: graph.optionalMissing, contents };
  writeJSON(path.join(directory, 'bundle.json'), manifest);
  const archive = path.join(output, `${name}.tar.gz`);
  archiveDirectory(directory, archive);
  const identity = { version, target, archive: path.basename(archive), sha256: hash(fs.readFileSync(archive)), byteLength: fs.statSync(archive).size };
  writeJSON(path.join(output, `${name}.json`), identity);
  return { ...identity, directory, archive, payloadDirectory, payloadArchive, applicationSHA256, packageInstances: graph.packages.length, metadataGaps: notices.metadataGaps.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, argv = process.argv.slice(2);
  try {
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index];
      if (!['--output', '--target'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--') || Object.hasOwn(options, flag.slice(2))) throw new Error('Usage: node distribution/bundle/assemble.mjs [--output DIRECTORY] [--target darwin-arm64|linux-x64]');
      options[flag.slice(2)] = argv[index + 1];
    }
    console.log(JSON.stringify(await assembleBundle(options), null, 2));
  } catch (error) { console.error(error.stack); process.exitCode = 2; }
}
