// The reader: the title strip, the Tree drawn on its canvas, and the reading pane beside it.
import { Fragment, memo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button, Link } from 'react-aria-components';
import {
  type Branch, type Facet, type LaidNode, type Layout, type Point, type Source, type Tree, type Owner,
  branchById, childId, childKind, facetById, facetsAround, outlineChildren, pointById, pointKindLabel,
  readableExcerpt, recordHref, recordOf, sourceHref, treeById,
} from './model.ts';
import { Action, Choice, Expand, Prose, RefLink, Section, Status, TextInput, Uncertainty, useStore, useStoreState } from './controls.tsx';
import type { State } from './store.ts';

/** What the header offers depends on the session; a candidate preview hides what edits the live Atlas. */
export function chrome(state: State, publication: boolean) {
  const live = state.preview ? state.live : state.data;
  const atlas = live?.atlas ?? null, editable = Boolean(live?.editable), preview = Boolean(state.preview);
  return {
    opened: state.phase === 'ready',
    search: Boolean(state.data?.atlas),
    reviewSources: !publication && Boolean(atlas) && !preview,
    style: Boolean(atlas?.style) || Boolean(atlas && editable),
    refresh: !publication && !preview,
    drafts: editable && !preview,
    checks: editable && !preview,
    export: Boolean(live?.canExport) && !preview,
    connect: editable && !preview,
    exitPreview: preview,
    mode: state.phase !== 'ready' ? '' : preview ? 'Candidate preview' : editable ? 'Editor' : publication ? 'Publication' : 'Navigator',
    title: state.phase !== 'ready' ? '' : atlas?.title ?? (live?.canInitialize ? 'New Atlas' : 'Atlas needs repair'),
  };
}

export function TitleStrip() {
  const store = useStore(), state = useStoreState(), shown = chrome(state, store.publication);
  return (
    <header className="topbar">
      <a className="brand" href="./" aria-label="Atlas home">Atlas</a>
      {shown.title ? <span className="atlas-title">{shown.title}</span> : null}
      {shown.mode ? <span className="tag">{shown.mode}</span> : null}
      {shown.opened ? (
        <div className="header-actions">
          <Action primary isDisabled={!shown.search} onPress={() => store.searchDialog()}>Search Atlas</Action>
          {shown.reviewSources ? <Action onPress={() => store.sourceReviewDialog()}>Review sources</Action> : null}
          {shown.style ? <Action onPress={() => store.styleDialog()}>Style</Action> : null}
          {shown.refresh ? <Action onPress={() => store.refresh()}>Refresh</Action> : null}
          {shown.drafts ? <Action onPress={() => store.drafts()}>Drafts</Action> : null}
          {shown.checks ? <Action onPress={() => store.showChecks()}>Checks</Action> : null}
          {shown.export ? <Action onPress={() => store.exportSite()}>Export site</Action> : null}
          {shown.connect ? <Action onPress={() => store.connectAgent()}>Connect an agent</Action> : null}
          {shown.exitPreview ? <Action onPress={() => store.exitPreview()}>Exit candidate preview</Action> : null}
        </div>
      ) : null}
    </header>
  );
}

export function Notices() {
  const state = useStoreState();
  return (
    <>
      {state.data?.stateIssue ? <p id="state-notice" className="state-notice" role="status">{state.data.stateIssue.message}</p> : null}
      {state.preview ? <p id="preview-notice" className="state-notice" role="status">{`Candidate: ${state.preview.reason}. Reading proposed content; nothing has been applied.`}</p> : null}
    </>
  );
}

const typeOptions = [{ id: '', name: 'All Points' }, { id: 'decision', name: 'Decisions' }, { id: 'observation', name: 'Observations' }, { id: 'untyped', name: 'Untyped' }];

function Toolbar() {
  const store = useStore(), state = useStoreState(), atlas = state.data?.atlas;
  if (!atlas) return null;
  return (
    <div className="toolbar">
      <Choice className="tree-picker" label="Tree" value={state.tree ?? ''} onChange={tree => store.chooseTree(tree)} options={atlas.trees.map(tree => ({ id: tree.id, name: tree.title }))} />
      <TextInput className="search-label" label="Find in this Tree" value={state.filter} onChange={value => store.setFilter(value)} placeholder="Titles and explanations" />
      <Choice className="type-picker" label="Type" value={state.type} onChange={value => store.setType(value)} options={typeOptions} />
      <Action isDisabled={!state.filter.trim() && !state.type} onPress={() => store.clearFilters()}>Clear</Action>
    </div>
  );
}

