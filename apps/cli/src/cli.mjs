#!/usr/bin/env node
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from '../../../library/src/frontmatter.mjs';
import { openAtlas, readSource } from '../../../library/src/model.mjs';
import { prepareInitialization, prepareChangeFromDisk, prepareFromCandidate, applyDraft, recoverChange, listTransactions, saveDraft, loadDraft, listDrafts, deleteDraft, writeCandidate } from '../../../library/src/authoring.mjs';
import { listStyles, getStyle } from '../../../library/src/styles.mjs';
import { summarizeAtlas, summarizeDraft, readJsonChunk } from '../../../library/src/inventory.mjs';
import { route } from '../../../library/src/route.mjs';
import { inspectAbsorb } from '../../../library/src/absorb.mjs';
import { prepareMove, prepareStamp } from '../../../library/src/references.mjs';
import { resolveState, stateHome, checkStateLocation } from '../../../library/src/state.mjs';
import { readGuide, GUIDE_DOCUMENTS, CANDIDATE, candidateDirectory, validateCandidate, inspectRecord, outline, references, search, stale } from '../../agent/src/tools.mjs';
import { savedDraft, reviewDraft, stampReport } from '../../agent/src/drafts.mjs';
import { discoverProject, chooseAtlas, verifySelection, launchBrowser } from './project.mjs';

// A reader that stops reading, such as head or a closed pipe, ends the command quietly: nothing more can be said to it.
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') throw error; process.exit(); });

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const usage = 'atlas open [PROJECT]; atlas locate [PROJECT]; atlas config [PROJECT]; atlas guide [DOCUMENT]; atlas styles; atlas --root PATH [--allow-source-root PATH]... [--state-home PATH] COMMAND; atlas help [COMMAND]; atlas COMMAND --help. INPUT is the path of a JSON file, or - to read the JSON from standard input.';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = (message) => fail('CLI_INVALID_ARGUMENT', message);
const GRANT_LIMIT = 'At most 100 distinct source roots, including the Atlas root, may be granted.';
/**
 * The commands that keep or read private state, or read sources (a source read leaves private state out, so it needs
 * the state location too), and validate with --from. A state location the Library refuses is refused at launch, before
 * any of them reads anything, so that no source read reports every source unread for it.
 */
const STATEFUL = ['open', 'config', 'state', 'read-source', 'stale', 'init', 'candidate', 'prepare', 'review', 'apply', 'drafts', 'recover', 'move', 'stamp', 'export'];
/** What the root itself gives when it is not there or not a directory: the command then meets it as it always does. */
const ROOT_PROBLEMS = ['ENOENT', 'ENOTDIR', 'UNSAFE_PATH'];
/** The state location of `root` as the Library decides it can be used, creating nothing; see STATEFUL. */
async function usableState(root) {
  stateHome();
  try { await checkStateLocation(root); } catch (error) { if (!ROOT_PROBLEMS.includes(error.code)) throw error; }
}
const emit = (value, stream = process.stdout) => stream.write(`${JSON.stringify(value, null, 2)}\n`);

