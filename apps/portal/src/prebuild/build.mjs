// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'prebuilt');
export async function buildBrowserAssets() {
  await new Promise((resolve, reject) => {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--assemble'], { env: { ...env, ASTRO_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' }, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser asset assembly failed (${code}).`)));
  });
  return output;
}
async function assemble() {
  fs.rmSync(output, { recursive: true, force: true });
  await build({ root, configFile: false, output: 'server', outDir: output, image: { service: { entrypoint: 'astro/assets/services/noop' } }, build: { format: 'directory' },
    adapter: { name: 'atlas-static-export', hooks: { 'astro:config:done': ({ setAdapter }) => setAdapter({ name: 'atlas-static-export', entrypointResolution: 'auto', serverEntrypoint: new URL('./entry.mjs', import.meta.url), supportedAstroFeatures: { serverOutput: 'stable', sharpImageService: 'unsupported' } }) } } });
  for (const name of fs.readdirSync(path.join(output, 'server'))) {
    if (!name.endsWith('.mjs')) continue;
    const filename = path.join(output, 'server', name);
    const source = fs.readFileSync(filename, 'utf8').replaceAll(root.replace(/\/$/u, ''), '/atlas-portal')
      .replace(/"[^"\n]*\/node_modules\/(?:\.pnpm\/[^"\n]+\/node_modules\/)?(@lucide\/astro\/[^"\n]+\.astro)"/gu, '"package:$1"');
    fs.writeFileSync(filename, source);
  }
  const scriptFiles = fs.readdirSync(path.join(output, 'client', '_astro')).filter(name => name.endsWith('.js'));
  if (scriptFiles.length !== 1) throw new Error('Expected one compiled Portal browser entrypoint.');
  fs.copyFileSync(path.join(root, 'src/styles/global.css'), path.join(output, 'client', '_astro', 'portal.css'));
  const assets = { script: `/_astro/${scriptFiles[0]}`, stylesheet: '/_astro/portal.css' };
  fs.writeFileSync(path.join(output, 'render.mjs'), `import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport render from './server/entry.mjs';\nexport async function renderSite(corpus, outputDirectory) {\n  fs.cpSync(fileURLToPath(new URL('./client/', import.meta.url)), outputDirectory, { recursive: true });\n  await render(corpus, outputDirectory, ${JSON.stringify(assets)});\n}\n`);
  return output;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await (process.argv.includes('--assemble') ? assemble() : buildBrowserAssets());
