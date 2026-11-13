// What the Portal reads and how it is arranged: pure functions over the presented
// Atlas, shared by the browser, the export prerender and the Node tests.

export type Kind = 'point' | 'branch';
export type Child = { point?: string; branch?: string; children?: Child[] };
export type Ancestor = { kind: Kind; id: string; tree: string };
export type Source = { uri: string; title?: string; role?: string; revision?: string; locator?: string; sha256?: string; publishedPath?: string; publishedHtmlPath?: string };
export type Citer = { kind: 'point' | 'facet'; id: string; tree: string; title: string };
export type Tree = { id: string; title: string; scope?: string; base: string; children?: Child[]; path: string };
export type Point = {
  id: string; tree: string; title: string; body?: string; html?: string; path: string;
  type?: string; status?: string; observedAt?: string; uncertainty?: string;
  sources?: Source[]; ancestors?: Ancestor[]; citers?: Citer[]; publicationAvailable?: boolean;
};
export type Branch = { id: string; tree: string; title: string; ancestors?: Ancestor[]; children: Child[]; path?: string };
export type Target = { point?: string; branch?: string; tree?: string };
export type Facet = {
  id: string; tree: string; title: string; body?: string; html?: string; path: string;
  on: { point?: string; branch?: string }; via: string; targets: Target[];
  uncertainty?: string; sources?: Source[]; citers?: Citer[];
};
export type Check = { id: string; title: string; status: string; level: string; revision: string; body?: string; html?: string };
export type Style = { id: string; revision: string; title: string; path?: string; body?: string; content?: string; html?: string };
export type Atlas = { id: string; title: string; trees: Tree[]; points: Point[]; branches: Branch[]; facets: Facet[]; checks?: Check[]; style?: Style | null };
export type Diagnostic = { path: string; message: string; line?: number };
export type View = {
  format?: string; status?: string; identity?: string; diagnostics: Diagnostic[]; editable?: boolean; atlas: Atlas | null;
  canInitialize?: boolean; canExport?: boolean; stateIssue?: { code?: string; message: string } | null;
};
export type Owner = { kind: 'point' | 'facet'; id: string; tree: string };
export type Selected =
  | { kind: 'point' | 'branch' | 'facet'; id: string; tree: string }
  | { kind: 'source'; id: string; tree: string; source: Source; owner?: Owner; sourceIndex: number; heading?: string; restoreScroll?: number };

export const pointById = (atlas: Atlas | null | undefined, id: string | null | undefined) => atlas?.points.find(point => point.id === id);
export const treeById = (atlas: Atlas | null | undefined, id: string | null | undefined) => atlas?.trees.find(tree => tree.id === id);
export const branchById = (atlas: Atlas | null | undefined, tree: string | null | undefined, id: string | null | undefined) => atlas?.branches.find(branch => branch.tree === tree && branch.id === id);
export const facetById = (atlas: Atlas | null | undefined, tree: string | null | undefined, id: string | null | undefined) => atlas?.facets.find(facet => facet.tree === tree && facet.id === id);
export const facetHost = (facet: Facet, kind: string, id: string, tree: string) => facet.tree === tree && facet.on[kind as Kind] === id;
export const childKind = (child: Child): Kind => child.point ? 'point' : 'branch';
export const childId = (child: Child) => (child.point ?? child.branch) as string;
export const recordOf = (atlas: Atlas | null | undefined, tree: string, kind: Kind, id: string) => kind === 'point' ? pointById(atlas, id) : branchById(atlas, tree, id);

