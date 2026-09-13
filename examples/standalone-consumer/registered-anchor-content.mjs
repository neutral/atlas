// SPDX-License-Identifier: CC0-1.0 OR 0BSD
// Change this literal binding only after reviewing the verifier against the complete new Check bytes and selected catalog registration.
export const CHECK_ID = 'registered-anchor-content';
export const CHECK_REVISION = 'sha256:3966a73b211fa9999c6dc59be09a8d51040e00c233325b23453872df2ddb47e1';

function verify({ view, check, subjects, actor }) {
  const model = view.validation.normalized;
  const unavailable = (message) => ({ outcome: 'unable', summary: message, evidence: [], diagnostics: [{ message }] });
  if (view.status !== 'ready' || !model) return unavailable('A complete valid captured model is required.');
  if (check.id !== CHECK_ID || check.revision !== CHECK_REVISION) return unavailable('This verifier supports only the declared exact Check revision.');
  const registryIds = model.atlas.resources.map((resource) => resource.id).sort();
  const registered = new Set(registryIds), points = new Map(model.points.map((point) => [point.id, point]));
  const registrySource = view.identity.inputs.find((input) => input.path === 'catalog.json' && input.kind === 'file');
  if (!registrySource?.sha256) return unavailable('The captured registry source hash is unavailable.');
  const observed = [], failures = [];
  for (const subject of subjects) {
    const point = points.get(subject.id), anchor = point?.records.find((record) => record.kind === 'anchor' && record.path === subject.path);
    const source = view.identity.inputs.find((input) => input.path === subject.path && input.kind === 'file');
    if (subject.kind !== 'point-anchor' || !point || !anchor || point.primaryMap !== subject.map || !source?.sha256) {
      return unavailable(`The captured anchor subject cannot be resolved exactly: ${subject.path}.`);
    }
    const active = point.lifecycle === 'active';
    const matchedResourceIds = [...new Set(anchor.content.filter((target) => typeof target.resource === 'string' && registered.has(target.resource)).map((target) => target.resource))].sort();
    observed.push({ id: point.id, path: anchor.path, sha256: source.sha256, lifecycle: point.lifecycle, posture: point.posture,
      content: anchor.content, matchedResourceIds, eligible: active, exemption: active ? null : `Point lifecycle is ${point.lifecycle}.` });
    if (active && matchedResourceIds.length === 0) failures.push({ path: anchor.path, message: `Active anchor ${point.id} has no Content target naming a registered Resource.` });
  }
  const eligibleCount = observed.filter((item) => item.eligible).length;
  return { outcome: failures.length ? 'fail' : 'pass',
    summary: failures.length ? `${failures.length} selected active anchors lack registered Content.` : eligibleCount ? 'Every selected active anchor names registered Content.' : 'No selected anchor has active lifecycle; the requirement holds vacuously.',
    evidence: [{ summary: 'Captured anchor Content, lifecycle, exact source hashes, and Resource registry membership.', mediaType: 'application/json', data: JSON.stringify({
      contract: 'example.registered-anchor-content-evidence/1', check: { id: CHECK_ID, revision: CHECK_REVISION }, actor,
      sourceInputDigest: view.identity.inputDigest, registry: { path: 'catalog.json', sha256: registrySource.sha256, ids: registryIds }, subjects: observed,
    }) }], diagnostics: failures };
}

// Importing this host-selected module registers nothing and adopts no Check by itself.
export const registrations = Object.freeze([Object.freeze({ id: 'example/registered-anchor-content', version: '1',
  checks: Object.freeze([Object.freeze({ id: CHECK_ID, revision: CHECK_REVISION })]), capabilities: Object.freeze([]), verify })]);
