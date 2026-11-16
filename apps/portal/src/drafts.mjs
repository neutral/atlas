// A proposed change as the Portal reads it: what differs, what else to read, and each Point and
// Facet as proposed with its differences. This is the only module that reads drafts.
import { listDrafts, loadDraft, inspectChange, applyBlocker } from '../../../library/src/authoring.mjs';
import { reviewImpact } from '../../../library/src/absorb.mjs';
import { present } from './model.mjs';
import { renderBlocks } from './markdown.mjs';

// ── What is read from the Library ───────────────────────────────────────────────────────────
// A saved draft is `{ format, id, revision, updatedAt, plan }`, and its revision changes whenever it
// does. The plan holds the `reason` its author gave, `baseline.identity` (the Atlas it was prepared
// against), `changes: [{ path, before, beforeBase64?, after }]`, and `status`, which is 'invalid' when
// the Atlas as proposed does not validate or the change itself is one the Library refuses (it alters
// the Style together with other files); `validation.diagnostics` then say why. `inspectChange` holds
// the status to the bytes the draft carries. `listDrafts` gives every saved draft that loads, and every draft file that
// does not as `{ file, code, message }`, its name in the store of drafts with the Library's words. `applyBlocker` says
// what stops the next apply of any draft, as the Library's apply gate decides it: `LOCKED` with the `transaction` of an
// interrupted apply that recovery rolls back, a journal or the folder of them that cannot be read, or `INCOMPLETE` when
// the Atlas does not read whole.

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
/** The word of a record or a source that differs only in the stamps of its sources. */
export const STAMPED = 'stamped';

/** The files a draft writes, each 'new', 'changed' or 'removed'. */
const changedFiles = draft => draft.plan.changes.map(change => ({ path: change.path, word: change.after === null ? 'removed' : change.before === null && change.beforeBase64 === undefined ? 'new' : 'changed' }));

/**
 * What a Library view holds at each path: `Map(path -> { kind, id, name })`, `kind` being 'atlas', 'style', 'account',
 * 'point', 'facet' or 'check', `id` its ID (for a Facet its key `<tree>:<id>`) and `name` its title. Empty when the
 * view does not validate.
 */
function holdings(view) {
  const held = new Map(), atlas = view.status === 'ready' ? view.atlas : null;
  if (!atlas) return held;
  held.set('atlas.json', { kind: 'atlas', id: atlas.id, name: atlas.title });
  held.set(atlas.style.path, { kind: 'style', id: null, name: atlas.style.title });
  for (const tree of atlas.trees) held.set(tree.path, { kind: 'account', id: tree.id, name: tree.title });
  for (const point of atlas.points) held.set(point.path, { kind: 'point', id: point.id, name: point.title });
  for (const facet of atlas.facets) held.set(facet.path, { kind: 'facet', id: `${facet.tree}:${facet.id}`, name: facet.title });
  for (const check of atlas.checks) held.set(check.path, { kind: 'check', id: check.id, name: check.title });
  return held;
}

const text = body => renderBlocks(body).map(block => block.html).join('');

/**
 * A Check as a proposed change's page shows it, from its Library records as it was and as proposed (either null):
 * `{ title, path, level, status, html, word, was }`, its text as HTML. `word` is 'new', 'removed', 'changed', or
 * null when only its file differs; `was` is null for a new or a removed one, else `{ title, path, rule, html }`, each
 * the earlier one when it differs and else null, `rule` being `{ level, status }`. `word` overrides the word.
 */
function heldTo(earlier, later, word) {
  const record = later ?? earlier;
  const shown = { title: record.title, path: record.path, level: record.level, status: record.status, html: text(record.body) };
  if (!earlier || !later) return { ...shown, word: word ?? (later ? 'new' : 'removed'), was: null };
  const was = { title: earlier.title === later.title ? null : earlier.title, path: earlier.path === later.path ? null : earlier.path,
    rule: earlier.level === later.level && earlier.status === later.status ? null : { level: earlier.level, status: earlier.status },
    html: earlier.body === later.body ? null : text(earlier.body) };
  return { ...shown, word: Object.values(was).some(value => value !== null) ? 'changed' : null, was };
}

