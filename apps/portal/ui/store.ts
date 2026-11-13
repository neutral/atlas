// The Portal's behavior, apart from its drawing: what is loaded, what is selected,
// which dialog is open, and the guarded editing session behind every form.
// React renders from `state`; the Node tests drive these methods directly.
import {
  type Atlas, type Facet, type Layout, type Owner, type Point, type Selected, type Source, type View,
  branchById, facetById, layoutTree, pointById, readerSearch, treeById,
} from './model.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Api = (path: string, data?: unknown, method?: string) => Promise<any>;
export type Host = {
  api: Api;
  publication: boolean;
  readPublication: () => Promise<View>;
  location: () => { pathname: string; search: string; hash: string; href: string; origin: string };
  history: { push(state: unknown, url: string): void; replace(state: unknown, url: string): void; back(): void };
  later: (callback: () => void, ms: number) => unknown;
  cancel: (timer: unknown) => void;
  frame: (callback: () => void) => void;
  clipboard?: (text: string) => Promise<void>;
};
/** What only the drawn page can answer or do; the page registers these once it is mounted. */
export type Surface = {
  canvas: () => { width: number; height: number };
  pageScroll: () => number;
  setPageScroll: (top: number) => void;
  scrollToId: (id: string) => boolean;
  focusKeepEditing: () => void;
};
export type Fields = { controls: { value: string; checked?: boolean; type: string }[]; citations?: { removed: boolean; values: Record<string, string> }[]; [extra: string]: unknown };
export type Editor = {
  dirty: boolean; saving: boolean; version: number; draftId?: string; revision?: string; title: string; context: any;
  working?: any; autosaving?: boolean; autosaveAgain?: boolean; clearAfterAutosave?: boolean; capture?: () => Fields;
};
export type DialogView =
  | { kind: 'search' }
  | { kind: 'reviewSources'; history: any; sources: string[] }
  | { kind: 'checks' }
  | { kind: 'export'; available: any }
  | { kind: 'exportReview'; preview: any; available: any }
  | { kind: 'exported'; result: any }
  | { kind: 'connect'; configuration: any }
  | { kind: 'styleRead'; current: any }
  | { kind: 'style'; available: any; files: any; recovered?: Fields }
  | { kind: 'drafts'; saved: any[]; transactions: any[]; working: any[] }
  | { kind: 'review'; draft: any }
  | { kind: 'semantic'; draft: any; blocks: ComparisonBlock[] }
  | { kind: 'checksForm'; draft: any; recovered?: Fields }
  | { kind: 'earlierNotes'; text: string }
  | { kind: 'point'; point: Point; files: any; header: any; title: string; explanation: string; recovered?: Fields }
  | { kind: 'facet'; facet: Facet; files: any; header: any; recovered?: Fields }
  | { kind: 'records'; saved: any; captured: any; recovered?: Fields }
  | { kind: 'move'; record: Point; files: any; recovered?: Fields }
  | { kind: 'branch'; record?: any; tree: string; files: any; recovered?: Fields }
  | { kind: 'position'; record: any; recordKind: 'point' | 'branch'; files: any; recovered?: Fields }
  | { kind: 'remove'; record: Point; files: any; recovered?: Fields }
  | { kind: 'newTree'; files: any; recovered?: Fields }
  | { kind: 'newPoint'; files: any; tree: string | null; recovered?: Fields }
  | { kind: 'newFacet'; record: any; hostKind: 'point' | 'branch'; files: any; recovered?: Fields }
  | { kind: 'initialize'; files: any; styles: any; recovered?: Fields };
export type Dialog = { key: number; title: string; view: DialogView };
export type ComparisonSide = { title: string; meta: string; html: string; uncertainty?: string; sources: string } | null;
export type ComparisonBlock =
  | { kind: 'style'; before: { title: string; meta: string; html: string } | null; after: { title: string; meta: string; html: string } | null }
  | { kind: 'record'; label: string; before: ComparisonSide; after: ComparisonSide };
export type SourceRead = { selected: Selected; status: 'reading' | 'ready' | 'failed'; result?: any; error?: string };
export type Preview = { id: string; revision: string; reason: string; before: View; after: View };
export type State = {
  phase: 'opening' | 'ready' | 'failed';
  failure: string | null;
  data: View | null;
  live: View | null;
  tree: string | null;
  selected: Selected | null;
  backAvailable: boolean;
  readingFocus: boolean;
  filter: string;
  type: string;
  view: { scale: number; x: number; y: number };
  vertical: boolean;
  preview: Preview | null;
  dialog: Dialog | null;
  unsaved: boolean;
  autosave: { text: string; attend: boolean };
  notice: { key: number; message: string; attend: boolean } | null;
  sourceRead: SourceRead | null;
};
export type Snapshot = {
  atlasReader: true; selected: Selected | null; tree: string | null; readingFocus: boolean; scroll: number;
  scale: number; x: number; y: number; filter: string; type: string; preview: { id: string; revision: string } | null;
};

