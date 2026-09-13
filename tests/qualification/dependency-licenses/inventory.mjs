import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const attributionName = /^(?:licen[cs]e|copying|notice|copyright|authors?(?:[._ -]|$)|acknowledg|attribution|third[._ -]?party|patents?(?:[._ -]|$))/iu;
const rootReadme = /^readme(?:[._ -]|$)/iu;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function collectInstalledInventory({ consumerRoot, packageName, tree, outputDirectory }) {
  consumerRoot = fs.realpathSync(consumerRoot);
  fs.mkdirSync(path.join(outputDirectory, 'manifests'), { recursive: true });
  const issues = [], metadataGaps = [], absentOptionalDependencies = [], treeUnavailable = [], treePaths = new Map(), treeEdges = [];
  function treeVisit(node, parent, requestedName, edgeKind) {
    if (!plain(node)) { issues.push({ kind: 'invalid-tree-node', requestedName }); return; }
    if (typeof node.path !== 'string' || !fs.existsSync(path.join(node.path, 'package.json'))) {
      treeUnavailable.push({ requestedName, parent, edgeKind, node }); return;
    }
    const resolved = fs.realpathSync(node.path);
    if (!inside(consumerRoot, resolved)) { issues.push({ kind: 'tree-package-outside-consumer', path: resolved }); return; }
    const previous = treePaths.get(resolved);
    if (previous && previous.version !== node.version) issues.push({ kind: 'tree-version-disagreement', path: resolved, versions: [previous.version, node.version] });
    treePaths.set(resolved, { requestedName, version: node.version, resolved: node.resolved ?? null, from: node.from ?? null });
    treeEdges.push({ parent, target: resolved, requestedName, kind: edgeKind });
    for (const field of ['dependencies', 'optionalDependencies']) for (const [name, child] of Object.entries(node[field] ?? {})) treeVisit(child, resolved, name, field);
  }
  if (!Array.isArray(tree) || tree.length !== 1) throw new Error('Exactly one installed consumer tree is required.');
  for (const field of ['dependencies', 'optionalDependencies']) for (const [name, node] of Object.entries(tree[0][field] ?? {})) treeVisit(node, null, name, field);

  function resolveDependency(from, name) {
    if (!/^(?:@[^/]+\/)?[^/]+$/u.test(name) || name.includes('\\') || name.includes('\0') || name.split('/').some((part) => ['.', '..'].includes(part))) return null;
    let current = from;
    while (inside(consumerRoot, current)) {
      const candidate = path.join(current, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        const real = fs.realpathSync(candidate);
        if (!inside(consumerRoot, real)) { issues.push({ kind: 'dependency-outside-consumer', from, name, path: real }); return null; }
        return real;
      }
      if (current === consumerRoot) break;
      current = path.dirname(current);
    }
    return null;
  }
  const manifests = new Map(), manifestEdges = [];
  function visit(directory) {
    if (manifests.has(directory)) return;
    const manifestPath = path.join(directory, 'package.json'), manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error(`Installed package manifest must be a regular file: ${manifestPath}`);
    const bytes = fs.readFileSync(manifestPath), manifest = JSON.parse(bytes);
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') issues.push({ kind: 'missing-package-identity', path: directory });
    manifests.set(directory, { manifest, bytes });
    const dependencies = new Map();
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) dependencies.set(name, { kind: 'dependency', range, optional: false });
    for (const [name, range] of Object.entries(manifest.optionalDependencies ?? {})) dependencies.set(name, { kind: 'optional', range, optional: true });
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) if (!dependencies.has(name)) dependencies.set(name, { kind: 'peer', range, optional: manifest.peerDependenciesMeta?.[name]?.optional === true });
    for (const [name, declaration] of dependencies) {
      const target = resolveDependency(directory, name);
      manifestEdges.push({ parent: directory, requestedName: name, target, ...declaration });
      if (target) visit(target);
      else (declaration.optional ? absentOptionalDependencies : issues).push({ ...declaration, relationship: declaration.kind,
        kind: declaration.optional ? 'absent-optional-dependency' : 'missing-required-dependency', parent: directory, name });
    }
  }
  const rootPackage = resolveDependency(consumerRoot, packageName);
  if (!rootPackage) throw new Error(`The product is not installed: ${packageName}`);
  visit(rootPackage);
  for (const unavailable of treeUnavailable) {
    const optional = absentOptionalDependencies.find((item) => item.parent === unavailable.parent && item.name === unavailable.requestedName);
    unavailable.classification = optional ? 'absent-declared-optional-dependency' : 'unexplained-uninstalled-tree-entry';
    if (!optional) issues.push({ kind: 'unexplained-uninstalled-tree-entry', parent: unavailable.parent, requestedName: unavailable.requestedName });
  }
  const onlyInTree = [...treePaths.keys()].filter((directory) => !manifests.has(directory));
  const onlyInManifestTraversal = [...manifests.keys()].filter((directory) => !treePaths.has(directory));
  for (const directory of onlyInTree) { issues.push({ kind: 'tree-package-not-in-manifest-closure', path: directory }); visit(directory); }
  for (const directory of onlyInManifestTraversal) issues.push({ kind: 'manifest-package-not-in-tree', path: directory });
  const packages = [];
  for (const [directory, { manifest, bytes }] of [...manifests].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    const treeRecord = treePaths.get(directory), relativePath = path.relative(consumerRoot, directory).split(path.sep).join('/');
    if (treeRecord && treeRecord.version !== manifest.version) issues.push({ kind: 'installed-version-disagrees-with-tree', path: directory, declared: manifest.version, listed: treeRecord.version });
    const manifestHash = sha256(bytes), id = sha256(JSON.stringify({ name: manifest.name, version: manifest.version, relativePath, manifestHash }));
    const manifestFile = `manifests/${id}.json`; fs.writeFileSync(path.join(outputDirectory, manifestFile), bytes);
    const candidates = new Map(), scanIssues = [], scannedFiles = [];
    function scan(current) {
      for (const name of fs.readdirSync(current).sort()) {
        if (['node_modules', '.git'].includes(name)) continue;
        const file = path.join(current, name), relative = path.relative(directory, file).split(path.sep).join('/'), stat = fs.lstatSync(file);
        const candidate = attributionName.test(name) || current === directory && rootReadme.test(name);
        if (stat.isDirectory()) scan(file);
        else if (stat.isFile()) { scannedFiles.push(relative); if (candidate) candidates.set(relative, attributionName.test(name) ? 'conventional-attribution-name' : 'root-readme-context'); }
        else if (candidate) scanIssues.push({ kind: 'unsupported-attribution-entry', file: relative, symbolicLink: stat.isSymbolicLink() });
      }
    }
    try { scan(directory); } catch (error) { scanIssues.push({ kind: 'package-attribution-scan-failed', message: error.message }); }
    const pointer = typeof manifest.license === 'string' ? /^SEE LICEN[CS]E IN\s+(.+)$/iu.exec(manifest.license)?.[1] ?? null : null;
    if (pointer) {
      const selected = path.resolve(directory, pointer);
      if (!inside(directory, selected) || path.isAbsolute(pointer)) scanIssues.push({ kind: 'uncontained-license-pointer', pointer });
      else {
        const relative = path.relative(directory, selected).split(path.sep).join('/');
        // Each component must be real; neither an explicit pointer nor a package filename grants outside access.
        let current = directory, valid = true;
        for (const part of relative.split('/')) {
          current = path.join(current, part);
          if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) { valid = false; break; }
        }
        if (!valid || !fs.lstatSync(selected).isFile()) scanIssues.push({ kind: 'unavailable-license-pointer', pointer });
        else candidates.set(relative, 'manifest-license-pointer');
      }
    }
    const attributions = [];
    for (const [relative, reason] of [...candidates].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      try {
        const file = path.join(directory, relative), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error('Attribution candidate is not a regular file within the 64 MiB retention bound.');
        const content = fs.readFileSync(file), sha = sha256(content), destination = `attributions/${id}/${relative}`;
        fs.mkdirSync(path.dirname(path.join(outputDirectory, destination)), { recursive: true });
        fs.writeFileSync(path.join(outputDirectory, destination), content);
        if (sha256(fs.readFileSync(path.join(outputDirectory, destination))) !== sha) throw new Error('Retained attribution hash differs from the original bytes.');
        attributions.push({ path: relative, reason, byteLength: content.length, sha256: sha, retainedFile: destination });
      } catch (error) { scanIssues.push({ kind: 'attribution-retention-failed', path: relative, message: error.message }); }
    }
    const license = Object.hasOwn(manifest, 'license') ? manifest.license : null, legacy = Object.hasOwn(manifest, 'licenses') ? manifest.licenses : null;
    const licenseMetadataStatus = typeof license === 'string' && license.trim() ? 'declared-string' : license !== null ? 'unrecognized-license-metadata' : legacy !== null ? 'legacy-only' : 'missing';
    if (licenseMetadataStatus !== 'declared-string') metadataGaps.push({ id, name: manifest.name, version: manifest.version, kind: licenseMetadataStatus });
    if (!attributions.some((file) => file.reason !== 'root-readme-context')) metadataGaps.push({ id, name: manifest.name, version: manifest.version, kind: 'no-conventional-license-or-attribution-file' });
    if (scanIssues.length) issues.push(...scanIssues.map((issue) => ({ packageId: id, name: manifest.name, version: manifest.version, ...issue })));
    packages.push({ id, name: manifest.name ?? null, version: manifest.version ?? null, installedPath: directory, installedRelativePath: relativePath,
      resolved: treeRecord?.resolved ?? null, from: treeRecord?.from ?? null, manifest: { file: manifestFile, byteLength: bytes.length, sha256: manifestHash },
      license, licenses: legacy, licenseMetadataStatus, attributionMetadata: Object.fromEntries(['author', 'contributors', 'maintainers', 'homepage', 'repository', 'funding'].filter((field) => Object.hasOwn(manifest, field)).map((field) => [field, manifest[field]])),
      scannedOwnFileCount: scannedFiles.length, attributions });
  }
  return { packageName, consumerRoot, rootPackage, status: issues.length ? 'incomplete' : metadataGaps.length ? 'complete-with-metadata-gaps' : 'complete',
    packageInstanceCount: packages.length, uniqueNameVersionCount: new Set(packages.map((item) => `${item.name}@${item.version}`)).size,
    attributionFileCount: packages.reduce((total, item) => total + item.attributions.length, 0), packages, manifestEdges, treeEdges, absentOptionalDependencies, treeUnavailable,
    coverage: { packageManagerPaths: treePaths.size, manifestTraversalPaths: manifests.size, onlyInTree, onlyInManifestTraversal, equal: onlyInTree.length === 0 && onlyInManifestTraversal.length === 0 },
    metadataGaps, issues };
}

export function inventoryMarkdown(report) {
  const cell = (value) => (typeof value === 'string' ? value : JSON.stringify(value)).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return `# ${report.packageName} installed production inventory\n\nStatus: ${report.status}. Declared metadata is recorded without a license-compatibility or rights-clearance claim.\n\n| Package | Version | Declared license | Metadata status | Attribution files | Manifest |\n| --- | --- | --- | --- | --- | --- |\n${report.packages.map((item) => `| ${cell(item.name)} | ${cell(item.version)} | ${cell(item.license ?? item.licenses ?? 'UNKNOWN')} | ${item.licenseMetadataStatus} | ${item.attributions.map((file) => `[${cell(file.path)}](${file.retainedFile.split('/').map(encodeURIComponent).join('/')})`).join(', ') || 'None found'} | [Original](${item.manifest.file}) |`).join('\n')}\n\nMetadata gaps: ${report.metadataGaps.length}. Coverage or retention issues: ${report.issues.length}. The JSON inventory retains package instances, dependency edges, source paths, hashes, and exact gap details.\n`;
}