/**
 * The records the Library's review of a change says differ (`reviewImpact`, here of the views `inspectChange`
 * already gave), or null when it has none to say: when the Atlas as proposed does not validate. The review reads the
 * Atlas a change was prepared against even when that one does not validate or holds no Atlas yet.
 *   points    `[{ id, word }]`, word being 'new', 'changed', 'removed', or 'stamped' when only the stamps of its sources differ
 *   facets    `[{ key, word }]`, the same
 *   accounts  Map of the ID of each account that differs to `{ word, parts, was }`: a new one has the word 'new', a
 *             removed one 'removed', one that stays 'changed' with which of its own 'title', 'scope' and 'outline'
 *             differ and `was: { title, scope }`, each the earlier text when it differs, else null
 *   checks    as `heldTo` gives them
 *   style     'new' when there was no Style, 'changed' when its title or text differs, 'file' when only its file does, else null
 *   manifest  the review's `changedManifest`: null when atlas.json is the same, else `{ title?, id?, order?, added, removed }`,
 *             `title`, `id` and `order` (the account IDs in order) each `{ before, after }` when it differs
 *   was       what the records the review names held as it was: `Map(path -> { kind, id, name })`, as `holdings` gives it
 */
function changedRecords(views) {
  const review = reviewImpact(views.before, views.after);
  if (review.status !== 'ready') return null;
  const word = entry => !entry.before ? 'new' : !entry.after ? 'removed' : 'changed';
  // A claim or view whose sources differ only in their stamps says what it said: it is stamped, not changed.
  const unstamped = record => ({ ...record, sources: (record.sources ?? []).map(({ sha256: _, ...source }) => source) });
  const told = entry => entry.before && entry.after && same(unstamped(entry.before), unstamped(entry.after)) ? 'stamped' : word(entry);
  const held = entry => entry.after ?? entry.before;
  const parts = ({ before, after }) => [['title', before.title !== after.title], ['scope', before.scope !== after.scope], ['outline', before.base !== after.base || !same(before.children, after.children)]]
    .filter(([, differs]) => differs).map(([part]) => part);
  const account = entry => entry.before && entry.after ? { word: 'changed', parts: parts(entry),
    was: { title: entry.before.title === entry.after.title ? null : entry.before.title, scope: entry.before.scope === entry.after.scope ? null : entry.before.scope } } : { word: word(entry), parts: [], was: null };
  const style = review.changedStyle;
  const earlier = (entries, kind, id = entry => entry.id) => entries.filter(entry => entry.before).map(entry => [entry.before.path, { kind, id: id(entry), name: entry.before.title }]);
  return {
    points: review.changedPoints.map(entry => ({ id: entry.id, word: told(entry) })),
    facets: review.changedFacets.map(entry => ({ key: `${held(entry).tree}:${held(entry).id}`, word: told(entry) })),
    accounts: new Map(review.changedTrees.map(entry => [entry.id, account(entry)])),
    checks: review.changedChecks.map(entry => heldTo(entry.before, entry.after)),
    style: !style ? null : !style.before ? 'new' : style.before.title !== style.after.title || style.before.body !== style.after.body ? 'changed' : 'file',
    manifest: review.changedManifest,
    was: new Map([...earlier(review.changedPoints, 'point'), ...earlier(review.changedFacets, 'facet', entry => `${entry.before.tree}:${entry.before.id}`),
      ...earlier(review.changedTrees, 'account'), ...earlier(review.changedChecks, 'check')]),
  };
}

/**
 * What a proposed change alters, told so that every file it writes is named on its page: by the record the file
 * holds as proposed or as it was, and by its path where neither side holds one there. `after` and `earlier` are
 * the presented Atlases (`earlier` null when the Atlas it was prepared against does not validate, or there was none).
 * The Library's review says what differs, read against that Atlas whether it validates or not; a record it removes
 * from one that cannot be presented has no page to draw it on, so its file is named instead, with what it was called.
 *   words     `{ points: Map(id, word), facets: Map(key, word) }`
 *   only      `{ points: Set, facets: Set }`: records whose file it rewrites while nothing in them differs
 *   own       Map of account ID to `{ word, parts, was }`: what differs of an account itself, as `changedRecords` gives
 *             it; `parts` holds 'file' when only its file does
 *   style     'changed', 'new', 'file' (only its file differs) or null
 *   checks    as `heldTo` gives them
 *   itself    null, or what differs of the Atlas itself: `{ word, parts, title, id, order, was: { title, id } }`;
 *             `parts` is a subset of 'title', 'id', 'accounts', 'order' and 'file', in that order; `order` the titles
 *             of its accounts as proposed when their order differs, else null
 *   files     `[{ path, word, name }]`: the files no record named elsewhere stands for; `name` is what the Atlas as it
 *             was called the record there, or null
 *   differs   how many Points differ in what they say; stamped: `{ claims, views }`, how many Points and Facets differ
 *             only in the stamps of their sources; stampsOnly: whether stamping them is all the change does
 */
