// The Portal's two builds from ui/: the browser bundle the service and exports load, and the
// prerenderer an export runs to write its first page. Both land in public/, which ships as is.
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('./ui/', import.meta.url));
const search = fileURLToPath(new URL('../../library/src/search.mjs', import.meta.url));
export const output = fileURLToPath(new URL('./public/', import.meta.url));
const banner = '/*! Atlas Portal. Bundled third-party code and its license texts: licenses.txt beside this file. */';

/** Record the directory of every installed package a build bundles, for its license notice. */
export function bundled(packages) {
  return {
    name: 'atlas-bundled-packages',
    moduleParsed(info) {
      const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/u.exec(info.id.replace(/\?.*$/u, ''));
      if (match) packages.add(path.resolve(match[1]));
    },
  };
}

/** The browser bundle: index.html, app.js and style.css. Search loads beside it as ./search.js. */
export const client = (outDir = output, packages = new Set()) => ({
  configFile: false, root: ui, base: './', publicDir: false, logLevel: 'warn', plugins: [react(), bundled(packages)],
  build: {
    outDir, emptyOutDir: true, assetsDir: '', target: 'es2022', modulePreload: false, cssCodeSplit: false, reportCompressedSize: false,
    rolldownOptions: {
      external: ['atlas-search'],
      output: { entryFileNames: 'app.js', assetFileNames: 'style.css', paths: { 'atlas-search': './search.js' }, postBanner: banner },
    },
  },
});

/** The prerenderer: the same Root and its dependencies bundled for Node, with search built in. */
export const server = (outDir = output, packages = new Set()) => ({
  configFile: false, root: ui, publicDir: false, logLevel: 'warn', plugins: [react(), bundled(packages)],
  resolve: { alias: { 'atlas-search': search } },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'prerender.tsx', outDir, emptyOutDir: false, target: 'node22', minify: true, reportCompressedSize: false,
    rolldownOptions: { output: { entryFileNames: 'prerender.mjs', format: 'es', postBanner: banner } },
  },
});