const ROOT = 'atlas --root PATH';
const GRANTED = 'atlas --root PATH [--allow-source-root PATH]...';
const SAVED = 'atlas.draft/1: id, revision, updatedAt, plan (format, status "ready", "invalid" or "noop", reason, baseline.identity, validation with status, identity and diagnostics, changes as { path, action "write" or "remove", bytes }), bounds (changes, validation; at most 100 of each are listed). Exit 1 when the plan is invalid. Read the draft with review ID, then apply ID --revision REVISION.';
const PAGE = { limit: '1 to 100, default 50: entries per list.', offset: '0 to 100000, default 0.' };
const CHUNK = { full: 'true: the complete result, as --full.', part: '"details": the complete result as exact JSON text in chunks.', maxBytes: 'With part: 4 to 131072 bytes per chunk, default 65536.', expectedSha256: 'With part: the sha256 of the text being continued; a changed text gives STALE_REPORT.' };
const HELP = {
  open: {
    usage: ['atlas open [PROJECT] [--atlas PATH] [--port N] [--no-browser] [--allow-source-root PATH]... [--state-home PATH]', `${GRANTED} [--state-home PATH] open [--port N] [--no-browser]`],
    does: 'Serves the Portal for one Atlas on 127.0.0.1 and asks the system to open it in a browser. The Portal only reads; it shows each saved draft as a proposed change. The first form finds the Atlas of a project: --atlas, then atlas.workspace.json, then discovery. PROJECT defaults to the working directory, and the project directory is granted for reading cited sources. The second form serves the Atlas at --root without discovery. A directory that holds no Atlas is served too: the Portal then names the command that creates one. Ctrl+C, SIGINT or SIGTERM stops the service.',
    options: { '--atlas PATH': 'First form: the project-relative directory of the Atlas, or . for the project itself.', '--port N': 'The port to listen on, 0 to 65535. Default 0: a free port.', '--no-browser': 'Print the address without asking for a browser.', '--allow-source-root PATH': 'Also read cited local sources under PATH. Repeatable.', '--state-home PATH': 'Read drafts under PATH instead of the user state directory.' },
    prints: 'atlas.server/1: status "serving", url, browser ("requested", "unavailable" or "not-requested"), shutdown. The first form adds project, atlasPath and create (true when the selected directory holds no atlas.json). The command then keeps running.',
  },
  locate: {
    usage: ['atlas locate [PROJECT] [--atlas PATH]'],
    does: 'Reports which Atlas a project selects, and how: by --atlas, by the project\'s atlas.workspace.json, or by searching the project for atlas.json files. It is the selection open and config make, without serving anything or reading the Atlas. Writes nothing.',
    options: { '--atlas PATH': 'The project-relative directory of the Atlas, or . for the project itself.' },
    prints: 'atlas.project/1: project, source ("explicit", "workspace" or "discovery": how the Atlas was selected), candidates as { path, root }, and visited after a discovery.',
  },
  validate: {
    usage: [`${ROOT} validate`, `${GRANTED} validate --from DIR`],
    does: `Reads the Atlas and says whether it is valid. With --from, says what prepare --from DIR would report of that candidate, and saves nothing: the candidate's own diagnostics and those of the change (a change that alters a valid style.md together with another file is invalid), the files that differ from the Atlas, and the files left out. It also reports what would otherwise surface only after the candidate is applied, without making it invalid: the link diagnostics review reports, and every local source reference whose file does not exist or whose fragment names no heading, with the record that cites it. Sources are read within the grants. A candidate that prepare would refuse is refused the same way.`,
    options: { '--from DIR': `The candidate directory: ${CANDIDATE} (relative to the Atlas root, as candidate writes it) or any other path.` },
    prints: 'atlas.validation/1: status ("ready", "invalid" or "incomplete"), identity, diagnostics as { code, path, message }. With --from it adds candidate (the absolute path), changes as { path, action "write" or "remove" }, ignored (files of the candidate that are not Atlas records and are absent from the Atlas or differ from its own), linkDiagnostics as { code, path, line, column, message }, missingSources as { from, sourceIndex, uri, code, reason } (code SOURCE_HEADING_MISSING when the file is there and the fragment names no heading in it), unreadSources (how many source references were not read: local ones outside the grants or unreadable, and every one past the 10000 references one stale report reads), bounds (linkDiagnostics and missingSources, at most 100 of each listed) and limits. Exit 1 unless ready; link diagnostics and missing sources leave it ready.',
  },
  outline: {
    usage: [`${ROOT} outline [TREE]`],
    does: 'Prints every Tree, or the Tree TREE names, with its title, its scope and its outline: one line for each Point, the Base first and each Point two spaces deeper than the Point it develops, giving the Point\'s ID, its title and, for a decision or an observation, its standing. It holds no explanation: choose a Point from it, then read that Point with route or inspect point ID.',
    prints: 'atlas.outline/1: status ("ready", "missing" when no Tree has the ID TREE, or "unavailable" when the Atlas is not valid), identity, tree when TREE was given, trees as { id, title, scope, outline } (empty, and ready, for an Atlas that has no Tree), and diagnostics. Each line of outline is "ID: title", followed by " [decision: STATUS]" or " [observation: DATE]" for a typed Point. Exit 1 unless ready.',
  },
  inspect: {
    usage: [`${ROOT} inspect [INPUT | --full]`, `${ROOT} inspect point ID`, `${ROOT} inspect tree ID`, `${ROOT} inspect facet TREE_ID FACET_ID`, `${ROOT} inspect style`, `${ROOT} inspect checks`],
    does: 'Without a record, prints a bounded summary of the Atlas: its identity, its diagnostics, and its files, Trees, Points, Facets and Checks without their text. With a record, prints that record whole: a Point with its owning Tree, the Points above it, the Facets attached to it, the Facets of other Trees that target it and its sources; a Tree with its Points and Facets; a Facet with its host, the Tree it reads through and its targets; the Style; or every Check with its complete text.',
    input: { ...PAGE, section: 'files, trees, points, facets, checks or diagnostics: list only this section.', expectedIdentity: 'The identity a continuation belongs to; a changed Atlas gives STALE.', full: 'true: the whole captured view with every file, as --full.' },
    prints: 'Summary: atlas.view/1 with status, root, identity, files, diagnostics, atlas (format, id, title, style, trees, points, facets, checks) and bounds; each section of bounds has available, returned, offset and next, and a next value is the INPUT that continues that section. Record: atlas.inspection/1 with status ("ready", "missing" or "unavailable"), identity, kind, record, diagnostics; for checks, records and limits in place of record. Exit 1 unless ready.',
  },
  search: {
    usage: [`${ROOT} search INPUT`],
    does: 'Finds Points and Facets whose ID, title, explanation or uncertainty contain the words of a query, ranked lexically. A match is a candidate, not an answer, and no match is not proof that the Atlas says nothing. Source bodies are not searched.',
    input: { query: 'Required: 1 to 4096 characters.', kinds: '["point"], ["facet"] or both. Default both.', tree: 'Only records of this Tree.', type: 'decision, observation or untyped: only Points of this Type.', limit: '1 to 100, default 20.', offset: '0 to 100000, default 0.', presentation: 'summary (default: an excerpt and a selector) or full (complete records).' },
    prints: 'atlas.search/1: status ("ready" or "unavailable"), identity, request, results, bounds (offset, limit, available: how many records matched in all, returned), next (the INPUT of the next page, or null when none was left out), diagnostics. Each result has score, matches and reason, and a decision its status and an observation its date; a summary has selector, which is the INPUT that reads it through route.',
  },
  route: {
    usage: [`${ROOT} route INPUT`],
    does: 'Suggests a reading path from one Point, one Tree, one Facet of a Tree, or a question. In read mode it returns the Points above, the complete selected explanations, what they develop into and the Facets that bear on them. In discover mode it returns compact results to choose from.',
    input: { point: 'An exact Point ID.', tree: 'An exact Tree ID; with facet, one Facet of that Tree.', facet: 'An exact Facet ID; needs tree.', query: 'A question, 1 to 4096 characters. Give exactly one of point, tree or query.', mode: 'read (default) or discover.', detail: 'How far read mode goes beneath each selected Point: overview, none of its developments; standard (default), the developments one level beneath it; deep, all of them, at every depth. The Facets returned are those that bear on what is returned. Discover mode returns no developments at any level.', orientation: 'full or compact. Default full in read mode, compact in discover mode.', kinds: 'With query: ["point"], ["facet"] or both.', type: 'decision, observation or untyped.', limit: '1 to 100, default 8.', cursor: 'Set by a next value: pass the whole next value as INPUT.' },
    prints: 'atlas.route/1: status ("ready", "ambiguous", "missing" or "unavailable"), identity, request, orientation, selected, supporting, facets, limits, bounds, next; search after a query (window, the 100 candidates read; available, how many matched in all; exhaustive); page on a continuation. Exit 1 when missing or unavailable.',
  },
  references: {
    usage: [`${ROOT} references INPUT`],
    does: 'Reports Markdown links and declared source references as authored, without reading any source. {} lists every link and citation; point, or facet with tree, lists the records whose text links to that record; uri lists the records that cite that exact source URI.',
    input: { point: 'A Point ID: the records that link to it.', facet: 'A Facet ID, with tree: the records that link to it.', tree: 'The Tree that owns facet.', uri: 'An exact source URI: the records that cite it.', limit: '1 to 10000. Default 1000 for {}, 100 otherwise.' },
    prints: 'atlas.references/1 (references, citations, diagnostics, bounds, limits), atlas.citers/1 (citers, bounds, limits) or atlas.source-citations/1 (uri, citations, bounds, limits), each with status and identity.',
  },
  'read-source': {
    usage: [`${GRANTED} read-source URI`],
    does: 'Reads one local source within the grants, as the MCP tool atlas_read_source does: the whole file, what URI cites in it (the file, or the section its fragment names) and the hash of that material. URI is written as an Atlas cites it, relative to the Atlas root. An HTTP(S) URI is returned as a reference and never fetched. A URI carries no stamp, so the read compares none: stale compares each stamped reference with what it cites now.',
    prints: 'The read: status ("ready", "missing", "denied", "incomplete", "invalid", or "reference" for an HTTP(S) URI), source ({ uri }), code and message when not ready; when ready, path (absolute), content, bytes, sha256 (of the whole file), cited (scope "file", or "section" with its heading; start, end, bytes and sha256 of the cited material; null when the fragment names no heading, with code SOURCE_HEADING_MISSING), stamp ("unstamped", or "missing" when the fragment names no heading) and message. A file over 1 MiB, or one that changed while it was read, is incomplete (READ_LIMIT, READ_CHANGED). Exit 1 when missing, denied, incomplete or invalid.',
  },
  stale: {
    usage: [`${GRANTED} stale [INPUT | --full]`],
    does: 'Reads every local source within the grants, stamped or not: a stamped one to compare it with its stamp, an unstamped one to learn whether what it cites is there. It gives each source reference one status: current, changed, missing, denied, unstamped or remote. By default it prints how many references have each status and the summary: each changed or missing source once with the records that cite it, which are the explanations to read again. --full adds every reference with its status and the reason for it. It rewrites nothing. A changed source is a reason to read the explanation again, not a finding that it is false.',
    input: { limit: '1 to 10000, default 100: summary entries per page, and with full references too.', offset: '0 to 10000, default 0.', expectedIdentity: 'The identity a continuation belongs to; a changed Atlas gives STALE.', full: 'true: also every reference with its status, as --full.' },
    prints: 'atlas.stale/1: status ("ready" or "unavailable"), identity, counts (references, current, changed, missing, denied, unstamped, remote), summary as { uri, status, code?, citers }, bounds (summary, and with --full references, each with available and returned; unread, how many references were not read past the bound of 10000 in one report; exhaustive, true only when nothing remains past this page and none was left unread; next, the INPUT of the next page or null), limits; with --full, references as { from, sourceIndex, source, status, cited?, code?, reason }. An unstamped reference that was not read carries the code that says why.',
  },
  guide: {
    usage: ['atlas guide', `atlas guide ${GUIDE_DOCUMENTS.join('|')}`],
    does: 'Prints "Working with Atlas", the guide for an agent that reads or maintains an Atlas, or one of the documents it names, as shipped: spec (the specification), format (the file format), operations (the operations) or project (the project workflow).',
    prints: 'Markdown text, not JSON.',
  },
  styles: {
    usage: ['atlas styles', 'atlas styles show ID'],
    does: 'Lists the curated Styles, or prints one: the exact text that init --style ID adopts as style.md.',
    prints: 'atlas.styles/1: styles as { id, title }. styles show prints Markdown text, not JSON.',
  },
  init: {
    usage: [`${ROOT} init --id ID --title TITLE --style STYLE`],
    does: 'Prepares a new Atlas at PATH as a draft: atlas.json and style.md. Nothing is written to PATH until the draft is applied. The Style is yours to choose; none is chosen for you.',
    options: { '--id ID': 'The identity of the Atlas: lowercase letters, digits and hyphens.', '--title TITLE': 'Its title.', '--style STYLE': 'A curated Style ID (atlas styles lists them), or the path of a file that holds a complete Style: one H1 title and a body.' },
    prints: SAVED,
  },
  candidate: {
    usage: [`${ROOT} candidate`],
    does: `Writes a fresh copy of the Atlas's records into ${CANDIDATE}/ at the Atlas root, as their exact bytes: atlas.json, style.md, each declared Tree's tree.json, points/ and facets/, and .checks/. It first removes everything the folder held, including edits not yet prepared. It writes nothing else, and refuses when the folder is a symbolic link, is not a directory, or holds a symbolic link. An invalid Atlas is copied as it is, so that it can be repaired in the copy. Edit the copy with your own file tools, then validate --from ${CANDIDATE} and prepare --from ${CANDIDATE}. The private state records which Atlas was copied, starting before the folder is touched: when it cannot, the folder is left as it was. Once the Atlas has changed, or when the folder is written again while it is read, both refuse the copy (STALE), and candidate writes a fresh one. Readers never capture the folder.`,
    prints: 'atlas.candidate/1: status "ready", path (absolute), files (how many were written), baseline (the identity of the Atlas copied).',
  },
  prepare: {
    usage: [`${ROOT} prepare INPUT`, `${ROOT} prepare --from DIR --reason TEXT`],
    does: `Prepares a change and saves it as a draft. It writes no authored file. INPUT gives explicit file changes. --from gives a candidate: a directory that holds the whole proposed Atlas, from which the files to add, replace and remove are derived. The candidate is ${CANDIDATE} at the Atlas root (what candidate writes), refused (STALE) unless it was copied from the Atlas as it is now, or a directory outside the Atlas and the private state. The candidate is validated whole. A change that alters a valid style.md may alter no other file; a style.md that does not validate may be repaired together with other files. An invalid draft is saved so that it can be inspected, and cannot be applied.`,
    input: { changes: 'Required: at most 1000 entries { path, content }. path is an authored record path relative to the Atlas root; content is the complete new text of the file, or null to remove it.', reason: 'Required: what changed, what was removed and where its meaning now lives, and what is unresolved.' },
    options: { '--from DIR': `The candidate directory: ${CANDIDATE} (relative to the Atlas root) or any other path. A plain copy of the Atlas folder, edited, is one. Symbolic links in it are refused by name; files that are not records are left out.`, '--reason TEXT': 'The reason that travels with the draft.' },
    prints: `${SAVED} With --from, plan.ignored names the files of the candidate that are not Atlas records, are no part of the change, and are absent from the Atlas or differ from its own; bounds.ignored counts them.`,
  },
  review: {
    usage: [`${ROOT} review ID [INPUT | --full]`],
    does: 'Prints the effects of a saved draft: every record that is new, changed or removed and what changed in it, the Points above each changed Point, the Facets that bear on it, the records that mention it, link diagnostics, and whether the Style or a Check differs. They are read against the Atlas the draft was prepared against, so a draft that creates an Atlas or repairs one that does not validate is reviewed like any other; its limits then say what the earlier files leave unknown. By default it prints a summary to read whole: each changed record by its ID, with the counts; --full prints the complete records and why each related record was named. These are leads to read, not proof of complete impact.',
    input: { limit: '1 to 1000, default 100: entries per list of the summary.', offset: 'Without part: where each list of the summary starts, 0 to 100000, default 0. With part: the byte offset of the chunk in the text, from 0 to its byteLength, default 0.', ...CHUNK },
    prints: 'atlas.draft-review/1: status ("ready", or "unavailable" when the candidate is invalid), draft (id, revision, updatedAt, status, reason, baseline, candidate, stale: true when the Atlas changed since the draft was prepared, and diagnostics when the draft is invalid), and effects. By default effects is atlas.impact-summary/1: counts (points, facets, trees and checks, each as added, changed and removed, and linkDiagnostics), points as { id, tree, changes, above, aboveBefore when it moved, facets, mentionedBy }, facets as { id, changes, on, targets, mentionedBy }, trees and checks as { id, changes }, changedManifest (what differs in atlas.json: title, id, order, added and removed Trees, or null), changedStyle (title and path before and after, only when the Style differs), linkDiagnostics, limits (what the review covers and what it leaves unknown); with bounds (one entry per list), next (the INPUT of the next page, or null) and details. A removed record is told as it stood before. With --full effects is atlas.impact-review/1 with the complete records: changedPoints, changedFacets, changedTrees, changedChecks, changedManifest, changedStyle, review (the related records with the reasons each was named), mentions, linkDiagnostics, limits. When unavailable, effects holds reason and diagnostics. Exit 1 when unavailable.',
  },
  apply: {
    usage: [`${ROOT} apply ID --revision REVISION`],
    does: 'Writes a saved draft to the Atlas. It needs the exact revision that was reviewed. It refuses when the Atlas changed since the draft was prepared (STALE), when the draft is not at that revision (STALE_DRAFT), when the candidate is invalid (INVALID_CANDIDATE), and while an earlier apply of this Atlas is unfinished, until recover rolls it back (LOCKED). A completed apply removes the draft and then its journal; an interrupted or noop one keeps the draft.',
    prints: 'atlas.apply/1: status ("complete", "noop" or "interrupted"), identity (of the Atlas after a complete or noop apply; an interrupted one has none), transaction (null for noop), draft ("removed" when the apply completed, else "kept"); an interrupted apply adds written and error, and recover rolls it back. Exit 1 when interrupted.',
  },
  drafts: {
    usage: [`${ROOT} drafts [list]`, `${ROOT} drafts show ID [INPUT | --full]`, `${ROOT} drafts delete ID --revision REVISION`],
    does: 'Lists the saved drafts, prints one, or deletes one by its exact revision. A draft keeps the baseline it was prepared against and survives restarts.',
    input: { ...PAGE, offset: 'Without part: where each list starts, 0 to 100000, default 0. With part: the byte offset of the chunk in the text, from 0 to its byteLength, default 0.', ...CHUNK },
    prints: 'list: atlas.drafts/1 with drafts as { id, revision, updatedAt, reason, status, baseline }, and unreadable as { file, code, message }: each .json file of the drafts folder that does not load as a draft, and why. show: atlas.draft/1 with id, revision, updatedAt, plan (format, status, reason, baseline.identity, validation with status, identity and diagnostics, candidate as an Atlas summary, changes as { path, action, bytes }), bounds (changes, validation) and details; --full prints the saved draft with every byte. delete: status "deleted" and id.',
  },
  recover: {
    usage: [`${ROOT} recover [TRANSACTION_ID]`],
    does: 'Without an ID, lists the apply transactions whose journals remain: a journal is kept only while its transaction is unfinished, so these are the unfinished ones, and a finished one, complete or rolled back, whose journal could not be removed. With one, rolls back an interrupted apply and then removes its journal; for a rolled-back journal that was left, it removes it. Each file of the change that holds its original or its proposed bytes, whoever wrote them, gets its original bytes back; any other content refuses the rollback (RECOVERY_CONFLICT). A rollback is not a completion.',
    prints: 'atlas.transactions/1 with transactions as { id, phase, createdAt, baseline, result, written, error }, and unreadable as { file, code, message }: each .json file of the transactions folder that does not load as a journal, and why; or atlas.recovery/1 with status "rolled-back", transaction, identity, baselineRestored (true when the Atlas reads back whole as the transaction found it), diagnostics, or status and transaction alone for a rolled-back journal that was left.',
  },
  move: {
    usage: [`${ROOT} move INPUT`],
    does: 'Prepares the move of one Point or Facet file within its Tree, with the path links to and from it repaired, and saves it as a draft. IDs do not change. A move whose links cannot all be repaired safely is refused.',
    input: { point: 'The Point to move.', facet: 'The Facet to move, with tree.', tree: 'The Tree that owns facet.', path: 'Required: the new path relative to the Atlas root, in the same Tree and of the same kind.', reason: 'Required.' },
    prints: SAVED,
  },
  stamp: {
    usage: [`${GRANTED} stamp (--point ID... | --tree ID | --all) [--reason TEXT]`],
    does: 'Prepares a change that writes, into the source references of the selected records, the hash of the material each one cites now, and saves it as a draft. Nothing is stamped until the draft is applied. Only local sources readable within the grants are stamped; the others are reported and keep the stamps they had. Stamp a record after you have read it against its sources, not before.',
    options: { '--point ID': 'A Point and the Facets attached to it. Repeatable.', '--tree ID': 'Every Point and Facet of one Tree.', '--all': 'Every record.', '--reason TEXT': 'The reason of the draft. Default "Record the sources as read".' },
    prints: 'atlas.stamp/1: status ("ready", or "noop" when nothing needs a stamp), identity, selection, counts, stamped, current, skipped (at most 100 entries each), limits, bounds, and draft: the saved draft as prepare prints it, or null when the status is noop. The command stale gives every reference its status, page by page.',
  },
  absorb: {
    usage: [`${ROOT} absorb INPUT`],
    does: 'Inspects incoming material against the Atlas: the Points it may belong with, the Trees that could own it and the Facets that bear on those Points. It prepares nothing; the author decides what the material changes.',
    input: { text: 'Required: the incoming material, up to 1048576 characters.', source: 'Required: its source reference { uri, title?, role?, revision?, locator?, sha256? }.', tree: 'Only this Tree.', limit: '1 to 100, default 8.' },
    prints: 'atlas.absorb-inspection/1: status ("candidates", "no-candidates", "missing" or "unavailable"), identity, incoming, candidates, owners, interpretations, limits, style, terms, bounds. Exit 1 when missing or unavailable.',
  },
  config: {
    usage: ['atlas config [PROJECT] [--atlas PATH] [--allow-source-root PATH]... [--state-home PATH]', `${GRANTED} [--state-home PATH] config`],
    does: 'Prints the configuration that connects an agent host to an Atlas through the MCP server, with its root, its source grants and, when one is set, its state location. The first form finds the Atlas of a project as open does and grants the project directory, so the agent can read the project\'s cited sources. The second form grants the Atlas root and the roots given. It changes no host settings; install it through the host.',
    options: { '--atlas PATH': 'First form: the project-relative directory of the Atlas, or . for the project itself.', '--allow-source-root PATH': 'First form: also grant the server PATH for reading cited local sources. Repeatable.', '--state-home PATH': 'First form: the state location the server is given, in place of the user state directory.' },
    prints: 'mcpServers.atlas: command (this Node), args (the MCP server, --root, and each --allow-source-root), and env.ATLAS_STATE_HOME when a state location was set.',
  },
  state: {
    usage: [`${ROOT} [--state-home PATH] state [inspect]`],
    does: 'Says where the drafts and recovery journals of this Atlas are kept. It creates nothing.',
    prints: 'atlas.state-inspection/1: state with root, directory, exists and owner.',
  },
  mcp: {
    usage: [`${GRANTED} [--state-home PATH] mcp`],
    does: 'Runs the MCP server for this Atlas on stdin and stdout until stdin closes. The root, the source grants and the state location are fixed for the session.',
    prints: 'MCP protocol messages only.',
  },
  export: {
    usage: [`${GRANTED} export OUT (--tree ID... | --all) [--source-base URL]`],
    does: 'Writes the Portal as static pages into the folder OUT for the selected Trees. It never expands through Facets or links: targets in Trees outside the selection are marked as not included. Source bodies are never copied. OUT must not exist, or must be a previous export, which is then replaced as a whole.',
    options: { '--tree ID': 'A Tree to include. Repeatable.', '--all': 'Every Tree. Give --tree or --all, not both.', '--source-base URL': 'The HTTP(S) address at which the Atlas root can be browsed; local source references then link there.' },
    prints: 'atlas.export/2: atlas, identity, trees, sourceBase, status "complete", output, points, facets, replaced.',
  },
  help: {
    usage: ['atlas --help', 'atlas help [COMMAND]', 'atlas COMMAND --help', 'atlas --version'],
    does: 'Prints every command with its usage, or one command with its options, its INPUT fields and what it prints. --version prints the version.',
    prints: 'usage, options, input, output, exit and commands; or command, usage, does, options, input and prints. --version: atlas.version/1 with version.',
  },
};
/** One example of INPUT for each command that takes one, run against the shipped example Atlas by the tests. */
const EXAMPLES = {
  inspect: `echo '{"section":"points","limit":2}' | ${ROOT} inspect -`,
  search: `echo '{"query":"offline delivery","limit":3}' | ${ROOT} search -`,
  route: `echo '{"point":"sync-policy","detail":"overview"}' | ${ROOT} route -`,
  references: `echo '{"point":"sync-policy"}' | ${ROOT} references -`,
  stale: `echo '{"full":true,"limit":5}' | ${ROOT} stale -`,
  prepare: `echo '{"reason":"Drop the note on the local limit.","changes":[{"path":"trees/product/facets/local-limit.md","content":null}]}' | ${ROOT} prepare -`,
  review: `echo '{"limit":10}' | ${ROOT} review ID -`,
  drafts: `echo '{"limit":10}' | ${ROOT} drafts show ID -`,
  move: `echo '{"point":"sync-policy","path":"trees/architecture/points/delivery/sync.md","reason":"Group the delivery notes."}' | ${ROOT} move -`,
  absorb: `echo '{"text":"A second trial reopened a note offline.","source":{"uri":"notes/second-trial.md","role":"evidence"},"limit":2}' | ${ROOT} absorb -`,
};
const GENERAL = {
  usage,
  options: {
    '--root PATH': 'The Atlas directory. It comes first for every command except open, locate, config, guide, styles, help and --version, and is not needed to ask a command for its help.',
    '--allow-source-root PATH': 'After --root: one more directory from which cited local sources may be read. Repeatable; at most 100 distinct roots with the Atlas root, which is always granted.',
    '--state-home PATH': 'After --root: keep drafts and recovery journals under PATH instead of the user state directory. ATLAS_STATE_HOME does the same.',
  },
  input: `INPUT is the path of a JSON file, or - to read the JSON from standard input: strict UTF-8 JSON without duplicate keys, at most 4 MiB. For example: ${EXAMPLES.search}`,
  output: 'Every command prints one JSON value on stdout, except guide and styles show, which print Markdown. An error is JSON on stderr: error with code and message, diagnostics when the refusal names paths, and usage when the input was invalid.',
  exit: {
    0: 'Done.',
    1: 'The status of the result is invalid, incomplete, unavailable, missing, interrupted or denied, or the operation failed.',
    2: 'Invalid arguments or input.',
    3: 'A conflict with the current state: STALE, STALE_DRAFT, LOCKED, PROJECT_CHANGED, RECOVERY_CONFLICT, EXPORT_EXISTS, EXPORT_CONFLICT or atlas.route.stale-cursor.',
  },
};
/** What INPUT is, said by each command that takes one, with an example of it: in `atlas --help` and in the command's own help. */
const takesInput = command => ({ ...(EXAMPLES[command] ? { INPUT: `The path of a JSON file, or - to read the JSON from standard input. For example: ${EXAMPLES[command]}` } : {}) });
const overview = () => ({ ...GENERAL, commands: Object.entries(HELP).map(([command, { usage: forms, does }]) => ({ command, usage: forms, does, ...takesInput(command) })) });
function commandHelp(command) {
  if (!Object.hasOwn(HELP, command)) invalid(`Unknown command: ${command}.`);
  const { usage: forms, does, ...rest } = HELP[command];
  return { command, usage: forms, does, ...takesInput(command), ...rest };
}
const asksHelp = (args) => args.length === 1 && ['--help', '-h'].includes(args[0]);