function tell(views, after, earlier, files) {
  const words = { points: new Map(), facets: new Map() }, only = { points: new Set(), facets: new Set() }, own = new Map();
  const records = changedRecords(views), proposed = holdings(views.after), was = records?.was ?? new Map();
  let style = null, checks = [], itself = null;
  const atlasItself = (word, parts, manifest = null) => ({ word, parts, title: after.title, id: after.id,
    order: manifest?.order ? [...after.accounts.values()].map(account => account.title) : null, was: { title: manifest?.title?.before ?? null, id: manifest?.id?.before ?? null } });
  if (records) {
    for (const point of records.points) if (earlier || point.word !== 'removed') words.points.set(point.id, point.word);
    for (const facet of records.facets) if (earlier || facet.word !== 'removed') words.facets.set(facet.key, facet.word);
    // An account that comes or goes is told from the Atlas it was prepared against when that one can be presented.
    for (const [id, account] of records.accounts) if (account.word === 'changed' ? account.parts.length : !earlier && account.word === 'new') own.set(id, account);
    ({ checks, style } = records);
    const manifest = records.manifest;
    const parts = !manifest ? [] : [['title', manifest.title], ['id', manifest.id], ['accounts', manifest.added.length || manifest.removed.length], ['order', manifest.order]].filter(([, differs]) => differs).map(([part]) => part);
    if (files.some(file => file.path === 'atlas.json' && file.word === 'new')) itself = atlasItself('new', []);
    else if (manifest) itself = parts.length ? atlasItself('changed', parts, manifest) : atlasItself(null, ['file']);
  }
  const unnamed = [];
  for (const file of files) {
    const now = proposed.get(file.path), held = now ?? was.get(file.path);
    if (!held || !records) unnamed.push({ ...file, name: held?.name ?? null });
    else if (!now && !earlier && held.kind !== 'check') unnamed.push({ ...file, name: held.name });
    else {
      // The review compares records, so a file it rewrites while its record stays the same is named here.
      if (held.kind === 'point' && !words.points.has(held.id)) only.points.add(held.id);
      if (held.kind === 'facet' && !words.facets.has(held.id)) only.facets.add(held.id);
      if (held.kind === 'account' && !own.has(held.id) && after.accounts.has(held.id) && records.accounts.get(held.id)?.word !== 'new') own.set(held.id, { word: null, parts: ['file'], was: null });
    }
  }
  const stampedIn = map => [...map.values()].filter(word => word === STAMPED).length;
  const stamped = { claims: stampedIn(words.points), views: stampedIn(words.facets) };
  // A change that only stamps writes nothing but the files of the Points and Facets it stamps.
  const stampsOnly = stamped.claims + stamped.views > 0 && stamped.claims + stamped.views === files.length;
  return { words, only, own, style, checks, itself, files: unnamed, differs: records ? records.points.filter(point => point.word !== STAMPED).length : files.filter(file => /\/points\/.+\.md$/.test(file.path)).length, stamped, stampsOnly };
}

// ── What differs between two texts ──────────────────────────────────────────────────────────

const wordsOf = text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** How alike two blocks are, from 0 to 1: the share of their words they hold in common. */
function likeness(left, right) {
  const counts = new Map();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const unmatched = counts.get(word);
    if (unmatched) { shared++; counts.set(word, unmatched - 1); }
  }
  return left.length + right.length ? 2 * shared / (left.length + right.length) : 0;
}

