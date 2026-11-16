// The Portal's local service: the reader's pages, served on loopback from the files on disk.
// It only reads. A request that is not GET or HEAD is refused, and so is one whose Host is not a
// loopback name with the listening port, which keeps other sites' pages from reaching it by name.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openModel, fingerprint, sourceReadings, sourcePage, sourceFile, citedFiles, linkSourcePages, searchIndex, searchModule, stateHome } from './model.mjs';
import { listProposals, openProposal, proposedPoint, proposedFacet, proposedStyle } from './drafts.mjs';
import { homePage, helpPage, pointPage, facetPage, sourceFilePage, proposalPage, proposedPointPage, proposedFacetPage, proposedStylePage, diagnosticsPage, absentPage, missingPage, contentPolicy } from './pages.mjs';

const ID = '[a-z0-9][a-z0-9-]{0,99}';
const assets = new Map([
  ['/_/sheet.css', [new URL('../assets/sheet.css', import.meta.url), 'text/css']],
  ['/_/reader.js', [new URL('../assets/reader.js', import.meta.url), 'text/javascript']],
  ['/_/search.js', [searchModule, 'text/javascript']],
]);
const headers = {
  'Content-Security-Policy': `${contentPolicy}; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};
const failure = (code, message) => Object.assign(new Error(message), { code });
/** Where drafts are read from when the service was started with a state home (ATLAS_STATE_HOME, which the CLI's --state-home sets); null for the user's own. */
const chosenHome = () => process.env.ATLAS_STATE_HOME === undefined ? null : stateHome();

/**
 * The Atlas at `root` as it is on disk now. A reading is kept between requests only while a
 * cheap look at the files (`fingerprint`) finds them as they were, and only once the newest of
 * them is older than `settle` milliseconds, so a file written while it was being read is read again.
 */
export function reading(root, { settle = 2000 } = {}) {
  let held = null;
  return async () => {
    if (held && (await fingerprint(held.model))?.key === held.key) return held.model;
    held = null;
    const started = BigInt(Date.now()) * 1_000_000n;
    const model = await openModel(root);
    const print = await fingerprint(model);
    if (print && print.newest <= started - BigInt(settle) * 1_000_000n) held = { model, key: print.key };
    return model;
  };
}

/**
 * Serve the Portal for the Atlas at `root` on 127.0.0.1.
 *
 * `port`: the port to listen on; 0 takes a free one.
 * `allowedRoots`: absolute directories cited local sources may be read from, besides the Atlas root.
 * `timeZone`: the zone moments are written in; omitted, this machine's.
 *
 * Returns `{ server, url, close }`.
 */
export async function startPortal(root, options = {}) {
  const unknown = Object.keys(options).filter(name => !['port', 'allowedRoots', 'timeZone'].includes(name));
  if (unknown.length) throw failure('INVALID_REQUEST', `The Portal has no option ${unknown.join(', ')}.`);
  const { port = 0, timeZone } = options;
  let { allowedRoots } = options;
  root = await fs.realpath(path.resolve(root));
  if (!(await fs.stat(root)).isDirectory()) throw failure('INVALID_ROOT', 'Atlas root must be a directory.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('INVALID_REQUEST', 'The port must be 0 through 65535.');
  if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.length > 99 || allowedRoots.some(item => typeof item !== 'string' || !path.isAbsolute(item)))) throw failure('INVALID_REQUEST', 'Source grants must be at most 99 absolute directories.');
  try { new Intl.DateTimeFormat('en-GB', { timeZone }); } catch { throw failure('INVALID_REQUEST', 'The time zone is not one this machine knows.'); }
  allowedRoots = [...new Set([root, ...(allowedRoots ?? [])])];
  const current = reading(root);
  let hosts, origins;

  /**
   * What one address holds: `{ status, type, body }`, or `{ to }` for an address that lacks its closing slash.
   * `query` is the request's query; only the page of a source reads it.
   */
  async function answer(address, query) {
    if (assets.has(address)) {
      const [file, type] = assets.get(address);
      return { status: 200, type, body: await fs.readFile(file) };
    }
    const model = await current(), atlas = model.atlas;
    const above = '../'.repeat(address.split('/').length - 2);
    const html = (body, status = 200) => ({ status, type: 'text/html', body });
    const missing = words => html(missingPage(model, words, { root: above }), 404);
    // How a page's sources stand, and which of them the service shows on a page of their own: a file the grants reach
    // and the Atlas as it is cites, so that a page under a proposed change links no source only the change cites.
    const states = async (held, record) => {
      const found = (await sourceReadings(held, [record], { allowedRoots }))[0];
      if (held === model) return found;
      const cited = model.atlas ? citedFiles(model) : new Set();
      return { ...found, served: found.served.map((shown, index) => shown && cited.has(sourceFile(record.sources[index].uri))) };
    };
    const draft = new RegExp(`^/_/draft/(${ID})/(?:(${ID})/|_/facet/(${ID})/(${ID})/|(_/style/))?$`).exec(address);
    if (draft) {
      const [, id, point, tree, facet, style] = draft;
      let proposal;
      try { proposal = await openProposal(root, id, model); }
      catch (error) { return html(missingPage(model, `The proposed change ${id} could not be read: ${error.message}`, { root: above }), 500); }
      if (!proposal) return missing(`No proposed change has the address ${id}.`);
      if (!point && !facet && !style) return html(proposalPage(proposal, { timeZone, stateHome: chosenHome() }));
      const proposed = !proposal.model.atlas ? null : style ? proposedStyle(proposal) : point ? proposedPoint(proposal, point) : proposedFacet(proposal, `${tree}:${facet}`);
      if (!proposed) return missing(point ? `This proposed change has no Point with the address ${point}.` : 'This proposed change has nothing at this address.');
      if (style) return html(proposedStylePage(proposal, proposed));
      // A record the proposal removes is drawn from the earlier Atlas without its sources.
      return html(point ? proposedPointPage(proposal, proposed, await states(proposal.model, proposed.point))
        : proposedFacetPage(proposal, proposed, await states(proposal.model, proposed.facet)));
    }
    if (new RegExp(`^(?:/_/draft/${ID})?(?:/${ID}|/_/facet/${ID}/${ID})$|^/_/draft/${ID}(?:/_/style)?$|^/_/help$`).test(address)) return { to: `${address}/` };
    // Help explains the Portal's words, moves and marks, so it answers whether or not there is an Atlas to read.
    if (address === '/_/help/') return html(helpPage(model));
    if (!atlas) {
      const body = model.status === 'absent' ? absentPage(model, { root: above, ...await listProposals(root, model), timeZone, stateHome: chosenHome() })
        : diagnosticsPage(model, { root: above, ...await listProposals(root, model), timeZone });
      return html(body, address === '/' ? 200 : 404);
    }
    if (address === '/') return html(homePage(model, { ...await listProposals(root, model), timeZone }));
    if (address === '/_/search.json') return { status: 200, type: 'application/json', body: JSON.stringify(searchIndex(model)) };
    // A cited local file, read through the Library within the grants; nothing outside them has a page.
    if (address === '/_/source/') {
      const uri = query.get('uri'), found = uri ? await sourcePage(model, uri, { allowedRoots }) : null;
      return found ? html(sourceFilePage(model, found)) : missing('No source this service can show has this address.');
    }
    // Prose links a file the Atlas cites to the file's own page; which files have one is learned once for each reading.
    await linkSourcePages(model, { allowedRoots });
    const facet = new RegExp(`^/_/facet/(${ID})/(${ID})/$`).exec(address);
    if (facet) {
      const key = `${facet[1]}:${facet[2]}`;
      return atlas.facets.has(key) ? html(facetPage(model, key, await states(model, atlas.facets.get(key)))) : missing('Nothing has this address.');
    }
    const point = new RegExp(`^/(${ID})/$`).exec(address)?.[1];
    if (point && atlas.points.has(point)) return html(pointPage(model, point, await states(model, atlas.points.get(point))));
    return missing(point ? `No Point has the address ${point}.` : 'Nothing has this address.');
  }

  const server = http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    const send = (status, type, body) => {
      body = Buffer.from(body);
      response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const origin = request.headers.origin;
      if (!hosts.has(request.headers.host?.toLowerCase()) || origin !== undefined && !origins.has(origin)) return send(403, 'text/plain', 'This request does not name the Portal on this machine.\n');
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        return send(405, 'text/plain', 'The Portal only reads: GET or HEAD.\n');
      }
      const cut = request.url.indexOf('?');
      const result = cut < 0 ? await answer(request.url, new URLSearchParams()) : await answer(request.url.slice(0, cut), new URLSearchParams(request.url.slice(cut + 1)));
      if (result.to) { response.setHeader('Location', result.to); return send(301, 'text/plain', `${result.to}\n`); }
      send(result.status, result.type, result.body);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      send(500, 'text/plain', `The Portal could not answer: ${error.message}\n`);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const listening = server.address().port, names = ['127.0.0.1', 'localhost', '[::1]'];
  hosts = new Set(names.flatMap(name => [`${name}:${listening}`, ...(listening === 80 ? [name] : [])]));
  origins = new Set([...hosts].map(host => `http://${host}`));
  return {
    server, url: `http://127.0.0.1:${listening}/`,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }),
  };
}