function TreeHeading({ layout }: { layout: Layout | null }) {
  const store = useStore(), state = useStoreState(), data = state.preview ? state.live : state.data;
  if (state.phase === 'opening') return <div className="tree-heading"><div><h1 id="tree-title">Atlas</h1><p id="tree-scope" className="tool" role="status">Opening the Atlas…</p></div></div>;
  if (state.phase === 'failed') return <div className="tree-heading"><div><h1 id="tree-title">The Atlas could not be opened</h1><p id="tree-scope" className="tool attend" role="alert">{state.failure}</p><Action onPress={() => store.start()}>Try again</Action></div></div>;
  const atlas = state.data?.atlas;
  if (!atlas) {
    const create = Boolean(state.data?.canInitialize);
    return (
      <div className="tree-heading"><div>
        <h1 id="tree-title">{create ? 'Create an Atlas here' : 'This Atlas needs repair'}</h1>
        <p id="tree-scope" className={`tool${create ? '' : ' attend'}`}>{create ? 'Organize this project’s knowledge. Review the draft before creating the Atlas.' : state.data?.diagnostics.map(item => `✗ ${item.path}: ${item.message}`).join('\n')}</p>
        {create ? <Action primary onPress={() => store.initializeAtlas()}>Create Atlas</Action> : null}
      </div></div>
    );
  }
  const tree = treeById(atlas, state.tree);
  const count = layout ? layout.filtering ? `${layout.matches} of ${layout.total} Points` : `${layout.total} ${layout.total === 1 ? 'Point' : 'Points'}` : '';
  return (
    <div className="tree-heading">
      <div>
        <h1 id="tree-title">{tree?.title ?? 'No Trees yet'}</h1>
        <p id="tree-scope" className={tree ? undefined : 'tool'}>{tree?.scope ?? 'Create a Tree for a subject you want to explain.'}</p>
        {tree ? (
          <div id="reading-start" className="reading-start">
            {store.overview ? <Action onPress={() => store.readOverview()}>Read overview</Action> : null}
            <span>Follow a Point into its detail, other perspectives and sources.</span>
          </div>
        ) : null}
        {data?.editable && !tree && atlas.trees.length === 0 ? <Action primary onPress={() => store.newTree()}>Create Tree</Action> : null}
      </div>
      <span id="point-count" className="count" aria-live="polite">{count}</span>
    </div>
  );
}

const TreeNodes = memo(function TreeNodes({ layout, tree, selected, facetCounts }: { layout: Layout; tree: Tree; selected: string | null; facetCounts: Map<string, number> }) {
  const store = useStore();
  return (
    <>
      <svg id="connections" aria-hidden="true" width={layout.width} height={layout.height}>
        {layout.lines.map(line => <path key={line.key} d={line.d} />)}
      </svg>
      <div id="nodes">
        {layout.nodes.map(node => <TreeNode key={node.key} node={node} active={selected === node.key} facets={facetCounts.get(node.key) ?? 0} onSelect={() => store.select(node.kind, node.id, tree.id)} onFocusVisible={() => store.ensureVisible(node)} />)}
      </div>
    </>
  );
});

function TreeNode({ node, active, facets, onSelect, onFocusVisible }: { node: LaidNode; active: boolean; facets: number; onSelect: () => void; onFocusVisible: () => void }) {
  const kind = node.base ? 'Base Point' : node.kind === 'branch' ? 'Branch' : (node.record as Point | undefined)?.type ?? 'Point';
  const classes = ['node', node.kind, node.base && 'base', active && 'selected', !node.match && 'context'].filter(Boolean).join(' ');
  // The node's name is what it shows: its kind, its Facets, its title, and whether it is only context for a match.
  return (
    <Button
      className={classes}
      style={{ left: `${node.x}px`, top: `${node.y}px` }}
      aria-current={active ? 'true' : undefined}
      onPress={onSelect}
      onFocus={event => { if ((event.target as HTMLElement).matches?.(':focus-visible')) onFocusVisible(); }}
    >
      <span className="node-head">
        <span className="node-kind">{node.match ? kind : `${kind} · context`}</span>
        {facets ? <span className="node-facets"><span aria-hidden="true">↗ </span>{`${facets} ${facets === 1 ? 'Facet' : 'Facets'}`}</span> : null}
      </span>
      <span className="node-label">{node.title}</span>
    </Button>
  );
}