/**
 * The block-level difference of two Markdown texts, each given as its blocks `{ source, html }`.
 * Returns the blocks as proposed, with the removed ones where they stood:
 *   { html, word: null, before: null }       unchanged
 *   { html, word: 'new', before: null }      added
 *   { html, word: 'removed', before: null }  removed; `html` is the earlier block
 *   { html, word: null, before: html }       changed; `before` is the earlier block
 * A block counts as changed, not removed and added, when at least half its words stayed.
 */
export function blockDifference(before, after) {
  const earlier = before.map(block => wordsOf(block.source)), later = after.map(block => wordsOf(block.source));
  const rows = before.length, columns = after.length, SAME = 1000;
  const pairing = (row, column) => {
    if (before[row].source === after[column].source) return SAME;
    const alike = likeness(earlier[row], later[column]);
    return alike >= 0.5 ? alike : 0;
  };
  const gain = Array.from({ length: rows }, () => new Float64Array(columns));
  const best = Array.from({ length: rows + 1 }, () => new Float64Array(columns + 1));
  for (let row = rows - 1; row >= 0; row--) for (let column = columns - 1; column >= 0; column--) {
    gain[row][column] = pairing(row, column);
    best[row][column] = Math.max(best[row + 1][column], best[row][column + 1], gain[row][column] ? gain[row][column] + best[row + 1][column + 1] : 0);
  }
  const blocks = [];
  for (let row = 0, column = 0; row < rows || column < columns;) {
    if (row < rows && column < columns && gain[row][column] && best[row][column] === gain[row][column] + best[row + 1][column + 1]) {
      blocks.push({ html: after[column].html, word: null, before: gain[row][column] === SAME ? null : before[row].html });
      row++; column++;
    } else if (row < rows && (column === columns || best[row][column] === best[row + 1][column])) blocks.push({ html: before[row++].html, word: 'removed', before: null });
    else blocks.push({ html: after[column++].html, word: 'new', before: null });
  }
  return blocks;
}

/** How a single value differs: null when it does not, else `{ word, before }`. */
function valueMark(was, now) {
  if (same(was, now)) return null;
  return was === null ? { word: 'new', before: null } : now === null ? { word: 'removed', before: was } : { word: 'changed', before: was };
}

/**
 * The sources as proposed with the removed ones after them, each `{ source, word, before }`; null when none differs. A
 * source whose stamp alone differs is 'stamped'.
 */
function sourceMarks(before, after) {
  const cited = source => [source.uri, source.title, source.role, source.locator, source.stamp];
  const shown = source => [source.title, source.shown, source.locator, source.role];
  const left = [...before], marks = after.map(source => ({ source, word: 'new', before: null }));
  for (const mark of marks) {
    const exact = left.findIndex(old => same(cited(old), cited(mark.source)));
    if (exact >= 0) { left.splice(exact, 1); mark.word = null; }
  }
  for (const mark of marks) {
    const earlier = mark.word ? left.findIndex(old => old.uri === mark.source.uri) : -1;
    if (earlier >= 0) { const [old] = left.splice(earlier, 1); const alike = same(shown(old), shown(mark.source)); mark.word = alike ? STAMPED : 'changed'; mark.before = alike ? null : old; }
  }
  marks.push(...left.map(source => ({ source, word: 'removed', before: null })));
  return marks.some(mark => mark.word) ? marks : null;
}

// ── A proposed change ───────────────────────────────────────────────────────────────────────

const kept = new Map();

