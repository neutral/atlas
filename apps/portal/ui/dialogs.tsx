// The dialog sheet and the dialogs that read, review and publish. Forms live in forms.tsx.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Heading, Input, Modal, ModalOverlay, SearchField, TextArea, TextField } from 'react-aria-components';
import { searchRecords } from 'atlas-search';
import { type Atlas, facetById, pointById, readableExcerpt, recordHref, treeById } from './model.ts';
import { Action, Choice, Expand, Prose, RefLink, Section, Status, TextInput, Tick, Uncertainty, useStore, useStoreState } from './controls.tsx';
import type { ComparisonBlock, ComparisonSide, Dialog as DialogState, DialogView } from './store.ts';
import { EditForm } from './forms.tsx';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function DialogHost() {
  const store = useStore(), state = useStoreState(), keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { store.surface.focusKeepEditing = () => keep.current?.focus(); }, [store]);
  const dialog = state.dialog;
  return (
    <ModalOverlay className="overlay" isOpen={Boolean(dialog)} onOpenChange={open => { if (!open) store.closeDialog(); }}>
      <Modal className="modal">
        <Dialog id="draft-dialog" className="sheet-dialog">
          {dialog ? (
            <>
              <div className="dialog-top">
                <Heading slot="title">{dialog.title}</Heading>
                <Action label="Close dialog" onPress={() => store.closeDialog()}>Close</Action>
              </div>
              {state.unsaved ? (
                <div id="unsaved-warning" className="alert" role="alert">
                  <p>You have unsaved changes. Keep editing, or discard them to leave this form.</p>
                  <div className="draft-actions">
                    <Button ref={keep} className="button primary" onPress={() => store.keepEditing()}>Keep editing</Button>
                    <Action danger onPress={() => store.discardEdits()}>Discard unsaved changes</Action>
                  </div>
                </div>
              ) : null}
              <div id="draft-content" key={dialog.key}><DialogBody dialog={dialog} /></div>
            </>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function DialogBody({ dialog }: { dialog: DialogState }) {
  const view = dialog.view;
  switch (view.kind) {
    case 'search': return <SearchDialog />;
    case 'reviewSources': return <ReviewSources view={view} dialogKey={dialog.key} />;
    case 'checks': return <Checks />;
    case 'export': return <ExportSelection view={view} />;
    case 'exportReview': return <ExportReview view={view} />;
    case 'exported': return <><p>The selected static site is ready. Serve this directory over HTTP to view it.</p><p className="record-path">{view.result.output}</p></>;
    case 'connect': return <ConnectAgent configuration={view.configuration} />;
    case 'styleRead': return <StyleRead current={view.current} />;
    case 'drafts': return <Drafts view={view} />;
    case 'review': return <ReviewDraft draft={view.draft} />;
    case 'semantic': return <Semantic draft={view.draft} blocks={view.blocks} />;
    case 'earlierNotes': return <><p className="alert">This draft changed after these notes were typed. Keep them as context and review the current candidate afresh.</p><pre className="source-text">{view.text}</pre></>;
    default: return <EditForm view={view} />;
  }
}

const limit = 10;
/** An excerpt keeps the author's paragraphs; a single line break is a soft break, as in the rendered Markdown. */
const softBreaks = (text: string) => text.replace(/([^\n])\n(?!\n)/g, '$1 ');
function SearchDialog() {
  const store = useStore(), atlas = store.atlas!;
  const [query, setQuery] = useState(''), [tree, setTree] = useState(''), [kind, setKind] = useState(''), [offset, setOffset] = useState(0);
  const records = searchRecords({ points: atlas.points.filter(point => point.publicationAvailable !== false), facets: atlas.facets }, { query, kinds: kind ? [kind] : ['point', 'facet'], tree: tree || undefined, limit: limit + 1, offset, presentation: 'summary' });
  const page = records.slice(0, limit), more = records.length > limit;
  const status = !query.trim() ? 'Search by a word, question, Point ID or Facet ID.' : page.length ? `Results ${offset + 1}–${offset + page.length}. Lexical matches; open the owning explanation to assess meaning.` : 'No matches. Try fewer words or another Tree.';
  return (
    <>
      <div className="search-controls">
        <SearchField className="field search-query" aria-label="Search Points and Facets" value={query} onChange={value => { setQuery(value); setOffset(0); }} autoFocus>
          <Input placeholder="Ask a question or enter an ID" />
        </SearchField>
        <Choice ariaLabel="Owning Tree" value={tree} onChange={value => { setTree(value); setOffset(0); }} options={[{ id: '', name: 'All Trees' }, ...atlas.trees.map(item => ({ id: item.id, name: item.title }))]} />
        <Choice ariaLabel="Record kind" value={kind} onChange={value => { setKind(value); setOffset(0); }} options={[{ id: '', name: 'Points and Facets' }, { id: 'point', name: 'Points' }, { id: 'facet', name: 'Facets' }]} />
      </div>
      <p className="minor" role="status">{status}</p>
      <div className="search-results">
        {page.map(record => (
          <article className="search-result" key={`${record.kind}/${record.tree}/${record.id}`}>
            <RefLink href={recordHref(record.kind === 'facet' ? 'facet' : 'point', record.id, record.tree)}>{record.title}</RefLink>
            <p className="minor">{`${record.kind === 'facet' ? 'Facet interpretation' : record.type ?? 'Point'} · ${treeById(atlas, record.tree)?.title ?? record.tree}${record.kind === 'facet' ? ` · host ${record.on?.point ?? record.on?.branch}` : ''}`}</p>
            <p className="snippet">{`${record.snippet.start > 0 ? '…' : ''}${softBreaks(readableExcerpt(record.snippet.text))}${record.snippet.end < record.snippet.totalLength ? '…' : ''}`}</p>
            {record.uncertainty ? <Uncertainty text={record.uncertainty} /> : null}
          </article>
        ))}
      </div>
      {offset > 0 || more ? (
        <div className="draft-actions">
          <Action isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - limit))}>Previous results</Action>
          <Action isDisabled={!more} onPress={() => setOffset(offset + limit)}>More results</Action>
        </div>
      ) : null}
    </>
  );
}

