// The editing forms. Each keeps its fields in one order, which is also the order of the
// private recovery copy, so unfinished typing restores into the field it came from.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { type Point, type Source, childId, childKind, outlineChildren, pointById, recordOf, treeById } from './model.ts';
import { Action, Choice, Expand, Prose, Section, TextBox, TextInput, Tick, useStore, useStoreState, type Option } from './controls.tsx';
import type { ByteRequirements, DialogView, Fields } from './store.ts';
import { StyleChoices } from './store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Control = Fields['controls'][number];
const text = (value: string): Control => ({ value, checked: false, type: 'text' });
const area = (value: string): Control => ({ value, type: 'textarea' });
const pick = (value: string): Control => ({ value, type: 'select-one' });
const box = (checked: boolean): Control => ({ value: 'on', checked, type: 'checkbox' });
/** Read a recovered control by its position, or keep the form's own value. */
const restored = (fields: Fields | undefined) => {
  const controls = fields?.controls ?? [];
  return { value: (index: number, fallback: string) => controls[index]?.value ?? fallback, checked: (index: number, fallback: boolean) => controls[index]?.checked ?? fallback, count: controls.length };
};

/** One form's values: every change marks the session edited; the recovery copy reads the latest. */
function useFormValues<T extends object>(initial: () => T, capture: (values: T) => Fields) {
  const store = useStore();
  const [values, setValues] = useState(initial);
  const latest = useRef(values); latest.current = values;
  const editor = useRef(store.editor).current;
  const read = useRef(capture); read.current = capture;
  useEffect(() => { store.bindCapture(editor, () => read.current(latest.current)); }, [store, editor]);
  const update = (patch: Partial<T>) => { latest.current = { ...latest.current, ...patch }; setValues(latest.current); store.edited(); };
  return [values, update, latest] as const;
}

function Autosave() {
  const state = useStoreState();
  return <p id="autosave-status" className={state.autosave.attend ? 'attend' : 'minor'} role="status">{state.autosave.text}</p>;
}
function Save({ children = 'Save and review', onPress }: { children?: string; onPress: () => unknown }) {
  return <div className="draft-actions"><Action primary onPress={onPress}>{children}</Action></div>;
}
function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field group" role="group" aria-label={label}><span className="field-label" aria-hidden="true">{label}</span>{children}</div>;
}

// Citations: each row keeps its role, revision and locator with the interpretation it supports.
type CitationRow = { key: number; removed: boolean; fields: Record<string, string> };
const citationNames = ['uri', 'title', 'role', 'revision', 'locator', 'sha256'] as const;
const citationLabels: Record<string, string> = { uri: 'Source URI', title: 'Title', role: 'Role', revision: 'Revision', locator: 'Locator', sha256: 'Expected SHA-256 (optional)' };
const roles: Option[] = ['', 'evidence', 'background', 'example', 'implementation', 'history'].map(value => ({ id: value, name: value || 'Unclassified' }));
let citationKey = 0;
function citationRows(sources: Source[] = [], recovered?: Fields) {
  const saved = recovered?.citations;
  const rows: CitationRow[] = (saved?.length ? saved.map(item => item.values) : sources as Record<string, string | undefined>[]).map(source => ({ key: ++citationKey, removed: false, fields: Object.fromEntries(citationNames.map(name => [name, source[name] ?? ''])) }));
  if (saved) saved.forEach((item, index) => { if (rows[index] && item.removed) rows[index].removed = true; });
  return rows;
}
const citationControls = (rows: CitationRow[]) => rows.flatMap(row => citationNames.map(name => name === 'role' ? pick(row.fields[name]) : text(row.fields[name])));
const citationFields = (rows: CitationRow[]) => rows.map(row => ({ removed: row.removed, values: { ...row.fields } }));
const citationValues = (rows: CitationRow[]): Source[] => rows.filter(row => !row.removed).map(row => Object.fromEntries(Object.entries(row.fields).filter(([name, value]) => name === 'uri' || value.trim()).map(([name, value]) => [name, value.trim()])) as Source);

