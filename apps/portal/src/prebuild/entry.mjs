// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import PortalShell from '../components/PortalShell.astro';

export default async function render(corpus, outputDirectory, assets) {
  const container = await AstroContainer.create({ resolve: specifier => {
    if (specifier.endsWith('/PortalShell.astro?astro&type=script&index=0&lang.ts')) return assets.script;
    throw new Error(`Unregistered prebuilt browser asset: ${specifier}`);
  } });
  for (const route of [...corpus.routes, { kind: 'not-found', path: '/404.html', title: 'Page not found' }]) {
    const filename = path.join(outputDirectory, route.path === '/404.html' ? '404.html' : `${route.path.slice(1)}index.html`);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const html = await container.renderToString(PortalShell, { props: { corpus, route, stylesheet: assets.stylesheet }, partial: false });
    fs.writeFileSync(filename, html);
  }
}