function SourceOwners({ atlas, citations }: { atlas: Atlas; citations: { from: { kind: string; tree: string; id: string } }[] }) {
  return (
    <div className="refs">
      {citations.map(({ from }) => {
        const record = from.kind === 'facet' ? facetById(atlas, from.tree, from.id) : pointById(atlas, from.id);
        return <RefLink key={`${from.kind}/${from.tree}/${from.id}`} href={recordHref(from.kind === 'facet' ? 'facet' : 'point', from.id, from.tree)}>{`${treeById(atlas, from.tree)?.title ?? from.tree}: ${record?.title ?? from.id}`}</RefLink>;
      })}
    </div>
  );
}

function ReviewSources({ view, dialogKey }: { view: Extract<DialogView, { kind: 'reviewSources' }>; dialogKey: number }) {
  const store = useStore(), atlas = store.atlas!;
  const [history, setHistory] = useState<any>(view.history);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [review, setReview] = useState<any>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const sources = view.sources;
  const citationsOf = (uri: string) => [...atlas.points.map(record => ({ ...record, kind: 'point' })), ...atlas.facets.map(record => ({ ...record, kind: 'facet' }))].filter(record => record.sources?.some(source => source.uri === uri)).map(record => ({ from: { kind: record.kind, tree: record.tree, id: record.id } }));
  const inspect = async () => {
    const uris = sources.filter(uri => chosen.has(uri));
    if (!uris.length || uris.length > 100) throw new Error('Choose between 1 and 100 sources.');
    setBusy(true);
    try {
      const result = await store.api('sources/review', { uris });
      if (!store.isOpen(dialogKey)) return;
      setReview(result);
      if (history) { const next = await store.api('sources/history'); if (store.isOpen(dialogKey)) setHistory(next); }
    } finally { setBusy(false); }
  };
  const decide = (item: any, outcome: string) => async () => {
    const reason = reasons[item.uri] ?? '';
    if (!reason.trim()) throw new Error('Record the reason for your review decision.');
    const next = await store.api('sources/decisions', { expectedRevision: history.revision, decisions: [{ uri: item.uri, sha256: item.sha256, outcome, reason }] });
    if (store.isOpen(dialogKey)) setHistory(next);
  };
  return (
    <>
      <p>Choose cited sources to inspect within launch-time source grants. Remote sources remain uninspected.</p>
      <div className="draft-actions">
        <Action onPress={() => setChosen(new Set(sources.slice(0, 100)))}>{sources.length > 100 ? 'Select first 100' : 'Select all'}</Action>
        <Action onPress={() => setChosen(new Set())}>Clear selection</Action>
      </div>
      <Expand open title={`${sources.length} declared sources`}>
        <div className="ticks">{sources.map(uri => <Tick key={uri} checked={chosen.has(uri)} onChange={checked => setChosen(previous => { const next = new Set(previous); if (checked) next.add(uri); else next.delete(uri); return next; })}>{uri}</Tick>)}</div>
      </Expand>
      <Action primary isDisabled={busy} onPress={inspect}>Review selected sources</Action>
      {review ? (
        <div className="review-results">
          <p className="minor">A changed source identifies explanations to review; it does not establish that they are false.</p>
          {review.results.map((row: any) => (
            <section className="draft-entry" key={row.uri}>
              <p><Status value={row.status} /></p>
              <h3 className="record-path">{row.uri}</h3>
              {row.reason ? <p>{row.reason}</p> : null}
              {(row.fragments ?? []).map((fragment: any) => <p key={fragment.fragment} className="minor"><Status value={fragment.status} />{` ${fragment.fragment.startsWith('#') ? '' : '#'}${fragment.fragment}: ${fragment.reason}`}</p>)}
              <SourceOwners atlas={atlas} citations={row.citations ?? []} />
            </section>
          ))}
          {(review.limits ?? []).map((item: string) => <p key={item} className="minor">{item}</p>)}
        </div>
      ) : null}
      {history ? (
        <Section title="Retained source review">
          <p className="minor">Observed bytes and review decisions persist across sessions. A successful reread leaves an unresolved change awaiting review.</p>
          {history.observations.map((item: any) => {
            const latest = history.inspections.find((read: any) => read.uri === item.uri);
            return (
              <div className="draft-entry" key={item.uri}>
                <h3 className="record-path">{item.uri}</h3>
                <p className="minor"><Status value={item.reviewStatus} />{` · ${item.observedAt}${latest && !['current', 'changed'].includes(latest.status) ? ` · latest read: ${latest.status}` : ''}`}</p>
                {item.reason ? <p className="words">{item.reason}</p> : null}
                <SourceOwners atlas={atlas} citations={citationsOf(item.uri)} />
                <Expand title="Record a review decision" level={4}>
                  <p className="record-path">{`Observed SHA-256 ${item.sha256}`}</p>
                  <TextInput ariaLabel={`Review reason for ${item.uri}`} placeholder="What did you inspect and conclude?" value={reasons[item.uri] ?? ''} onChange={value => setReasons(previous => ({ ...previous, [item.uri]: value }))} />
                  <div className="draft-actions">
                    <Action onPress={decide(item, 'reviewed-unchanged')}>Reviewed: explanation remains valid</Action>
                    <Action onPress={decide(item, 'updated')}>Explanations updated</Action>
                    <Action onPress={decide(item, 'needs-review')}>Keep awaiting review</Action>
                  </div>
                </Expand>
              </div>
            );
          })}
        </Section>
      ) : null}
    </>
  );
}

