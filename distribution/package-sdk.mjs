#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { libraryFiles } from './assemble-library.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function sdkFiles({ browserDirectory } = {}) {
  const files = libraryFiles();
  const manifest = JSON.parse(files.get('package.json').contents);
  manifest.name = '@neutral/atlas'; delete manifest.private; manifest.publishConfig = { access: 'public' };
  manifest.description = 'Atlas local browser Editor, static site export, command line tools, and Library APIs';
  manifest.repository = { type: 'git', url: 'git+https://github.com/neutral/atlas.git' };
  manifest.homepage = 'https://github.com/neutral/atlas#readme';
  delete manifest.scripts;
  manifest.files.push('apps', 'notices');
  const add = (source, destination) => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`npm package input must not be a symbolic link: ${source}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) add(path.join(source, name), `${destination}/${name}`);
    } else if (stat.isFile()) files.set(destination, { contents: fs.readFileSync(source), mode: stat.mode & 0o777 });
  };
  for (const component of ['editor', 'portal']) {
    const directory = path.join(root, 'apps', component);
    const componentManifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const [name, version] of Object.entries(componentManifest.dependencies)) {
      if (version.startsWith('workspace:')) continue;
      if (manifest.dependencies[name] && manifest.dependencies[name] !== version) throw new Error(`npm dependency version conflict: ${name}`);
      manifest.dependencies[name] = version;
    }
    for (const name of componentManifest.files) {
      // The package's entry guide and canonical guides own its installed documentation.
      if (['bin', 'prebuilt', 'README.md', 'docs', 'LICENSE', 'LICENSE.CC0-1.0', 'LICENSE.0BSD'].includes(name)) continue;
      add(path.join(directory, name), `apps/${component}/${name}`);
    }
  }
  if (browserDirectory) {
    if (!fs.existsSync(path.join(browserDirectory, 'render.mjs'))) throw new Error('npm package requires the prebuilt Portal renderer.');
    add(browserDirectory, 'apps/portal/prebuilt');
    // These original licenses cover code and icons incorporated into the generated renderer.
    for (const name of ['astro', '@lucide/astro']) {
      const directory = path.join(root, 'apps/portal/node_modules', name);
      add(path.join(directory, 'LICENSE'), `notices/${name.replace('/', '-')}/LICENSE`);
      add(path.join(directory, 'package.json'), `notices/${name.replace('/', '-')}/package.json`);
    }
  }
  files.get('package.json').contents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const rename = new Map([['src/model.mjs', 1], ['src/atlas-cli.mjs', 1], ['src/authoring-cli.mjs', 1], ['src/cli.mjs', 2], ['src/inspect-cli.mjs', 1], ['src/project.mjs', 1], ['src/read-cli.mjs', 1], ['src/workspace-cli.mjs', 1], ['src/agent-tools.mjs', 1], ['src/agent-types.d.ts', 2]]);
  for (const [relative, count] of rename) {
    const entry = files.get(relative), source = entry.contents.toString();
    if (source.split('atlas-reference-validator').length - 1 !== count) throw new Error(`SDK package locator drift: ${relative}`);
    entry.contents = Buffer.from(source.split('atlas-reference-validator').join('@neutral/atlas'));
  }
  const locators = new Map([
    ['src/atlas-cli.mjs', [["import('atlas-editor')", "import('../apps/editor/src/server.mjs')", 1], ["import('atlas-portal/product')", "import('../apps/portal/src/product.mjs')", 1]]],
    ['apps/editor/src/worker.mjs', [["'atlas-reference-validator'", "'@neutral/atlas'", 1], ["import('atlas-portal/product')", "import('../../portal/src/product.mjs')", 1]]],
    ['apps/portal/src/product.mjs', [["'atlas-reference-validator'", "'@neutral/atlas'", 1]]],
    ['apps/portal/src/core/compile.mjs', [["'atlas-reference-validator'", "'@neutral/atlas'", 3]]],
  ]);
  for (const [relative, rewrites] of locators) {
    const entry = files.get(relative);
    for (const [from, to, count] of rewrites) {
      const source = entry.contents.toString();
      if (source.split(from).length - 1 !== count) throw new Error(`npm component locator drift: ${relative}: ${from}`);
      entry.contents = Buffer.from(source.split(from).join(to));
    }
  }
  const owners = JSON.parse(files.get('guides/source-owners.json').contents);
  for (const [guide, owner] of Object.entries(owners.owners)) {
    if (!['spec/'].some(prefix => owner.owner === `${prefix}${guide}`)) throw new Error(`Unexpected guide owner: ${guide}`);
    owner.owner = `spec/${guide}`;
    if (owner.sha256 !== hash(files.get(`guides/${guide}`).contents)) throw new Error(`Guide digest mismatch: ${guide}`);
  }
  files.get('guides/source-owners.json').contents = Buffer.from(`${JSON.stringify(owners, null, 2)}\n`);
  files.get('README.md').contents = Buffer.from(`# Atlas\n\nAtlas provides a local browser Editor, static site export, command line tools, MCP, captured reading, workspaces, prepared authoring, Check evaluation, and public types. The npm package includes the browser assets and uses an installed Node.js 22.23.2 or later.\n\n## Install and open\n\n\`\`\`sh\nnpm install --global @neutral/atlas\natlas open /absolute/project\n\`\`\`\n\nThe command opens the local Editor and stays running until Ctrl-C. Projects and durable drafts remain outside the installation. A project without an Atlas offers creation through preview and explicit apply.\n\nFor a local dependency, run \`npm install @neutral/atlas\` and \`npm exec -- atlas open /absolute/project\`. Import supported APIs from \`@neutral/atlas\`. Start with [Working with Atlas](guides/OPERATING.md) and the [API guide](https://github.com/neutral/atlas/blob/main/docs/sdk.md). Run \`atlas --help\` for commands.\n\n## Package contents\n\nThe package contains the Editor, prebuilt Portal renderer, schemas, specifications, agent guides, command adapters, and Library declarations. Installation runs no build scripts. Guide bodies retain their canonical specification bytes; ownership and digests appear in \`guides/source-owners.json\`. Some contracts name the source workspace component \`atlas-reference-validator\`; its supported interfaces are available as \`@neutral/atlas\`.\n\nOriginal material uses CC0 1.0 Universal or 0BSD. Dependencies retain their own terms. Original Astro and Lucide licenses for the generated renderer appear in \`notices/\`; installed dependencies retain their original notices.\n`);
  return { files, version: manifest.version };
}
export function packSDK(output) {
  output = path.resolve(output);
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const expected = path.join(output, `neutral-atlas-${version}.tgz`);
  if (fs.existsSync(expected)) throw new Error(`SDK archive exists: ${expected}`);
  execFileSync(process.execPath, [path.join(root, 'apps/portal/src/prebuild/build.mjs')], {
    cwd: path.join(root, 'apps/portal'), env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: 'inherit',
  });
  const { files, version: packageVersion } = sdkFiles({ browserDirectory: path.join(root, 'apps/portal/prebuilt') });
  if (packageVersion !== version) throw new Error(`npm package version ${packageVersion} differs from VERSION ${version}.`);
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sdk-'));
  try {
    for (const [relative, entry] of files) {
      const file = path.join(temporary, relative);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, entry.contents, { mode: entry.mode });
    }
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', output], { cwd: temporary, encoding: 'utf8' }));
    const archive = path.join(output, packed[0].filename);
    const record = { name: '@neutral/atlas', version, archive: path.basename(archive), sha256: hash(fs.readFileSync(archive)), files: [...files].map(([name, entry]) => ({ path: name, sha256: hash(entry.contents), mode: entry.mode })) };
    fs.writeFileSync(`${archive}.json`, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node distribution/package-sdk.mjs --output /absolute/new-artifacts');
  console.log(JSON.stringify(packSDK(args[1]), null, 2));
}