/** Everything about one saved draft that does not depend on the Atlas as it is now. Kept per revision. */
async function read(root, id, revision) {
  const key = `${root}\0${id}`;
  if (kept.get(key)?.revision === revision) return kept.get(key);
  const draft = await loadDraft(root, id);
  const views = inspectChange(draft.plan);
  const model = present(views.after), before = present(views.before);
  const after = model.atlas, earlier = before.atlas, files = changedFiles(draft);
  // When the Atlas as proposed does not validate, nothing in it can be read: each file is named by its path, and by what the Atlas as it was calls it.
  const told = after ? tell(views, after, earlier, files) : { words: { points: new Map(), facets: new Map() }, style: null, checks: [], itself: null,
    files: files.map(file => ({ ...file, name: holdings(views.before).get(file.path)?.name ?? null })), differs: files.filter(file => /\/points\/.+\.md$/.test(file.path)).length, stamped: { claims: 0, views: 0 }, stampsOnly: false };
  const words = told.words;
  const proposal = {
    id, revision: draft.revision, reason: draft.plan.reason, preparedAt: draft.updatedAt, baseline: draft.plan.baseline.identity,
    root: model.root, title: after?.title ?? earlier?.title ?? 'Atlas', invalid: draft.plan.status === 'invalid',
    // The diagnostics of the Atlas as proposed are read again from its bytes; a change refused for itself carries its own.
    diagnostics: after ? draft.plan.validation.diagnostics.map(({ code, path, message }) => ({ code, path, message })) : model.diagnostics,
    model, before, words, style: told.style, checks: told.checks, itself: told.itself, files: told.files, differs: told.differs, stamped: told.stamped, stampsOnly: told.stampsOnly,
    accounts: after ? byAccount(after, earlier, words, told.own, told.only) : [],
    ...(after ? alsoRead(after, earlier, words) : { above: [], drawing: [] }),
  };
  kept.delete(key);
  kept.set(key, proposal);
  if (kept.size > 8) kept.delete(kept.keys().next().value);
  return proposal;
}

/**
 * What differs, by account: the accounts as proposed, then any the proposal removes. `own` says what differs of an
 * account itself; `only` names the records whose file alone differs, which are listed with the word null.
 */
function byAccount(after, earlier, words, own, only) {
  const entries = new Map();
  const entry = (atlas, id) => entries.get(id) ?? entries.set(id, { id, title: atlas.accounts.get(id).title, scope: atlas.accounts.get(id).scope, word: null, parts: [], was: { title: null, scope: null }, points: [], facets: [] }).get(id);
  const seenFrom = (atlas, facet) => `Facet, seen from ${atlas.accounts.get(facet.via)?.title ?? facet.via}`;
  for (const account of after.accounts.values()) {
    const itself = own.get(account.id);
    if (earlier && !earlier.accounts.has(account.id)) entry(after, account.id).word = 'new';
    else if (itself) Object.assign(entry(after, account.id), { word: itself.word, parts: itself.parts, was: itself.was ?? { title: null, scope: null } });
    for (const id of account.order) if (words.points.has(id) || only.points.has(id)) entry(after, account.id).points.push({ id, title: after.points.get(id).title, word: words.points.get(id) ?? null });
  }
  for (const account of earlier?.accounts.values() ?? []) {
    const stays = after.accounts.has(account.id);
    if (!stays) entry(earlier, account.id).word = 'removed';
    for (const id of account.order) if (words.points.get(id) === 'removed') entry(stays ? after : earlier, account.id).points.push({ id, title: earlier.points.get(id).title, word: 'removed' });
  }
  for (const facet of after.facets.values()) if (words.facets.has(facet.key) || only.facets.has(facet.key)) entry(after, facet.account).facets.push({ key: facet.key, title: facet.title, word: words.facets.get(facet.key) ?? null, label: seenFrom(after, facet) });
  for (const facet of earlier?.facets.values() ?? []) if (words.facets.get(facet.key) === 'removed') entry(after.accounts.has(facet.account) ? after : earlier, facet.account).facets.push({ key: facet.key, title: facet.title, word: 'removed', label: seenFrom(earlier, facet) });
  return [...after.accounts.keys(), ...[...earlier?.accounts.keys() ?? []].filter(id => !after.accounts.has(id))].filter(id => entries.has(id)).map(id => entries.get(id));
}

/** What else to read because of it: the claims above what differs, and the Facets that draw on it. Neither list repeats what differs itself. */
function alsoRead(after, earlier, words) {
  const above = new Set(), drawing = new Set();
  // A stamp changes nothing a claim says, so nothing around a stamped claim needs reading again because of it.
  const differs = (map, key) => map.has(key) && map.get(key) !== STAMPED;
  for (const [id, word] of words.points) {
    if (word === STAMPED) continue;
    const point = word === 'removed' ? earlier.points.get(id) : after.points.get(id);
    for (const claim of point.above) if (after.points.has(claim) && !differs(words.points, claim)) above.add(claim);
    if (word !== 'removed') for (const key of point.incoming) if (!differs(words.facets, key)) drawing.add(key);
  }
  return { above: [...after.points.keys()].filter(id => above.has(id)), drawing: [...after.facets.keys()].filter(key => drawing.has(key)) };
}