function Checks() {
  const atlas = useStore().atlas;
  const checks = atlas?.checks ?? [];
  const active = checks.filter(check => check.status === 'active');
  return (
    <>
      <p>{atlas ? `${active.filter(check => check.level === 'required').length} active required Checks. This panel lists their definitions.` : 'Repair the Atlas to load its complete set of Checks. Use Edit records to inspect the affected files.'}</p>
      <p className="minor">Use a connected agent to review current content, or open a saved draft and choose Review candidate Checks to record evidence before application.</p>
      {checks.length ? checks.map(check => (
        <Section key={check.id} title={check.title}>
          <p>{`${check.status} · ${check.level}${check.status === 'active' ? ' · Review not shown' : ' · Inactive'}`}</p>
          <Prose html={check.html} />
          <p className="record-path">{`Revision: ${check.revision}`}</p>
        </Section>
      )) : <p>{atlas ? 'No Check definitions are present.' : 'No complete Check inventory is available.'}</p>}
    </>
  );
}

function ExportSelection({ view }: { view: Extract<DialogView, { kind: 'export' }> }) {
  const store = useStore(), available = view.available;
  const [trees, setTrees] = useState<Set<string>>(() => new Set(available.atlas.trees.map((tree: any) => tree.id)));
  const [points, setPoints] = useState<Set<string>>(() => new Set(available.atlas.points.map((point: any) => point.id)));
  const sources: string[] = [...new Set<string>([...available.atlas.points, ...available.atlas.facets].flatMap((record: any) => (record.sources ?? []).map((source: any) => source.uri)))].sort();
  const [chosen, setChosen] = useState<Set<string>>(new Set()), [includeStyle, setIncludeStyle] = useState(false);
  const toggle = (set: Set<string>, value: string, on: boolean) => { const next = new Set(set); if (on) next.add(value); else next.delete(value); return next; };
  return (
    <>
      <p>Choose the Trees and Points for a local static site. Select any source files to include below. The site will be saved at the destination shown here.</p>
      <p className="record-path">{`Destination: ${available.output}`}</p>
      {available.atlas.trees.map((tree: any) => (
        <section className="draft-entry ticks" key={tree.id}>
          <Tick checked={trees.has(tree.id)} onChange={on => setTrees(toggle(trees, tree.id, on))}><strong>{tree.title}</strong></Tick>
          {available.atlas.points.filter((point: any) => point.tree === tree.id).map((point: any) => <Tick key={point.id} className="nested" checked={points.has(point.id)} onChange={on => setPoints(toggle(points, point.id, on))}>{point.title}</Tick>)}
        </section>
      ))}
      {sources.length ? <Section title="Include source files"><div className="ticks">{sources.map(uri => <Tick key={uri} checked={chosen.has(uri)} onChange={on => setChosen(toggle(chosen, uri, on))}>{uri}</Tick>)}</div></Section> : null}
      <Tick checked={includeStyle} onChange={setIncludeStyle}>Include the captured Atlas style in this publication</Tick>
      <Action primary onPress={() => {
        const selectedTrees = available.atlas.trees.map((tree: any) => tree.id).filter((id: string) => trees.has(id));
        const selectedPoints = available.atlas.points.filter((point: any) => points.has(point.id) && selectedTrees.includes(point.tree)).map((point: any) => point.id);
        return store.previewPublication(available, { trees: selectedTrees, points: selectedPoints, sources: sources.filter(uri => chosen.has(uri)), includeStyle });
      }}>Preview selection</Action>
    </>
  );
}

