// The Portal's pages: pure functions from the presented model to HTML. Every page is complete as
// written. Two patterns hold on all of them: an underlined name goes to the page of what it
// names, and a name in a margin (drawn with ▸) is a link the reader's script opens here instead.
// The one margin that opens nothing is a source's, on the page the local service shows of a cited
// file: it lists what cites the file, each a name that goes to its page, as a name in a list does.
// Every link between the Portal's own pages is relative, so the same pages serve from a local
// service and from an export under any path; a link out of the Atlas (an address an author wrote,
// or a source under an export's source base) is absolute. Only the local service links a cited
// local source to a page of its own; an export does not hold one.

/** The policy each page carries for itself; the local service sends it as a header as well. */
export const contentPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** The commands a page names. They are the CLI's; keep them as the CLI reads them. */
const shell = value => /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
/** The start of a command for the Atlas at `root`: `--state-home` too when the drafts are kept in `home`, not the user's own state directory. */
const rooted = (root, home) => `atlas --root ${shell(root)}${home ? ` --state-home ${shell(home)}` : ''}`;
const createCommand = (root, home) => `${rooted(root, home)} init --id ID --title TITLE --style STYLE`;
const applyCommand = (root, home, id, revision) => `${rooted(root, home)} apply ${id} --revision ${revision}`;
/** The command that lists the applies of the Atlas whose journals remain, the interrupted ones to recover among them. */
const recoverCommand = (root, home) => `${rooted(root, home)} recover`;

const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The calendar date an author wrote, as words: "3 November 2026". */
const dated = iso => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : iso;
};
/** A moment, as the reader's clock has it: "14 November 2026 at 17:59". */
const moment = (iso, timeZone) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
const count = (number, one, many) => `${number} ${number === 1 ? one : many}`;

const ROLES = [['evidence', 'Evidence'], ['background', 'Background'], ['example', 'Examples'], ['implementation', 'Implementation'], ['history', 'History'], [null, 'Sources']];
// How a source stands, where that needs saying: red where the reader must attend to it; blue where a stamp could not
// be checked against its source where this page is served, which is a limit of this reading and not a difference.
const FLAGS = { changed: ['red', '△', 'changed since this was checked'], missing: ['red', '✗', 'missing'], denied: ['blue', '○', 'not checked here'] };

/** A Point's Type and standing in words, or '' when it has no Type: "Decision · selected", "Observation · 3 November 2026". */
export const standing = value => !value ? '' : value.type === 'decision' ? `Decision · ${value.status}` : `Observation · ${dated(value.observedAt)}`;
/** What kind of record a Point is, where a page or a panel names it: its Type and standing, or "Point" when it has no Type. */
const kindOf = value => standing(value) || 'Point';
/** What a Facet is, in the one phrase its page, its panel and its search result give it: "Product · Facet, seen from Model". */
const facetKind = (atlas, facet) => `${atlas.accounts.get(facet.account).title} · Facet, seen from ${facet.outside ? 'a Tree not in this publication' : atlas.accounts.get(facet.via).title}`;

/** Where the pages of an Atlas stand, seen from a page from which `base` leads to that Atlas's home. */
const places = base => ({ point: id => `${base}${id}/`, facet: key => `${base}_/facet/${key.replace(':', '/')}/` });
/**
 * The local service's page of a cited source, seen from a page from which `home` leads to the Atlas's home: the URI as
 * cited in the query, and its fragment, if any, as the page's own, so that the reader lands on the section it cites.
 */
const sourceAddress = (home, uri) => `${home}_/source/?uri=${encodeURIComponent(uri)}${uri.includes('#') ? uri.slice(uri.indexOf('#')) : ''}`;

// ── Parts every page shares ─────────────────────────────────────────────────────────────────