const recordText = (header: unknown, title: string, body: string) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body.trim()}\n`;
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u;

/** Rendered explanations, uncertainty and citations from the exact original and candidate. */
export function comparisonBlocks(preview: { before: View; after: View }): ComparisonBlock[] {
  const blocks: ComparisonBlock[] = [];
  const beforeStyle = preview.before.atlas?.style ?? null, afterStyle = preview.after.atlas?.style ?? null;
  const styleSide = (style: any) => style ? { title: style.title, meta: `${style.id} · revision ${style.revision}`, html: style.html ?? '' } : null;
  if (JSON.stringify(beforeStyle) !== JSON.stringify(afterStyle)) blocks.push({ kind: 'style', before: styleSide(beforeStyle), after: styleSide(afterStyle) });
  for (const kind of ['points', 'facets'] as const) {
    const before: any[] = preview.before.atlas?.[kind] ?? [], after: any[] = preview.after.atlas?.[kind] ?? [];
    const keys = [...new Set([...before, ...after].map(item => `${item.tree}/${item.id}`))];
    for (const key of keys) {
      const old = before.find(item => `${item.tree}/${item.id}` === key), next = after.find(item => `${item.tree}/${item.id}` === key);
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      const side = (record: any): ComparisonSide => record ? {
        title: record.title, meta: [record.type, record.status, record.observedAt].filter(Boolean).join(' · '), html: record.html ?? '', uncertainty: record.uncertainty,
        sources: `Sources: ${(record.sources ?? []).map((item: Source) => [item.uri, item.role, item.locator].filter(Boolean).join(' · ')).join('; ') || 'none'}`,
      } : null;
      blocks.push({ kind: 'record', label: `${kind === 'facets' ? 'Facet' : 'Point'} · ${key}`, before: side(old), after: side(next) });
    }
  }
  return blocks;
}

/** One Style editor: each choice keeps its own unfinished definition. */
export class StyleChoices {
  private definitions = new Map<string, string>();
  private styles: { id: string; content?: string }[];
  choice = '';
  constructor(captured: string, styles: { id: string; content?: string }[]) { this.styles = styles; this.definitions.set('', captured); }
  /** Leave the current choice holding `content`, and return the next choice's definition. */
  choose(next: string, content: string) {
    this.definitions.set(this.choice, content);
    this.choice = next;
    if (!this.definitions.has(next)) this.definitions.set(next, this.styles.find(item => item.id === next)?.content ?? '');
    return this.definitions.get(next)!;
  }
}

/** Source byte requirements for one change: an inspection never silently replaces a chosen requirement. */
export class ByteRequirements {
  readonly uris: string[];
  private chosen: Map<string, string>;
  private observed = new Map<string, string | undefined>();
  status = new Map<string, string>();
  checked = new Map<string, boolean>();
  busy = new Set<string>();
  version = 0;
  private listeners = new Set<() => void>();
  private inspectBytes: (uri: string) => Promise<any>;
  constructor(sources: Source[], existing: { uri: string; sha256: string }[] = [], inspectBytes: (uri: string) => Promise<any>) {
    this.inspectBytes = inspectBytes;
    this.chosen = new Map(existing.map(item => [item.uri, item.sha256]));
    this.uris = [...new Set([...sources.map(source => source.uri), ...this.chosen.keys()])].filter(uri => !/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('file:'));
    for (const uri of this.uris) {
      const sha256 = this.chosen.get(uri);
      this.observed.set(uri, sha256);
      this.checked.set(uri, this.chosen.has(uri));
      this.status.set(uri, sha256 ? `Required source bytes: ${sha256}` : 'No byte requirement selected.');
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.version++; for (const listener of this.listeners) listener(); }
  canRequire(uri: string) { return Boolean(this.observed.get(uri)); }
  toggle(uri: string, checked: boolean) {
    this.checked.set(uri, checked);
    const sha256 = this.observed.get(uri);
    if (checked && sha256) this.chosen.set(uri, sha256); else this.chosen.delete(uri);
    this.changed();
  }
  async inspect(uri: string) {
    this.busy.add(uri); this.changed();
    try {
      const review = await this.inspectBytes(uri);
      const row = review.results[0];
      // A new inspection never silently replaces a previously selected requirement.
      if (this.chosen.has(uri) && row?.sha256 !== this.chosen.get(uri)) { this.status.set(uri, `${row?.status ?? 'unavailable'}: source differs from the selected bytes. Uncheck the requirement before choosing the current bytes.`); return; }
      this.observed.set(uri, row?.sha256);
      this.status.set(uri, `${row?.status ?? 'unavailable'}: ${row?.reason ?? ''}${row?.sha256 ? ` SHA-256 ${row.sha256}` : ''}`);
    } finally { this.busy.delete(uri); this.changed(); }
  }
  selected() { return [...this.chosen].map(([uri, sha256]) => ({ uri, sha256 })); }
}

const initial = (data: View | null): State => ({
  phase: data ? 'ready' : 'opening', failure: null, data, live: data,
  tree: data?.atlas?.trees[0]?.id ?? null, selected: null, backAvailable: false, readingFocus: false,
  filter: '', type: '', view: { scale: 1, x: 30, y: 30 }, vertical: false, preview: null,
  dialog: null, unsaved: false, autosave: { text: '', attend: false }, notice: null, sourceRead: null,
});

export class Store {
  state: State;
  editor: Editor | null = null;
  review: object | null = null;
  recovery: any = null;
  private formContext: any = null;
  private pendingLeave: (() => unknown) | null = null;
  private history: Snapshot[] = [];
  private liveReader: Snapshot | null = null;
  private restoring = false;
  private canvasTree: string | null = null;
  private dialogKey = 0;
  private noticeKey = 0;
  private noticeTimer: unknown;
  private workingTimer: unknown;
  private listeners = new Set<() => void>();
  private layoutCache: { key: unknown[]; value: Layout | null } = { key: [], value: null };
  surface: Surface = { canvas: () => ({ width: 900, height: 600 }), pageScroll: () => 0, setPageScroll: () => {}, scrollToId: () => false, focusKeepEditing: () => {} };

  readonly host: Host;
  constructor(host: Host, preloaded: View | null = null) { this.host = host; this.state = initial(preloaded); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private set(patch: Partial<State>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  get atlas(): Atlas | null { return this.state.data?.atlas ?? null; }
  get publication() { return this.host.publication; }
  api: Api = (path, data, method) => this.host.api(path, data, method);

  // Messages and errors.
  notice(message: string, attend = false) {
    this.set({ notice: { key: ++this.noticeKey, message, attend } });
    this.host.cancel(this.noticeTimer);
    this.noticeTimer = this.host.later(() => this.set({ notice: null }), 6500);
  }
  run = async (action: () => unknown) => { try { await action(); } catch (error) { this.notice((error as Error).message, true); } };

  // Opening and reloading the Atlas.
  async start() {
    if (this.state.data) { await this.applyView(this.state.data, true); return; }
    // A failure to open is drawn in place of the Tree, once; it is not also a passing notice.
    try { await this.refresh(true); }
    catch (error) { this.set({ phase: 'failed', failure: (error as Error).message }); }
  }
  async refresh(initial = false) {
    if (this.state.preview) return;
    const data = this.publication ? await this.host.readPublication() : await this.api('view');
    await this.applyView(data, initial);
  }
  private async applyView(data: View, initial: boolean) {
    this.set({ data, live: data, phase: 'ready', failure: null });
    const atlas = data.atlas;
    if (!atlas) { this.history = []; this.set({ selected: null, backAvailable: false, tree: null }); return; }
    const params = new URLSearchParams(this.host.location().search);
    let tree = initial ? params.get('tree') : this.state.tree;
    let selected: Selected | null = initial ? null : this.state.selected;
    if (!treeById(atlas, tree)) tree = atlas.trees[0]?.id ?? null;
    if (initial && pointById(atlas, params.get('point'))) { const point = pointById(atlas, params.get('point'))!; selected = { kind: 'point', id: point.id, tree: point.tree }; tree = point.tree; }
    if (initial && branchById(atlas, tree, params.get('branch'))) selected = { kind: 'branch', id: params.get('branch')!, tree: tree! };
    if (selected && (selected.kind === 'point' && !pointById(atlas, selected.id) || selected.kind === 'branch' && !branchById(atlas, selected.tree, selected.id))) selected = null;
    this.set({ tree, selected });
    if (selected?.kind === 'source') this.readSource(selected);
    this.drawTree();
    if (initial && params.has('facet')) { const facet = facetById(atlas, tree, params.get('facet')); if (facet) this.select('facet', facet.id, facet.tree, false); }
    if (initial && params.has('source')) {
      const owner = params.has('facet') ? facetById(atlas, tree, params.get('facet')) : pointById(atlas, params.get('point'));
      const index = Number(params.get('sourceIndex'));
      const source = owner?.sources?.[index];
      const hash = this.host.location().hash.slice(1);
      if (source?.uri === params.get('source')) await this.showSource(source, owner ? { kind: params.has('facet') ? 'facet' : 'point', id: owner.id, tree: owner.tree } : undefined, index, hash || undefined);
    }
    const hash = this.host.location().hash;
    if (initial && hash) this.host.frame(() => { try { this.surface.scrollToId(decodeURIComponent(hash.slice(1))); } catch { /* Malformed authored fragments remain inert. */ } });
  }

  // The Tree's drawing.
  layout(): Layout | null {
    const atlas = this.atlas, tree = treeById(atlas, this.state.tree);
    const key = [atlas, tree, this.state.filter, this.state.type, this.state.vertical];
    if (this.layoutCache.value !== undefined && key.every((value, index) => value === this.layoutCache.key[index])) return this.layoutCache.value;
    const value = atlas && tree ? layoutTree(atlas, tree, { query: this.state.filter, type: this.state.type, vertical: this.state.vertical }) : null;
    this.layoutCache = { key, value };
    return value;
  }
  private drawTree() {
    const sameTree = this.canvasTree === this.state.tree;
    this.canvasTree = this.state.tree;
    this.host.frame(() => { if (!sameTree && !this.restoring) this.frameTree(); });
  }
  measure() {
    const vertical = this.surface.canvas().width < 650;
    if (vertical !== this.state.vertical) this.set({ vertical });
  }
  fit() {
    const layout = this.layout(); if (!layout) return;
    const { width, height } = this.surface.canvas();
    const scale = Math.max(.08, Math.min(1, (width - 50) / layout.width, (height - 45) / layout.height));
    this.set({ view: { scale, x: (width - layout.width * scale) / 2, y: (height - layout.height * scale) / 2 } });
  }
  frameTree() {
    this.fit();
    const layout = this.layout();
    if (!layout || this.state.view.scale >= .85 || !layout.nodes.length) return;
    const selected = this.state.selected;
    const focus = layout.nodes.find(node => selected?.tree === this.state.tree && selected.kind === node.kind && selected.id === node.id) ?? layout.nodes[0];
    const { width, height } = this.surface.canvas();
    const scale = .85;
    this.set({ view: { scale, x: width < 650 || !focus.base ? width / 2 - (focus.x + 112) * scale : 30 - focus.x * scale, y: height / 2 - (focus.y + 43) * scale } });
  }
  zoom(factor: number) {
    const rect = this.surface.canvas(), { scale, x, y } = this.state.view;
    const next = Math.max(.08, Math.min(2.5, scale * factor));
    this.set({ view: { scale: next, x: rect.width / 2 - (rect.width / 2 - x) * next / scale, y: rect.height / 2 - (rect.height / 2 - y) * next / scale } });
  }
  pan(dx: number, dy: number) { const view = this.state.view; this.set({ view: { ...view, x: view.x + dx, y: view.y + dy } }); }
  moveTo(x: number, y: number) { this.set({ view: { ...this.state.view, x, y } }); }
  ensureVisible(node: { x: number; y: number }) {
    const rect = this.surface.canvas(), { scale, x, y } = this.state.view;
    const left = x + node.x * scale, top = y + node.y * scale;
    if (left < 0 || left + 225 * scale > rect.width || top < 0 || top + 86 * scale > rect.height) this.set({ view: { scale, x: rect.width / 2 - (node.x + 112) * scale, y: rect.height / 2 - (node.y + 43) * scale } });
  }
  setFilter(filter: string) { this.set({ filter }); this.drawTree(); }
  setType(type: string) { this.set({ type }); this.drawTree(); }
  clearFilters() { this.set({ filter: '', type: '' }); this.drawTree(); }
  chooseTree(tree: string) {
    this.history = [];
    this.set({ readingFocus: false, tree, selected: null, backAvailable: false, filter: '' });
    this.drawTree();
    const { pathname } = this.host.location();
    this.host.history.replace({}, `${pathname}?tree=${encodeURIComponent(tree)}`);
  }
  closePage() {
    this.set({ readingFocus: false, selected: null });
    const { pathname } = this.host.location();
    this.host.history.replace({}, `${pathname}?tree=${encodeURIComponent(this.state.tree ?? '')}`);
    this.drawTree();
  }
  setReadingFocus(readingFocus: boolean) { this.set({ readingFocus }); }
  /** The current Tree's Base Point, when the reader can open it. */
  get overview() { const tree = treeById(this.atlas, this.state.tree), base = pointById(this.atlas, tree?.base); return base && base.publicationAvailable !== false ? base : undefined; }
  readOverview() { const tree = treeById(this.atlas, this.state.tree); if (tree) this.select('point', tree.base, tree.id); }

  // Selection, the address bar and Back.
  readerSnapshot(scroll = this.surface.pageScroll()): Snapshot {
    const { selected, tree, readingFocus, view, filter, type, preview } = this.state;
    return { atlasReader: true, selected, tree, readingFocus, scroll, scale: view.scale, x: view.x, y: view.y, filter, type, preview: preview ? { id: preview.id, revision: preview.revision } : null };
  }
  rememberReader() { const snapshot = this.readerSnapshot(); this.host.history.replace(snapshot, this.host.location().href); return snapshot; }
  remembered() { if (this.state.selected && !this.restoring) this.rememberReader(); }
  readerURL(selected = this.state.selected) { return `${this.host.location().pathname}${readerSearch(selected, this.state.tree)}`; }
  select(kind: Selected['kind'], id: string, tree: string, remember = true, extra: Partial<Extract<Selected, { kind: 'source' }>> = {}) {
    if (remember) { const previous = this.rememberReader(); if (this.state.selected) this.history.push(previous); }
    const patch: Partial<State> = { tree, selected: { kind, id, tree, ...extra } as Selected, backAvailable: this.history.length > 0 };
    if (tree !== this.state.tree) { patch.filter = ''; patch.type = ''; }
    this.set(patch);
    if (kind === 'source') this.readSource(this.state.selected!);
    this.drawTree();
    this.surface.setPageScroll(0);
    this.host.frame(() => this.surface.setPageScroll(0));
    this.host.history[remember ? 'push' : 'replace'](this.readerSnapshot(0), this.readerURL());
  }
  back() { this.host.history.back(); }
  async restoreReader(snapshot: Snapshot | null | undefined) {
    if (!snapshot?.atlasReader) return this.refresh(true);
    if (snapshot.preview && (!this.state.preview || this.state.preview.id !== snapshot.preview.id)) await this.previewDraft({ id: snapshot.preview.id, revision: snapshot.preview.revision }, false);
    else if (!snapshot.preview && this.state.preview) await this.exitPreview(false);
    this.restoring = true;
    const selected = snapshot.selected ? { ...snapshot.selected, ...(snapshot.selected.kind === 'source' ? { restoreScroll: snapshot.scroll } : {}) } as Selected : null;
    this.set({ selected, tree: snapshot.tree, view: { scale: snapshot.scale, x: snapshot.x, y: snapshot.y }, filter: snapshot.filter ?? '', type: snapshot.type ?? '', readingFocus: Boolean(snapshot.readingFocus) });
    if (selected?.kind === 'source') this.readSource(selected);
    this.drawTree();
    this.host.frame(() => { this.surface.setPageScroll(snapshot.scroll ?? 0); this.restoring = false; });
  }
  navigateTo(kind: 'point' | 'branch', id: string, tree: string) { if (this.closeDialog()) this.select(kind, id, tree); }
  showFacet(facet: Facet | undefined) { if (!facet) return; if (this.closeDialog()) this.select('facet', facet.id, facet.tree); }
  openCiter(citer: { kind: string; id: string; tree: string }) {
    if (citer.kind === 'facet') this.showFacet(facetById(this.atlas, citer.tree, citer.id));
    else this.navigateTo('point', citer.id, citer.tree);
  }
  /** Follow an in-reader address: a Link, an authored cross-reference or a pasted query. */
  navigateHref(href: string) {
    const location = this.host.location();
    const url = new URL(href, location.href);
    const params = url.searchParams;
    if (url.origin !== location.origin || url.pathname !== location.pathname || !params.has('point') && !params.has('facet') && !params.has('branch')) return false;
    void this.run(async () => {
      const tree = params.get('tree') ?? this.state.tree!;
      if (params.has('source')) {
        const owner: Owner = params.has('facet') ? { kind: 'facet', id: params.get('facet')!, tree } : { kind: 'point', id: params.get('point')!, tree };
        const record = owner.kind === 'facet' ? facetById(this.atlas, tree, owner.id) : pointById(this.atlas, owner.id);
        const index = Number(params.get('sourceIndex')), source = record?.sources?.[index];
        if (source?.uri === params.get('source')) await this.showSource(source, owner, index, url.hash.slice(1) || undefined);
      } else if (params.has('facet')) this.showFacet(facetById(this.atlas, tree, params.get('facet')));
      else this.navigateTo(params.has('branch') ? 'branch' : 'point', (params.get('branch') ?? params.get('point'))!, tree);
      if (url.hash) this.host.frame(() => { try { this.surface.scrollToId(decodeURIComponent(url.hash.slice(1))); } catch { /* Malformed authored fragments remain inert. */ } });
    });
    return true;
  }

  // A cited source, read in the pane.
  async showSource(source: Source, owner?: Owner, sourceIndex = 0, heading?: string) {
    if (!this.closeDialog()) return;
    const selected = this.state.selected;
    if (!owner && selected && (selected.kind === 'point' || selected.kind === 'facet')) owner = { kind: selected.kind, id: selected.id, tree: selected.tree };
    this.select('source', source.uri, owner?.tree ?? this.state.tree!, true, { source, owner, sourceIndex, heading });
  }
  private async readSource(selected: Selected) {
    if (selected.kind !== 'source' || this.publication) return;
    this.set({ sourceRead: { selected, status: 'reading' } });
    try {
      const preview = this.state.preview;
      const result = await this.api('source', { source: selected.source, ...(preview ? { draft: { id: preview.id, revision: preview.revision } } : {}) });
      if (this.state.selected !== selected) return;
      this.set({ sourceRead: { selected, status: 'ready', result } });
      const fragment = selected.heading ?? (selected.source.uri.includes('#') ? `source-${selected.source.uri.split('#')[1]}` : null);
      if (selected.restoreScroll !== undefined) { const top = selected.restoreScroll; this.host.frame(() => this.surface.setPageScroll(top)); delete selected.restoreScroll; }
      else if (fragment && !this.restoring) this.host.frame(() => { let found = false; try { found = this.surface.scrollToId(decodeURIComponent(fragment)); } catch { /* inert */ } if (!found) this.notice('The cited heading was not found in these source bytes.', true); });
    } catch (error) { if (this.state.selected === selected) this.set({ sourceRead: { selected, status: 'failed', error: (error as Error).message } }); }
  }

  // The editing session: every way out of a form passes this guard.
  leaveEditor(action: () => unknown) {
    const editor = this.editor;
    if (editor?.saving) { this.notice('Wait for this draft save to finish before leaving.'); return false; }
    if (editor?.dirty) { this.pendingLeave = action; this.set({ unsaved: true }); this.host.frame(() => this.surface.focusKeepEditing()); return false; }
    this.editor = null; this.pendingLeave = null;
    if (this.state.unsaved) this.set({ unsaved: false });
    return true;
  }
  showDialog(title: string, view: DialogView, editor: Editor | null = null, review: object | null = null) {
    if (!this.leaveEditor(() => this.showDialog(title, view, editor, review))) return false;
    this.editor = editor; this.review = review;
    this.set({ dialog: { key: ++this.dialogKey, title, view }, ...(editor ? { autosave: { text: 'Typing will be saved privately for recovery.', attend: false } } : {}) });
    return true;
  }
  openDialog(title: string, view: DialogView) { return this.showDialog(title, view); }
  editDialog(title: string, view: DialogView, draft: { id?: string; revision?: string } | null = null) {
    const context = this.formContext; this.formContext = null;
    return this.showDialog(title, view, { dirty: false, saving: false, version: 0, draftId: draft?.id, revision: draft?.revision, title, context });
  }
  closeDialog = (): boolean => {
    if (!this.leaveEditor(this.closeDialog)) return false;
    this.review = null;
    if (this.state.dialog) this.set({ dialog: null });
    return true;
  };
  isOpen(key: number) { return this.state.dialog?.key === key; }
  keepEditing() { this.pendingLeave = null; this.set({ unsaved: false }); }
  discardEdits() {
    const action = this.pendingLeave, editor = this.editor;
    void this.run(() => this.clearWorkingCopy(editor));
    this.editor = null; this.pendingLeave = null; this.set({ unsaved: false });
    action?.();
  }
  /** The page is closing: keep unfinished typing and ask the browser to confirm. */
  beforeUnload(event: { preventDefault(): void; returnValue?: unknown }) {
    if (!this.editor?.dirty && !this.editor?.saving) return;
    void this.run(() => this.persistWorkingCopy(this.editor!));
    event.preventDefault(); event.returnValue = '';
  }
  edited() {
    if (!this.editor) return;
    this.editor.dirty = true; this.editor.version++;
    this.scheduleWorkingCopy(this.editor);
  }
  bindCapture(editor: Editor | null, capture: () => Fields) { if (editor) editor.capture = capture; }
  private setAutosave(editor: Editor, text: string, attend = false) { if (this.editor === editor) this.set({ autosave: { text, attend } }); }
  private scheduleWorkingCopy(editor: Editor) {
    this.host.cancel(this.workingTimer);
    this.workingTimer = this.host.later(() => void this.run(() => this.persistWorkingCopy(editor)), 500);
  }
  async persistWorkingCopy(editor: Editor) {
    if (this.editor !== editor || !editor.dirty || !editor.context) return;
    if (editor.autosaving) { editor.autosaveAgain = true; return; }
    editor.autosaving = true;
    const version = editor.version;
    const fields = editor.capture?.() ?? { controls: [] };
    try {
      const copy = await this.api('working-copies', { ...(editor.working ? { id: editor.working.id, expectedRevision: editor.working.revision } : {}), baseline: editor.context.captured?.identity ?? this.state.data?.identity, form: { kind: editor.context.kind, title: editor.title, context: editor.context, fields } });
      editor.working = copy;
      this.setAutosave(editor, editor.version === version ? 'Typing saved privately for recovery. Save and review to create a candidate.' : 'Saving newer typing…');
    } catch (error) { this.setAutosave(editor, `Recovery save failed: ${(error as Error).message}. Keep this form open.`, true); }
    finally {
      editor.autosaving = false;
      if (editor.clearAfterAutosave) { editor.clearAfterAutosave = false; await this.clearWorkingCopy(editor); }
      if (this.editor === editor && (editor.autosaveAgain || editor.version !== version)) { editor.autosaveAgain = false; this.scheduleWorkingCopy(editor); }
    }
  }
  async clearWorkingCopy(editor: Editor | null) {
    this.host.cancel(this.workingTimer);
    if (editor?.autosaving) { editor.clearAfterAutosave = true; return; }
    if (editor?.working) { await this.api('working-copies', { id: editor.working.id, expectedRevision: editor.working.revision }, 'DELETE'); editor.working = null; }
  }
  private async formCapture(kind: string, context: Record<string, unknown> = {}) {
    const captured = this.recovery?.form.context?.captured ?? await this.api('files');
    this.formContext = { kind, ...context, captured };
    return captured;
  }
  private get recovered(): Fields | undefined { return this.recovery?.form.fields; }

  /** Save a form's change as a draft and review it, unless newer typing arrived meanwhile. */
  async saveForReview(baseline: string, changes: { path: string; content: string | null }[], reason: string, id?: string, sourcePreconditions?: { uri: string; sha256: string }[], styleChange = false) {
    const editor = this.editor;
    if (!editor || editor.saving) return;
    const version = editor.version;
    editor.saving = true;
    try {
      const draftId = editor.draftId ?? id;
      const draft = await this.api('drafts', { baseline, changes, reason, ...(styleChange ? { styleChange: true } : {}), ...(sourcePreconditions ? { sourcePreconditions } : {}), ...(draftId ? { id: draftId, expectedRevision: editor.revision } : {}) });
      if (this.editor !== editor) return;
      editor.draftId = draft.id; editor.revision = draft.revision;
      if (editor.version !== version) { this.notice('Draft saved. Your newer changes are still unsaved; save again before reviewing.'); return; }
      editor.dirty = false; editor.saving = false;
      await this.clearWorkingCopy(editor);
      this.reviewDraft(draft);
    } finally { editor.saving = false; }
  }
  /** Save through a dedicated endpoint, then review the draft it returns. */
  private async saveThrough(request: () => Promise<any>, newerTyping: string, after?: (editor: Editor, saved: any) => void) {
    const editor = this.editor;
    if (!editor || editor.saving) return;
    const version = editor.version; editor.saving = true;
    try {
      const saved = await request();
      if (this.editor !== editor) return;
      after?.(editor, saved);
      if (editor.version !== version) { this.notice(newerTyping); return; }
      editor.dirty = false; editor.saving = false; await this.clearWorkingCopy(editor); this.reviewDraft(saved);
    } finally { editor.saving = false; }
  }
  saveStructure(request: Record<string, unknown>) { return this.saveThrough(() => this.api('structure', request), 'Draft saved. Newer typing remains in this form.'); }

  // Dialogs that only read.
  searchDialog() { this.openDialog('Search Atlas', { kind: 'search' }); }
  showChecks() { this.openDialog('Checks', { kind: 'checks' }); }
  async sourceReviewDialog() {
    const history = this.state.data?.editable ? await this.api('sources/history') : null;
    const atlas = this.atlas!;
    const sources = [...new Set([...atlas.points, ...atlas.facets].flatMap(record => (record.sources ?? []).map(source => source.uri)))];
    this.openDialog('Review source changes', { kind: 'reviewSources', history, sources });
  }
  async connectAgent() { this.openDialog('Connect an agent', { kind: 'connect', configuration: await this.api('connection') }); }
  async exportSite() { this.openDialog('Export site', { kind: 'export', available: await this.api('publication') }); }
  async previewPublication(available: any, request: { trees: string[]; points: string[]; sources: string[]; includeStyle: boolean }) {
    const preview = await this.api('publication/prepare', { baseline: available.identity, ...request });
    this.openDialog('Review publication', { kind: 'exportReview', preview, available });
  }
  async applyPublication(preview: any) {
    const result = await this.api('publication/apply', { id: preview.id });
    this.openDialog('Site exported', { kind: 'exported', result });
  }
  async styleDialog() {
    const available = this.publication || this.state.preview ? { current: this.atlas?.style, styles: [] } : await this.api('styles');
    if (!this.state.data?.editable) { this.openDialog('Atlas style', { kind: 'styleRead', current: available.current }); return; }
    const recovered = this.recovered;
    const files = await this.formCapture('style');
    this.editDialog('Atlas style', { kind: 'style', available, files, recovered });
  }
  saveStyle(files: any, styleContent: string, reason: string) {
    return this.saveThrough(() => this.api('style', { baseline: files.identity, styleContent, reason }), 'Style draft saved. Newer typing remains.');
  }

  // Drafts, review and the candidate.
  async drafts() {
    const [saved, transactions, working] = await Promise.all([this.api('drafts'), this.api('transactions'), this.api('working-copies')]);
    this.openDialog('Drafts and recovery', { kind: 'drafts', saved, transactions, working });
  }
  async openDraft(id: string) { this.reviewDraft(await this.api(`drafts/${id}`)); }
  async discardDraft(draft: any) { await this.api('drafts', { id: draft.id, expectedRevision: draft.revision }, 'DELETE'); await this.drafts(); }
  async discardRecoveryCopy(copy: any) { await this.api('working-copies', { id: copy.id, expectedRevision: copy.revision }, 'DELETE'); await this.drafts(); }
  async restoreOriginal(item: any) {
    const result = await this.api('recover', { id: item.id });
    this.notice(result.baselineRestored ? 'Original Atlas restored.' : 'Affected files restored; other changes remain.');
    await this.refresh(); await this.drafts();
  }
  reviewDraft(draft: any) {
    const review = {};
    this.showDialog('Review draft', { kind: 'review', draft }, null, review);
  }
  /** Apply the reviewed revision; a late result never closes a dialog opened after it. */
  async applyDraft(draft: any) {
    const review = this.review;
    const result = await this.api('apply', { id: draft.id, expectedRevision: draft.revision });
    if (result.status === 'interrupted') { this.notice(`Change interrupted: ${result.error.message}`, true); if (this.review === review) await this.drafts(); return; }
    this.notice(result.status === 'noop' ? 'No change needed.' : 'Draft applied.');
    if (this.review === review) { this.review = null; this.set({ dialog: null }); }
    await this.refresh();
  }
  async previewDraft(draft: { id: string; revision?: string }, remember = true) {
    const preview = await this.api(`drafts/${draft.id}/preview`);
    if (draft.revision && preview.revision !== draft.revision) throw new Error('The draft changed. Reopen its review before previewing.');
    if (!this.closeDialog()) return;
    if (!this.state.preview) this.liveReader = this.readerSnapshot();
    if (remember) this.rememberReader();
    const atlas: Atlas | null = preview.after.atlas;
    let tree = this.state.tree, selected = this.state.selected;
    if (!treeById(atlas, tree)) tree = atlas?.trees[0]?.id ?? null;
    if (!selected || selected.kind === 'source' || selected.kind === 'point' && !pointById(atlas, selected.id)) selected = tree ? { kind: 'point', id: treeById(atlas, tree)!.base, tree } : null;
    this.set({ preview, data: preview.after, live: this.state.preview ? this.state.live : this.state.data, tree, selected });
    this.drawTree();
    if (remember) this.host.history.push(this.readerSnapshot(), this.readerURL());
  }
  async exitPreview(remember = true) {
    if (!this.state.preview) return;
    const previous = this.liveReader;
    this.set({ preview: null, data: this.state.live });
    await this.refresh();
    await this.restoreReader(previous);
    if (remember) this.host.history.push(this.readerSnapshot(), this.readerURL());
  }
  async semanticComparison(draft: any) {
    const preview = await this.api(`drafts/${draft.id}/preview`);
    if (preview.revision !== draft.revision) throw new Error('Reopen the current draft before comparing.');
    this.openDialog('Read proposed changes', { kind: 'semantic', draft, blocks: comparisonBlocks(preview) });
  }
  reviewCandidateChecks(draft: any) {
    this.formContext = { kind: 'checks', draftId: draft.id, draftRevision: draft.revision, baseline: draft.plan.baseline.identity };
    this.editDialog('Review candidate Checks', { kind: 'checksForm', draft, recovered: this.recovered }, draft);
  }
  async saveCheckEvidence(draft: any, actor: string, controls: { check: any; outcome: string; reason: string; evidence: string }[]) {
    if (!actor.trim()) throw new Error('Enter a reviewer name.');
    const candidate = draft.plan.candidate;
    const manual = controls.filter(item => item.outcome !== 'unreviewed').map(({ check, outcome, reason, evidence }) => ({ id: check.id, revision: check.revision, baseline: candidate.identity, outcome, reason, evidence: evidence.trim() ? [{ text: evidence }] : [] }));
    if (!manual.length) throw new Error('Review at least one Check before saving evidence.');
    const editor = this.editor;
    if (!editor) return;
    return this.saveThrough(() => this.api('draft-checks', { id: draft.id, expectedRevision: editor.revision, actor, checkIds: manual.map(item => item.id), manual }), 'Evidence saved. Newer form changes remain unsaved.', (current, saved) => { current.revision = saved.revision; });
  }
  inspectBytes(uri: string, draft?: { id: string; revision: string } | null) {
    return this.api('sources/review', { uris: [uri], ...(draft ? { draft: { id: draft.id, revision: this.editor?.revision ?? draft.revision } } : {}) });
  }
  byteRequirements(sources: Source[], existing: { uri: string; sha256: string }[] = [], draft?: { id: string; revision: string } | null) {
    return new ByteRequirements(sources, existing, uri => this.inspectBytes(uri, draft));
  }
  async recoverWorkingCopy(id: string) {
    const copy = await this.api(`working-copies/${id}`), context = copy.form.context ?? {};
    this.recovery = copy;
    try {
      const atlas = this.atlas;
      const kind = copy.form.kind;
      if (kind === 'point') await this.editPoint(pointById(atlas, context.id) ?? context.record);
      else if (kind === 'facet') await this.editFacet(facetById(atlas, context.tree, context.id) ?? context.record);
      else if (kind === 'records') await this.editRecords(context.draftId);
      else if (kind === 'new-point') await this.newPoint();
      else if (kind === 'new-tree') await this.newTree();
      else if (kind === 'new-facet') await this.newFacet(context.record, context.hostKind);
      else if (kind === 'branch') await this.branchForm(context.record);
      else if (kind === 'position') await this.positionRecord(context.record, context.recordKind);
      else if (kind === 'remove') await this.removePoint(context.record);
      else if (kind === 'style') await this.styleDialog();
      else if (kind === 'checks') {
        const draft = await this.api(`drafts/${context.draftId}`);
        if (draft.revision !== context.draftRevision) { this.openDialog('Earlier candidate review notes', { kind: 'earlierNotes', text: copy.form.fields.controls.map((item: { value: string }) => item.value).filter(Boolean).join('\n\n') }); return; }
        this.reviewCandidateChecks(draft);
      } else if (kind === 'move') await this.moveRecord(context.record);
      else if (kind === 'initialize') await this.initializeAtlas();
      else throw new Error('Open advanced records and use the retained field text to recover this form.');
      const editor = this.editor;
      if (editor) {
        this.edited();
        editor.working = copy;
        if (context.draftRevision) editor.revision = context.draftRevision;
        editor.dirty = true;
        this.setAutosave(editor, copy.baseline === this.state.data?.identity ? 'Recovered private typing. Review it before saving a candidate.' : 'Recovered against an older Atlas. Applying will require a fresh review if the source changed.');
      }
    } finally { this.recovery = null; }
  }

  // Forms. Each opener captures the exact files it edits; its form keeps the person's typing.
  async editPoint(point: Point) {
    const recovered = this.recovered;
    const files = await this.formCapture('point', { id: point.id, tree: point.tree, record: point });
    const file = files.files.find((item: any) => item.path === point.path);
    if (!file) throw new Error('This Point moved or was removed. Refresh the Atlas.');
    const match = frontmatter.exec(file.content);
    if (!match) throw new Error('Use Edit records to repair this Point.');
    const header = JSON.parse(match[1]);
    if (header.id !== point.id) throw new Error('This Point changed identity. Refresh the Atlas.');
    const title = /^# (.*)(?:\r?\n|$)/u.exec(match[2])?.[1];
    if (!title) throw new Error('Use Edit records to repair this Point title.');
    this.editDialog('Edit Point', { kind: 'point', point, files, header, title, explanation: match[2].replace(/^# .*(?:\r?\n|$)/u, '').replace(/^\s*\n/u, ''), recovered });
  }
  savePoint(view: Extract<DialogView, { kind: 'point' }>, values: { title: string; explanation: string; type: string; standing: string; observedAt: string; uncertainty: string; reason: string; sources: Source[]; required: { uri: string; sha256: string }[] }) {
    const header = { ...view.header };
    header.sources = values.sources;
    delete header.type; delete header.status; delete header.observedAt;
    if (values.type !== 'untyped') header.type = values.type;
    if (values.type === 'decision') header.status = values.standing;
    if (values.type === 'observation') header.observedAt = values.observedAt;
    if (values.uncertainty.trim()) header.uncertainty = values.uncertainty; else delete header.uncertainty;
    return this.saveForReview(view.files.identity, [{ path: view.point.path, content: `---\n${JSON.stringify(header)}\n---\n# ${values.title}\n\n${values.explanation.trim()}\n` }], values.reason, undefined, values.required);
  }
  async editFacet(facet: Facet) {
    const recovered = this.recovered;
    const files = await this.formCapture('facet', { id: facet.id, tree: facet.tree, record: facet });
    const file = files.files.find((item: any) => item.path === facet.path);
    const match = frontmatter.exec(file?.content ?? '');
    if (!match) throw new Error('Repair the Facet record in Edit records first.');
    this.editDialog('Edit Facet', { kind: 'facet', facet, files, header: JSON.parse(match[1]), recovered });
  }
  saveFacet(view: Extract<DialogView, { kind: 'facet' }>, values: { title: string; host: string; via: string; targets: Record<string, string>[]; body: string; uncertainty: string; sources: Source[]; reason: string }) {
    const header = { ...view.header };
    const [kind, id] = values.host.split(':'); header.on = { [kind]: id }; header.via = values.via; header.targets = values.targets;
    header.sources = values.sources; if (values.uncertainty.trim()) header.uncertainty = values.uncertainty; else delete header.uncertainty;
    return this.saveForReview(view.files.identity, [{ path: view.facet.path, content: recordText(header, values.title, values.body) }], values.reason);
  }
  async moveRecord(record: Point) {
    const recovered = this.recovered;
    const files = await this.formCapture('move', { record });
    this.editDialog('Move Point file', { kind: 'move', record, files, recovered });
  }
  saveMove(view: Extract<DialogView, { kind: 'move' }>, path: string, reason: string) {
    return this.saveThrough(() => this.api('move', { baseline: view.files.identity, point: view.record.id, path, reason }), 'Move draft saved in Drafts. Newer form changes remain unsaved.');
  }
  async branchForm(record?: any) {
    const recovered = this.recovered;
    const files = await this.formCapture('branch', { record });
    const tree = record?.tree ?? this.state.tree;
    if (!tree) throw new Error('Create a Tree first.');
    this.editDialog(record ? 'Edit Branch' : 'New Branch', { kind: 'branch', record, tree, files, recovered });
  }
  async positionRecord(record: any, recordKind: 'point' | 'branch') {
    const recovered = this.recovered;
    const files = await this.formCapture('position', { record, recordKind });
    this.editDialog('Change position', { kind: 'position', record, recordKind, files, recovered });
  }
  async removePoint(record: Point) {
    const recovered = this.recovered;
    const files = await this.formCapture('remove', { record });
    this.editDialog('Remove or consolidate Point', { kind: 'remove', record, files, recovered });
  }
  async newTree() {
    if (!this.atlas) throw new Error('Repair the Atlas records before adding a Tree.');
    const recovered = this.recovered;
    const files = await this.formCapture('new-tree');
    this.editDialog('New Tree', { kind: 'newTree', files, recovered });
  }
  saveNewTree(files: any, values: { id: string; title: string; scope: string; body: string }) {
    const manifest = JSON.parse(files.files.find((file: any) => file.path === 'atlas.json').content);
    const folder = `trees/${values.id}`, base = `${values.id}-base`;
    manifest.trees.push(folder);
    return this.saveForReview(files.identity, [
      { path: 'atlas.json', content: JSON.stringify(manifest, null, 2) + '\n' },
      { path: `${folder}/tree.json`, content: JSON.stringify({ id: values.id, title: values.title, scope: values.scope, base, children: [] }, null, 2) + '\n' },
      { path: `${folder}/points/base.md`, content: recordText({ id: base }, values.title, values.body) },
    ], `Create ${values.title}`);
  }
  async newPoint(): Promise<void> {
    if (!this.atlas) throw new Error('Repair the Atlas records before adding a Point.');
    if (!this.atlas.trees.length) return this.newTree();
    const recovered = this.recovered;
    const files = await this.formCapture('new-point');
    this.editDialog('New Point', { kind: 'newPoint', files, tree: this.state.tree, recovered });
  }
  saveNewPoint(files: any, values: { tree: string; parent: string; id: string; title: string; body: string }) {
    const tree = treeById(this.atlas, values.tree)!;
    const outline = JSON.parse(files.files.find((file: any) => file.path === tree.path).content);
    const [kind, parentId] = values.parent.split(':');
    const find = (children: any[]): any => { for (const child of children) { if (child[kind] === parentId) return child; const nested = find(child.children ?? []); if (nested) return nested; } };
    const host = parentId === outline.base ? outline : find(outline.children);
    (host.children ??= []).push({ point: values.id });
    const folder = tree.path.slice(0, -'/tree.json'.length);
    return this.saveForReview(files.identity, [{ path: tree.path, content: JSON.stringify(outline, null, 2) + '\n' }, { path: `${folder}/points/${values.id}.md`, content: recordText({ id: values.id }, values.title, values.body) }], `Add ${values.title}`);
  }
  async newFacet(record: any, hostKind: 'point' | 'branch' = 'point') {
    const others = this.atlas!.trees.filter(tree => tree.id !== record.tree);
    if (!others.length) throw new Error('A Facet needs another Tree.');
    const recovered = this.recovered;
    const files = await this.formCapture('new-facet', { record, hostKind });
    this.editDialog('Attach a Facet', { kind: 'newFacet', record, hostKind, files, recovered });
  }
  saveNewFacet(view: Extract<DialogView, { kind: 'newFacet' }>, values: { via: string; target: string; id: string; title: string; body: string }) {
    const folder = treeById(this.atlas, view.record.tree)!.path.slice(0, -'/tree.json'.length);
    if (this.atlas!.facets.some(facet => facet.tree === view.record.tree && facet.id === values.id) || view.files.files.some((file: any) => file.path === `${folder}/facets/${values.id}.md`)) throw new Error('This Tree already has that Facet. Choose a new ID or use Edit records.');
    return this.saveForReview(view.files.identity, [{ path: `${folder}/facets/${values.id}.md`, content: recordText({ id: values.id, on: { [view.hostKind]: view.record.id }, via: values.via, targets: [{ point: values.target }] }, values.title, values.body) }], `Connect ${view.record.title}`);
  }
  async initializeAtlas() {
    const recovered = this.recovered;
    const files = await this.formCapture('initialize');
    const styles = await this.api('styles');
    this.editDialog('Create Atlas', { kind: 'initialize', files, styles, recovered });
  }
  saveInitialize(files: any, values: { id: string; title: string; style: string; custom: string }) {
    return this.saveThrough(() => this.api('initialize', { baseline: files.identity, id: values.id, title: values.title, ...(values.style === 'custom' ? { styleContent: values.custom } : { styleId: values.style }) }), 'Creation draft saved in Drafts. Your newer form changes are still unsaved.');
  }
  async editRecords(id?: string) {
    const recovered = this.recovered;
    const saved = id ? await this.api(`drafts/${id}`) : null;
    const captured = this.recovery?.form.context?.captured ?? (saved ? { identity: saved.plan.baseline.identity, files: saved.plan.candidate.files } : await this.api('files'));
    this.formContext = { kind: 'records', draftId: id, draftRevision: this.recovery?.form.context?.draftRevision ?? saved?.revision, captured };
    this.editDialog('Edit records', { kind: 'records', saved, captured, recovered }, saved);
  }
}