function ExportReview({ view }: { view: Extract<DialogView, { kind: 'exportReview' }> }) {
  const store = useStore(), preview = view.preview;
  return (
    <>
      <p className="record-path">{`Destination: ${preview.output}`}</p>
      <p>{`${preview.counts.trees} Trees · ${preview.counts.points} Points · ${preview.counts.facets} Facets · ${preview.counts.sources} source references`}</p>
      <pre className="source-text">{JSON.stringify(preview.selection, null, 2)}</pre>
      {preview.sources.map((source: any) => <p key={source.uri}><span className="record-path">{`${source.uri} `}</span><Status value={source.status} />{source.message ? ` — ${source.message}` : ''}</p>)}
      {preview.excludedTargets.length ? <Section title="Unavailable Facet targets"><pre className="source-text">{JSON.stringify(preview.excludedTargets, null, 2)}</pre></Section> : null}
      <p className="minor">An existing destination or changed source will stop this export. Choose a new destination at launch for a later export.</p>
      <div className="draft-actions">
        <Action primary onPress={() => store.applyPublication(preview)}>Export this selection</Action>
        <Action onPress={() => store.exportSite()}>Change selection</Action>
      </div>
    </>
  );
}

function ConnectAgent({ configuration }: { configuration: unknown }) {
  const text = JSON.stringify(configuration, null, 2), area = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  return (
    <>
      <p>Copy this configuration into your agent host to connect it to the selected Atlas and source folders.</p>
      <TextField className="field" value={text} isReadOnly aria-label="Agent host configuration"><TextArea ref={area} className="react-aria-TextArea code" /></TextField>
      <Action onPress={async () => {
        try { await navigator.clipboard.writeText(text); setStatus('Agent configuration copied.'); }
        catch { area.current?.focus(); area.current?.select(); setStatus('Automatic copy is unavailable. The configuration is selected; copy it with your keyboard.'); }
      }}>Copy configuration</Action>
      <p className="minor" role="status">{status}</p>
    </>
  );
}