function count(args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) invalid('Unexpected or missing command arguments.');
}

function nonblank(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) invalid(`${name} must be nonblank text without NUL characters.`);
  return value;
}

/** One source grant, resolved, as the MCP server takes one: a directory path of at most 4096 characters without NUL. */
function granted(value) {
  const refused = () => fail('INVALID_SCOPE', 'Source grants must be directory paths of at most 4096 characters, without NUL characters.');
  if (typeof value === 'string' && value.includes('\0')) refused();
  const directory = path.resolve(nonblank(value, 'directory'));
  if (directory.length > 4096) refused();
  return directory;
}

function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) invalid('Expected an exact lowercase identity, not a file path.');
  return value;
}

function reviewedRevision(args) {
  if (args.length !== 2 || args[0] !== '--revision' || !/^[a-f0-9]{64}$/.test(args[1])) invalid('Supply --revision with the exact saved draft revision you reviewed.');
  return args[1];
}

function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    invalid(`Input has unexpected or missing fields. Fields: ${allowed.join(', ')}.`);
  }
  return value;
}

/** Options after a command: `value` takes the next argument, `list` may repeat, `flag` stands alone. */
function options(args, accepted) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index], kind = accepted[name];
    if (!kind) invalid(`Unexpected argument: ${name}. Options: ${Object.keys(accepted).join(', ')}.`);
    if (kind !== 'list' && result[name] !== undefined) invalid(`${name} may be given once.`);
    if (kind === 'flag') { result[name] = true; continue; }
    if (++index >= args.length) invalid(`${name} requires a value.`);
    if (kind === 'list') (result[name] ??= []).push(args[index]);
    else result[name] = args[index];
  }
  return result;
}