function Citations({ rows, onChange, open }: { rows: CitationRow[]; onChange: (rows: CitationRow[]) => void; open: boolean }) {
  const set = (key: number, patch: Partial<CitationRow>) => onChange(rows.map(row => row.key === key ? { ...row, ...patch } : row));
  return (
    <Expand section open={open} title="Sources and evidence boundaries">
      <p className="minor">Keep the source role, revision and exact locator with the interpretation they support. Local paths are relative to this Atlas.</p>
      <div className="citation-editor">
        {rows.filter(row => !row.removed).map(row => (
          <fieldset className="citation-fields" key={row.key}>
            <legend>Source citation</legend>
            {citationNames.map(name => name === 'role'
              ? <Choice key={name} label={citationLabels[name]} value={row.fields.role} onChange={value => set(row.key, { fields: { ...row.fields, role: value } })} options={roles} />
              : <TextInput key={name} label={citationLabels[name]} value={row.fields[name]} placeholder={name === 'uri' ? 'sources/report.md#heading' : undefined} onChange={value => set(row.key, { fields: { ...row.fields, [name]: value } })} />)}
            <Action onPress={() => set(row.key, { removed: true })}>Remove citation</Action>
          </fieldset>
        ))}
      </div>
      <Action onPress={() => onChange([...rows, { key: ++citationKey, removed: false, fields: Object.fromEntries(citationNames.map(name => [name, ''])) }])}>Add citation</Action>
    </Expand>
  );
}