function StyleRead({ current }: { current: any }) {
  if (!current) return <p>The style was not included in this publication.</p>;
  return <div className="style-read"><h3 className="title">{current.title}</h3><p className="minor">{`${current.id} · revision ${current.revision}`}</p>{current.html ? <Prose html={current.html} /> : <pre className="source-text">{current.body}</pre>}</div>;
}

function Drafts({ view }: { view: Extract<DialogView, { kind: 'drafts' }> }) {
  const store = useStore();
  const interrupted = view.transactions.filter((item: any) => !['complete', 'rolled-back'].includes(item.phase));
  const [dates, setDates] = useState<Record<string, string>>({});
  useEffect(() => { setDates(Object.fromEntries(view.saved.map((draft: any) => [draft.id, new Date(draft.updatedAt).toLocaleString()]))); }, [view.saved]);
  return (
    <>
      <div className="draft-actions">
        <Action primary onPress={() => store.newPoint()}>New Point</Action>
        <Action onPress={() => store.newTree()}>New Tree</Action>
        <Action onPress={() => store.branchForm()}>New Branch</Action>
        <Action onPress={() => store.editRecords()}>Edit records</Action>
      </div>
      {view.working.map((copy: any) => (
        <div className="draft-entry" key={copy.id}>
          <h3>{copy.form?.title ?? copy.title ?? 'Unfinished typing'}</h3>
          <p className="minor">Private recovery copy · has not been applied</p>
          <div className="draft-actions">
            <Action onPress={() => store.recoverWorkingCopy(copy.id)}>Recover typing</Action>
            <Action danger onPress={() => store.discardRecoveryCopy(copy)}>Discard recovery copy</Action>
          </div>
        </div>
      ))}
      {view.saved.length ? view.saved.map((draft: any) => (
        <div className="draft-entry" key={draft.id}>
          <h3 className="title">{draft.reason}</h3>
          <p className="minor"><Status value={draft.status} />{` · ${dates[draft.id] ?? draft.updatedAt}`}</p>
          <div className="draft-actions">
            <Action onPress={() => store.openDraft(draft.id)}>Review</Action>
            <Action onPress={() => store.editRecords(draft.id)}>Continue editing</Action>
            <Action danger onPress={() => store.discardDraft(draft)}>Discard</Action>
          </div>
        </div>
      )) : <p className="minor">No saved drafts.</p>}
      {interrupted.map((item: any) => (
        <div className="draft-entry" key={item.id}>
          <h3 className="attend"><span aria-hidden="true">△ </span>Interrupted change</h3>
          <p className="minor">{`${item.written?.length ?? 0} ${item.written?.length === 1 ? 'file' : 'files'} recorded as written. Recovery restores the original files after checking for later edits. It stops if an affected file has changed.`}</p>
          <Action onPress={() => store.restoreOriginal(item)}>Restore original files</Action>
        </div>
      ))}
    </>
  );
}