function launcher(argv) {
  if (argv.length < 3 || argv[0] !== '--root' || argv[1].startsWith('--')) invalid('Supply --root PATH first, followed by one command.');
  const root = path.resolve(nonblank(argv[1], 'root'));
  const allowedRoots = [];
  let index = 2;
  while (['--allow-source-root', '--state-home'].includes(argv[index])) {
    const option = argv[index];
    if (++index >= argv.length || argv[index].startsWith('--')) invalid(`${option} requires a directory path.`);
    if (option === '--state-home') process.env.ATLAS_STATE_HOME = path.resolve(nonblank(argv[index++], 'directory'));
    else allowedRoots.push(granted(argv[index++]));
  }
  if (new Set([root, ...allowedRoots]).size > 100) invalid(GRANT_LIMIT);
  const command = argv[index++];
  if (!command || command.startsWith('-')) invalid('Supply one command after the launcher options.');
  return Object.freeze({ root, allowedRoots: Object.freeze([...new Set(allowedRoots)]), command, args: argv.slice(index) });
}

/** Strict UTF-8 text of at most 4 MiB from a regular file, or from stdin for `-`. */
async function inputText(filename, kind) {
  nonblank(filename, 'input');
  if (filename.startsWith('--')) invalid(`${kind} must be an explicit file path${kind === 'JSON input' ? ' or -' : ''}.`);
  const chunks = [];
  let size = 0;
  const accept = (chunk) => {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) fail('CLI_INPUT_LIMIT', `${kind} exceeds 4 MiB.`);
    chunks.push(chunk);
  };
  if (filename === '-' && kind === 'JSON input') {
    if (process.stdin.isTTY) invalid('Pipe JSON to stdin when using -.');
    for await (const chunk of process.stdin) accept(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  } else {
    const handle = await fs.open(path.resolve(filename), constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) invalid(`${kind} must be a regular file.`);
      if (stat.size > MAX_INPUT_BYTES) fail('CLI_INPUT_LIMIT', `${kind} exceeds 4 MiB.`);
      while (true) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
        const { bytesRead } = await handle.read(buffer);
        if (!bytesRead) break;
        accept(buffer.subarray(0, bytesRead));
      }
    } finally { await handle.close(); }
  }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size)); }
  catch { fail('CLI_INPUT_ENCODING', `${kind} must be valid UTF-8.`); }
}
const inputJson = async (filename) => parseStrictJson(await inputText(filename, 'JSON input'));