/** Explicit source byte requirements for an application, inspected one source at a time. */
function Requirements({ requirements }: { requirements: ByteRequirements }) {
  const store = useStore();
  useSyncExternalStore(requirements.subscribe, () => requirements.version, () => requirements.version);
  return (
    <Expand section title={`Source byte requirements (${requirements.uris.length})`}>
      <p className="minor">Inspect a cited source, then explicitly require its current bytes if this change depends on them. A changed required source will stop application.</p>
      {requirements.uris.map(uri => (
        <div className="draft-entry" key={uri}>
          <p className="record-path">{uri}</p>
          <Action isDisabled={requirements.busy.has(uri)} onPress={() => requirements.inspect(uri)}>Inspect source bytes</Action>
          <Tick checked={requirements.checked.get(uri) ?? false} isDisabled={!requirements.canRequire(uri) && !requirements.checked.get(uri)} onChange={checked => { requirements.toggle(uri, checked); store.edited(); }}>Require these source bytes when applying</Tick>
          <p className="minor" role="status">{requirements.status.get(uri)}</p>
        </div>
      ))}
    </Expand>
  );
}
function useRequirements(sources: Source[], existing: { uri: string; sha256: string }[] = [], draft: any = null, recovered?: { offset: number; fields?: Fields }) {
  const store = useStore();
  return useMemo(() => {
    const requirements = store.byteRequirements(sources, existing, draft);
    if (recovered?.fields) requirements.uris.forEach((uri, index) => { const control = recovered.fields!.controls[recovered.offset + index]; if (control?.checked !== undefined) requirements.toggle(uri, control.checked); });
    return requirements;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function EditForm({ view }: { view: DialogView }) {
  switch (view.kind) {
    case 'point': return <PointForm view={view} />;
    case 'facet': return <FacetForm view={view} />;
    case 'records': return <RecordsForm view={view} />;
    case 'move': return <MoveForm view={view} />;
    case 'branch': return <BranchForm view={view} />;
    case 'position': return <PositionForm view={view} />;
    case 'remove': return <RemoveForm view={view} />;
    case 'newTree': return <NewTreeForm view={view} />;
    case 'newPoint': return <NewPointForm view={view} />;
    case 'newFacet': return <NewFacetForm view={view} />;
    case 'initialize': return <InitializeForm view={view} />;
    case 'style': return <StyleForm view={view} />;
    case 'checksForm': return <ChecksForm view={view} />;
    default: return null;
  }
}

function PointForm({ view }: { view: Extract<DialogView, { kind: 'point' }> }) {
  const store = useStore(), r = restored(view.recovered), header = view.header;
  const [values, update] = useFormValues(() => ({
    title: r.value(0, view.title), explanation: r.value(1, view.explanation), type: r.value(2, header.type ?? 'untyped'), standing: r.value(3, header.status ?? 'open'),
    observedAt: r.value(4, header.observedAt ?? ''), uncertainty: r.value(5, header.uncertainty ?? ''), reason: r.value(6, `Revise ${view.point.title}`),
    citations: citationRows(header.sources, view.recovered),
  }), current => ({ controls: [text(current.title), area(current.explanation), pick(current.type), pick(current.standing), text(current.observedAt), area(current.uncertainty), text(current.reason), ...citationControls(current.citations), ...requirements.uris.map(uri => box(requirements.checked.get(uri) ?? false))], citations: citationFields(current.citations) }));
  const requirements = useRequirements(header.sources ?? [], [], null, { offset: 7 + values.citations.length * 6, fields: view.recovered });
  return (
    <>
      <TextInput label="Title" isRequired value={values.title} onChange={title => update({ title })} />
      <TextBox label="Explanation" value={values.explanation} onChange={explanation => update({ explanation })} />
      <Choice label="Point Type" value={values.type} onChange={type => update({ type })} options={['untyped', 'decision', 'observation'].map(id => ({ id, name: id }))} />
      {values.type === 'decision' ? <Choice label="Decision status" value={values.standing} onChange={standing => update({ standing })} options={['open', 'proposed', 'selected', 'rejected', 'superseded'].map(id => ({ id, name: id }))} /> : null}
      {values.type === 'observation' ? <TextInput label="Observed at" placeholder="2026-09-29" value={values.observedAt} onChange={observedAt => update({ observedAt })} /> : null}
      <TextBox label="Uncertainty" short value={values.uncertainty} onChange={uncertainty => update({ uncertainty })} />
      <TextInput label="Reason for this change" value={values.reason} onChange={reason => update({ reason })} />
      <Citations rows={values.citations} open={values.citations.length > 0} onChange={citations => update({ citations })} />
      <Requirements requirements={requirements} />
      <Save onPress={() => store.savePoint(view, { ...values, sources: citationValues(values.citations), required: requirements.selected() })} />
      <Autosave />
    </>
  );
}

function FacetForm({ view }: { view: Extract<DialogView, { kind: 'facet' }> }) {
  const store = useStore(), atlas = store.atlas!, facet = view.facet, header = view.header, r = restored(view.recovered);
  const hosts = [...atlas.points.filter(item => item.tree === facet.tree).map(item => ({ kind: 'point', id: item.id, title: item.title })), ...atlas.branches.filter(item => item.tree === facet.tree).map(item => ({ kind: 'branch', id: item.id, title: item.title }))];
  const others = atlas.trees.filter(item => item.id !== facet.tree);
  const recordsFor = (via: string) => { const tree = treeById(atlas, via); return tree ? [{ kind: 'tree', id: tree.id, title: `Whole account: ${tree.title}` }, ...atlas.points.filter(item => item.tree === via).map(item => ({ kind: 'point', id: item.id, title: item.title })), ...atlas.branches.filter(item => item.tree === via).map(item => ({ kind: 'branch', id: item.id, title: item.title }))] : []; };
  const originally = (via: string) => recordsFor(via).map(item => facet.via === via && facet.targets.some(target => (target as Record<string, string | undefined>)[item.kind] === item.id));
  const hostDefault = [...hosts].reverse().find(item => header.on[item.kind] === item.id) ?? hosts[0];
  const viaDefault = others.find(item => item.id === facet.via)?.id ?? others[0]?.id ?? '';
  const [values, update] = useFormValues(() => {
    const via = r.value(2, viaDefault);
    const targets = originally(via).map((checked, index) => r.count ? r.checked(3 + index, checked) : checked);
    const at = 3 + targets.length, citations = citationRows(header.sources, view.recovered);
    return { title: r.value(0, facet.title), host: r.value(1, hostDefault ? `${hostDefault.kind}:${hostDefault.id}` : ''), via, targets, body: r.value(at, facet.body ?? ''), uncertainty: r.value(at + 1, facet.uncertainty ?? ''), citations, reason: r.value(at + 2 + citations.length * 6, `Revise ${facet.title}`) };
  }, current => ({ controls: [text(current.title), pick(current.host), pick(current.via), ...current.targets.map(box), area(current.body), area(current.uncertainty), ...citationControls(current.citations), text(current.reason)], citations: citationFields(current.citations) }));
  const records = recordsFor(values.via);
  return (
    <>
      <TextInput label="Title" value={values.title} onChange={title => update({ title })} />
      <Choice label="Host in this Tree" value={values.host} onChange={host => update({ host })} options={hosts.map(item => ({ id: `${item.kind}:${item.id}`, name: `${item.kind}: ${item.title}` }))} />
      <Choice label="Through another Tree" value={values.via} onChange={via => update({ via, targets: originally(via) })} options={others.map(item => ({ id: item.id, name: item.title }))} />
      <Section title="Relevant targets"><div className="ticks">{records.map((item, index) => <Tick key={`${item.kind}:${item.id}`} checked={values.targets[index] ?? false} onChange={checked => update({ targets: values.targets.map((value, at) => at === index ? checked : value) })}>{`${item.kind}: ${item.title}`}</Tick>)}</div></Section>
      <TextBox label="Why this interpretation matters" value={values.body} onChange={body => update({ body })} />
      <TextBox label="Uncertainty" short value={values.uncertainty} onChange={uncertainty => update({ uncertainty })} />
      <Citations rows={values.citations} open={values.citations.length > 0} onChange={citations => update({ citations })} />
      <TextInput label="Reason" value={values.reason} onChange={reason => update({ reason })} />
      <Save onPress={() => store.saveFacet(view, { ...values, targets: records.filter((_, index) => values.targets[index]).map(item => ({ [item.kind]: item.id })), sources: citationValues(values.citations) })} />
      <Autosave />
    </>
  );
}

function RecordsForm({ view }: { view: Extract<DialogView, { kind: 'records' }> }) {
  const store = useStore(), saved = view.saved, captured = view.captured, recovered = view.recovered, r = restored(recovered);
  const files = useMemo(() => new Map<string, string>(captured.files.map((file: any) => [file.path, file.content])), [captured]);
  const raw = useMemo(() => new Map<string, string>([...captured.files.filter((file: any) => file.rawBase64 !== undefined).map((file: any) => [file.path, file.rawBase64]), ...(saved?.plan.changes ?? []).filter((change: any) => change.beforeBase64 !== undefined).map((change: any) => [change.path, change.beforeBase64])]), [captured, saved]);
  const changes = useRef(new Map<string, string | null>((recovered?.changes as [string, string | null][] | undefined) ?? saved?.plan.changes.map((change: any) => [change.path, change.after]) ?? []));
  const loaded = (path: string) => {
    const value = changes.current.has(path) ? changes.current.get(path) : files.get(path);
    const isRaw = raw.has(path);
    return { text: value ?? '', deleted: value === null && (!isRaw || changes.current.has(path)), repair: isRaw && changes.current.has(path) && value !== null };
  };
  const candidate = saved?.plan.candidate.atlas ?? store.atlas;
  const [values, update, latest] = useFormValues(() => {
    const paths = [...new Set([...files.keys(), ...changes.current.keys()])].sort();
    const chosen = r.count && paths.includes(r.value(0, '')) ? r.value(0, '') : paths[0] ?? '';
    const state = loaded(chosen);
    return { paths, current: chosen, repair: r.checked(1, state.repair), text: r.value(2, state.text), deleted: r.checked(3, state.deleted), newPath: r.value(4, ''), reason: r.value(5, saved?.plan.reason ?? 'Revise Atlas records'), styleRepair: r.checked(6, false) };
  }, current => { keep(current); return { controls: [pick(current.current), box(current.repair), area(current.text), box(current.deleted), text(current.newPath), text(current.reason), box(current.styleRepair), ...requirements.uris.map(uri => box(requirements.checked.get(uri) ?? false))], changes: [...changes.current] }; });
  const requirements = useRequirements([...(candidate?.points ?? []), ...(candidate?.facets ?? [])].flatMap((record: any) => record.sources ?? []), saved?.plan.sourcePreconditions ?? [], saved, { offset: 7, fields: recovered });
  function keep(current = latest.current) {
    if (!current.current) return;
    if (raw.has(current.current) && !current.repair && !current.deleted) changes.current.delete(current.current); else changes.current.set(current.current, current.deleted ? null : current.text);
  }
  const isRaw = raw.has(values.current);
  const disabled = values.deleted || isRaw && !values.repair;
  return (
    <>
      <p className="minor">Edit Tree structure, Facets, Checks, or malformed records. Save a draft to review the complete result.</p>
      {saved?.review || saved?.checkRuns?.length ? <p className="note">Saving edits creates a new candidate. Earlier reasoning and Check evidence remain in revision history and do not approve the revised candidate.</p> : null}
      <Choice className="record-picker" ariaLabel="Record" value={values.current} onChange={next => { keep(); update({ current: next, ...loaded(next) }); }} options={values.paths.map(path => ({ id: path, name: path }))} />
      {isRaw ? (
        <section className="alert">
          <p>This record contains bytes that are not valid UTF-8. The original bytes remain unchanged until you explicitly replace or delete this record.</p>
          <Expand title="Original bytes (Base64)" level={4}><pre className="source-text">{raw.get(values.current)}</pre></Expand>
          <Tick checked={values.repair} onChange={repair => update({ repair })}>Replace unreadable bytes with UTF-8 text</Tick>
        </section>
      ) : null}
      <TextBox ariaLabel="Record content" code value={values.text} isDisabled={disabled} onChange={value => update({ text: value })} />
      <Tick checked={values.deleted} onChange={deleted => update({ deleted })}>Delete this record</Tick>
      <div className="edit-actions">
        <TextInput ariaLabel="New record path" placeholder="trees/example/points/new-point.md" value={values.newPath} onChange={newPath => update({ newPath })} />
        <Action onPress={() => {
          keep();
          const path = latest.current.newPath;
          if (!path.trim() || latest.current.paths.includes(path)) throw new Error('Use a new record path.');
          changes.current.set(path, '');
          update({ paths: [...latest.current.paths, path], current: path, ...loaded(path) });
        }}>Add record</Action>
      </div>
      <TextInput label="Reason for this change" value={values.reason} onChange={reason => update({ reason })} />
      <Tick checked={values.styleRepair} onChange={styleRepair => update({ styleRepair })}>Explicitly restore or change the selected Atlas style</Tick>
      <Requirements requirements={requirements} />
      <div className="draft-actions">
        <Action primary onPress={() => { keep(); return store.saveForReview(captured.identity, [...changes.current].map(([path, content]) => ({ path, content })), latest.current.reason, saved?.id, requirements.selected(), latest.current.styleRepair); }}>Save and review</Action>
        <Action onPress={() => store.drafts()}>All drafts</Action>
      </div>
      <Autosave />
    </>
  );
}

function MoveForm({ view }: { view: Extract<DialogView, { kind: 'move' }> }) {
  const store = useStore(), r = restored(view.recovered);
  const [values, update] = useFormValues(() => ({ path: r.value(0, view.record.path), reason: r.value(1, `Move ${view.record.title}`) }), current => ({ controls: [text(current.path), text(current.reason)] }));
  return (
    <>
      <TextInput label="New path in the same Tree" value={values.path} onChange={path => update({ path })} />
      <TextInput label="Reason" value={values.reason} onChange={reason => update({ reason })} />
      <Save onPress={() => store.saveMove(view, values.path, values.reason)} />
      <Autosave />
    </>
  );
}

const parentOptions = (atlas: any, tree: string) => [...atlas.points.filter((item: Point) => item.tree === tree).map((item: Point) => ({ kind: 'point', id: item.id, title: item.title })), ...atlas.branches.filter((item: any) => item.tree === tree).map((item: any) => ({ kind: 'branch', id: item.id, title: item.title }))];
const parentDefault = (options: { kind: string; id: string }[], selected: string) => { const match = [...options].reverse().find(item => item.id === selected) ?? options[0]; return match ? `${match.kind}:${match.id}` : ''; };

function BranchForm({ view }: { view: Extract<DialogView, { kind: 'branch' }> }) {
  const store = useStore(), atlas = store.atlas!, record = view.record, tree = treeById(atlas, view.tree)!, r = restored(view.recovered);
  const options = parentOptions(atlas, tree.id);
  const membersFor = (parent: string) => { const [kind, id] = parent.split(':'); return outlineChildren(tree, kind, id).map(child => ({ kind: childKind(child), id: childId(child) })); };
  const [values, update] = useFormValues(() => {
    const parent = record ? parentDefault(options, tree.base) : r.value(2, parentDefault(options, tree.base));
    const members = record ? [] : membersFor(parent).map((_, index) => r.checked(3 + index, false));
    return { id: r.value(0, record?.id ?? ''), title: r.value(1, record?.title ?? ''), parent, members, reason: r.value(record ? 2 : 3 + members.length, record ? `Revise ${record.title}` : 'Group related explanations') };
  }, current => ({ controls: [text(current.id), text(current.title), ...(!record ? [pick(current.parent), ...current.members.map(box)] : []), text(current.reason)] }));
  const members = membersFor(values.parent);
  return (
    <>
      <TextInput label="Stable ID" value={values.id} isDisabled={Boolean(record)} onChange={id => update({ id })} />
      <TextInput label="Label" value={values.title} onChange={title => update({ title })} />
      {!record ? <>
        <Choice label="Place beneath" value={values.parent} onChange={parent => update({ parent, members: membersFor(parent).map(() => false) })} options={options.map(item => ({ id: `${item.kind}:${item.id}`, name: `${item.kind}: ${item.title}` }))} />
        <Group label="Group existing detail"><div className="ticks">{members.map((item, index) => <Tick key={`${item.kind}:${item.id}`} checked={values.members[index] ?? false} onChange={checked => update({ members: values.members.map((value, at) => at === index ? checked : value) })}>{recordOf(atlas, tree.id, item.kind, item.id)?.title ?? ''}</Tick>)}</div></Group>
      </> : null}
      <TextInput label="Reason" value={values.reason} onChange={reason => update({ reason })} />
      <Save onPress={() => { const [kind, parentId] = values.parent.split(':'); return store.saveStructure({ baseline: view.files.identity, operation: 'branch', tree: tree.id, id: values.id, title: values.title, create: !record, members: members.filter((_, index) => values.members[index]).map(({ kind: memberKind, id }) => ({ kind: memberKind, id })), parent: { kind, id: parentId }, reason: values.reason }); }} />
      <Autosave />
    </>
  );
}

function PositionForm({ view }: { view: Extract<DialogView, { kind: 'position' }> }) {
  const store = useStore(), atlas = store.atlas!, record = view.record, tree = treeById(atlas, record.tree)!, r = restored(view.recovered);
  const options = parentOptions(atlas, tree.id);
  const beforeFor = (parent: string) => { const [kind, id] = parent.split(':'); return [{ id: '', name: 'Last in this group' }, ...outlineChildren(tree, kind, id).filter(item => (item as Record<string, unknown>)[view.recordKind] !== record.id).map(item => { const itemKind = childKind(item), itemId = childId(item); return { id: `${itemKind}:${itemId}`, name: `Before ${recordOf(atlas, tree.id, itemKind, itemId)?.title}` }; })]; };
  const [values, update] = useFormValues(() => ({ parent: r.value(0, parentDefault(options, record.ancestors?.at(-1)?.id ?? tree.base)), before: r.value(1, ''), cleanup: r.checked(2, false), reason: r.value(3, `Change the position of ${record.title}`) }), current => ({ controls: [pick(current.parent), pick(current.before), box(current.cleanup), text(current.reason)] }));
  return (
    <>
      <Choice label="Develop beneath" value={values.parent} onChange={parent => update({ parent, before: '' })} options={options.map(item => ({ id: `${item.kind}:${item.id}`, name: `${item.kind}: ${item.title}` }))} />
      <Choice label="Position" value={values.before} onChange={before => update({ before })} options={beforeFor(values.parent)} />
      <Tick checked={values.cleanup} onChange={cleanup => update({ cleanup })}>Remove Branches left empty and their attached Facets</Tick>
      <TextInput label="Reason" value={values.reason} onChange={reason => update({ reason })} />
      <Save onPress={() => { const [parentKind, id] = values.parent.split(':'), [beforeKind, beforeId] = values.before.split(':'); return store.saveStructure({ baseline: view.files.identity, operation: 'place', tree: record.tree, id: record.id, kind: view.recordKind, cleanupEmptyBranches: values.cleanup, parent: { kind: parentKind, id }, ...(beforeId ? { before: { kind: beforeKind, id: beforeId } } : {}), reason: values.reason }); }} />
      <Autosave />
    </>
  );
}

function RemoveForm({ view }: { view: Extract<DialogView, { kind: 'remove' }> }) {
  const store = useStore(), atlas = store.atlas!, record = view.record, r = restored(view.recovered);
  const [values, update] = useFormValues(() => { const destination = r.value(0, ''); return { destination, body: r.value(1, pointById(atlas, destination)?.body ?? ''), reason: r.value(2, ''), cleanup: r.checked(3, false) }; }, current => ({ controls: [pick(current.destination), area(current.body), area(current.reason), box(current.cleanup)] }));
  return (
    <>
      <p className="note">The review will show the removed Point, promoted children, affected Facets and citations. Read and rewrite the surviving explanation if you are consolidating; naming a destination does not preserve meaning by itself.</p>
      <Choice label="Surviving destination" value={values.destination} onChange={destination => update({ destination, body: pointById(atlas, destination)?.body ?? '' })} options={[{ id: '', name: 'Remove with no surviving destination' }, ...atlas.points.filter(item => item.id !== record.id).map(item => ({ id: item.id, name: `${treeById(atlas, item.tree)!.title}: ${item.title}` }))]} />
      <TextBox label="Complete surviving explanation" value={values.body} isDisabled={!values.destination} onChange={body => update({ body })} />
      <TextBox label="Why this material is removed or how its meaning survives" short value={values.reason} onChange={reason => update({ reason })} />
      <Tick checked={values.cleanup} onChange={cleanup => update({ cleanup })}>Remove Branches left empty and their attached Facets</Tick>
      <Save onPress={() => store.saveStructure({ baseline: view.files.identity, operation: 'remove', tree: record.tree, id: record.id, cleanupEmptyBranches: values.cleanup, reason: values.reason, ...(values.destination ? { destination: values.destination, destinationBody: values.body } : {}) })}>Prepare removal for review</Save>
      <Autosave />
    </>
  );
}

function NewTreeForm({ view }: { view: Extract<DialogView, { kind: 'newTree' }> }) {
  const store = useStore(), r = restored(view.recovered);
  const [values, update] = useFormValues(() => ({ id: r.value(0, ''), title: r.value(1, ''), scope: r.value(2, ''), body: r.value(3, '') }), current => ({ controls: [text(current.id), text(current.title), text(current.scope), area(current.body)] }));
  return (
    <>
      <TextInput label="Stable ID" placeholder="product" value={values.id} onChange={id => update({ id })} />
      <TextInput label="Title" value={values.title} onChange={title => update({ title })} />
      <TextInput label="Subject and scope" value={values.scope} onChange={scope => update({ scope })} />
      <TextBox label="Base Point explanation" value={values.body} onChange={body => update({ body })} />
      <Save onPress={() => store.saveNewTree(view.files, values)} />
      <Autosave />
    </>
  );
}

function NewPointForm({ view }: { view: Extract<DialogView, { kind: 'newPoint' }> }) {
  const store = useStore(), atlas = store.atlas!, r = restored(view.recovered);
  const parentsFor = (treeId: string): Option[] => { const tree = treeById(atlas, treeId); if (!tree) return []; return [{ id: `point:${tree.base}`, name: `Base: ${pointById(atlas, tree.base)?.title}` }, ...atlas.points.filter(point => point.tree === tree.id && point.id !== tree.base).map(point => ({ id: `point:${point.id}`, name: point.title })), ...atlas.branches.filter(branch => branch.tree === tree.id).map(branch => ({ id: `branch:${branch.id}`, name: `Branch: ${branch.title}` }))]; };
  const [values, update] = useFormValues(() => { const tree = r.value(0, treeById(atlas, view.tree) ? view.tree! : atlas.trees[0].id); return { tree, parent: r.value(1, parentsFor(tree)[0]?.id ?? ''), id: r.value(2, ''), title: r.value(3, ''), body: r.value(4, '') }; }, current => ({ controls: [pick(current.tree), pick(current.parent), text(current.id), text(current.title), area(current.body)] }));
  return (
    <>
      <Choice label="Owning Tree" value={values.tree} onChange={tree => update({ tree, parent: parentsFor(tree)[0]?.id ?? '' })} options={atlas.trees.map(tree => ({ id: tree.id, name: tree.title }))} />
      <Choice label="Develop beneath" value={values.parent} onChange={parent => update({ parent })} options={parentsFor(values.tree)} />
      <TextInput label="Stable ID" value={values.id} onChange={id => update({ id })} />
      <TextInput label="Title" value={values.title} onChange={title => update({ title })} />
      <TextBox label="Explanation" value={values.body} onChange={body => update({ body })} />
      <Save onPress={() => store.saveNewPoint(view.files, values)} />
      <Autosave />
    </>
  );
}

function NewFacetForm({ view }: { view: Extract<DialogView, { kind: 'newFacet' }> }) {
  const store = useStore(), atlas = store.atlas!, r = restored(view.recovered);
  const others = atlas.trees.filter(tree => tree.id !== view.record.tree);
  const targetsFor = (via: string): Option[] => atlas.points.filter(item => item.tree === via).map(item => ({ id: item.id, name: item.title }));
  const [values, update] = useFormValues(() => { const via = r.value(0, others[0].id); return { via, target: r.value(1, targetsFor(via)[0]?.id ?? ''), id: r.value(2, ''), title: r.value(3, ''), body: r.value(4, '') }; }, current => ({ controls: [pick(current.via), pick(current.target), text(current.id), text(current.title), area(current.body)] }));
  return (
    <>
      <Choice label="Through this Tree" value={values.via} onChange={via => update({ via, target: targetsFor(via)[0]?.id ?? '' })} options={others.map(tree => ({ id: tree.id, name: tree.title }))} />
      <Choice label="Relevant Point" value={values.target} onChange={target => update({ target })} options={targetsFor(values.via)} />
      <TextInput label="Stable ID" value={values.id} onChange={id => update({ id })} />
      <TextInput label="Title" value={values.title} onChange={title => update({ title })} />
      <TextBox label="Why the connection matters" value={values.body} onChange={body => update({ body })} />
      <Save onPress={() => store.saveNewFacet(view, values)} />
      <Autosave />
    </>
  );
}

const customDefault = '---\n{"id":"my-style","revision":"1"}\n---\n# My authoring style\n\nExplain how this account should choose Tree boundaries, develop Points and use Facets.\n';
function InitializeForm({ view }: { view: Extract<DialogView, { kind: 'initialize' }> }) {
  const store = useStore(), styles: any[] = view.styles.styles, r = restored(view.recovered);
  const [values, update] = useFormValues(() => ({ id: r.value(0, 'my-atlas'), title: r.value(1, 'My Atlas'), style: r.value(2, styles[0]?.id ?? 'custom'), custom: r.value(3, customDefault) }), current => ({ controls: [text(current.id), text(current.title), pick(current.style), area(current.custom)] }));
  const chosen = styles.find(item => item.id === values.style);
  return (
    <>
      <TextInput label="Stable ID" value={values.id} onChange={id => update({ id })} />
      <TextInput label="Title" value={values.title} onChange={title => update({ title })} />
      <Choice label="Authoring style" value={values.style} onChange={style => update({ style })} options={[...styles.map(item => ({ id: item.id, name: item.title })), { id: 'custom', name: 'Custom style' }]} />
      <Group label="Style guidance">{chosen ? <Prose html={chosen.html} /> : <p>Write the local guidance for this account below.</p>}</Group>
      {values.style === 'custom' ? <div className="custom-style">
        <p className="minor">Provide a complete Markdown style with JSON metadata, stable id, revision, title and guidance. The reviewed draft captures these exact words.</p>
        <TextBox ariaLabel="Custom style definition" code value={values.custom} onChange={custom => update({ custom })} />
      </div> : null}
      <Save onPress={() => store.saveInitialize(view.files, values)} />
      <Autosave />
    </>
  );
}

function StyleForm({ view }: { view: Extract<DialogView, { kind: 'style' }> }) {
  const store = useStore(), current = view.available.current, styles: any[] = view.available.styles, r = restored(view.recovered);
  const captured = view.files.files.find((item: any) => item.path === current?.path)?.content ?? '';
  const choices = useRef<StyleChoices | null>(null);
  const [values, update] = useFormValues(() => {
    choices.current = new StyleChoices(captured, styles);
    const picker = r.value(0, '');
    const chosen = picker ? choices.current.choose(picker, captured) : captured;
    return { picker, content: r.value(1, chosen), reason: r.value(2, 'Revise the Atlas authoring style') };
  }, state => ({ controls: [pick(state.picker), area(state.content), text(state.reason)] }));
  const selected = styles.find(item => item.id === values.picker);
  return (
    <>
      <h3 className="title">{current?.title ?? 'Choose an Atlas style'}</h3>
      <p className="minor">{current ? `${current.id} · revision ${current.revision}. This captured guidance describes how the account is organized.` : 'This account predates explicit styles. Adopting one is a reviewed change.'}</p>
      {current ? <Prose html={current.html} /> : null}
      <Expand section open={!current} title="Revise or replace style">
        <p className="minor">A style change takes effect only after its draft is reviewed and applied.</p>
        <Choice label="Style to adopt or revise" value={values.picker} onChange={picker => update({ picker, content: choices.current!.choose(picker, values.content) })} options={[{ id: '', name: 'Revise the captured style' }, ...styles.map(item => ({ id: item.id, name: item.title }))]} />
        {selected ? <Prose html={selected.html} /> : <p className="minor">Edit the captured style, including its revision, then review the exact change.</p>}
        <Expand title="Edit captured style definition" level={4}><TextBox ariaLabel="Captured style definition" code value={values.content} onChange={content => update({ content })} /></Expand>
        <TextInput label="Reason for the style change" value={values.reason} onChange={reason => update({ reason })} />
        <Save onPress={() => store.saveStyle(view.files, values.content, values.reason)}>Prepare explicit style change</Save>
      </Expand>
      <Autosave />
    </>
  );
}

function ChecksForm({ view }: { view: Extract<DialogView, { kind: 'checksForm' }> }) {
  const store = useStore(), draft = view.draft, r = restored(view.recovered);
  const checks: any[] = draft.plan.candidate.atlas.checks.filter((check: any) => check.status === 'active');
  const [values, update] = useFormValues(() => ({ actor: r.value(0, ''), entries: checks.map((check, index) => ({ check, outcome: r.value(1 + index * 3, 'unreviewed'), reason: r.value(2 + index * 3, ''), evidence: r.value(3 + index * 3, '') })) }), current => ({ controls: [text(current.actor), ...current.entries.flatMap(entry => [pick(entry.outcome), text(entry.reason), area(entry.evidence)])] }));
  const set = (index: number, patch: Record<string, string>) => update({ entries: values.entries.map((entry, at) => at === index ? { ...entry, ...patch } : entry) });
  return (
    <>
      <p>Review the candidate explanations and the Check definitions below. This records evidence against this exact candidate; it does not apply or approve the draft.</p>
      <TextInput label="Reviewer" placeholder="Reviewer name" value={values.actor} onChange={actor => update({ actor })} />
      {values.entries.map((entry, index) => (
        <Section key={entry.check.id} title={`${entry.check.title} · ${entry.check.level}`}>
          <pre className="source-text">{entry.check.body}</pre>
          <Choice label="Outcome" value={entry.outcome} onChange={outcome => set(index, { outcome })} options={['unreviewed', 'pass', 'fail', 'unable'].map(id => ({ id, name: id }))} />
          <TextInput label="Reason" placeholder="Reason for this result" value={entry.reason} onChange={reason => set(index, { reason })} />
          <TextBox label="Evidence" short placeholder="What did you inspect, and what did it show?" value={entry.evidence} onChange={evidence => set(index, { evidence })} />
        </Section>
      ))}
      <Save onPress={() => store.saveCheckEvidence(draft, values.actor, values.entries)}>Save Check evidence</Save>
      <Autosave />
    </>
  );
}