/**
 * What stops the next apply of any draft at `root`, as the Library's own apply gate decides it (`applyBlocker`): null,
 * or `{ code, message, transaction? }`. When that cannot be told, no draft is shown ready either: the Library's words
 * for why are the blocker, with `code` null. It is read once for each page.
 */
async function blockerOf(root) {
  try { return await applyBlocker(root); } catch (error) { return { code: null, message: error.message }; }
}

/**
 * How a proposed change stands against the Atlas as it is (`live`, a presented model), `blocker` being what `blockerOf`
 * says: 'invalid', 'blocked', 'stale' or 'ready', the first that holds.
 */
const standingOf = (proposal, live, blocker) => proposal.invalid ? 'invalid' : blocker ? 'blocked' : proposal.baseline === live.identity ? 'ready' : 'stale';

/**
 * The proposed changes saved for the Atlas at `root`, the latest first, each with how it stands against the Atlas as it
 * is (`live`, a presented model), and what stood in the way of reading them:
 * `{ proposals: [{ id, reason, preparedAt, standing, creates, differs, stamped, stampsOnly }], unread }`. `standing` is as
 * `openProposal` gives it; `creates` is true when the Atlas it was prepared against held no Atlas. `unread` is
 * `[{ file, message }]`, by file name: each draft that could not be read, by its file in the store of drafts and the
 * Library's words, whether the Library could not load it or its change could not be read; or, when the store of drafts
 * as a whole could not be read, that alone, with `file` null. A draft that could not be read is left out of `proposals`.
 */
export async function listProposals(root, live) {
  const proposals = [], unread = [];
  let saved = [];
  try {
    const listed = await listDrafts(root);
    saved = listed.drafts;
    unread.push(...listed.unreadable.map(({ file, message }) => ({ file, message })));
  } catch (error) { unread.push({ file: null, message: error.message }); }
  for (const { id, revision } of saved) {
    try { proposals.push(await read(root, id, revision)); } catch (error) { unread.push({ file: `${id}.json`, message: error.message }); }
  }
  unread.sort((left, right) => (left.file ?? '') < (right.file ?? '') ? -1 : (left.file ?? '') > (right.file ?? '') ? 1 : 0);
  const blocker = proposals.length > 0 ? await blockerOf(root) : null;
  return { unread, proposals: proposals.map(proposal => ({ id: proposal.id, reason: proposal.reason, preparedAt: proposal.preparedAt, standing: standingOf(proposal, live, blocker),
    creates: proposal.before.status === 'absent', differs: proposal.differs, stamped: proposal.stamped, stampsOnly: proposal.stampsOnly }))
    .sort((left, right) => left.preparedAt < right.preparedAt ? 1 : left.preparedAt > right.preparedAt ? -1 : 0) };
}