function outcome(value) {
  const status = value?.status ?? value?.plan?.status;
  if (['invalid', 'incomplete', 'unavailable', 'missing', 'interrupted', 'denied'].includes(status)) process.exitCode = 1;
  emit(value);
}

/** Bounded reading of a saved draft or of its effects: a summary, the whole, or exact chunks. */
async function reading(argument) {
  if (argument === undefined) return {};
  if (argument === '--full') return { full: true };
  return object(await inputJson(argument), ['limit', 'offset', 'full', 'part', 'maxBytes', 'expectedSha256']);
}

async function inspection(view, args) {
  if (!args.length) return summarizeAtlas(view);
  if (args.length === 1 && args[0] === '--full') return view;
  const [kind, first, second] = args;
  if (!['point', 'tree', 'facet', 'style', 'checks'].includes(kind)) {
    count(args, 1);
    return summarizeAtlas(view, object(await inputJson(kind), ['limit', 'offset', 'section', 'expectedIdentity', 'full']));
  }
  count(args, kind === 'facet' ? 3 : kind === 'point' || kind === 'tree' ? 2 : 1);
  return inspectRecord(view, kind, kind === 'facet' ? { tree: identifier(first), id: identifier(second) } : first === undefined ? true : identifier(first));
}

function searchInput(value) {
  object(value, ['query', 'tree', 'type', 'limit', 'offset', 'kinds', 'presentation'], ['query']);
  if (value.presentation !== undefined && !['full', 'summary'].includes(value.presentation)) invalid('Unknown search presentation.');
  nonblank(value.query, 'query');
  if (value.query.length > 4096) invalid('Search query exceeds 4096 characters.');
  if (value.tree !== undefined) identifier(value.tree);
  if (value.type !== undefined && !['decision', 'observation', 'untyped'].includes(value.type)) invalid('Unknown Point Type.');
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) invalid('Search limit must be 1 through 100.');
  return value;
}

