import path from 'node:path';
import { parseJsonObject } from './frontmatter.mjs';
import { parseCheckDocument } from './structure.mjs';
import { validators } from './schemas.mjs';
import { UTF8, UTF8_BOM } from './constants.mjs';
import { compareCodePoints as compare } from './model.mjs';

// Recovery reads only the opened observation. It never builds a partial Atlas model.
export function capturedChecks(view) {
  const diagnostics = [], checks = [], identities = [], inputs = view.identity.inputs;
  const report = (path, message) => diagnostics.push({ path, message });
  const root = inputs.find(input => input.path === '.');
  const directory = inputs.find(input => input.path === '.checks');
  if (view.validation.diagnostics.some(item => item.code === 'atlas.discovery.root-not-found')) {
    report('atlas.md', 'No Atlas root was discovered. Local Check adoption cannot be established.');
    return { checks, diagnostics };
  }
  if (root?.kind !== 'directory') report('.', 'The Atlas root inventory is unavailable. Check discovery may be incomplete.');
  if (directory && !['directory', 'missing'].includes(directory.kind)) {
    report('.checks', 'The captured .checks directory is unavailable or is not a regular directory.');
    return { checks, diagnostics };
  }
  for (const input of inputs.filter(input => /^\.checks\/[^/]+$/u.test(input.path))) {
    if (!input.path.endsWith('.md') || !['file', 'unreadable'].includes(input.kind)) {
      report(input.path, 'A Check must be a direct regular Markdown file in .checks.');
      continue;
    }
    const bytes = capturedBytes(view, input.path, report);
    if (!bytes) continue;
    const parsed = parseCheckDocument(bytes, path.join(view.atlasRoot, input.path), view.atlasRoot);
    diagnostics.push(...parsed.diagnostics.map(({ path, message }) => ({ path, message })));
    if (parsed.id !== null) identities.push(parsed.id);
    if (parsed.value) checks.push({ ...parsed.value, path: input.path, sha256: input.sha256 });
  }
  const catalog = readCatalog(view, report);
  const ids = new Set(checks.map(check => check.id));
  for (const entry of catalog.checks ?? []) {
    if (!validators.checkRegistration(entry)) report('catalog.json', 'A catalog Check registration is invalid.');
    else if (!ids.has(entry.check)) report('catalog.json', `Check registration ${entry.check} has no readable local definition.`);
  }
  for (const check of checks) {
    const reasons = [], matching = catalog.checks?.filter(entry => entry?.check === check.id);
    const reason = (message, source = 'catalog.json') => { reasons.push(message); report(source, message); };
    let registration = null;
    if (identities.filter(id => id === check.id).length !== 1) {
      reason(`Check identity ${check.id} occurs in multiple local documents.`, check.path);
    } else if (!matching) {
      reason('The catalog Check registrations are unavailable.');
    } else if (matching.length !== 1) {
      reason(`Check ${check.id} has ${matching.length} catalog registrations; exactly one is required.`);
    } else if (!validators.checkRegistration(matching[0])) {
      reason(`The catalog registration for Check ${check.id} is invalid.`);
    } else registration = structuredClone(matching[0]);
    check.level = registration?.level ?? null;
    check.appliesTo = registration?.['applies-to'] ?? null;
    if (registration) {
      const extensions = catalog.extensions?.filter(entry => entry?.owner?.type === 'check' && entry.owner.check === check.id);
      if (!extensions || catalog.unknownExtensionOwner) {
        reason('Check-owned catalog extensions cannot be established.');
        registration = null;
      } else if (extensions.length > 1 || extensions.some(entry => !validators.checkExtension(entry))) {
        reason(`Catalog extensions for Check ${check.id} are invalid or ambiguous.`);
        registration = null;
      } else if (extensions.length) {
        const values = extensions[0].values;
        if (Object.keys(values).some(key => Object.hasOwn(registration, key))) {
          reason(`Catalog extensions for Check ${check.id} repeat a registration field.`);
          registration = null;
        } else registration = { ...registration, ...values };
      }
    }
    check.registration = registration;
    check.reasons = reasons;
  }
  checks.sort((a, b) => compare(a.id, b.id) || compare(a.path, b.path));
  diagnostics.sort((a, b) => compare(a.path, b.path) || compare(a.message, b.message));
  return { checks, diagnostics };
}

function capturedBytes(view, file, report) {
  const document = view.readDocument(file);
  if (document.status !== 'read') {
    report(file, `The captured document is ${document.status}; complete readable bytes are required for Check discovery.`);
    return null;
  }
  return Buffer.from(document.bytesBase64, 'base64');
}

function readCatalog(view, report) {
  const unavailable = { checks: null, extensions: null };
  const bytes = capturedBytes(view, 'catalog.json', report);
  if (!bytes) return unavailable;
  if (bytes.subarray(0, 3).equals(UTF8_BOM)) {
    report('catalog.json', 'Catalog text must not begin with a UTF-8 byte-order mark.');
    return unavailable;
  }
  const text = UTF8.decode(bytes);
  if (text.includes('\0')) {
    report('catalog.json', 'Catalog text must not contain NUL.');
    return unavailable;
  }
  const parsed = parseJsonObject(text);
  if (parsed.errors.length) {
    report('catalog.json', parsed.errors[0]);
    return unavailable;
  }
  // Unrelated catalog declarations cannot suppress independently readable policy.
  const checks = parsed.value.checks === undefined ? [] : parsed.value.checks;
  const extensions = parsed.value.extensions === undefined ? [] : parsed.value.extensions;
  if (!Array.isArray(checks)) report('catalog.json', 'Catalog checks must be an array.');
  if (!Array.isArray(extensions)) report('catalog.json', 'Catalog extensions must be an array.');
  const unknownExtensionOwner = Array.isArray(extensions) && extensions.some(entry =>
    !entry?.owner || !['atlas', 'map', 'area', 'point', 'check'].includes(entry.owner.type)
    || (entry.owner.type === 'check' && typeof entry.owner.check !== 'string'));
  return { checks: Array.isArray(checks) ? checks : null,
    extensions: Array.isArray(extensions) ? extensions : null, unknownExtensionOwner };
}
