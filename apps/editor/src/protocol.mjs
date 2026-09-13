export class EditorError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function requireValue(condition, message, code = 'atlas.editor.invalid-request') {
  if (!condition) throw new EditorError(code, message);
}

export function fields(value, allowed, required = []) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
  requireValue(Object.keys(value).every(key => allowed.includes(key)), 'Unsupported request fields.');
  requireValue(required.every(key => Object.hasOwn(value, key)), 'Required request fields are missing.');
}

export function exactPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes('\0')
    && !value.startsWith('/') && value.split('/').every(part => !['', '.', '..'].includes(part));
}

export const requests = Object.freeze({
  'export-options': [], 'export-prepare': ['profileId', 'name'], 'export-apply': ['exportId'], 'export-preview': ['exportId'], 'agent-config': [],
  state: [], refresh: [], 'draft-list': [], 'report-list': [],
  read: ['viewId', 'kind', 'id', 'mapId', 'path', 'target', 'ownerPath'],
  find: ['viewId', 'query', 'options'], freshness: ['viewId'],
  compare: ['beforeViewId', 'afterViewId'],
  prepare: ['baseViewId', 'expected', 'operations'], apply: ['planId', 'mode'],
  checks: ['viewId', 'filters'], evaluate: ['viewId', 'planId', 'actor', 'checkIds'],
  retain: ['runId'], 'report-read': ['reportId'],
  'draft-save': ['draftId', 'kind', 'path', 'baseViewDigest', 'text', 'expectedRevision'],
  'draft-discard': ['draftId', 'expectedRevision'],
});

export function validateRequest(method, value) {
  requireValue(Object.hasOwn(requests, method), 'Unknown Editor method.', 'atlas.editor.unknown-method');
  fields(value, requests[method]);
}
