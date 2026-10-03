import { prepareChange } from '../../../library/src/authoring.mjs';
import { prepareAbsorb, reviewChange } from '../../../library/src/absorb.mjs';
import { referenceIndex } from '../../../library/src/references.mjs';

const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' }); };
const text = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body.trim()}\n`;
const json = value => JSON.stringify(value, null, 2) + '\n';
function located(outline, kind, id) {
  if (kind === 'point' && outline.base === id) return { item: outline, base: true };
  const find = children => {
    for (let index = 0; index < children.length; index++) {
      const item = children[index];
      if (item[kind] === id) return { item, siblings: children, index };
      const nested = find(item.children ?? []); if (nested) return nested;
    }
  };
  return find(outline.children ?? []);
}
const has = (item, kind, id) => item[kind] === id || (item.children ?? []).some(child => has(child, kind, id));

/** Form submissions prepare complete reviewable changes; no authored write occurs here. */
export function prepareFormChange(view, input) {
  if (!view.atlas || view.status !== 'ready') fail('Repair the Atlas before changing its structure.');
  const { operation, tree: treeId, id, kind = 'point', reason } = input;
  if (!reason?.trim()) fail('Explain why this change is useful.');
  const tree = view.atlas.trees.find(item => item.id === treeId);
  if (!tree) fail('Choose an existing owning Tree.');
  const files = new Map(view.files.map(file => [file.path, file.content]));
  const outline = JSON.parse(files.get(tree.path));
  const changes = new Map();
  const contributions = [];
  if (operation === 'branch') {
    if (!id?.trim() || !input.title?.trim()) fail('A Branch needs an ID and label.');
    const existing = located(outline, 'branch', id);
    if (input.create && existing) fail('This Tree already has that Branch ID.');
    if (!input.create && !existing) fail('The Branch no longer exists.');
    if (existing) existing.item.title = input.title;
    else {
      const parent = located(outline, input.parent?.kind, input.parent?.id);
      if (!parent) fail('Choose a parent in the owning Tree.');
      const chosen = input.members;
      if (!Array.isArray(chosen) || !chosen.length) fail('Choose at least one existing child to group in the Branch.');
      const children = parent.item.children ?? [];
      const grouped = children.filter(child => chosen.some(member => child[member.kind] === member.id));
      if (grouped.length !== chosen.length) fail('Choose existing children from this parent only.');
      const first = children.findIndex(child => grouped.includes(child));
      parent.item.children = children.filter(child => !grouped.includes(child));
      parent.item.children.splice(first, 0, { branch: id, title: input.title, children: grouped });
    }
    changes.set(tree.path, json(outline));
  } else if (operation === 'place') {
    const original = located(outline, kind, id);
    const parent = located(outline, input.parent?.kind, input.parent?.id);
    if (!original || original.base || !parent) fail('Choose a movable Point or Branch and an existing parent.');
    if (has(original.item, input.parent.kind, input.parent.id)) fail('An item cannot be placed beneath itself or its descendants.');
    original.siblings.splice(original.index, 1);
    const children = parent.item.children ??= [];
    const index = input.before ? children.findIndex(item => item[input.before.kind] === input.before.id) : children.length;
    if (index < 0) fail('The chosen preceding position no longer exists.');
    children.splice(index, 0, original.item); changes.set(tree.path, json(outline));
  } else if (operation === 'remove') {
    const point = view.atlas.points.find(item => item.id === id && item.tree === treeId);
    const original = located(outline, 'point', id);
    if (!point || !original || original.base) fail('Only a non-Base Point can be removed here.');
    const destination = input.destination ? view.atlas.points.find(item => item.id === input.destination && item.id !== id) : null;
    if (input.destination && !destination) fail('Choose a surviving destination Point.');
    original.siblings.splice(original.index, 1, ...(original.item.children ?? []));
    changes.set(tree.path, json(outline)); changes.set(point.path, null);
    const destinations = destination ? [{ point: destination.id }] : undefined;
    contributions.push({ disposition: 'remove', point: id, rationale: reason, ...(destinations ? { destinations } : {}) });
    if (destination && typeof input.destinationBody === 'string') {
      const content = files.get(destination.path), match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
      if (!match) fail('Repair the destination record before consolidating.');
      changes.set(destination.path, text(JSON.parse(match[1]), destination.title, input.destinationBody));
      contributions.push({ disposition: 'update', point: destination.id, rationale: reason });
    }
    for (const facet of view.atlas.facets) {
      if (facet.on.point === id) {
        changes.set(facet.path, null); contributions.push({ disposition: 'remove', tree: facet.tree, facet: facet.id, rationale: `Remove the interpretation attached to ${id}. ${reason}` });
        continue;
      }
      if (!facet.targets.some(target => target.point === id)) continue;
      // A replacement must preserve the Facet's declared target Tree.
      if (destination && destination.tree !== facet.via) fail('An incoming Facet requires a replacement in its target Tree. Revise that Facet before this consolidation.');
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(files.get(facet.path));
      const header = JSON.parse(match[1]);
      header.targets = header.targets.flatMap(target => target.point === id ? destination ? [{ point: destination.id }] : [] : [target]);
      header.targets = header.targets.filter((target, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(target)) === index);
      if (!header.targets.length) { changes.set(facet.path, null); contributions.push({ disposition: 'remove', tree: facet.tree, facet: facet.id, rationale: `Its only target is removed. ${reason}` }); }
      else changes.set(facet.path, `---\n${JSON.stringify(header)}\n---\n${match[2]}`);
    }
    if (destination) {
      const indexed = referenceIndex(view, { limit: 10000 });
      if (!indexed.bounds.exhaustive) fail('The reference inventory is incomplete. Review references before consolidating.');
      const groups = new Map();
      for (const reference of indexed.references) {
        if (reference.target?.kind !== 'point' || reference.target.id !== id || changes.get(reference.from.path) === null) continue;
        if (!reference.destination) fail('A reference cannot be repaired safely. Revise it before consolidation.');
        const list = groups.get(reference.from.path) ?? []; list.push(reference); groups.set(reference.from.path, list);
      }
      for (const [path, references] of groups) {
        // Header edits and Markdown reference rewrites cannot share captured offsets safely.
        if (changes.has(path)) fail('A changed record also cites the removed Point. Revise that citation before consolidating.');
        let content = files.get(path);
        for (const reference of references.sort((a, b) => b.destination.start - a.destination.start)) {
          const parent = path.split('/').slice(0, -1), target = destination.path.split('/');
          while (parent.length && target.length && parent[0] === target[0]) { parent.shift(); target.shift(); }
          const href = [...parent.map(() => '..'), ...target].join('/') + (reference.href.includes('#') ? `#${reference.href.split('#').slice(1).join('#')}` : '');
          content = content.slice(0, reference.destination.start) + href + content.slice(reference.destination.end);
        }
        changes.set(path, content);
      }
    }
  } else fail('Unknown structure operation.');
  if (input.cleanupEmptyBranches) {
    const removed = new Set();
    const prune = children => children.filter(child => { if (child.children) child.children = prune(child.children); if (child.branch && !child.children?.length) { removed.add(child.branch); return false; } return true; });
    outline.children = prune(outline.children); changes.set(tree.path, json(outline));
    for (const facet of view.atlas.facets) if (facet.tree === tree.id && removed.has(facet.on.branch)) { changes.set(facet.path, null); if (contributions.length) contributions.push({ disposition: 'remove', tree: facet.tree, facet: facet.id, rationale: `Its empty host Branch is removed. ${reason}` }); }
    // Incoming interpretations require an explicit revision before removing their Branch targets.
    for (const facet of view.atlas.facets) if (facet.via === tree.id && facet.targets.some(target => removed.has(target.branch))) fail('An incoming Facet targets an empty Branch. Revise that interpretation before removing the Branch.');
  }
  const request = { changes: [...changes].map(([path, content]) => ({ path, content })), reason };
  if (contributions.length) {
    const impact = reviewChange(prepareChange(view, request));
    for (const point of impact.changedPoints ?? []) if (!contributions.some(item => item.point === point.id)) contributions.push({ disposition: 'update', point: point.id, rationale: `Review the revised placement or repaired citation after consolidation. ${reason}` });
    for (const change of impact.changedFacets ?? []) { const facet = change.after ?? change.before; if (!contributions.some(item => item.facet === facet.id && item.tree === facet.tree)) contributions.push({ disposition: change.after ? 'facet' : 'remove', tree: facet.tree, facet: facet.id, rationale: `Review the interpretation after its target or citation changes. ${reason}` }); }
    const proposal = prepareAbsorb(view, { source: { uri: 'atlas.json', role: 'background' }, contributions, changes: request.changes, rationale: reason, unresolved: [] });
    if (proposal.status === 'invalid') fail([...proposal.plan.validation.diagnostics, ...proposal.decisionDiagnostics].map(item => item.message).join(' ') || 'The proposed removal is invalid. Review the Tree and affected interpretations.');
    return { plan: proposal.plan, review: proposal.review };
  }
  return { plan: prepareChange(view, request) };
}
