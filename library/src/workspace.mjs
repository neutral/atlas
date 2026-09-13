import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtlasToolError, openAtlas } from './view.mjs';
import { digest } from './source-inventory.mjs';
import { pathContainsSymlink, pathCaseOrNormalizationMismatch } from './util.mjs';

const configurationKeys = ['specificationRevision', 'maxDocumentBytes'];
let processorIdentity;

function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

function argument(condition, text) {
  if (!condition) throw new AtlasToolError('atlas.tools.invalid-argument', text);
}

function configured(condition, text) {
  if (!condition) throw new AtlasToolError('atlas.workspace.invalid-configuration', text);
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function exactPath(value) {
  return typeof value === 'string' && (value === '.' || (value.length > 0 && !path.isAbsolute(value)
    && !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => !['', '.', '..'].includes(part))));
}

export function canonicalDestination(file) {
  const suffix = [];
  let existing = file;
  while (true) {
    try {
      const stat = fs.lstatSync(existing);
      // Preserve a selected symlink leaf so destination guards can refuse it.
      if (existing === file && stat.isSymbolicLink()) return file;
      return path.join(fs.realpathSync(existing), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

export function checkConfiguration(configuration, check) {
  check(object(configuration) && Object.keys(configuration).every((key) => configurationKeys.includes(key)), 'Unsupported reading configuration.');
  for (const field of ['specificationRevision']) {
    check(configuration[field] === undefined || (typeof configuration[field] === 'string' && configuration[field].trim().length > 0), `${field} must be a nonblank string.`);
  }
  check(configuration.maxDocumentBytes === undefined || (Number.isSafeInteger(configuration.maxDocumentBytes) && configuration.maxDocumentBytes > 0), 'maxDocumentBytes must be a positive safe integer.');
}

export function effectiveConfiguration(durable, explicit) {
  const overrides = Object.fromEntries(Object.entries(explicit ?? {}).filter(([, value]) => value !== undefined));
  return { specificationRevision: '0.9.0', maxDocumentBytes: 1024 * 1024, ...durable, ...overrides };
}

export function processorDigest() {
  if (processorIdentity) return processorIdentity;
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const entries = [];
  for (const directory of ['src', 'schemas']) {
    for (const name of fs.readdirSync(path.join(packageRoot, directory)).sort()) {
      const relative = `${directory}/${name}`;
      if (fs.statSync(path.join(packageRoot, relative)).isFile()) entries.push([relative, digest(fs.readFileSync(path.join(packageRoot, relative)))]);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  entries.push(['package.json', digest(JSON.stringify(manifest))]);
  for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
    let location = path.dirname(fileURLToPath(import.meta.resolve(name)));
    while (true) {
      const candidate = path.join(location, 'package.json');
      if (fs.existsSync(candidate)) {
        const dependency = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (dependency.name === name) { entries.push([name, dependency.version, digest(JSON.stringify(dependency))]); break; }
      }
      const parent = path.dirname(location);
      if (parent === location) throw new Error(`Cannot identify installed dependency ${name}.`);
      location = parent;
    }
  }
  processorIdentity = digest(JSON.stringify({ entries, node: process.version, api: 'atlas.read-view/2' }));
  return processorIdentity;
}

export function readConfiguration(repositoryRoot) {
  const file = path.join(repositoryRoot, 'atlas.workspace.json');
  let bytes;
  try {
    configured(fs.lstatSync(file).isFile(), 'atlas.workspace.json must be a regular file.');
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { value: {}, sourceDigest: null };
    if (error instanceof AtlasToolError) throw error;
    throw new AtlasToolError('atlas.workspace.invalid-configuration', error.message);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)); }
  catch { throw new AtlasToolError('atlas.workspace.invalid-configuration', 'atlas.workspace.json must contain a UTF-8 JSON object.'); }
  configured(object(value) && Object.keys(value).every((key) => ['format', 'atlasPath', 'configuration'].includes(key)) && value.format === 1, 'Unsupported workspace configuration format or fields.');
  configured(exactPath(value.atlasPath), 'atlasPath must be an exact repository-relative directory.');
  if (value.configuration !== undefined) checkConfiguration(value.configuration, configured);
  return { value, sourceDigest: digest(bytes) };
}


/** Retain one current observation in memory without writing workspace state. */
export function openWorkspace(options) {
  argument(object(options) && Object.keys(options).every((key) => ['repositoryRoot', 'atlasPath', 'configuration'].includes(key)), 'Unsupported workspace options.');
  argument(typeof options.repositoryRoot === 'string' && path.isAbsolute(options.repositoryRoot), 'repositoryRoot must be absolute.');
  argument(options.atlasPath === undefined || exactPath(options.atlasPath), 'atlasPath must be an exact repository-relative directory.');
  if (options.configuration !== undefined) checkConfiguration(options.configuration, argument);
  const request = structuredClone(options);
  let repositoryRoot;
  try { repositoryRoot = fs.realpathSync(options.repositoryRoot); }
  catch (error) { throw new AtlasToolError('atlas.workspace.invalid-configuration', error.message); }
  configured(fs.statSync(repositoryRoot).isDirectory(), 'repositoryRoot must identify a directory.');
  let closed = false, info, remembered;

  function effective() {
    if (closed) throw new AtlasToolError('atlas.workspace.closed', 'The workspace is closed.');
    const { value, sourceDigest } = readConfiguration(repositoryRoot);
    const atlasPath = request.atlasPath ?? value.atlasPath;
    configured(exactPath(atlasPath), 'An explicit atlasPath or atlas.workspace.json is required.');
    const atlasRoot = path.resolve(repositoryRoot, atlasPath);
    configured(!pathContainsSymlink(repositoryRoot, atlasRoot) && !pathCaseOrNormalizationMismatch(repositoryRoot, atlasRoot), 'atlasPath traverses a symlink or differs in case or normalization.');
    try { configured(fs.lstatSync(atlasRoot).isDirectory(), 'atlasPath must identify a directory.'); }
    catch (error) { if (error instanceof AtlasToolError) throw error; throw new AtlasToolError('atlas.workspace.invalid-configuration', error.message); }
    const configuration = effectiveConfiguration(value.configuration, request.configuration);
    const configurationDigest = digest(JSON.stringify({ sourceDigest, configuration, repositoryRoot, atlasRoot }));
    info = frozen({ repositoryRoot, atlasRoot, atlasPath, configuration, configurationDigest, configurationSourceDigest: sourceDigest });
    return info;
  }

  function checkUnchanged(settings) {
    let currentDigest;
    try { currentDigest = readConfiguration(repositoryRoot).sourceDigest; }
    catch { throw new AtlasToolError('atlas.workspace.configuration-changed', 'Workspace configuration became unreadable or invalid during observation. Retry the operation.'); }
    if (currentDigest !== settings.configurationSourceDigest) {
      throw new AtlasToolError('atlas.workspace.configuration-changed', 'Workspace configuration changed during observation. Retry the operation.');
    }
  }

  function observe(force = false) {
    try {
      const settings = effective();
      let view = !force && remembered?.key === settings.configurationDigest ? remembered.view : undefined;
      let freshness = view?.freshness();
      if (freshness?.status !== 'fresh') {
        view = openAtlas(settings.atlasRoot, settings.configuration);
        freshness = view.freshness();
      }
      configured(view.atlasRoot === settings.atlasRoot, 'The selected directory has no Atlas root; ancestor discovery is not a workspace selection.');
      checkUnchanged(settings);
      // Never substitute an older complete view for a newer incomplete observation.
      remembered = view.validation.complete && view.identity.digest && freshness.status === 'fresh'
        ? { key: settings.configurationDigest, view } : undefined;
      return frozen({ contract: 'atlas.workspace-view/2', view, freshness });
    } catch (error) {
      remembered = undefined;
      throw error;
    }
  }

  effective();
  return Object.freeze({
    get info() { return info; },
    read() { return observe(); },
    refresh() { return observe(true); },
    close() { closed = true; remembered = undefined; },
  });
}