const target = (item: any) => item.point ?? `${item.tree}/${item.facet}`;
function ReviewDetails({ draft }: { draft: any }) {
  const rows: ReactNode[] = [], impact = draft.impact;
  if (draft.review) {
    const review = draft.review;
    rows.push(<Section key="absorb" title="Absorb reasoning"><p className="words">{review.rationale}</p><p className="record-path">{review.source.uri}</p>{review.contributions.map((item: any, index: number) => <p key={index}>{`${item.disposition}${item.point || item.facet ? ` · ${item.point ?? `${item.tree}/${item.facet}`}` : ''}: `}<span className="words">{item.rationale}</span>{item.destinations?.length ? ` Destination: ${item.destinations.map(target).join(', ')}` : ''}</p>)}</Section>);
    if (review.unresolved.length) rows.push(<Section key="unresolved" title="Unresolved">{review.unresolved.map((item: string, index: number) => <p key={index} className="alert"><span aria-hidden="true">△ </span><span className="words">{item}</span></p>)}</Section>);
    if (review.preservation) rows.push(<Expand key="preservation" section title="Preservation review"><p className="words">{review.preservation.scope}</p>{review.preservation.units.map((unit: any) => <p key={unit.id}>{`${unit.id} · ${unit.disposition} · ${unit.source.uri} · ${unit.locator}: ${unit.rationale}${unit.destinations?.length ? ` → ${unit.destinations.map(target).join(', ')}` : ''}`}</p>)}</Expand>);
  }
  if (impact?.changedStyle) rows.push(
    <Section key="style" title="Selected Atlas style changes">
      <div className="draft-grid">
        {(['before', 'after'] as const).map(side => <div key={side} className={side === 'after' ? 'candidate' : undefined}><h3 className={side === 'after' ? 'cap attend' : 'cap'}>{side === 'before' ? 'Before' : '△ Candidate style'}</h3><pre className="source-text" tabIndex={0} role="region" aria-label={side === 'before' ? 'Style before' : 'Candidate style'}>{impact.changedStyle[side]?.content ?? impact.changedStyle[side]?.body ?? 'No captured style'}</pre></div>)}
      </div>
      <p className="minor">Review whether the existing Tree boundaries and explanations still follow this style.</p>
    </Section>,
  );
  if (impact?.status === 'ready') {
    const changed = [...(impact.changedPoints ?? []).map((item: any) => `${item.after?.title ?? item.before?.title}: ${item.changes.join(', ')}`), ...(impact.changedFacets ?? []).map((item: any) => `Facet: ${item.after?.title ?? item.before?.title}`), ...(impact.changedTrees ?? []).map((item: any) => `Tree: ${item.after?.title ?? item.before?.title}`), ...(impact.changedBranches ?? []).map((item: any) => `Branch: ${item.after?.title ?? item.before?.title}`)];
    rows.push(<Section key="meaning" title="Meaning and placement to review">{changed.map((text: string, index: number) => <p key={index}>{text}</p>)}</Section>);
    for (const [side, context] of Object.entries<any>(impact.review ?? {})) rows.push(
      <Expand key={`related-${side}`} section title={`${side === 'before' ? 'Before' : 'Candidate'}: related explanations`}>
        {['points', 'branches', 'facets', 'trees'].flatMap(kind => context[kind].map(({ record, reasons }: any) => (
          <Expand key={`${kind}/${record.tree}/${record.id}`} className="draft-entry" level={4} title={record.title}>
            <p className="minor">{reasons.map((reason: any) => reason.explanation ?? reason.kind).join(' · ')}</p>
            <pre className="source-text">{record.body ?? record.scope ?? record.title}</pre>
          </Expand>
        )))}
      </Expand>,
    );
    const mentions = (['before', 'after'] as const).flatMap(side => (impact.mentions?.[side] ?? []).map((item: any, index: number) => <p key={`${side}-${index}`}>{`${side} · ${item.target.point ?? item.target.facet}: ${item.citers.map((citer: any) => citer.record?.title ?? citer.record?.id).join(', ') || 'no direct citers'} (${item.bounds.returned}/${item.bounds.available})`}</p>));
    if (mentions.length) rows.push(<Expand key="mentions" section title="Direct citations to review"><p className="minor">Direct mentions are review leads; they do not establish dependency or require an automatic rewrite.</p>{mentions}</Expand>);
    if (impact.linkDiagnostics?.length) rows.push(<Section key="links" title="Links needing review">{impact.linkDiagnostics.map((item: any, index: number) => <p key={index} className="attend">{`✗ ${item.path}${item.line ? `:${item.line}` : ''}: ${item.message}`}</p>)}</Section>);
  }
  if (draft.plan.sourcePreconditions?.length) rows.push(<Section key="bytes" title="Required source bytes">{draft.plan.sourcePreconditions.map((item: any) => <p key={item.uri} className="record-path">{`${item.uri} · ${item.sha256}`}</p>)}</Section>);
  if (draft.reviewHistory?.length) rows.push(
    <Expand key="history" section title={`Prior reasoning and evidence (${draft.reviewHistory.length} revisions)`}>
      <p className="note">Historical context. These records describe earlier candidates and do not verify this one.</p>
      {draft.reviewHistory.map((item: any, index: number) => (
        <Expand key={index} level={4} title={`${item.reason} · ${item.updatedAt}`}>
          <p className="record-path">{`Prior candidate ${item.candidate}`}</p>
          {item.review ? <><p className="words">{item.review.rationale}</p>{item.review.contributions.map((contribution: any, at: number) => <p key={at}>{`${contribution.disposition}: `}<span className="words">{contribution.rationale}</span></p>)}</> : null}
          {(item.checkRuns ?? []).map((run: any, at: number) => <p key={at}>{`Previous evidence: ${run.required.passed}/${run.required.total} required Checks passed`}</p>)}
        </Expand>
      ))}
    </Expand>,
  );
  if (draft.checkRuns?.length) rows.push(
    <Section key="checks" title="Candidate Check evidence">
      {draft.checkRuns.map((run: any, index: number) => (
        <Expand key={index} level={4} title={`${run.required.passed}/${run.required.total} required Checks passed · ${run.actor ?? 'Unknown reviewer'}`}>
          <p className="minor">{`Candidate ${run.baseline} · ${run.createdAt}. Evidence does not approve application.`}</p>
          {run.results.map((result: any) => (
            <div className="draft-entry" key={result.id}>
              <h4>{`${result.id}: `}<Status value={result.outcome} /></h4>
              <p className="words">{result.reason}</p>
              {result.evidence.map((item: any, at: number) => <p key={at}><span className="words">{item.text}</span>{item.source ? ` · ${item.source.uri}` : ''}</p>)}
            </div>
          ))}
        </Expand>
      ))}
    </Section>,
  );
  return <>{rows}</>;
}