/** Markdown reduced to readable text for an excerpt. */
export const readableExcerpt = (text?: string | null) => (text ?? '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[^\n]*\/[^\n]*\)\s*/, '')
  .replace(/\]\([^)]*$/g, '').replace(/[[\]`*_]/g, '').replace(/^#{1,6}\s+/gm, '');

export function outlineChildren(tree: Tree, kind: string, id: string): Child[] {
  if (kind === 'point' && tree.base === id) return tree.children ?? [];
  const find = (children: Child[]): Child[] | undefined => {
    for (const child of children) {
      if (child[kind as Kind] === id) return child.children ?? [];
      const nested = find(child.children ?? []);
      if (nested) return nested;
    }
  };
  return find(tree.children ?? []) ?? [];
}

/** The query string that reopens a selection: the reader's address for it. */
export function readerSearch(selected: Selected | null, tree: string | null | undefined) {
  const params = new URLSearchParams({ tree: selected?.tree ?? tree ?? '' });
  if (selected?.kind === 'source') {
    if (selected.owner) params.set(selected.owner.kind, selected.owner.id);
    params.set('source', selected.source.uri); params.set('sourceIndex', String(selected.sourceIndex ?? 0));
  } else if (selected) params.set(selected.kind, selected.id);
  return `?${params}`;
}
export const recordHref = (kind: 'point' | 'branch' | 'facet', id: string, tree: string) => readerSearch({ kind, id, tree }, tree);
export const sourceHref = (source: Source, owner: Owner, sourceIndex: number) => readerSearch({ kind: 'source', id: source.uri, tree: owner.tree, source, owner, sourceIndex }, owner.tree);

export const isPublished = (point?: Point) => Boolean(point) && point!.publicationAvailable !== false;
export const pointKindLabel = (point: Point | undefined, tree: Tree) => point?.id === tree.base ? 'Base Point' : point?.type ?? 'Point';

/** The Facets a reader meets beside a selected Point or Branch, each set apart by its scope. */
export function facetsAround(atlas: Atlas, selected: { kind: string; id: string; tree: string }, record: { ancestors?: Ancestor[] }) {
  const tree = treeById(atlas, selected.tree)!;
  const attached = atlas.facets.filter(facet => facetHost(facet, selected.kind, selected.id, tree.id));
  const ancestors = record.ancestors ?? [];
  const surrounding = selected.kind === 'point' ? atlas.facets.filter(facet => facet.tree === tree.id && facet.on.branch && ancestors.some(a => a.kind === 'branch' && a.id === facet.on.branch)) : [];
  const broader = selected.kind === 'point' ? atlas.facets.filter(facet => facet.tree === tree.id && facet.on.point && ancestors.some(a => a.kind === 'point' && a.id === facet.on.point)) : [];
  const incoming = atlas.facets.filter(facet => facet.via === tree.id && facet.targets.some(target => target[selected.kind as Kind] === selected.id || (selected.kind === 'point' && selected.id === tree.base && target.tree === tree.id)));
  return { attached, surrounding, broader, incoming };
}

// The drawing of one Tree: which nodes the filters keep, where each sits, and the lines between them.
export const NODE = { point: { width: 225, height: 86 }, branch: { width: 210, height: 66 } } as const;
export type LaidNode = { key: string; id: string; kind: Kind; title: string; base: boolean; record?: Point | Branch; x: number; y: number; depth: number; parent: LaidNode | null; children: LaidNode[]; axis: number; match: boolean };
export type Layout = { nodes: LaidNode[]; lines: { key: string; d: string }[]; width: number; height: number; total: number; matches: number; filtering: boolean };

export function layoutTree(atlas: Atlas, tree: Tree, { query = '', type = '', vertical = false }: { query?: string; type?: string; vertical?: boolean }): Layout {
  const all: LaidNode[] = [];
  const walk = (item: Child, parent: LaidNode | null, depth: number): LaidNode => {
    const kind = childKind(item), id = childId(item);
    const record = recordOf(atlas, tree.id, kind, id);
    const node: LaidNode = { id, kind, record, parent, depth, key: `${kind}:${id}`, children: [], title: record?.title ?? 'Not published', base: id === tree.base && kind === 'point', x: 0, y: 0, axis: 0, match: false };
    all.push(node);
    node.children = (item.children ?? []).map(child => walk(child, node, depth + 1));
    return node;
  };
  const root = walk({ point: tree.base, children: tree.children }, null, 0);
  const needle = query.trim().toLocaleLowerCase();
  const filtering = Boolean(needle || type);
  const matches = new Set(all.filter(node => node.kind === 'point' && (node.record as Point | undefined)?.publicationAvailable !== false &&
    (!needle || `${node.title} ${(node.record as Point | undefined)?.body ?? ''}`.toLocaleLowerCase().includes(needle)) &&
    (!type || ((node.record as Point | undefined)?.type ?? 'untyped') === type)).map(node => node.key));
  const included = new Set<string>();
  if (!filtering) all.forEach(node => included.add(node.key));
  else all.filter(node => matches.has(node.key)).forEach(node => { let cursor: LaidNode | null = node; while (cursor) { included.add(cursor.key); cursor = cursor.parent; } });
  let cursor = 0;
  const place = (node: LaidNode) => {
    if (!included.has(node.key)) return;
    const children = node.children.filter(child => included.has(child.key));
    children.forEach(place);
    node.axis = children.length ? (children[0].axis + children[children.length - 1].axis) / 2 : cursor++;
    node.x = vertical ? 30 + node.axis * 260 : 30 + node.depth * 280;
    node.y = vertical ? 30 + node.depth * 135 : 30 + node.axis * 128;
  };
  place(root);
  const nodes = all.filter(node => included.has(node.key));
  nodes.forEach(node => { node.match = !filtering || matches.has(node.key); });
  const lines = nodes.filter(node => node.parent && included.has(node.parent.key)).map(node => {
    const parent = node.parent!;
    const x = parent.x + NODE[parent.kind].width, y = parent.y + 43;
    const d = vertical
      ? `M ${parent.x + 110} ${parent.y + NODE[parent.kind].height} C ${parent.x + 110} ${node.y - 24}, ${node.x + 110} ${node.y - 24}, ${node.x + 110} ${node.y}`
      : `M ${x} ${y} C ${x + 35} ${y}, ${node.x - 35} ${node.y + 43}, ${node.x} ${node.y + 43}`;
    return { key: node.key, d };
  });
  const total = all.filter(node => node.kind === 'point' && (node.record as Point | undefined)?.publicationAvailable !== false).length;
  return {
    nodes, lines, total, matches: matches.size, filtering,
    width: Math.max(300, ...nodes.map(node => node.x + 250)),
    height: Math.max(160, ...nodes.map(node => node.y + 110)),
  };
}

// Statuses carry a mark and a word. Red marks only a difference the reader must attend to.
const marks: Record<string, string> = {
  current: '✓', resolved: '✓', pass: '✓', ready: '✓', 'reviewed-unchanged': '✓', updated: '✓',
  changed: '△', 'needs-review': '△',
  missing: '✗', 'missing-heading': '✗', invalid: '✗', incomplete: '✗', fail: '✗',
  denied: '○', uninspected: '○', unable: '○', unavailable: '○', noop: '○', unreviewed: '○',
};
const attention = new Set(['changed', 'needs-review', 'missing', 'missing-heading', 'invalid', 'incomplete', 'fail']);
export const statusMark = (status: string) => marks[status] ?? '·';
export const needsAttention = (status: string) => attention.has(status);
