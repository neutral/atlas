import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const names = ['OPERATING.md', 'SPEC.md', 'GLOSSARY.md', 'schemas/README.md', ...fs.readdirSync(path.join(root, 'spec/spec')).filter((name) => name.endsWith('.md')).sort().map((name) => `spec/${name}`)];
const destination = path.join(root, 'apps/agent/guides');
fs.mkdirSync(destination, { recursive: true });
const owners = {};
for (const name of names) {
  const owner = `spec/${name}`, bytes = fs.readFileSync(path.join(root, owner));
  fs.mkdirSync(path.dirname(path.join(destination, name)), { recursive: true });
  fs.writeFileSync(path.join(destination, name), bytes);
  owners[name] = { owner, sha256: createHash('sha256').update(bytes).digest('hex') };
}
fs.writeFileSync(path.join(destination, 'source-owners.json'), `${JSON.stringify({ contract: 'atlas.guide-owners/1', owners }, null, 2)}\n`);