function ReviewDraft({ draft }: { draft: any }) {
  const store = useStore(), plan = draft.plan;
  const diagnostics = plan.validation.diagnostics.map((item: any) => `✗ ${item.path}: ${item.message}`).join('\n');
  return (
    <>
      <h3 className="title">{plan.reason}</h3>
      <p className="minor">{`${plan.changes.length} changed ${plan.changes.length === 1 ? 'file' : 'files'} · `}<Status value={plan.status} />. If the Atlas changes, review a new draft before applying.</p>
      {diagnostics ? <pre className="diagnostics">{diagnostics}</pre> : null}
      <ReviewDetails draft={draft} />
      <div className="draft-actions">
        <Action primary isDisabled={plan.status === 'invalid'} onPress={() => store.applyDraft(draft)}>{plan.status === 'noop' ? 'Confirm no change' : 'Apply draft'}</Action>
        <Action isDisabled={!plan.candidate.atlas} onPress={() => store.semanticComparison(draft)}>Read proposed changes</Action>
        <Action isDisabled={!plan.candidate.atlas} onPress={() => store.previewDraft(draft)}>Browse complete candidate</Action>
        <Action onPress={() => store.editRecords(draft.id)}>Continue editing</Action>
        {plan.candidate.atlas?.checks?.some((check: any) => check.status === 'active') ? <Action onPress={() => store.reviewCandidateChecks(draft)}>Review candidate Checks</Action> : null}
        <Action onPress={() => store.drafts()}>All drafts</Action>
      </div>
      <Expand title="File changes">
        {plan.changes.map((change: any) => (
          <section className="draft-entry" key={change.path}>
            <h3 className="record-path">{change.path}</h3>
            <div className="draft-grid">
              <div><p className="cap">Before</p><pre tabIndex={0} role="region" aria-label={`Before: ${change.path}`}>{change.beforeBase64 === undefined ? change.before ?? '(new file)' : `Original non-UTF-8 bytes (Base64):\n${change.beforeBase64}`}</pre></div>
              <div className="candidate"><p className="cap attend">△ After</p><pre tabIndex={0} role="region" aria-label={`After: ${change.path}`}>{change.after ?? '(deleted)'}</pre></div>
            </div>
          </section>
        ))}
      </Expand>
    </>
  );
}