function Canvas({ layout, tree }: { layout: Layout | null; tree: Tree | undefined }) {
  const store = useStore(), state = useStoreState(), ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    store.surface.canvas = () => { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; };
    store.measure();
    const resize = () => store.measure();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) store.zoom(event.deltaY < 0 ? 1.07 : 1 / 1.07); else store.pan(-event.deltaX, -event.deltaY);
    };
    window.addEventListener('resize', resize);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('wheel', wheel); };
  }, [store]);
  const atlas = state.data?.atlas;
  const selected = state.selected && state.selected.tree === tree?.id && (state.selected.kind === 'point' || state.selected.kind === 'branch') ? `${state.selected.kind}:${state.selected.id}` : null;
  const counts = new Map<string, number>();
  if (atlas && tree) for (const facet of atlas.facets) if (facet.tree === tree.id) { const key = facet.on.point ? `point:${facet.on.point}` : `branch:${facet.on.branch}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const { scale, x, y } = state.view;
  return (
    <div
      id="canvas" ref={ref} role="region" tabIndex={layout ? 0 : undefined}
      aria-label="Tree canvas. Drag or use the arrow keys to pan; use the zoom controls to change scale."
      onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; drag.current = { x: event.clientX, y: event.clientY, startX: store.state.view.x, startY: store.state.view.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const start = drag.current; if (start) store.moveTo(start.startX + event.clientX - start.x, start.startY + event.clientY - start.y); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] };
        const offset = offsets[event.key];
        if (offset) { event.preventDefault(); store.pan(offset[0], offset[1]); }
      }}
    >
      {layout && tree ? (
        <div id="stage" style={{ width: `${layout.width}px`, height: `${layout.height}px`, transform: `translate(${x}px,${y}px) scale(${scale})` }}>
          <TreeNodes layout={layout} tree={tree} selected={selected} facetCounts={counts} />
        </div>
      ) : null}
      {layout && !layout.nodes.length ? <p id="empty">No Points match. Try another filter.</p> : null}
    </div>
  );
}

function CanvasFooter() {
  const store = useStore(), state = useStoreState();
  if (!state.data?.atlas || !treeById(state.data.atlas, state.tree)) return null;
  return (
    <div className="canvas-footer">
      <div role="group" aria-label="Zoom">
        <Action label="Zoom out" className="zoom" onPress={() => store.zoom(1 / 1.2)}>−</Action>
        <span id="zoom-level">{`${Math.round(state.view.scale * 100)}%`}</span>
        <Action label="Zoom in" className="zoom" onPress={() => store.zoom(1.2)}>+</Action>
        <Action onPress={() => store.fit()}>Fit</Action>
      </div>
    </div>
  );
}

export function Workspace() {
  const store = useStore(), state = useStoreState();
  const layout = store.layout(), tree = treeById(state.data?.atlas, state.tree);
  return (
    <section className="workspace" aria-label="Tree navigator">
      <Toolbar />
      <TreeHeading layout={layout} />
      <Canvas layout={layout} tree={tree} />
      <CanvasFooter />
    </section>
  );
}

// The reading pane.
const sourceMeta = (source: Source) => [source.role, source.revision, source.locator].filter(Boolean).join(' · ');

function SourceList({ sources, owner }: { sources: Source[]; owner: Owner }) {
  const store = useStore();
  return (
    <div className="source-list">
      {sources.map((source, index) => {
        const name = source.title ?? source.uri, web = /^https?:\/\//i.test(source.uri);
        const included = store.publication && source.publishedPath;
        return (
          <div className="source-row" key={`${source.uri}#${index}`}>
            <div className="source-info">{name}{sourceMeta(source) ? <small>{sourceMeta(source)}</small> : null}{store.publication && !web && !included ? <small>Source not included</small> : null}</div>
            {web ? <Link className="button" href={source.uri} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} in a new tab`}>Open <span aria-hidden="true">↗</span></Link>
              : included ? <Link className="button" href={source.publishedHtmlPath ?? source.publishedPath} target="_blank" rel="noopener noreferrer" aria-label={`Read ${name} in a new tab`}>Read</Link>
              : store.publication ? null
              : <Link className="button" href={sourceHref(source, owner, index)} aria-label={`Read ${name}`}>Read</Link>}
          </div>
        );
      })}
    </div>
  );
}

function FacetCard({ facet }: { facet: Facet }) {
  const store = useStore(), state = useStoreState(), atlas = state.data!.atlas!;
  const host = facet.on.point ? pointById(atlas, facet.on.point) : branchById(atlas, facet.tree, facet.on.branch);
  const via = treeById(atlas, facet.via);
  return (
    <article className="facet-card" id={`facet-${facet.tree}-${facet.id}`}>
      <h4 className="title">{facet.title}</h4>
      <p className="minor">{`${treeById(atlas, facet.tree)?.title ?? facet.tree} · attached to ${host?.title ?? 'Not published'}`}</p>
      <Prose html={facet.html} />
      {facet.uncertainty ? <Uncertainty text={facet.uncertainty} /> : null}
      <div className="refs">
        {facet.targets.map((target, index) => {
          const record = target.point ? pointById(atlas, target.point) : target.branch ? branchById(atlas, facet.via, target.branch) : via;
          const available = Boolean(via && record && (record as Point).publicationAvailable !== false);
          const href = recordHref(target.branch ? 'branch' : 'point', (target.point ?? target.branch ?? via?.base ?? '') as string, facet.via);
          return <RefLink key={index} href={href} isDisabled={!available}>{available ? `${via!.title} → ${record!.title}` : `${facet.via}/${target.point ?? target.branch ?? target.tree} · not published`}</RefLink>;
        })}
      </div>
      {state.data?.editable ? <div className="edit-actions"><Action onPress={() => store.editFacet(facet)}>Edit Facet</Action></div> : null}
      {facet.sources?.length ? <SourceList sources={facet.sources} owner={{ kind: 'facet', id: facet.id, tree: facet.tree }} /> : null}
      {facet.citers?.length ? <Expand title="Cited by" level={5}><div className="refs">{facet.citers.map(citer => <RefLink key={`${citer.kind}/${citer.tree}/${citer.id}`} href={recordHref(citer.kind, citer.id, citer.tree)}>{citer.title}</RefLink>)}</div></Expand> : null}
    </article>
  );
}

function ChildLinks({ tree, children }: { tree: Tree; children: { point?: string; branch?: string }[] }) {
  const atlas = useStoreState().data!.atlas!;
  return (
    <div className="refs child-explanations">
      {children.map(child => {
        const kind = childKind(child), id = childId(child), record = recordOf(atlas, tree.id, kind, id) as Point | undefined;
        const body = record?.body;
        return (
          <article key={`${kind}:${id}`}>
            <RefLink href={recordHref(kind, id, tree.id)}>{record?.title ?? 'Not published'}</RefLink>
            <p className="minor">
              {kind === 'branch' ? <><span className="cap kind">Branch</span>grouped detail</>
                : record?.publicationAvailable === false ? 'Not included'
                : <><span className="cap kind">{record?.type ?? 'Point'}</span><span className="excerpt">{`${readableExcerpt(body?.slice(0, 180))}${(body?.length ?? 0) > 180 ? '…' : ''}`}</span></>}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function Around({ kind, id, tree, record }: { kind: 'point' | 'branch'; id: string; tree: Tree; record: Point | Branch }) {
  const atlas = useStoreState().data!.atlas!;
  const { attached, surrounding, broader, incoming } = facetsAround(atlas, { kind, id, tree: tree.id }, record);
  const citers = (record as Point).citers ?? [];
  return (
    <>
      {attached.length ? <Section title="Through another Tree">{attached.map(facet => <FacetCard key={facet.id} facet={facet} />)}</Section> : null}
      {surrounding.length ? <Section title="On the surrounding Branch">{surrounding.map(facet => <FacetCard key={facet.id} facet={facet} />)}</Section> : null}
      {broader.length ? (
        <Expand section title={`From the broader explanation (${broader.length})`}>
          <p className="minor">These Facets belong to ancestor Points; their scope remains with those explanations.</p>
          {broader.map(facet => <FacetCard key={facet.id} facet={facet} />)}
        </Expand>
      ) : null}
      {incoming.length ? <Section title="Referenced by other accounts"><div className="refs">{incoming.map(facet => <RefLink key={`${facet.tree}/${facet.id}`} href={recordHref('facet', facet.id, facet.tree)}>{`${treeById(atlas, facet.tree)?.title ?? facet.tree}: ${facet.title}`}</RefLink>)}</div></Section> : null}
      {citers.length ? <Section title="Cited by"><div className="refs">{citers.map(citer => <RefLink key={`${citer.kind}/${citer.tree}/${citer.id}`} href={recordHref(citer.kind, citer.id, citer.tree)}>{`${treeById(atlas, citer.tree)?.title ?? citer.tree}: ${citer.title}`}</RefLink>)}</div></Section> : null}
      <p className="reference">{`Reference: ${record.tree}/${record.id}`}</p>
    </>
  );
}

function Breadcrumb({ tree, record }: { tree: Tree; record: Point | Branch }) {
  const atlas = useStoreState().data!.atlas!;
  return (
    <nav className="breadcrumb" aria-label="Point ancestry">
      <RefLink href={recordHref('point', tree.base, tree.id)}>{tree.title}</RefLink>
      {(record.ancestors ?? []).filter(ancestor => ancestor.id !== tree.base).map(ancestor => (
        <Fragment key={`${ancestor.kind}:${ancestor.id}`}>
          <span className="sep" aria-hidden="true">›</span>
          <RefLink href={recordHref(ancestor.kind, ancestor.id, tree.id)}>{recordOf(atlas, tree.id, ancestor.kind, ancestor.id)?.title ?? 'Not published'}</RefLink>
        </Fragment>
      ))}
    </nav>
  );
}

function PointPage({ point, tree }: { point: Point; tree: Tree }) {
  const store = useStore(), state = useStoreState();
  if (point.publicationAvailable === false) return <><Breadcrumb tree={tree} record={point} /><h2 className="tool">Not published</h2><p className="minor">This Point was excluded from the publication.</p></>;
  const children = outlineChildren(tree, 'point', point.id);
  return (
    <>
      <Breadcrumb tree={tree} record={point} />
      <div className="point-meta">
        <span className="badge">{pointKindLabel(point, tree)}</span>
        {point.status ? <span className="badge">{point.status}</span> : null}
        {point.observedAt ? <span className="badge">{`observed ${point.observedAt}`}</span> : null}
      </div>
      <h2 className="title">{point.title}</h2>
      <Prose html={point.html} />
      {point.uncertainty ? <Uncertainty text={point.uncertainty} /> : null}
      {state.data?.editable ? (
        <div className="edit-actions">
          <Action onPress={() => store.editPoint(point)}>Edit Point</Action>
          <Action onPress={() => store.newFacet(point)}>Attach a Facet</Action>
          <Action onPress={() => store.moveRecord(point)}>Move file</Action>
          <Action onPress={() => store.positionRecord(point, 'point')}>Change position</Action>
          {point.id !== tree.base ? <Action onPress={() => store.removePoint(point)}>Remove or consolidate</Action> : null}
        </div>
      ) : null}
      {children.length ? <Section title="Develop this explanation"><ChildLinks tree={tree} children={children} /></Section> : null}
      {point.sources?.length ? <Section title="Sources"><SourceList sources={point.sources} owner={{ kind: 'point', id: point.id, tree: point.tree }} /></Section> : null}
      <Around kind="point" id={point.id} tree={tree} record={point} />
    </>
  );
}

function BranchPage({ branch, tree }: { branch: Branch; tree: Tree }) {
  const store = useStore(), state = useStoreState(), atlas = state.data!.atlas!;
  return (
    <>
      <Breadcrumb tree={tree} record={branch} />
      <div className="point-meta"><span className="badge">Branch</span></div>
      <h2 className="title">{branch.title}</h2>
      <div className="refs">
        {branch.children.map(child => { const kind = childKind(child), id = childId(child); return <RefLink key={`${kind}:${id}`} href={recordHref(kind, id, tree.id)}>{recordOf(atlas, tree.id, kind, id)?.title ?? 'Not published'}</RefLink>; })}
      </div>
      {state.data?.editable ? (
        <div className="edit-actions">
          <Action onPress={() => store.branchForm(branch)}>Edit Branch</Action>
          <Action onPress={() => store.positionRecord(branch, 'branch')}>Change position</Action>
          <Action onPress={() => store.newFacet(branch, 'branch')}>Attach a Facet</Action>
        </div>
      ) : null}
      <Around kind="branch" id={branch.id} tree={tree} record={branch} />
    </>
  );
}

function FacetPage({ facet }: { facet: Facet }) {
  const atlas = useStoreState().data!.atlas!;
  const hostKind = facet.on.point ? 'point' : 'branch', hostId = (facet.on.point ?? facet.on.branch)!;
  const host = hostKind === 'point' ? pointById(atlas, hostId) : branchById(atlas, facet.tree, hostId);
  return (
    <>
      <nav className="breadcrumb" aria-label="Facet host"><RefLink href={recordHref(hostKind, hostId, facet.tree)}>{`${treeById(atlas, facet.tree)?.title}: ${host?.title}`}</RefLink></nav>
      <div className="point-meta"><span className="badge">Facet</span><span className="badge">host-owned interpretation</span></div>
      <FacetCard facet={facet} />
    </>
  );
}

function SourcePage() {
  const store = useStore(), state = useStoreState();
  const selected = state.selected;
  if (selected?.kind !== 'source') return null;
  const { source, owner } = selected;
  const read = state.sourceRead?.selected === selected ? state.sourceRead : null;
  const context = source.publishedHtmlPath ?? source.publishedPath;
  let body: ReactNode;
  if (store.publication) body = context ? <p><Link href={context}>Read included source</Link></p> : <p className="minor">Source not included.</p>;
  else if (!read || read.status === 'reading') body = <p className="minor" role="status">Reading source…</p>;
  else if (read.status === 'failed') body = <p className="alert" role="alert">{`✗ ${read.error}`}</p>;
  else {
    const result = read.result;
    const raw = <pre className="source-text">{result.content}</pre>;
    body = result.content === undefined || result.content === null
      ? <p className="source-status"><Status value={result.status} />{` ${result.message ?? ''}`}</p>
      : <>
        {result.html ? <Prose html={result.html} /> : raw}
        {result.sha256 ? <Expand section title="Source details"><p className="record-path">{`SHA-256 ${result.sha256}`}</p></Expand> : null}
        {result.html ? <Expand section title="Exact source text">{raw}</Expand> : null}
      </>;
  }
  return (
    <>
      {owner ? <p><Link className="button" href={recordHref(owner.kind, owner.id, owner.tree)}>Return to citing explanation</Link></p> : null}
      <h2 className="source-title">{source.title ?? source.uri}</h2>
      {source.title ? <p className="record-path">{source.uri}</p> : null}
      {sourceMeta(source) ? <p className="minor">{sourceMeta(source)}</p> : null}
      {body}
    </>
  );
}

export function ReadingPane() {
  const store = useStore(), state = useStoreState(), ref = useRef<HTMLElement>(null);
  const atlas = state.data?.atlas, selected = state.selected;
  useEffect(() => {
    store.surface.pageScroll = () => ref.current?.scrollTop ?? 0;
    store.surface.setPageScroll = top => { if (ref.current) ref.current.scrollTop = top; };
  }, [store]);
  if (!atlas || !selected) return null;
  let page: ReactNode = null;
  if (selected.kind === 'source') page = <SourcePage />;
  else if (selected.kind === 'facet') { const facet = facetById(atlas, selected.tree, selected.id); if (facet) page = <FacetPage facet={facet} />; }
  else {
    const tree = treeById(atlas, selected.tree);
    const record = selected.kind === 'point' ? pointById(atlas, selected.id) : branchById(atlas, selected.tree, selected.id);
    if (tree && record) page = selected.kind === 'point' ? <PointPage point={record as Point} tree={tree} /> : <BranchPage branch={record as Branch} tree={tree} />;
  }
  if (!page) return null;
  return (
    <aside id="page" aria-label="Reading pane" ref={ref} onScroll={() => store.remembered()}>
      <div id="page-controls">
        {state.backAvailable ? <Action onPress={() => store.back()}>Back</Action> : null}
        <Action onPress={() => store.setReadingFocus(!state.readingFocus)}>{state.readingFocus ? 'Show Tree' : 'Focus reading'}</Action>
        <Action id="close-page" label="Close reading pane" onPress={() => store.closePage()}>Close</Action>
      </div>
      <div id="page-content" key={`${selected.kind}:${selected.tree}:${selected.id}`}>{page}</div>
    </aside>
  );
}