/**
 * One proposed change, read against the Atlas as it is (`live`, a presented model). Null when no draft has this ID;
 * it throws, with the Library's words, when the draft or the store of drafts cannot be read.
 *
 * Returns `{ id, revision, reason, preparedAt, baseline, standing, blocker, invalid, root, title, diagnostics, model,
 * before, live, words, style, checks, itself, files, differs, accounts, above, drawing }`. Every file the change
 * writes is named by one of `itself`, `accounts`, `style`, `checks` and `files`.
 *   baseline     the identity of the Atlas it was prepared against
 *   standing     'ready', 'invalid' (the Atlas as proposed does not validate, or the change alters the Style
 *                together with other files; `diagnostics` say why), 'blocked' (the Library applies no draft of this
 *                Atlas now: `blocker` says why) or 'stale' (the Atlas has changed since it was prepared), the first
 *                that holds in that order; `invalid` is true for the second, whatever the Atlas is now
 *   blocker      null, or what stops the next apply of any draft, as `applyBlocker` gives it: `{ code, message,
 *                transaction? }`, `code` null when even that could not be told
 *   model        the Atlas as proposed, presented; its `atlas` is null when it does not validate
 *   before       the Atlas it was prepared against, presented; its `atlas` is null when it does not validate, and a
 *                Point or Facet that differs then has no earlier text to show
 *   words        `{ points: Map(id, word), facets: Map(key, word) }`, word being 'new', 'changed', 'removed' or 'stamped'
 *   style        'new' when the Atlas it was prepared against held no Style, 'changed' when the Style's title or text
 *                differs, 'file' when only its file does, else null
 *   checks       the Checks that differ: `[{ title, path, level, status, html, word, was }]`, each with its text as
 *                proposed (as it was, for a removed one); `word` is null when only its file differs, and `was` holds
 *                the earlier title, path, `rule: { level, status }` and text where each differs
 *   itself       null, or what differs of the Atlas itself when it writes atlas.json: `{ word, parts, title, id, order,
 *                was: { title, id } }`; `parts` is a subset of 'title', 'id', 'accounts' (which accounts it holds),
 *                'order' and 'file' (only its file differs); `order` the titles of its accounts as proposed when their
 *                order differs; `was` the earlier title and ID where each differs
 *   files        `[{ path, word, name }]`, the files no record named elsewhere stands for: every file when the Atlas as
 *                proposed does not validate, and what it removes from an Atlas that does not validate; `name` is what the
 *                Atlas as it was calls the record there, or null
 *   differs      how many Points differ in what they say; stamped: `{ claims, views }`, how many Points and Facets
 *                differ only in the stamps of their sources; stampsOnly: whether stamping them is all the change does
 *   accounts     what differs by account: `[{ id, title, scope, word, parts, was, points: [{ id, title, word }],
 *                facets: [{ key, title, word, label }] }]`. An account that stays and differs in itself has the
 *                word 'changed', `parts` (which of 'title', 'scope' and 'outline' differ, in that order) and
 *                `was: { title, scope }`, each the earlier text when it differs, else null; one whose file alone
 *                differs has the word null and `parts` ['file']. A Point or Facet whose file alone differs has the word null
 *   above        IDs of the claims above what differs; drawing: keys of the Facets that draw on it
 */
export async function openProposal(root, id, live) {
  const { drafts, unreadable } = await listDrafts(root);
  const saved = drafts.find(draft => draft.id === id);
  if (!saved) {
    const failed = unreadable.find(item => item.file === `${id}.json`);
    if (failed) throw Object.assign(new Error(failed.message), { code: failed.code });
    return null;
  }
  const proposal = await read(root, id, saved.revision);
  const blocker = await blockerOf(root);
  return { ...proposal, live, blocker, standing: standingOf(proposal, live, blocker) };
}

/** The marks of a record nothing is yet known to differ in: its own word, and the words and names of everything around it. */
const unmarked = (word, proposal) => ({ word, title: null, standing: null, place: null, blocks: null, uncertainty: null, sources: null, words: proposal.words, proposed: proposal.model.atlas, gone: { beneath: [], beside: [], facets: [] } });
const struck = blocks => blocks.map(block => ({ html: block.html, word: 'removed', before: null }));

/**
 * One Point as proposed, with what differs from the Atlas the proposal was prepared against.
 * Null when the proposal neither holds nor removes a Point with this ID.
 *
 * Returns `{ atlas, point, marks, asItIs }`: the Atlas and Point to draw (the earlier ones for a
 * Point the proposal removes), whether the Atlas as it is holds this Point, and `marks`:
 *   word          the Point's own word ('new', 'changed', 'removed' or 'stamped'), or null
 *   title         the earlier title, when it differs
 *   standing      `{ word, before }` when its standing differs
 *   place         when it moved, `{ account, claims }`: the title of the account it stood in before, and the claims
 *                 that stood above it there as `{ id, title, word }`, each as the proposal has it
 *   blocks        the prose as `blockDifference` gives it, or null when the prose is the same
 *   uncertainty   `{ word, before }` when it differs
 *   sources       `[{ source, word, before }]` when any differs
 *   words         the proposal's `{ points, facets }`, for the names around it
 *   proposed      the Atlas as proposed: a claim named beside a record the proposal removes reads as proposed
 *   gone          what the proposal removes around it: `{ beneath, beside, facets }`, the Points that
 *                 developed it and those that stood beside it as `{ id, title }`, and the Facets said
 *                 of it as `{ key, title, label }`
 */