function page({ title, root, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="${contentPolicy}">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${root}_/sheet.css">
<script type="module" src="${root}_/reader.js"></script>
</head>
<body>
<div class="sheet">
${body}
</div>
</body>
</html>
`;
}

/** Help, at the right end of every strip: a link to the page that explains the Portal's words, its moves and its marks. `home` leads to the Atlas's home. */
const helpLink = home => `<a class="control help" href="${home}_/help/" aria-label="Help">?</a>`;

/**
 * The title strip of a page of the Atlas as it is. `outline` is false on home, where it would lead to itself, and
 * `help` on the help page.
 */
function strip(title, root, { outline = true, help = true } = {}) {
  const home = root || './';
  const tools = `${outline ? `<a class="control" href="${home}" data-outline>Outline</a>` : ''}${help ? helpLink(root) : ''}`;
  return `<header class="strip" data-strip><a class="title" href="${home}">${esc(title)}</a>${tools ? `<div class="tools">${tools}</div>` : ''}</header>`;
}

/** The title strip of a page under a proposed change: its top, what it is, the way back, and Help, which `root` leads to. */
function proposedStrip(title, top, asItIs, root) {
  return `<header class="strip"><a class="title" href="${top}">${esc(title)}</a><span class="red">Proposed change</span><a href="${asItIs}">The Atlas as it is</a>${helpLink(root)}</header>`;
}

/** The title strip where there is no Atlas to name. */
const bareStrip = (root, help = true) => `<header class="strip"><a class="title" href="${root || './'}">Atlas</a>${help ? helpLink(root) : ''}</header>`;

const red = word => `<span class="red">${esc(word)}</span>`;
/** The word of what differs: red, but blue for a stamp, which changes nothing a record says. */
const marked = word => word === 'stamped' ? `<span class="blue">${esc(word)}</span>` : red(word);
const before = html => `<details class="before"><summary>Before</summary>${html}</details>`;

/** Why an Atlas or a proposed change does not validate: for each reason its code, what is wrong, and the file it is in. */
function diagnosticsList(diagnostics) {
  return `<ul class="diagnostics">${diagnostics.map(item =>
    `<li><span class="red"><span aria-hidden="true">✗ </span>${esc(item.code)}</span><p>${esc(item.message)}${item.path ? `<span class="file">${esc(item.path)}</span>` : ''}</p></li>`).join('')}</ul>`;
}

// ── The Trees: home, and what Outline shows ─────────────────────────────────────────────────

function outline(atlas, id, at) {
  const children = atlas.points.get(id).children;
  if (!children.length) return '';
  return `<ul>${children.map(child => {
    const point = atlas.points.get(child), words = standing(point.standing);
    return `<li><a href="${at(child)}" data-id="${esc(child)}">${esc(point.title)}</a>${words ? `<span class="std"> · ${esc(words)}</span>` : ''}${outline(atlas, child, at)}</li>`;
  }).join('')}</ul>`;
}

function accounts(atlas, at) {
  return `<ol class="accounts" data-accounts>${[...atlas.accounts.values()].map(account => {
    const base = atlas.points.get(account.base), words = standing(base.standing), developing = account.order.length - 1;
    return `<li><h2 class="tree">${esc(account.title)}</h2><div><a class="claim" href="${at(account.base)}" data-id="${esc(account.base)}">${esc(base.title)}</a>${words ? `<span class="std">${esc(words)}</span>` : ''}<p class="scope">${esc(account.scope)}</p>${
      developing ? `<details class="outline map"><summary>${count(developing, 'Point', 'Points')}</summary>${outline(atlas, account.base, at)}</details>` : ''}</div></li>`;
  }).join('')}</ol>`;
}

/**
 * What a proposed change does, in one line: how many Points differ, or that it creates the Atlas, and how many Points
 * and Facets it only stamps; or that stamping is all it does.
 */
function summary({ creates = false, differs, stamped = { claims: 0, views: 0 }, stampsOnly = false }) {
  const stamps = [stamped.claims && count(stamped.claims, 'Point', 'Points'), stamped.views && count(stamped.views, 'Facet', 'Facets')].filter(Boolean).join(' and ');
  if (stampsOnly) return `only stamps: ${stamps} stamped, nothing they say differs`;
  return `${creates ? 'a new Atlas' : differs ? count(differs, 'Point differs', 'Points differ') : 'no Point differs'}${stamps ? ` · ${stamps} stamped` : ''}`;
}

/**
 * Each proposed change as home lists it: its reason, then in one line, for one that cannot be applied as it stands, the
 * word its page begins with, in red; what it does; and when it was prepared. Under the list, in red, one line for each
 * that could not be read: its file and the Library's words.
 */
function proposalList({ proposals = [], unread = [] }, root, timeZone) {
  if (!proposals.length && !unread.length) return '';
  const listed = proposals.length ? `<ul>${proposals.map(item =>
    `<li><a class="claim" href="${root}_/draft/${esc(item.id)}/">${esc(item.reason)}</a><p class="says">${item.standing === 'ready' ? '' : `${red(STANDINGS[item.standing][1])} · `}${summary(item)} · prepared ${esc(moment(item.preparedAt, timeZone))}</p></li>`).join('')}</ul>` : '';
  return `<section class="proposals"><h2 class="cap">Proposed changes</h2>${listed}${unread.map(item =>
    `<p class="red"><span aria-hidden="true">✗ </span>A proposed change could not be read: ${item.file === null ? '' : `${esc(item.file)}: `}${esc(item.message)}</p>`).join('')}</section>`;
}

/**
 * Home: the Atlas title, the proposed changes when there are any, and each account with its top claim,
 * scope and outline.
 * `proposals`: `[{ id, reason, preparedAt, standing, creates, differs, stamped, stampsOnly }]`; `unread`: `[{ file,
 * message }]`, each that could not be read (both as `listProposals` returns them).
 * `timeZone`: the zone moments are written in; omitted, this machine's.
 */
export function homePage(model, { root = '', proposals = [], unread = [], timeZone } = {}) {
  const atlas = model.atlas;
  return page({ title: atlas.title, root, body: `${strip(atlas.title, root, { outline: false })}
<main class="home">
<h1>${esc(atlas.title)}</h1>
${proposalList({ proposals, unread }, root, timeZone)}${accounts(atlas, id => `${root}${id}/`)}
</main>` });
}

// ── The main column: a kind line, the title, the prose and the foot ─────────────────────────

/** What a page of the Atlas as it is has in place of a proposed change's marks: nothing differs. */
const NONE = { word: null, title: null, standing: null, place: null, blocks: null, uncertainty: null, sources: null,
  words: { points: new Map(), facets: new Map() }, proposed: null, gone: { beneath: [], beside: [], facets: [] } };

function prose(record, marks) {
  if (!marks.blocks) return record.html;
  return marks.blocks.map(block => block.word === 'removed' ? `<div class="gone">${red('removed')}${block.html}</div>`
    : block.word === 'new' ? `<div class="added">${red('new')}${block.html}</div>`
    : block.before ? `<div class="altered">${block.html}${before(block.before)}</div>` : block.html).join('');
}

/** The line above a title and the title: what kind of thing this is, how it stands, and what differs of either. */
function head(title, kind, marks) {
  const was = marks.standing;
  const line = `${marks.word ? marked(marks.word) : ''}${kind}${!was ? '' : was.word === 'removed' ? `<span class="cap gone">${esc(standing(was.before))}</span>${red('removed')}` : was.word === 'new' ? red('new') : before(`<p class="cap">${esc(standing(was.before))}</p>`)}`;
  return `${line ? `<div class="kind">${line}</div>` : ''}
<h1${marks.word === 'removed' ? ' class="gone"' : ''}>${esc(title)}</h1>${marks.title ? before(`<p class="was">${esc(marks.title)}</p>`) : ''}`;
}

/**
 * One source as its line reads: its title or path, its locator, its path under a title, and how it stands. `page` is
 * the address of the source's own page in the local service, when it shows one; else the name links only where the
 * model gives the source an address of its own (an HTTP(S) source, or a local one under an export's source base).
 */
function sourceWords(source, state, page = null) {
  const name = esc(source.title ?? source.shown);
  const named = page ? `<a href="${esc(page)}">${name}</a>` : source.href ? `<a class="out" href="${esc(source.href)}" target="_blank" rel="noopener noreferrer">${name}</a>` : `<span>${name}</span>`;
  const flag = FLAGS[state] ? `<span class="${FLAGS[state][0]} flag"><span aria-hidden="true">${FLAGS[state][1]} </span>${FLAGS[state][2]}</span>` : '';
  return `${named}${source.locator ? `<span class="loc"> · ${esc(source.locator)}</span>` : ''}${source.title && !source.remote ? `<span class="file">${esc(source.shown)}</span>` : ''}${flag}`;
}

function sourceLine({ source, shown, page, word, before: earlier }) {
  const line = sourceWords(source, shown, page);
  if (word === 'removed') return `<li><span class="gone">${line}</span>${red('removed')}</li>`;
  return `<li>${line}${earlier ? before(`<p>${sourceWords(earlier)}</p>`) : word ? marked(word) : ''}</li>`;
}

/**
 * Under the prose: what is not established, and what it rests on. The sources stand behind a native disclosure whose
 * line says how many there are, how many no longer match their stamp or are missing, and how many stamps could not be
 * checked here. When some stamps were checked and some were not, each unchecked source is marked and the line counts
 * them; when none could be, no source is marked and the line says it once. `served[i]`: the local service shows the
 * i-th source on a page of its own, which `home` leads to.
 */
function foot(record, states, marks, served = [], home = '') {
  const doubt = marks.uncertainty;
  const unsure = doubt?.word === 'removed' ? `<div class="unsure"><h2 class="cap">Uncertainty</h2><p class="gone">${esc(doubt.before)}</p>${red('removed')}</div>`
    : record.uncertainty ? `<div class="unsure"><h2 class="cap">Uncertainty</h2><p>${esc(record.uncertainty)}</p>${doubt?.word === 'new' ? red('new') : doubt ? before(`<p>${esc(doubt.before)}</p>`) : ''}</div>` : '';
  const cited = (marks.sources ?? record.sources.map(source => ({ source }))).map(item => {
    const at = record.sources.indexOf(item.source);
    return { ...item, state: states[at], page: served[at] ? sourceAddress(home, item.source.uri) : null };
  });
  const stamped = cited.filter(item => item.source.stamp && item.state);
  const unchecked = stamped.length > 0 && stamped.every(item => item.state === 'denied');
  const flags = tone => Object.entries(FLAGS).filter(([, [ink]]) => ink === tone).map(([state, [, , words]]) => [cited.filter(item => item.state === state).length, words])
    .filter(([found]) => found).map(([found, words]) => ` · ${unchecked && tone === 'blue' ? '' : `${found} `}${words}`).join('');
  const told = ['red', 'blue'].map(tone => flags(tone) ? `<span class="${tone}">${flags(tone)}</span>` : '').join('');
  const rests = cited.length ? `<details class="rests"${marks.sources ? ' open' : ''}><summary>${count(record.sources.length, 'source', 'sources')}${told}</summary>${ROLES.map(([role, label]) => {
    const list = cited.filter(item => item.source.role === role);
    return list.length ? `<h2 class="cap">${label}</h2><ul class="sources">${list.map(item => sourceLine({ ...item, shown: unchecked && item.state === 'denied' ? null : item.state })).join('')}</ul>` : '';
  }).join('')}</details>` : '';
  return unsure || rests ? `<footer class="foot" data-foot>${unsure}${rests}</footer>` : '';
}

// ── The margin: the map of where a Point stands ─────────────────────────────────────────────

/** A claim's name beside the record a page draws. Under a proposed change it is the claim's name as proposed, which is what its page says, even where the record drawn is one the proposal removes. */
const named = (atlas, marks) => id => (marks.proposed?.points.get(id) ?? atlas.points.get(id)).title;

/** One item of a margin: a name that opens what it names here; without the script, a link to its page. */
function opens(href, token, title, word, inner = '') {
  return `<li><a class="opens${word === 'removed' ? ' gone' : ''}" href="${href}" data-open="${esc(token)}">${esc(title)}${word ? marked(word) : ''}</a>${inner}</li>`;
}

/** Items under the title of the account each belongs to, the accounts in the order they first appear. */
function byAccount(atlas, items) {
  const groups = new Map();
  for (const item of items) groups.set(item.account, [...(groups.get(item.account) ?? []), item]);
  return [...groups].map(([account, list]) => `<li class="acct"><span class="acct-name">${esc(atlas.accounts.get(account).title)}</span><ul>${list.map(item => item.line).join('')}</ul></li>`).join('');
}

/**
 * The margin of a Point's page, in up to four parts: the account's outline around the Point (up to
 * three claims above, the claims beside it, itself as the current page, its developments), the
 * Facets said of it, the Points its prose refers to, and what refers to it. The last two leave
 * out what the outline already shows. Under a proposed change that moves the Point, where it stood
 * before follows the outline.
 */
function pointMargin(atlas, point, at, marks) {
  const word = id => marks.words.points.get(id), facetWord = key => marks.words.facets.get(key);
  const claim = (id, inner) => opens(at.point(id), id, named(atlas, marks)(id), word(id), inner);
  const removed = list => list.map(item => opens(at.point(item.id), item.id, item.title, 'removed')).join('');
  const beneath = point.children.length || marks.gone.beneath.length ? `<ul data-develops>${point.children.map(id => claim(id)).join('')}${removed(marks.gone.beneath)}</ul>` : '';
  const here = `<li class="here"><span aria-current="page">${esc(point.title)}${marks.word ? marked(marks.word) : ''}</span>${beneath}</li>`;
  const beside = point.parent === null ? here : `${atlas.points.get(point.parent).children.map(id => id === point.id ? here : claim(id)).join('')}${removed(marks.gone.beside)}`;
  const shown = point.above.slice(-3), more = point.above.length - shown.length;
  const around = shown.reduceRight((inner, id) => `<ul>${claim(id, inner)}</ul>`, `<ul>${beside}</ul>`);
  const parts = [`<section class="map"><h2 class="cap"><span data-account>${esc(atlas.accounts.get(point.account).title)}</span>${more ? ` · ${count(more, 'more Point', 'more Points')} above` : ''}</h2>${around}</section>`];
  // Where a Point that moved stood before: the claims that were above it, each as it now is, nested as an outline.
  if (marks.place) parts.push(`<section class="map"><h2 class="cap">${red('Before')}${marks.place.claims.length ? ` in ${esc(marks.place.account)}, under` : `, the top Point of ${esc(marks.place.account)}`}</h2>${
    marks.place.claims.reduceRight((inner, item) => `<ul>${opens(at.point(item.id), item.id, item.title, item.word, inner)}</ul>`, '')}</section>`);

  const seen = new Map();
  const seenFrom = facet => facet.outside ? 'Facets seen from a Tree not in this publication' : `Facets seen from ${atlas.accounts.get(facet.via).title}`;
  for (const key of point.attached) {
    const facet = atlas.facets.get(key), label = seenFrom(facet);
    seen.set(label, `${seen.get(label) ?? ''}${opens(at.facet(key), key, facet.title, facetWord(key))}`);
  }
  for (const facet of marks.gone.facets) seen.set(facet.label, `${seen.get(facet.label) ?? ''}${opens(at.facet(facet.key), facet.key, facet.title, 'removed')}`);
  for (const [label, items] of seen) parts.push(`<section class="map" data-part><h2 class="cap">${esc(label)}</h2><ul>${items}</ul></section>`);

  const outlined = new Set([point.id, ...shown, ...point.children, ...(point.parent === null ? [] : atlas.points.get(point.parent).children)]);
  const across = ids => ids.filter(id => !outlined.has(id)).map(id => ({ account: atlas.points.get(id).account, line: claim(id) }));
  const to = across(point.linksTo);
  if (to.length) parts.push(`<section class="map" data-part><h2 class="cap">Refers to</h2><ul>${byAccount(atlas, to)}</ul></section>`);
  const from = [...across(point.linkedFrom), ...point.incoming.map(key => ({ account: atlas.facets.get(key).account, line: opens(at.facet(key), key, atlas.facets.get(key).title, facetWord(key)) }))];
  if (from.length) parts.push(`<section class="map" data-part><h2 class="cap">Referred to by</h2><ul>${byAccount(atlas, from)}</ul></section>`);
  return parts.join('\n');
}

/** The margin of a Facet: the Point it is said of, and the Points it draws on. */
function facetMargin(atlas, facet, at, marks) {
  const claim = id => opens(at.point(id), id, named(atlas, marks)(id), marks.words.points.get(id));
  return `<section class="map" data-part data-said="${esc(facet.on)}"><h2 class="cap">Said of, in ${esc(atlas.accounts.get(facet.account).title)}</h2><ul>${claim(facet.on)}</ul></section>${
    facet.targets.length ? `\n<section class="map" data-part><h2 class="cap">In ${esc(atlas.accounts.get(facet.via).title)}</h2><ul>${facet.targets.map(claim).join('')}</ul></section>` : ''}`;
}

// ── A Point and a Facet ─────────────────────────────────────────────────────────────────────

function pointBody(atlas, point, { base, states = [], marks = NONE, served = [], home = base }) {
  const at = places(base), next = point.next && atlas.points.get(point.next);
  return `<main class="doc">
<div class="row">
<article class="point" data-point="${esc(point.id)}">
${head(point.title, `<span class="cap" data-standing>${esc(kindOf(point.standing))}</span>`, marks)}
<div class="body" data-prose>${prose(point, marks)}</div>
${foot(point, states, marks, served, home)}
${next ? `<p class="onward"><span class="cap">${next.account === point.account ? 'Next' : `Next, in ${esc(atlas.accounts.get(next.account).title)}`}</span><a href="${at.point(next.id)}">${esc(next.title)}</a></p>` : ''}
</article>
<nav class="margin" aria-label="Where this stands">
${pointMargin(atlas, point, at, marks)}
</nav>
</div>
</main>`;
}

function facetBody(atlas, facet, { base, states = [], marks = NONE, served = [], home = base }) {
  return `<main class="doc">
<div class="row">
<article class="point">
${head(facet.title, `<span class="cap" data-account>${esc(facetKind(atlas, facet))}</span>`, marks)}
<div class="body" data-prose>${prose(facet, marks)}</div>
${foot(facet, states, marks, served, home)}
</article>
<nav class="margin" aria-label="Where this stands">
${facetMargin(atlas, facet, places(base), marks)}
</nav>
</div>
</main>`;
}

/** The Style as a proposed change holds it: how this Atlas is written. It follows a Point's page: a kind line, the title and the prose in the main column; it has no margin. */
function styleBody(atlas, marks = NONE) {
  return `<main class="doc">
<div class="row">
<article class="point">
${head(atlas.style.title, '<span class="cap">How this Atlas is written</span>', marks)}
<div class="body">${prose(atlas.style, marks)}</div>
</article>
</div>
</main>`;
}

/**
 * One Point's page: the strip; in the main column its standing, title, prose, uncertainty, sources
 * and the next Point, with its account when it is the top claim of the next; in the margin the map of where it stands.
 * `states`: how each of the Point's sources stands, in the order of `point.sources` (see `sourceStates`).
 * `served`: in the same order, whether the local service shows the source on a page of its own (see `sourceReadings`),
 * which its name then links to; an export passes none.
 */
export function pointPage(model, id, { root = '../', states = [], served = [] } = {}) {
  const atlas = model.atlas, point = atlas.points.get(id);
  return page({ title: `${point.title} · ${atlas.title}`, root, body: `${strip(atlas.title, root)}
${pointBody(atlas, point, { base: root, states, served })}` });
}

/** One Facet's page, by its key `<tree>:<id>`: its accounts, title, prose, uncertainty and sources; in the margin, the Point it is said of and the claims it draws on. `states` and `served` as for `pointPage`. */
export function facetPage(model, key, { root = '../../../../', states = [], served = [] } = {}) {
  const atlas = model.atlas, facet = atlas.facets.get(key);
  return page({ title: `${facet.title} · ${atlas.title}`, root, body: `${strip(atlas.title, root)}
${facetBody(atlas, facet, { base: root, states, served })}` });
}

/** A heading of a file shown on its own page, one level down, so that the page's own title is its one H1. */
const lowered = html => html.replace(/<(\/?)h([1-6])\b/g, (whole, close, level) => `<${close}h${Math.min(6, Number(level) + 1)}`);
const UNSHOWN = {
  missing: 'This file is not there.',
  large: 'This file is too large to show here.',
  binary: 'This file is not text, so it is not shown here.',
  unreadable: 'This file could not be read here.',
};

/**
 * A cited local file, as the local service shows it: the strip; in the main column its path as the title and the file
 * as it is now (Markdown rendered as prose is, each heading carrying the Library's heading name as its ID; other text
 * as it is; or a sentence that says why it is not shown); in the margin the claims that cite it, each a link to its
 * page. `found` is what `sourcePage` returns.
 */
export function sourceFilePage(model, found, { root = '../../' } = {}) {
  const atlas = model.atlas, at = places(root);
  const shown = found.read === 'markdown' ? `<div class="body">${lowered(found.html)}</div>`
    : found.read === 'text' ? `<div class="body"><pre><code>${esc(found.text)}</code></pre></div>` : `<p class="says">${UNSHOWN[found.read]}</p>`;
  const citers = found.citers.map(item => ({ account: item.account, line: `<li><a href="${item.point ? at.point(item.point) : at.facet(item.facet)}">${esc(item.title)}</a></li>` }));
  return page({ title: `${found.shown} · ${atlas.title}`, root, body: `${strip(atlas.title, root)}
<main class="doc">
<div class="row">
<article class="point source">
<div class="kind"><span class="cap">Source, as it is now</span></div>
<h1>${esc(found.shown)}</h1>
${shown}
</article>
<nav class="margin" aria-label="What cites it">
<section class="map cited"><h2 class="cap">Cited by</h2><ul>${byAccount(atlas, citers)}</ul></section>
</nav>
</div>
</main>` });
}

// ── A proposed change ───────────────────────────────────────────────────────────────────────

/**
 * How a proposed change stands: the ink of its line, its word, and what its page says after the word; a blocked one's
 * page says it in the terms of what blocks it (see `blockedBecause`). Home says the word of one that cannot be applied.
 */
const STANDINGS = {
  ready: ['says', 'Ready to apply', null],
  stale: ['red', 'Stale', 'the Atlas has changed since this was prepared'],
  invalid: ['red', 'Invalid', 'it cannot be applied as it stands'],
  blocked: ['red', 'Blocked', null],
};

/**
 * Why no draft can be applied now, from what blocks it (`blocker`, as `openProposal` gives it), and whether recovery
 * is what it needs: an interrupted apply that recovery rolls back; an Atlas that does not read whole; else the Library's
 * words.
 */
function blockedBecause(blocker) {
  if (blocker.code === 'LOCKED' && blocker.transaction) return { why: 'an interrupted apply needs recovery first', recover: true };
  if (blocker.code === 'INCOMPLETE') return { why: 'the Atlas does not read whole', recover: false };
  return { why: blocker.message, recover: false };
}

const PARTS = { title: 'its title', id: 'its ID', accounts: 'which Trees it holds', order: 'the order of its Trees', scope: 'its scope', outline: 'its outline', file: 'its file only' };
/** Which parts of a thing differ, in words: "its title, its scope". */
const said = parts => parts.length ? `<p class="says">${parts.map(part => PARTS[part]).join(', ')}</p>` : '';
/** A row of what differs for a record whose file alone differs: its name, and that it reads the same. */
const fileOnly = named => `<li><span></span><span>${named}<span class="says">its file only</span></span></li>`;

/** What differs of an account itself: which of its parts, its scope when that is new, and what its title and scope said before. */
function ownDifference(account) {
  const scope = account.word === 'new' || account.was.scope !== null ? `<p class="scope">${esc(account.scope)}</p>` : '';
  const earlier = `${account.was.title === null ? '' : `<p class="tree">${esc(account.was.title)}</p>`}${account.was.scope === null ? '' : `<p class="scope">${esc(account.was.scope)}</p>`}`;
  return `${said(account.parts)}${scope}${earlier ? before(earlier) : ''}`;
}

/** What differs of the Atlas itself: which of its parts, its title and ID as proposed with what they were, and the order of its accounts as proposed. */
function atlasDifference(itself) {
  const title = itself.was.title === null ? '' : `<p class="said">${esc(itself.title)}</p>${before(`<p class="said">${esc(itself.was.title)}</p>`)}`;
  const id = itself.was.id === null ? '' : `<p class="tree">${esc(itself.id)}</p>${before(`<p class="tree">${esc(itself.was.id)}</p>`)}`;
  const order = itself.order ? `<ol class="order">${itself.order.map(title => `<li>${esc(title)}</li>`).join('')}</ol>` : '';
  return `${said(itself.parts)}${title}${id}${order}`;
}

const LEVELS = { required: 'Required', advisory: 'Advisory' };
/** How a Check binds, in words: "Required · active". */
const binds = rule => `${LEVELS[rule.level] ?? rule.level} · ${rule.status}`;
/** A Check's text under the page's own headings: its sections keep their order and their names, two levels down. */
const sections = html => html.replace(/<(\/?)h([1-6])>/g, (whole, close, level) => `<${close}h${Math.min(6, Number(level) + 2)}>`);

/**
 * One Check that differs: its word, its title, its file, how it binds and its text as proposed, and under them one
 * "Before" holding whichever of those it had before differ; a removed one as it was, struck through. A Check has no
 * page of its own.
 */
function heldTo(check) {
  const was = check.was ?? { title: null, path: null, rule: null, html: null }, struck = check.word === 'removed' ? ' gone' : '';
  const earlier = `${was.title === null ? '' : `<p class="named">${esc(was.title)}</p>`}${was.path === null ? '' : `<span class="file">${esc(was.path)}</span>`
  }${was.rule === null ? '' : `<p class="cap">${esc(binds(was.rule))}</p>`}${was.html === null ? '' : `<div class="body">${sections(was.html)}</div>`}`;
  return `<li>${check.word ? red(check.word) : '<span></span>'}<div class="held"><p class="named${struck}">${esc(check.title)}</p><span class="file">${esc(check.path)}</span>`
    + `<p class="cap${struck}">${esc(binds(check))}</p><div class="body${struck}">${sections(check.html)}</div>${earlier ? before(`<div>${earlier}</div>`) : ''}${check.word ? '' : '<p class="says">its file only</p>'}</div></li>`;
}

/**
 * A proposed change: its reason, whether it can be applied, what differs by account, what else
 * to read because of it, and the command that applies it, or, while an interrupted apply blocks it, the command that
 * lists what to recover. `proposal` is what `openProposal` returns.
 * `timeZone`: the zone moments are written in; omitted, this machine's. `stateHome`: the directory the drafts
 * are read from when it is not the user's own state directory, which the command then names; else null.
 */
export function proposalPage(proposal, { root = '../../../', timeZone, stateHome = null } = {}) {
  const blocked = proposal.standing === 'blocked' ? blockedBecause(proposal.blocker) : null;
  const [tone, word, said] = STANDINGS[proposal.standing], why = blocked ? blocked.why : said, words = why ? `${word}: ${why}` : word;
  const atlas = proposal.model.atlas, at = places('');
  // A name the proposal removes is struck through in red inside its link, so the link keeps its own underline.
  const name = (word, title) => word === 'removed' ? `<span class="gone">${esc(title)}</span>` : esc(title);
  const group = (name, own, rows) => `<li><h3 class="tree">${name}</h3><div>${own}${rows.length ? `<ul class="claims">${rows.join('')}</ul>` : ''}</div></li>`;
  const differs = [
    proposal.itself ? group(`This Atlas${proposal.itself.word ? red(proposal.itself.word) : ''}`, atlasDifference(proposal.itself), []) : '',
    ...proposal.accounts.map(account => group(`${esc(account.title)}${account.word ? red(account.word) : ''}`, ownDifference(account), [
      ...account.points.map(point => point.word ? `<li>${marked(point.word)}<a href="${at.point(point.id)}">${name(point.word, point.title)}</a></li>` : fileOnly(`<a href="${at.point(point.id)}">${esc(point.title)}</a>`)),
      ...account.facets.map(facet => {
        const named = `<span class="cap">${esc(facet.label)}</span><a href="${at.facet(facet.key)}">${name(facet.word, facet.title)}</a>`;
        return facet.word ? `<li>${marked(facet.word)}<span>${named}</span></li>` : fileOnly(named);
      }),
    ])),
    proposal.style ? group('How this Atlas is written', '', [proposal.style === 'file' ? fileOnly(`<a href="_/style/">${esc(atlas.style.title)}</a>`) : `<li>${red(proposal.style)}<a href="_/style/">${esc(atlas.style.title)}</a></li>`]) : '',
    proposal.checks.length ? group('What this Atlas is held to', '', proposal.checks.map(heldTo)) : '',
    // The files no record stands for: named by their path, with what the Atlas as it was called the record there.
    proposal.files.length ? group('Files', '', proposal.files.map(file =>
      `<li>${red(file.word)}<span>${file.name === null ? '' : name(file.word, file.name)}<span class="file">${esc(file.path)}</span></span></li>`)) : '',
  ].join('');
  const also = (label, lines) => lines.length ? `<h3 class="cap">${label}</h3><div class="map"><ul>${byAccount(atlas, lines.map(item => ({ account: item.account, line: `<li><a href="${item.href}">${esc(item.title)}</a></li>` })))}</ul></div>` : '';
  const reading = atlas ? `${also('Points above what differs', proposal.above.map(id => ({ ...atlas.points.get(id), href: at.point(id) })))}${
    also('Other Trees&#39; Facets that draw on what differs', proposal.drawing.map(key => ({ ...atlas.facets.get(key), href: at.facet(key) })))}` : '';
  return page({ title: `${proposal.reason} · Proposed change · ${proposal.title}`, root, body: `${proposedStrip(proposal.title, './', root, root)}
<main class="home proposal">
<h1>${esc(proposal.reason)}</h1>
<p class="${tone}">${esc(words)} · prepared ${esc(moment(proposal.preparedAt, timeZone))}</p>
${proposal.stamped.claims + proposal.stamped.views ? `<p class="says">${summary(proposal)}</p>\n` : ''}${atlas && proposal.before.status === 'invalid' ? '<p class="says">The Atlas it was prepared against does not validate: what differs is read from its files as far as they allow, and no Point or Facet shows what it said before.</p>\n' : ''}${proposal.standing === 'invalid' ? diagnosticsList(proposal.diagnostics) : ''}
${differs ? `<section><h2 class="cap">What differs</h2><ol class="accounts">${differs}</ol></section>` : ''}
${reading ? `<section><h2 class="cap">What else to read</h2>${reading}</section>` : ''}
${proposal.standing === 'ready' ? `<section><h2 class="cap">To apply</h2><pre class="command">${esc(applyCommand(proposal.root, stateHome, proposal.id, proposal.revision))}</pre></section>`
    : blocked?.recover ? `<section><h2 class="cap">To recover</h2><pre class="command">${esc(recoverCommand(proposal.root, stateHome))}</pre></section>` : ''}
</main>` });
}

/**
 * A Point as proposed, with what differs marked. `proposed` is what `proposedPoint` returns:
 * `{ atlas, point, marks, asItIs }`.
 */
export function proposedPointPage(proposal, proposed, { root = '../../../../', states = [], served = [] } = {}) {
  const { atlas, point, marks } = proposed;
  return page({ title: `${point.title} · Proposed change · ${proposal.title}`, root, body: `${proposedStrip(proposal.title, '../', proposed.asItIs ? places(root).point(point.id) : root, root)}
${pointBody(atlas, point, { base: '../', states, marks, served, home: root })}` });
}

/** A Facet as proposed, with what differs marked. `proposed` is what `proposedFacet` returns: `{ atlas, facet, marks, asItIs }`. */
export function proposedFacetPage(proposal, proposed, { root = '../../../../../../../', states = [], served = [] } = {}) {
  const { atlas, facet, marks } = proposed;
  return page({ title: `${facet.title} · Proposed change · ${proposal.title}`, root, body: `${proposedStrip(proposal.title, '../../../../', proposed.asItIs ? places(root).facet(facet.key) : root, root)}
${facetBody(atlas, facet, { base: '../../../../', states, marks, served, home: root })}` });
}

/**
 * The Style as proposed, with what differs marked. `proposed` is what `proposedStyle` returns: `{ atlas, marks }`.
 * The Style has no page in the Atlas as it is, so the way back is home.
 */
export function proposedStylePage(proposal, proposed, { root = '../../../../../' } = {}) {
  const { atlas, marks } = proposed;
  return page({ title: `${atlas.style.title} · Proposed change · ${proposal.title}`, root, body: `${proposedStrip(proposal.title, '../../', root, root)}
${styleBody(atlas, marks)}` });
}

// ── Help ────────────────────────────────────────────────────────────────────────────────────

/** What Help says: the words the Portal uses, how to move around, and the marks. The help page holds it, and Help's dialog takes it from there. */
const HELP = [
  ['The words', [
    ['Atlas', 'This project, explained in a few Trees that rest on its own files and pages: the sources.'],
    ['Tree', 'One account of the project, from one perspective: a top Point, developed by the Points under it. Facets join it to the other Trees.'],
    ['Point', 'One claim: the title states it, the body explains it, and under the body stand what is uncertain and the sources. It sits under the Point it develops.'],
    ['Decision', 'A Point that records a choice and its standing: open, proposed, selected, rejected or superseded. Selected does not mean built.'],
    ['Observation', 'A Point that records what was observed, on a date. It does not say that it still holds.'],
    ['Facet', 'A Tree\'s reading of one of its Points through another Tree: what the other holds that changes how the Point is read. It speaks for its own Tree only.'],
  ]],
  ['Moving around', [
    ['An underlined name', 'goes to its page.'],
    ['A name with ▸', 'opens here; in a margin, under the prose, with its own margin and Close. ▾ marks it open.'],
    ['Next', 'the next Point in reading order.'],
    ['Outline', 'every Tree whole, over the page, your place marked.'],
    ['Search', 'finds Points and Facets by their words; / goes to it.'],
    ['Escape', 'closes what is open, the innermost first.'],
  ]],
  ['The marks', [
    ['new, changed, removed', 'in red, under a proposed change: what it adds, changes or removes. Before holds what a changed part said.'],
    ['stamped', 'under a proposed change: only the stamps differ, the record of each source as the text was checked against it.'],
    ['△ changed since this was checked', 'a source changed since the text was checked against it: a reason to read again, not proof of an error.'],
    ['✗ missing', 'a source is not there; beside a code, what does not validate or cannot be read.'],
    ['○ not checked here', 'a stamp could not be compared with its source where this page is served.'],
    ['↗', 'a link that leaves the Atlas.'],
  ]],
];

/** The help page: what the Portal's words mean, how to move around, and what the marks say. Help's dialog shows its `[data-help]`. */
export function helpPage(model, { root = '../../' } = {}) {
  const atlas = model.atlas;
  return page({ title: `Help · ${atlas?.title ?? 'Atlas'}`, root, body: `${atlas ? strip(atlas.title, root, { help: false }) : bareStrip(root, false)}
<main class="home help">
<h1>Help</h1>
<div data-help>
${HELP.map(([label, terms]) => `<section><h2 class="cap">${label}</h2><dl>${terms.map(([term, words]) => `<dt>${esc(term)}</dt><dd>${esc(words)}</dd>`).join('')}</dl></section>`).join('\n')}
</div>
</main>` });
}

// ── Where there are no pages ────────────────────────────────────────────────────────────────

/** An Atlas that does not validate: its diagnostics instead of pages, under any proposed changes. */
export function diagnosticsPage(model, { root = '', proposals = [], unread = [], timeZone } = {}) {
  return page({ title: 'Atlas', root, body: `${bareStrip(root)}
<main class="home">
<h1>This Atlas does not validate</h1>
${proposalList({ proposals, unread }, root, timeZone)}${diagnosticsList(model.diagnostics)}
</main>` });
}

/** No Atlas at this root: any proposed change saved for it, and the command that prepares an Atlas as one. `stateHome` as for `proposalPage`. */
export function absentPage(model, { root = '', proposals = [], unread = [], timeZone, stateHome = null } = {}) {
  return page({ title: 'Atlas', root, body: `${bareStrip(root)}
<main class="home">
<h1>No Atlas here</h1>
${proposalList({ proposals, unread }, root, timeZone)}<p class="says">This command prepares one in ${esc(model.root)}, as a proposed change to read here and then apply. Its ID, its title and its Style are yours to choose; atlas styles lists the Styles.</p>
<pre class="command">${esc(createCommand(model.root, stateHome))}</pre>
</main>` });
}

/** An address that has no page to show. `words` says what was looked for, or why it could not be read. */
export function missingPage(model, words, { root = '' } = {}) {
  const atlas = model.atlas;
  return page({ title: atlas?.title ?? 'Atlas', root, body: `${atlas ? strip(atlas.title, root) : bareStrip(root)}
<main class="home">
<p class="says">${esc(words)}</p>
</main>` });
}
