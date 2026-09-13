import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function packageDocumentation(bytes, manifest) {
  const source = bytes.toString('utf8');
  const start = source.indexOf('This package is the reference implementation');
  const install = source.indexOf('\n## Install\n', start);
  const reference = source.indexOf('\n## Validate an Atlas\n', install);
  const end = source.indexOf('\n## Source organization\n');
  if (start < 0 || install <= start || reference <= install || end <= reference) throw new Error('Library README is missing its consumer documentation boundaries.');
  const archive = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
  const installation = `\n## Install the component archive\n\nUse Node.js ${manifest.engines.node.slice(2)} or a later compatible release. Place\n\`${archive}\` in an existing Node project, or create an empty ESM\nproject first:\n\n\`\`\`sh\nnpm init --yes\nnpm pkg set private=true --json\nnpm pkg set type=module\nnpm install --save-exact ./${archive}\nnpm exec -- atlas-validate /absolute/path/to/project/atlas --json\n\`\`\`\n\nImport this component's supported APIs from \`${manifest.name}\`. Run local\ncommand bins through \`npm exec --\`. The component contains command adapters,\nTypeScript declarations in \`src/index.d.ts\`, schemas in \`schemas/\`, and\noperating contracts in \`guides/\`. Start with [Working with Atlas](guides/OPERATING.md).\nPrivate source modules are not supported imports. Preserve an existing host\ndependency trust and build policy.\n\nThe component archive does not include the Editor or Portal browser assets.\nThe full \`@neutral/atlas\` npm application supplies those application surfaces.\n`;
  const consumer = `${source.slice(start, install)}${installation}${source.slice(reference, end)}`
    .replaceAll('../apps/agent/guides/', 'guides/')
    .replaceAll("from '@neutral/atlas';", `from '${manifest.name}';`)
    .replace('In the\ndevelopment workspace, prefix the command with\n`corepack pnpm@11.22.0 exec`.', 'Run the locally installed command through `npm exec --`.');
  return Buffer.from(`# Atlas Library\n\nAtlas Library provides captured reading views, local workspaces, prepared authoring, Check evaluation, retained reports, CLI commands, an agent adapter, and TypeScript declarations.\n\n${consumer.trim()}\n\nInstalled guide ownership is recorded in \`guides/source-owners.json\`.\n`);
}

/** Assemble the existing Library distribution from its development components. */
export function libraryFiles(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const files = new Map();
  const add = (source, destination, transform = (bytes) => bytes) => {
    const target = path.join(root, source);
    files.set(destination, { contents: transform(fs.readFileSync(target)), mode: fs.statSync(target).mode & 0o777 });
  };
  const tree = (source, destination) => {
    for (const entry of fs.readdirSync(path.join(root, source), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Distribution input must not be a symbolic link: ${source}/${entry.name}`);
      if (entry.isDirectory()) tree(`${source}/${entry.name}`, `${destination}/${entry.name}`);
      else if (entry.isFile()) add(`${source}/${entry.name}`, `${destination}/${entry.name}`);
    }
  };
  for (const name of ['LICENSE', 'LICENSE.CC0-1.0', 'LICENSE.0BSD']) add(name, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'library/package.json'), 'utf8'));
  const commands = ['cli', 'agent'].flatMap((component) => Object.keys(JSON.parse(fs.readFileSync(path.join(root, `apps/${component}/package.json`), 'utf8')).bin));
  manifest.bin = Object.fromEntries(commands.map((name) => [name, `bin/${name}.mjs`]));
  files.set('package.json', { contents: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mode: 0o644 });
  add('library/README.md', 'README.md', bytes => packageDocumentation(bytes, manifest));
  tree('library/src', 'src');
  tree('library/schemas', 'schemas');
  for (const component of ['cli', 'agent']) {
    tree(`apps/${component}/src`, 'src');
    tree(`apps/${component}/bin`, 'bin');
  }
  tree('apps/agent/guides', 'guides');
  for (const name of ['src/index.mjs', 'src/index.d.ts']) {
    const entry = files.get(name);
    entry.contents = Buffer.from(entry.contents.toString('utf8').replaceAll('../../apps/agent/src/', './'));
  }
  if (files.has('src/atlas-cli.mjs')) {
    const entry = files.get('src/atlas-cli.mjs');
    entry.contents = Buffer.from(entry.contents.toString('utf8').replaceAll('../../agent/src/agent-stdio.mjs', './agent-stdio.mjs'));
  }
  return files;
}

export function assembleLibrary(target, options = {}) {
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) throw new Error(`Library assembly target must be empty: ${target}`);
  fs.mkdirSync(target, { recursive: true });
  const files = libraryFiles(options);
  for (const [relative, entry] of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.contents, { mode: entry.mode });
  }
  return { directory: target, files: [...files.keys()] };
}