export function proposedPoint(proposal, id) {
  const after = proposal.model.atlas, earlier = proposal.before.atlas, words = proposal.words;
  const word = words.points.get(id) ?? null, asItIs = Boolean(proposal.live.atlas?.points.has(id)), marks = unmarked(word, proposal);
  if (word === 'removed') {
    const was = earlier.points.get(id);
    return { atlas: earlier, asItIs, point: { ...was, uncertainty: null, sources: [], next: null, attached: [], incoming: [], linksTo: [], linkedFrom: [] }, marks: { ...marks, blocks: struck(was.blocks) } };
  }
  const point = after?.points.get(id);
  if (!point) return null;
  const was = word === 'changed' || word === STAMPED ? earlier?.points.get(id) : null;
  if (was) {
    if (was.title !== point.title) marks.title = was.title;
    marks.standing = valueMark(was.standing, point.standing);
    if (was.account !== point.account || !same(was.above, point.above)) marks.place = { account: earlier.accounts.get(was.account).title,
      claims: was.above.map(claim => ({ id: claim, title: (after.points.get(claim) ?? earlier.points.get(claim)).title, word: words.points.get(claim) ?? null })) };
    if (was.body !== point.body) marks.blocks = blockDifference(was.blocks, point.blocks);
    marks.uncertainty = valueMark(was.uncertainty, point.uncertainty);
    marks.sources = sourceMarks(was.sources, point.sources);
  }
  const removedUnder = parent => [...words.points].filter(([gone, goneWord]) => goneWord === 'removed' && earlier.points.get(gone).parent === parent).map(([gone]) => ({ id: gone, title: earlier.points.get(gone).title }));
  marks.gone.beneath = removedUnder(id);
  if (point.parent !== null) marks.gone.beside = removedUnder(point.parent);
  marks.gone.facets = [...words.facets].filter(([key, facetWord]) => facetWord === 'removed' && earlier.facets.get(key).on === id)
    .map(([key]) => ({ key, title: earlier.facets.get(key).title, label: `Facets seen from ${earlier.accounts.get(earlier.facets.get(key).via)?.title ?? earlier.facets.get(key).via}` }));
  return { atlas: after, point, marks, asItIs };
}

/**
 * One Facet as proposed, by its key, with what differs from the Atlas the proposal was prepared
 * against. Null when the proposal neither holds nor removes it. Returns `{ atlas, facet, marks, asItIs }`;
 * `marks` is as for a Point, of which a Facet has `word`, `title`, `blocks`, `uncertainty`, `sources`, `words` and `proposed`.
 */
export function proposedFacet(proposal, key) {
  const after = proposal.model.atlas, earlier = proposal.before.atlas, words = proposal.words;
  const word = words.facets.get(key) ?? null, asItIs = Boolean(proposal.live.atlas?.facets.has(key)), marks = unmarked(word, proposal);
  if (word === 'removed') {
    const was = earlier.facets.get(key);
    return { atlas: earlier, asItIs, facet: { ...was, uncertainty: null, sources: [] }, marks: { ...marks, blocks: struck(was.blocks) } };
  }
  const facet = after?.facets.get(key);
  if (!facet) return null;
  const was = word === 'changed' || word === STAMPED ? earlier?.facets.get(key) : null;
  if (was) {
    if (was.title !== facet.title) marks.title = was.title;
    if (was.body !== facet.body) marks.blocks = blockDifference(was.blocks, facet.blocks);
    marks.uncertainty = valueMark(was.uncertainty, facet.uncertainty);
    marks.sources = sourceMarks(was.sources, facet.sources);
  }
  return { atlas: after, facet, marks, asItIs };
}

/**
 * The Style as proposed, with what differs from the Atlas the proposal was prepared against.
 * Returns `{ atlas, marks }`; of `marks` the Style has `word`, `title` and `blocks`.
 */
export function proposedStyle(proposal) {
  const after = proposal.model.atlas, was = proposal.style === 'changed' ? proposal.before.atlas?.style : null;
  const marks = unmarked(proposal.style === 'file' ? null : proposal.style, proposal);
  if (was) {
    if (was.title !== after.style.title) marks.title = was.title;
    if (was.body !== after.style.body) marks.blocks = blockDifference(was.blocks, after.style.blocks);
  }
  return { atlas: after, marks };
}
