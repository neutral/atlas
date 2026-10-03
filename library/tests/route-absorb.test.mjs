import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles } from '../src/model.mjs';
import { route } from '../src/route.mjs';
import { inspectAbsorb, prepareAbsorb, reviewImpact } from '../src/absorb.mjs';

const source = { uri: 'sources/design.md', role: 'evidence', revision: 'reviewed-1' };
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fixture() {
  const files = new Map([
    ['atlas.json', json({ format: 'atlas/1', id: 'example', title: 'Example', trees: ['trees/service', 'trees/evidence'] })],
    ['trees/service/tree.json', json({ id: 'service', title: 'Service design', scope: 'Custody and recovery duties.', base: 'purpose', children: [
      { branch: 'recovery', title: 'Recovery', children: [{ point: 'lifecycle', children: [{ point: 'shutdown' }] }] },
    ] })],
    ['trees/evidence/tree.json', json({ id: 'evidence', title: 'Evidence architecture', scope: 'Proof production and verification.', base: 'assurance', children: [
      { branch: 'production', title: 'Production', children: [{ point: 'proof-inputs' }, { point: 'measurement' }] },
    ] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose', sources: [source] }, 'Small services', 'Users retain receipts under declared duties.')],
    ['trees/service/points/lifecycle.md', markdown({ id: 'lifecycle', uncertainty: 'Concrete recovery remains untested.' }, 'Recovery follows the service lifecycle', 'An outage and terminal shutdown differ.')],
    ['trees/service/points/shutdown.md', markdown({ id: 'shutdown' }, 'Shutdown ends source work', 'Pending proof obligations remain unfulfilled.')],
    ['trees/evidence/points/assurance.md', markdown({ id: 'assurance' }, 'Evidence preserves its scope', 'A proof establishes only its declared computation.')],
    ['trees/evidence/points/proof-inputs.md', markdown({ id: 'proof-inputs', type: 'decision', status: 'selected', sources: [source], uncertainty: 'Implementation is not established.' }, 'Operator proof inputs', 'The operator captures original witnesses for proof production.')],
    ['trees/evidence/points/measurement.md', markdown({ id: 'measurement', type: 'observation', observedAt: '2026-09-27', sources: [source] }, 'Measured proving time', 'This observation describes one recorded workload.')],
    ['trees/service/facets/assurance.md', markdown({ id: 'assurance', on: { point: 'lifecycle' }, via: 'evidence', targets: [{ point: 'proof-inputs' }], sources: [source], uncertainty: 'Receiving sufficiency is domain-specific.' }, 'Recovery does not complete absent proof', 'Useful receiving operations do not produce missing source evidence.')],
    ['trees/service/facets/branch-cost.md', markdown({ id: 'branch-cost', on: { branch: 'recovery' }, via: 'evidence', targets: [{ branch: 'production' }] }, 'Recovery cost depends on retained work', 'Material needed by source production remains a separate responsibility.')],
    ['trees/evidence/facets/service.md', markdown({ id: 'service', on: { point: 'proof-inputs' }, via: 'service', targets: [{ branch: 'recovery' }] }, 'Production qualifies recovery', 'Service reconstruction and proof production establish different outcomes.')],
    ['trees/evidence/facets/base-scope.md', markdown({ id: 'base-scope', on: { point: 'assurance' }, via: 'service', targets: [{ tree: 'service' }] }, 'Evidence informs service promises', 'The service account chooses which evidence its declared functions need.')],
  ]);
  const view = validateFiles(files, { root: '/tmp/atlas-route-absorb-fixture' });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { files, view };
}

function changedView(files, changes) {
  const result = new Map(files);
  for (const { path, content } of changes) content === null ? result.delete(path) : result.set(path, content);
  const view = validateFiles(result, { root: '/tmp/atlas-route-absorb-fixture' });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return view;
}

test('exact Route retains owning orientation, ancestor explanations, type and source limits', () => {
  const { view } = fixture();
  const result = route(view, { point: 'proof-inputs', detail: 'overview' });
  assert.equal(result.format, 'atlas.route/1');
  assert.equal(result.status, 'ready');
  assert.equal(result.selected[0].point.status, 'selected');
  assert.equal(result.selected[0].point.uncertainty, 'Implementation is not established.');
  assert.equal(result.orientation[0].base.id, 'assurance');
  assert.equal(result.orientation[0].tree.scope, 'Proof production and verification.');
  assert.equal(result.selected[0].reasons[0].kind, 'exact-point');
  assert.deepEqual(result.supporting, []);
  assert.ok(result.facets.some(({ facet }) => facet.tree === 'service' && facet.id === 'assurance'));
  assert.ok(result.facets.some(({ facet, reasons }) => facet.id === 'base-scope' && reasons.some((reason) => reason.kind === 'attached-ancestor-point')));
  result.selected[0].point.sources[0].uri = 'changed.md';
  assert.equal(view.atlas.points.find((point) => point.id === 'proof-inputs').sources[0].uri, source.uri);
});

test('Route bounds descendants by explanatory Point depth and preserves Branch attachment scope', () => {
  const { view } = fixture();
  const standard = route(view, { tree: 'service' });
  assert.deepEqual(standard.supporting.map(({ point }) => point.id), ['lifecycle']);
  const deep = route(view, { tree: 'service', detail: 'deep', limit: 1 });
  assert.deepEqual(deep.supporting.map(({ point }) => point.id), ['lifecycle']);
  assert.equal(deep.bounds.supporting.available, 2);
  const detail = route(view, { point: 'shutdown' });
  assert.ok(detail.orientation[0].ancestors.some((entry) => entry.id === 'lifecycle' && entry.record.body.includes('outage')));
  assert.ok(detail.facets.some(({ reasons }) => reasons.some((reason) => reason.kind === 'attached-ancestor-branch' && reason.limit.includes('separate judgment'))));
});

test('Route keeps lexical alternatives ambiguous, exact misses explicit and dates visible', () => {
  const { view } = fixture();
  const alternatives = route(view, { query: 'proof', limit: 1 });
  assert.equal(alternatives.status, 'ambiguous');
  assert.equal(alternatives.selected.length, 1);
  assert.ok(alternatives.bounds.selected.available > 1);
  assert.equal(alternatives.selected[0].reasons[0].kind, 'lexical-candidate');
  assert.equal(route(view, { point: 'proof-input' }).status, 'missing');
  assert.equal(route(view, { point: 'proof-inputs', type: 'observation' }).status, 'missing');
  const observations = route(view, { tree: 'evidence', type: 'observation' });
  assert.equal(observations.selected[0].point.observedAt, '2026-09-27');
  assert.ok(route(view, { query: 'proof', type: 'untyped' }).selected.every(({ point }) => point.type === undefined));
});

test('Route refuses malformed selectors and distinguishes invalid source from missing identity', () => {
  const { view } = fixture();
  for (const options of [{}, { point: 'purpose', tree: 'service' }, { point: 'bad id' }, { query: 'proof', limit: 101 }, { point: 'purpose', detail: 'all' }, { point: 'purpose', write: true }]) {
    assert.throws(() => route(view, options), { code: 'atlas.route.invalid-argument' });
  }
  const invalid = validateFiles(new Map([['atlas.json', '{}']]), { root: '/tmp/invalid-atlas' });
  assert.equal(route(invalid, { point: 'purpose' }).status, 'unavailable');
});

test('Absorb inspection preserves original incoming material and makes no ownership decision', () => {
  const { view } = fixture();
  const incoming = 'Proof inputs need retained original witnesses. Recovery depends on custody.';
  const result = inspectAbsorb(view, { text: incoming, source, limit: 3 });
  assert.equal(result.incoming.text, incoming);
  assert.deepEqual(result.incoming.source, source);
  assert.equal(result.status, 'candidates');
  assert.ok(result.candidates.some(({ point }) => point.id === 'proof-inputs'));
  assert.ok(result.owners.some(({ tree, reasons }) => tree.id === 'evidence' && reasons.length));
  assert.ok(result.interpretations.some(({ facet }) => facet.id === 'assurance'));
  assert.equal(Object.hasOwn(result, 'contributions'), false);
  assert.equal(inspectAbsorb(view, { text: incoming, source, tree: 'absent' }).status, 'missing');
  assert.equal(inspectAbsorb(view, { text: 'quartz ziggurat', source }).status, 'no-candidates');
});

test('Absorb source metadata follows the source grammar without granting source access', () => {
  const { view } = fixture();
  for (const bad of [{ uri: '/etc/passwd' }, { uri: 'https://user:pass@example.com/data' }, { uri: 'javascript:alert(1)' }, { uri: 'sources/a.md', secret: true }]) {
    assert.throws(() => inspectAbsorb(view, { text: 'proof', source: bad }), { code: 'atlas.absorb.invalid-argument' });
  }
  const reference = { uri: '../external.md', sha256: 'a'.repeat(64), locator: 'Section 2' };
  assert.deepEqual(inspectAbsorb(view, { text: 'proof', source: reference }).incoming.source, reference);
});

test('impact retains both sides of standing/date changes, ancestry and removed incoming Facets', () => {
  const { view, files } = fixture();
  const after = changedView(files, [
    { path: 'trees/evidence/points/proof-inputs.md', content: markdown({ id: 'proof-inputs', type: 'decision', status: 'superseded', sources: [source] }, 'Operator proof inputs', 'This source decision was superseded.') },
    { path: 'trees/evidence/points/measurement.md', content: markdown({ id: 'measurement', type: 'observation', observedAt: '2026-09-28', sources: [source] }, 'Measured proving time', 'A later observation describes another workload.') },
    { path: 'trees/service/facets/assurance.md', content: null },
  ]);
  const result = reviewImpact(view, after);
  assert.equal(result.status, 'ready');
  assert.ok(result.changedPoints.find((point) => point.id === 'proof-inputs').changes.includes('decision-status'));
  assert.ok(result.changedPoints.find((point) => point.id === 'measurement').changes.includes('observation-date'));
  assert.ok(result.review.before.points.some(({ record }) => record.id === 'assurance'));
  assert.ok(result.review.after.branches.some(({ record }) => record.id === 'production'));
  assert.ok(result.review.before.facets.some(({ record }) => record.tree === 'service' && record.id === 'assurance'));
  assert.ok(!result.review.after.facets.some(({ record }) => record.tree === 'service' && record.id === 'assurance'));
  assert.ok(result.limits.some((limit) => limit.includes('Additional consequences may require investigation')));
});

test('impact reviews direct relationships without propagating to every connected account', () => {
  const { view, files } = fixture();
  const after = changedView(files, [{ path: 'trees/evidence/points/proof-inputs.md', content: markdown({ id: 'proof-inputs', type: 'decision', status: 'open', sources: [source] }, 'Operator proof inputs', 'The source decision is reopened.') }]);
  const result = reviewImpact(view, after);
  assert.ok(result.review.after.facets.some(({ record }) => record.id === 'assurance'));
  assert.ok(result.review.after.points.some(({ record, reasons }) => record.id === 'lifecycle' && reasons.some(reason => reason.kind === 'incoming-facet-host')));
  assert.ok(!result.review.after.points.some(({ record }) => record.id === 'shutdown')); // no descendants or graph closure
  assert.deepEqual(reviewImpact(view, view).changedPoints, []);
});

test('prepareAbsorb validates explicit changes without mutating the baseline; repetition is no-op', () => {
  const { view, files } = fixture();
  const change = { path: 'trees/evidence/points/proof-inputs.md', content: markdown({ id: 'proof-inputs', type: 'decision', status: 'open', sources: [source] }, 'Operator proof inputs', 'The producer responsibility is unresolved.') };
  const input = { source, contributions: [{ disposition: 'update', point: 'proof-inputs', rationale: 'The source reopens this decision.' }], changes: [change], rationale: 'Preserve the new decision status.', unresolved: ['The replacement arrangement remains open.'] };
  const proposal = prepareAbsorb(view, input);
  assert.equal(proposal.status, 'ready');
  assert.equal(proposal.plan.changes[0].before, files.get(change.path));
  assert.equal(view.atlas.points.find((point) => point.id === 'proof-inputs').status, 'selected');
  assert.ok(proposal.impact.changedPoints[0].changes.includes('decision-status'));
  const repeated = prepareAbsorb(proposal.plan.candidate, input);
  assert.equal(repeated.status, 'noop');
  assert.deepEqual(repeated.plan.changes, []);
});

test('creation has one explicit owner and identical repeated creation is no-op', () => {
  const { view, files } = fixture();
  const tree = JSON.parse(files.get('trees/service/tree.json'));
  tree.children.push({ point: 'consent' });
  const input = { source, contributions: [{ disposition: 'create', point: 'consent', tree: 'service', rationale: 'Consent needs an independent explanation.' }],
    changes: [{ path: 'trees/service/tree.json', content: json(tree) }, { path: 'trees/service/points/consent.md', content: markdown({ id: 'consent', sources: [source] }, 'Users authorize release', 'Receipt delivery is not standing release permission.') }], rationale: 'Record consent in the service account.' };
  const proposal = prepareAbsorb(view, input);
  assert.equal(proposal.status, 'ready');
  assert.equal(prepareAbsorb(proposal.plan.candidate, input).status, 'noop');
  const wrongOwner = prepareAbsorb(view, { ...input, contributions: [{ ...input.contributions[0], tree: 'evidence' }] });
  assert.equal(wrongOwner.status, 'invalid');
  assert.match(wrongOwner.decisionDiagnostics[0].message, /owning Tree/);
});

test('Facet, conflict, reference-only and non-integration remain distinct contribution decisions', () => {
  const { view, files } = fixture();
  const facet = prepareAbsorb(view, { source, contributions: [{ disposition: 'facet', tree: 'service', facet: 'assurance', rationale: 'Keep this contextual interpretation.' }], changes: [], rationale: 'The existing interpretation already covers the source.' });
  assert.equal(facet.status, 'noop');
  const conflict = prepareAbsorb(view, { source, contributions: [{ disposition: 'conflict', point: 'proof-inputs', rationale: 'The incoming account conflicts with this selected decision.' }], changes: [], rationale: 'Leave the conflict explicit for author review.', unresolved: ['Which source governs?'] });
  assert.equal(conflict.status, 'noop');
  assert.equal(conflict.contributions[0].disposition, 'conflict');
  const reference = prepareAbsorb(view, { source, contributions: [{ disposition: 'reference-only', point: 'purpose', rationale: 'Add background without changing the explanation.' }], changes: [{ path: 'trees/service/points/purpose.md', content: markdown({ id: 'purpose', sources: [source, { uri: 'sources/background.md', role: 'background' }] }, 'Small services', 'Users retain receipts under declared duties.') }], rationale: 'Retain an additional reference.' });
  assert.equal(reference.status, 'ready');
  const badReference = prepareAbsorb(view, { source, contributions: [{ disposition: 'reference-only', point: 'purpose', rationale: 'Claim a source-only edit.' }], changes: [{ path: 'trees/service/points/purpose.md', content: files.get('trees/service/points/purpose.md').replace('declared duties', 'different duties') }], rationale: 'Misclassified proposal.' });
  assert.equal(badReference.status, 'invalid');
  const lostReference = prepareAbsorb(view, { source, contributions: [{ disposition: 'reference-only', point: 'purpose', rationale: 'Replace the reference.' }], changes: [{ path: 'trees/service/points/purpose.md', content: markdown({ id: 'purpose', sources: [] }, 'Small services', 'Users retain receipts under declared duties.') }], rationale: 'A reference-only addition cannot remove evidence.' });
  assert.equal(lostReference.status, 'invalid');
  assert.ok(lostReference.decisionDiagnostics.some((item) => item.message.includes('preserve existing')));
  const noIntegration = { source, contributions: [{ disposition: 'non-integration', rationale: 'The material adds no useful meaning.' }], changes: [], rationale: 'Keep the current account.' };
  assert.equal(prepareAbsorb(view, noIntegration).status, 'noop');
  assert.throws(() => prepareAbsorb(view, { ...noIntegration, changes: [{ path: 'atlas.json', content: files.get('atlas.json') }] }), { code: 'atlas.absorb.invalid-argument' });
});

test('every changed Point or Facet needs an explicit contribution decision', () => {
  const { view, files } = fixture();
  const proposal = prepareAbsorb(view, { source,
    contributions: [{ disposition: 'update', point: 'purpose', rationale: 'Revise the purpose.' }],
    changes: [{ path: 'trees/service/points/shutdown.md', content: files.get('trees/service/points/shutdown.md').replace('unfulfilled', 'unfulfilled and visible') },
      { path: 'trees/service/facets/assurance.md', content: files.get('trees/service/facets/assurance.md').replace('missing source evidence', 'missing original source evidence') }],
    rationale: 'The supplied changes target different identities.' });
  assert.equal(proposal.status, 'invalid');
  assert.ok(proposal.decisionDiagnostics.some((item) => item.point === 'shutdown'));
  assert.ok(proposal.decisionDiagnostics.some((item) => item.facet === 'service/assurance'));
});

test('invalid candidates remain inspectable and invalid contribution requests are rejected', () => {
  const { view } = fixture();
  const input = { source, contributions: [{ disposition: 'update', point: 'purpose', rationale: 'Repair the current explanation.' }], changes: [{ path: 'trees/service/points/purpose.md', content: 'invalid record' }], rationale: 'Inspect the proposed repair.' };
  const proposal = prepareAbsorb(view, input);
  assert.equal(proposal.status, 'invalid');
  assert.equal(proposal.plan.candidate.status, 'invalid');
  assert.ok(proposal.plan.validation.diagnostics.length);
  assert.equal(proposal.impact.status, 'unavailable');
  for (const contributions of [[], [{ disposition: 'merge', point: 'purpose', rationale: 'Not a supported decision.' }], [{ disposition: 'update', point: 'missing', rationale: 'Not an existing identity.' }], [{ disposition: 'non-integration', point: 'purpose', rationale: 'No target is assigned.' }]]) {
    assert.throws(() => prepareAbsorb(view, { ...input, contributions }), { code: 'atlas.absorb.invalid-argument' });
  }
});

test('Absorb carries explicit local evidence hashes into apply preconditions without fetching URLs', () => {
  const { view } = fixture();
  const input = { source: { uri: 'sources/design.md#retention', sha256: 'a'.repeat(64), revision: 'reviewed-1' },
    contributions: [{ disposition: 'conflict', point: 'purpose', rationale: 'Keep the disagreement explicit.' }], changes: [], rationale: 'Preserve the source boundary.' };
  const local = prepareAbsorb(view, input);
  assert.deepEqual(local.plan.sourcePreconditions, [{ uri: input.source.uri, sha256: input.source.sha256 }]);
  assert.deepEqual(local.source, input.source);
  assert.deepEqual(prepareAbsorb(view, { ...input, source: { uri: 'https://example.test/design', sha256: input.source.sha256 } }).plan.sourcePreconditions, []);
  assert.deepEqual(prepareAbsorb(view, { ...input, source: { uri: 'sources/design.md' } }).plan.sourcePreconditions, []);
  assert.throws(() => prepareAbsorb(view, { ...input, source: { ...input.source, allowedRoots: ['/'] } }), { code: 'atlas.absorb.invalid-argument' });
  assert.deepEqual(prepareAbsorb(view, { ...input, sourcePreconditions: [] }).plan.sourcePreconditions, local.plan.sourcePreconditions);
  assert.throws(() => prepareAbsorb(view, { ...input, sourcePreconditions: [{ uri: input.source.uri, sha256: 'b'.repeat(64) }] }), { code: 'atlas.absorb.invalid-argument' });
  assert.throws(() => prepareAbsorb(view, { ...input, sourcePreconditions: [null] }), { code: 'INVALID_REQUEST' });
});