function agentConfiguration(root, allowedRoots) {
  const server = fileURLToPath(new URL('../../agent/src/server.mjs', import.meta.url));
  return { mcpServers: { atlas: {
    command: process.execPath,
    args: [server, '--root', root, ...allowedRoots.filter(directory => directory !== root).flatMap(directory => ['--allow-source-root', directory])],
    ...(process.env.ATLAS_STATE_HOME ? { env: { ATLAS_STATE_HOME: path.resolve(process.env.ATLAS_STATE_HOME) } } : {}),
  } } };
}

/** Serve the Portal until a signal stops it. `selection` is what a project opening found. */
async function serve(root, allowedRoots, given, selection = {}) {
  let port = 0;
  if (given['--port'] !== undefined) {
    if (!/^[0-9]+$/.test(given['--port']) || Number(given['--port']) > 65535) invalid('Port must be 0 through 65535.');
    port = Number(given['--port']);
  }
  const { startPortal } = await import('../../portal/src/server.mjs');
  const portal = await startPortal(root, { port, allowedRoots: allowedRoots.filter(directory => directory !== root) });
  const browser = given['--no-browser'] ? 'not-requested' : await launchBrowser(portal.url);
  emit({ format: 'atlas.server/1', status: 'serving', url: portal.url, browser, ...selection, shutdown: 'Press Ctrl+C in this terminal to stop Atlas.' });
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try { await portal.close(); }
    catch (error) { emit({ error: { code: error.code ?? 'CLI_SERVER_CLOSE', message: error.message } }, process.stderr); process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function projectCommand(command, args) {
  let project = process.cwd();
  if (args[0] && !args[0].startsWith('-')) project = args.shift();
  const given = options(args, command === 'locate' ? { '--atlas': 'value' }
    : command === 'config' ? { '--atlas': 'value', '--allow-source-root': 'list', '--state-home': 'value' }
    : { '--atlas': 'value', '--port': 'value', '--no-browser': 'flag', '--allow-source-root': 'list', '--state-home': 'value' });
  if (given['--state-home'] !== undefined) process.env.ATLAS_STATE_HOME = path.resolve(nonblank(given['--state-home'], 'directory'));
  const extra = (given['--allow-source-root'] ?? []).map(granted);
  if (command !== 'locate') stateHome();
  const discovery = await discoverProject(project, { atlasPath: given['--atlas'] });
  if (command === 'locate') return emit(discovery);
  const selected = await verifySelection(discovery, await chooseAtlas(discovery));
  await usableState(selected.root);
  const roots = [...new Set([selected.root, discovery.project, ...extra])];
  if (roots.length > 100) invalid(GRANT_LIMIT);
  if (command === 'config') return emit(agentConfiguration(selected.root, roots));
  return serve(selected.root, roots, given, { project: discovery.project, atlasPath: selected.path, create: selected.create });
}

/** The two documents the CLI prints as written: the guide for agents, and a curated Style. */
async function document(command, args) {
  if (command === 'guide') {
    count(args, 0, 1);
    if (args.length && !GUIDE_DOCUMENTS.includes(args[0])) invalid(`Unknown document: ${args[0]}. Use guide, or guide ${GUIDE_DOCUMENTS.join(', ')}.`);
    return process.stdout.write(await readGuide(args[0]));
  }
  if (!args.length) return emit({ format: 'atlas.styles/1', styles: listStyles() });
  if (args[0] !== 'show') invalid('Use styles, or styles show ID.');
  count(args, 2);
  const style = getStyle(args[1]);
  if (!style) invalid(`Unknown curated Style: ${args[1]}. Curated Styles: ${listStyles().map(item => item.id).join(', ')}.`);
  return process.stdout.write(style.content);
}

async function main(argv) {
  if (!argv.length || ['--help', '-h'].includes(argv[0])) {
    count(argv, 0, 1);
    return emit(overview());
  }
  if (argv[0] === 'help') {
    count(argv, 1, 2);
    return emit(argv.length === 2 ? commandHelp(asksHelp(argv.slice(1)) ? 'help' : argv[1]) : overview());
  }
  // Every command says how it is used without an Atlas: atlas COMMAND --help needs no --root.
  if (Object.hasOwn(HELP, argv[0]) && asksHelp(argv.slice(1))) return emit(commandHelp(argv[0]));
  if (argv[0] === '--version') {
    count(argv, 1);
    return emit({ format: 'atlas.version/1', version: (await fs.readFile(new URL('../../../VERSION', import.meta.url), 'utf8')).trim() });
  }
  if (['open', 'locate', 'config', 'guide', 'styles'].includes(argv[0])) {
    return ['open', 'locate', 'config'].includes(argv[0]) ? projectCommand(argv[0], argv.slice(1)) : document(argv[0], argv.slice(1));
  }
  const { root, allowedRoots, command, args } = launcher(argv);
  const sourceRoots = Object.freeze([...new Set([root, ...allowedRoots])]);
  if (asksHelp(args)) return emit(commandHelp(command));
  if (STATEFUL.includes(command) || command === 'validate' && args.includes('--from')) await usableState(root);
  const save = async (plan) => savedDraft(await saveDraft(root, { plan }));
  switch (command) {
    case 'help':
      count(args, 0, 1);
      return emit(args.length ? commandHelp(args[0]) : overview());
    case 'guide':
    case 'styles':
      return document(command, args);
    case 'open':
      return serve(root, sourceRoots, options(args, { '--port': 'value', '--no-browser': 'flag' }));
    case 'config': {
      count(args, 0);
      return emit(agentConfiguration(root, sourceRoots));
    }
    case 'state': {
      if (args.length > 1 || args.length === 1 && args[0] !== 'inspect') invalid('Use state, or state inspect.');
      return emit({ format: 'atlas.state-inspection/1', state: await resolveState(root) });
    }
    case 'validate': {
      const given = options(args, { '--from': 'value' });
      if (given['--from'] !== undefined) return outcome(await validateCandidate(root, candidateDirectory(root, nonblank(given['--from'], 'directory')), [...sourceRoots]));
      const view = await openAtlas(root);
      return outcome({ format: 'atlas.validation/1', status: view.status, identity: view.identity, diagnostics: view.diagnostics });
    }
    case 'candidate': {
      count(args, 0);
      const written = await writeCandidate(root);
      return emit({ format: 'atlas.candidate/1', status: 'ready', path: written.path, files: written.files, baseline: written.baseline });
    }
    case 'outline': {
      count(args, 0, 1);
      return outcome(outline(await openAtlas(root), args.length ? identifier(args[0]) : undefined));
    }
    case 'inspect':
      return outcome(await inspection(await openAtlas(root), args));
    case 'search': {
      count(args, 1);
      return outcome(search(await openAtlas(root), searchInput(await inputJson(args[0]))));
    }
    case 'route': {
      count(args, 1);
      const request = await inputJson(args[0]);
      return outcome(route(await openAtlas(root), request));
    }
    case 'references': {
      count(args, 1);
      const request = object(await inputJson(args[0]), ['point', 'facet', 'tree', 'uri', 'limit']);
      return outcome(references(await openAtlas(root), request));
    }
    case 'read-source': {
      count(args, 1);
      if (args[0].startsWith('-')) invalid('Give the URI of one source, as the Atlas cites it.');
      return outcome(await readSource(await openAtlas(root), { uri: nonblank(args[0], 'URI') }, { allowedRoots: [...sourceRoots], maxBytes: 1024 * 1024 }));
    }
    case 'stale': {
      count(args, 0, 1);
      const request = !args.length ? {} : args[0] === '--full' ? { full: true } : object(await inputJson(args[0]), ['limit', 'offset', 'expectedIdentity', 'full']);
      return outcome(await stale(await openAtlas(root), request, [...sourceRoots]));
    }
    case 'absorb': {
      count(args, 1);
      const request = await inputJson(args[0]);
      return outcome(inspectAbsorb(await openAtlas(root), request));
    }
    case 'init': {
      const given = options(args, { '--id': 'value', '--title': 'value', '--style': 'value' });
      const curated = listStyles().map(style => style.id);
      if (given['--id'] === undefined || given['--title'] === undefined || given['--style'] === undefined) invalid(`init needs --id ID, --title TITLE and --style STYLE. STYLE is a curated Style (${curated.join(', ')}) or the path of a file that holds a complete Style.`);
      const request = { id: identifier(given['--id']), title: nonblank(given['--title'], 'title') };
      if (curated.includes(given['--style'])) request.styleId = given['--style'];
      else {
        try { request.styleContent = await inputText(given['--style'], 'A Style file'); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          invalid(`--style is neither a curated Style (${curated.join(', ')}) nor the path of a file: ${given['--style']}.`);
        }
      }
      return outcome(await save(prepareInitialization(await openAtlas(root), request)));
    }
    case 'prepare': {
      if (args[0]?.startsWith('--')) {
        const given = options(args, { '--from': 'value', '--reason': 'value' });
        if (given['--from'] === undefined || given['--reason'] === undefined) invalid('Use prepare INPUT, or prepare --from DIR --reason TEXT.');
        return outcome(await save(await prepareFromCandidate(root, candidateDirectory(root, nonblank(given['--from'], 'directory')), { reason: given['--reason'] })));
      }
      count(args, 1);
      return outcome(await save(await prepareChangeFromDisk(root, await inputJson(args[0]))));
    }
    case 'review': {
      count(args, 1, 2);
      const draft = await loadDraft(root, identifier(args[0]));
      return outcome(reviewDraft(draft, await reading(args[1]), await openAtlas(root)));
    }
    case 'apply': {
      count(args, 3);
      return outcome(await applyDraft(root, identifier(args[0]), { expectedRevision: reviewedRevision(args.slice(1)) }));
    }
    case 'drafts': {
      count(args, 0, 4);
      if (!args.length || args.length === 1 && args[0] === 'list') return emit({ format: 'atlas.drafts/1', ...await listDrafts(root) });
      if (args[0] === 'delete') count(args, 4); else count(args, 2, 3);
      const id = identifier(args[1]);
      if (args[0] === 'show') {
        const draft = await loadDraft(root, id), request = await reading(args[2]);
        return outcome(request.part === 'details' ? readJsonChunk(draft, request) : summarizeDraft(draft, request));
      }
      if (args[0] === 'delete') return outcome(await deleteDraft(root, id, { expectedRevision: reviewedRevision(args.slice(2)) }));
      return invalid('Drafts accepts list, show ID, or delete ID.');
    }
    case 'recover':
      count(args, 0, 1);
      return outcome(args.length ? await recoverChange(root, identifier(args[0])) : { format: 'atlas.transactions/1', ...await listTransactions(root) });
    case 'move': {
      count(args, 1);
      return outcome(await save(prepareMove(await openAtlas(root), await inputJson(args[0]))));
    }
    case 'stamp': {
      const given = options(args, { '--point': 'list', '--tree': 'value', '--all': 'flag', '--reason': 'value' });
      const result = await prepareStamp(root, {
        ...(given['--point'] ? { points: given['--point'].map(identifier) } : {}), ...(given['--tree'] !== undefined ? { tree: identifier(given['--tree']) } : {}),
        ...(given['--all'] ? { all: true } : {}), ...(given['--reason'] !== undefined ? { reason: given['--reason'] } : {}), allowedRoots: [...sourceRoots],
      });
      return outcome({ ...stampReport(result), draft: result.plan.status === 'noop' ? null : await save(result.plan) });
    }
    case 'mcp': {
      count(args, 0);
      const { startAgent } = await import('../../agent/src/server.mjs');
      const agent = startAgent(root, { allowedRoots });
      const stop = () => { agent.close(); process.stdin.destroy(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      await agent.closed;
      return;
    }
    case 'export': {
      if (!args.length || args[0].startsWith('--')) invalid('Name the output folder first: export OUT (--tree ID... | --all) [--source-base URL].');
      const given = options(args.slice(1), { '--tree': 'list', '--all': 'flag', '--source-base': 'value' });
      const trees = given['--tree'] ?? [];
      if (Boolean(trees.length) === Boolean(given['--all']) || new Set(trees).size !== trees.length) fail('SELECTION_REQUIRED', 'Select what to export: --tree ID once for each Tree, or --all for every Tree, not both.');
      const { exportPortal } = await import('../../portal/src/export.mjs');
      return outcome(await exportPortal(root, path.resolve(nonblank(args[0], 'output')), {
        ...(given['--all'] ? { all: true } : { trees: trees.map(identifier) }),
        ...(given['--source-base'] !== undefined ? { sourceBase: given['--source-base'] } : {}),
        allowedRoots: sourceRoots.filter(directory => directory !== root),
      }));
    }
    default:
      invalid(`Unknown command: ${command}.`);
  }
}

try { await main(process.argv.slice(2)); }
catch (error) {
  const code = typeof error.code === 'string' ? error.code : error instanceof TypeError ? 'CLI_INVALID_ARGUMENT' : 'CLI_FAILED';
  const invalidInput = code.startsWith('CLI_INPUT_') || code.startsWith('JSON_') || code.endsWith('.invalid-argument') ||
    ['CLI_INVALID_ARGUMENT', 'PROJECT_INVALID', 'PROJECT_AMBIGUOUS', 'PROJECT_DISCOVERY_LIMIT', 'INVALID_REQUEST', 'UNSAFE_PATH', 'SELECTION_REQUIRED', 'SELECTION_UNKNOWN', 'INVALID_SOURCE_BASE', 'EXPORT_OVERLAP', 'atlas.route.cursor-mismatch'].includes(code);
  const conflict = ['STALE', 'STALE_DRAFT', 'LOCKED', 'PROJECT_CHANGED', 'RECOVERY_CONFLICT', 'EXPORT_EXISTS', 'EXPORT_CONFLICT', 'atlas.route.stale-cursor'].includes(code);
  process.exitCode = invalidInput ? 2 : conflict ? 3 : 1;
  emit({ error: { code, message: error.message, ...(Array.isArray(error.diagnostics) ? { diagnostics: error.diagnostics.slice(0, 100) } : {}) }, ...(invalidInput ? { usage } : {}) }, process.stderr);
}
