import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFiles } from '../src/model.mjs';
import { route } from '../src/route.mjs';
import { inspectAbsorb } from '../src/absorb.mjs';

const source = { uri: 'sources/design.md', role: 'evidence', revision: 'reviewed-1' };
const markdown = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fixture() {
  const files = new Map([
    ['atlas.json', json({ format: 'atlas/1.2', id: 'example', title: 'Example', trees: ['trees/service', 'trees/evidence'] })],
    ['style.md', '# Perspectives\n\nService duties and the evidence for them are separate accounts.\n'],
    ['trees/service/tree.json', json({ id: 'service', title: 'Service design', scope: 'Custody and recovery duties.', base: 'purpose', children: [
      { point: 'lifecycle', children: [{ point: 'shutdown' }] },
    ] })],
    ['trees/evidence/tree.json', json({ id: 'evidence', title: 'Evidence architecture', scope: 'Proof production and verification.', base: 'assurance', children: [
      { point: 'proof-inputs' }, { point: 'measurement' },
    ] })],
    ['trees/service/points/purpose.md', markdown({ id: 'purpose', sources: [source] }, 'Small services', 'Users retain receipts under declared duties.')],
    ['trees/service/points/lifecycle.md', markdown({ id: 'lifecycle', uncertainty: 'Concrete recovery remains untested.' }, 'Recovery follows the service lifecycle', 'An outage and terminal shutdown differ.')],
    ['trees/service/points/shutdown.md', markdown({ id: 'shutdown' }, 'Shutdown ends source work', 'Pending proof obligations remain unfulfilled.')],
    ['trees/evidence/points/assurance.md', markdown({ id: 'assurance' }, 'Evidence preserves its scope', 'A proof establishes only its declared computation.')],
    ['trees/evidence/points/proof-inputs.md', markdown({ id: 'proof-inputs', type: 'decision', status: 'selected', sources: [source], uncertainty: 'Implementation is not established.' }, 'Operator proof inputs', 'The operator captures original witnesses for proof production.')],
    ['trees/evidence/points/measurement.md', markdown({ id: 'measurement', type: 'observation', observedAt: '2026-09-27', sources: [source] }, 'Measured proving time', 'This observation describes one recorded workload.')],
    ['trees/service/facets/assurance.md', markdown({ id: 'assurance', on: 'lifecycle', via: 'evidence', targets: ['proof-inputs'], sources: [source], uncertainty: 'Receiving sufficiency is domain-specific.' }, 'Recovery does not complete absent proof', 'Useful receiving operations do not produce missing source evidence.')],
    ['trees/service/facets/recovery-cost.md', markdown({ id: 'recovery-cost', on: 'purpose', via: 'evidence', targets: ['measurement'] }, 'Recovery cost depends on retained work', 'Material needed by source production remains a separate responsibility.')],
    ['trees/evidence/facets/service.md', markdown({ id: 'service', on: 'proof-inputs', via: 'service', targets: ['lifecycle'] }, 'Production qualifies recovery', 'Service reconstruction and proof production establish different outcomes.')],
    ['trees/evidence/facets/base-scope.md', markdown({ id: 'base-scope', on: 'assurance', via: 'service', targets: ['purpose'] }, 'Evidence informs service promises', 'The service account chooses which evidence its declared functions need.')],
  ]);
  const view = validateFiles(files, { root: '/tmp/atlas-route-absorb-fixture' });
  assert.equal(view.status, 'ready', JSON.stringify(view.diagnostics));
  return { files, view };
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

test('Route bounds descendants by Point depth and keeps a Facet on a Point above distinct from one on the selection', () => {
  const { view } = fixture();
  const standard = route(view, { tree: 'service' });
  assert.deepEqual(standard.supporting.map(({ point }) => point.id), ['lifecycle']);
  assert.deepEqual(standard.supporting[0].reasons, [{ kind: 'authored-descendant', point: 'purpose', pointDepth: 1 }]);
  const deep = route(view, { tree: 'service', detail: 'deep', limit: 1 });
  assert.deepEqual(deep.supporting.map(({ point }) => point.id), ['lifecycle']);
  assert.equal(deep.bounds.supporting.available, 2);
  assert.deepEqual(route(view, { tree: 'service', detail: 'deep' }).supporting[1].reasons, [{ kind: 'authored-descendant', point: 'purpose', pointDepth: 2 }]);
  const detail = route(view, { point: 'shutdown' });
  assert.deepEqual(detail.orientation[0].ancestors.map(({ record, ...ancestor }) => ancestor), [{ id: 'lifecycle', tree: 'service' }]);
  assert.ok(detail.orientation[0].ancestors[0].record.body.includes('outage'));
  const reasons = Object.fromEntries(detail.facets.map(({ facet, reasons }) => [`${facet.tree}/${facet.id}`, reasons.map(reason => reason.kind)]));
  assert.deepEqual(reasons, { 'service/assurance': ['attached-ancestor-point'], 'service/recovery-cost': ['attached-ancestor-point'], 'evidence/service': ['incoming-ancestor-point-reference'], 'evidence/base-scope': ['incoming-ancestor-point-reference'] });
  assert.ok(detail.facets[0].reasons[0].limit.includes('separate judgment'));
});

test('Route describes each Facet by the Point it attaches to and the Points it targets', () => {
  const { view } = fixture();
  const account = route(view, { tree: 'service', detail: 'overview' });
  assert.deepEqual(account.facets.map(({ facet, reasons }) => [facet.tree, facet.id, reasons.map(reason => reason.kind)]), [['service', 'recovery-cost', ['attached-point']], ['evidence', 'base-scope', ['incoming-point-reference']]]);
  const reading = route(view, { tree: 'service', facet: 'assurance' }).facets[0];
  assert.deepEqual([reading.facet.on, reading.facet.via, reading.facet.targets], ['lifecycle', 'evidence', ['proof-inputs']]);
  assert.deepEqual(reading.host, { id: 'lifecycle', tree: 'service', title: 'Recovery follows the service lifecycle', path: 'trees/service/points/lifecycle.md', uncertainty: 'Concrete recovery remains untested.', reference: true, selector: { point: 'lifecycle' } });
  assert.deepEqual(reading.targets, [{ id: 'proof-inputs', tree: 'evidence', title: 'Operator proof inputs', path: 'trees/evidence/points/proof-inputs.md', type: 'decision', status: 'selected', uncertainty: 'Implementation is not established.', reference: true, selector: { point: 'proof-inputs' } }]);
  assert.deepEqual([reading.owner.id, reading.viaTree.id], ['service', 'evidence']);
  const selected = route(view, { tree: 'service', facet: 'assurance' });
  assert.deepEqual(selected.orientation[0].forPoints, ['lifecycle']);
  assert.equal(selected.orientation[0].base.id, 'purpose');
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
  assert.deepEqual(result.candidates.map(({ point }) => point.id), ['proof-inputs', 'lifecycle', 'assurance']);
  assert.deepEqual(result.interpretations.find(({ facet }) => facet.tree === 'service' && facet.id === 'assurance').reasons, [{ kind: 'attached-candidate', point: 'lifecycle' }, { kind: 'incoming-candidate-reference', point: 'proof-inputs' }]);
  assert.deepEqual(result.interpretations.find(({ facet }) => facet.id === 'service').reasons, [{ kind: 'attached-candidate', point: 'proof-inputs' }, { kind: 'incoming-candidate-reference', point: 'lifecycle' }]);
  assert.deepEqual(result.style, { title: 'Perspectives', body: 'Service duties and the evidence for them are separate accounts.', path: 'style.md' });
  assert.deepEqual(Object.keys(result), ['format', 'status', 'identity', 'incoming', 'candidates', 'owners', 'interpretations', 'limits', 'style', 'terms', 'bounds']);
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