function SideView({ side }: { side: ComparisonSide }) {
  if (!side) return <p className="minor">Not present</p>;
  return <div><h3 className="title">{side.title}</h3>{side.meta ? <p className="minor">{side.meta}</p> : null}<Prose html={side.html} />{side.uncertainty ? <Uncertainty text={side.uncertainty} /> : null}<p className="minor">{side.sources}</p></div>;
}
function Semantic({ draft, blocks }: { draft: any; blocks: ComparisonBlock[] }) {
  const store = useStore();
  return (
    <>
      <p className="minor">Rendered explanations, uncertainty and citations from the exact original and candidate. Structure and file effects remain in the draft review.</p>
      {blocks.map((block, index) => (
        <Section key={index} title={block.kind === 'style' ? 'Atlas style' : block.label}>
          <div className="draft-grid semantic-comparison">
            <div><p className="cap">Before</p>{block.kind === 'style' ? block.before ? <div><h3 className="title">{block.before.title}</h3><p className="minor">{block.before.meta}</p><Prose html={block.before.html} /></div> : <p className="minor">No captured style</p> : <SideView side={block.before} />}</div>
            <div className="candidate"><p className="cap attend">△ Candidate</p>{block.kind === 'style' ? block.after ? <div><h3 className="title">{block.after.title}</h3><p className="minor">{block.after.meta}</p><Prose html={block.after.html} /></div> : <p className="minor">No captured style</p> : <SideView side={block.after} />}</div>
          </div>
        </Section>
      ))}
      <div className="draft-actions">
        <Action primary onPress={() => store.previewDraft(draft)}>Browse the complete candidate</Action>
        <Action onPress={() => store.reviewDraft(draft)}>Return to draft review</Action>
      </div>
    </>
  );
}

