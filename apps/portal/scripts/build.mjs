// Build the Portal into public/ (or the directory given): the browser bundle, the export's
// prerenderer, the license texts of the code they bundle, and an index.html whose first
// paint is the prerendered "opening" state.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { client, output, server } from '../vite.config.mjs';

const outDir = process.argv[2] ? path.resolve(process.argv[2]) : output;
const marker = '<!--app-->';
const packages = new Set();
await build(client(outDir, packages));
await build(server(outDir, packages));

const notices = [];
for (const directory of packages) {
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory)).filter(name => /^(?:licen[cs]e|notice|copying)/iu.test(name)).sort();
  const texts = await Promise.all(files.map(async name => (await readFile(path.join(directory, name), 'utf8')).trim()));
  notices.push({ name: metadata.name, text: `${metadata.name} ${metadata.version}\nLicense: ${metadata.license}\n\n${texts.join('\n\n') || `The package ships no license file; its package metadata declares ${metadata.license}.`}` });
}
notices.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
await writeFile(path.join(outDir, 'licenses.txt'), `Third-party code bundled into the Atlas Portal's app.js and prerender.mjs, with each package's license.\n\n${notices.map(item => item.text).join(`\n\n${'-'.repeat(72)}\n\n`)}\n`);

const page = path.join(outDir, 'index.html');
const html = await readFile(page, 'utf8');
if (html.split(marker).length !== 2) throw new Error(`index.html needs exactly one ${marker} marker`);
const { renderPortal } = await import(`${pathToFileURL(path.join(outDir, 'prerender.mjs')).href}?${Date.now()}`);
await writeFile(page, html.replace(marker, await renderPortal(null, false)));
console.log(`Built the Portal into ${path.relative(process.cwd(), outDir) || '.'}`);
