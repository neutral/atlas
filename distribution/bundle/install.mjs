import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const usage = 'Usage: install.sh|uninstall.sh [--prefix DIRECTORY] [--bin-directory DIRECTORY]\n';

export function defaultInstallPrefix({ platform = process.platform, home = os.homedir(), xdgDataHome = process.env.XDG_DATA_HOME } = {}) {
  const userData = platform === 'darwin' ? path.join(home, 'Library/Application Support/Atlas') : path.join(xdgDataHome && path.isAbsolute(xdgDataHome) ? xdgDataHome : path.join(home, '.local/share'), 'atlas');
  return path.join(userData, 'install');
}

export function install(argv = process.argv.slice(2)) {
  const remove = argv[0] === '--remove';
  if (remove) argv = argv.slice(1);
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(usage); return; }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--prefix', '--bin-directory'].includes(flag) || Object.hasOwn(options, flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(usage.trim());
    options[flag] = path.resolve(argv[index + 1]);
  }
  const prefix = options['--prefix'] ?? defaultInstallPrefix();
  const bin = options['--bin-directory'] ?? path.join(os.homedir(), '.local/bin');
  const marker = JSON.parse(fs.readFileSync(path.join(source, 'bundle.json'), 'utf8'));
  if (marker.contract !== 'atlas.bundle/1') throw new Error('The source has no supported Atlas bundle marker.');
  if (`${process.platform}-${process.arch}` !== marker.target) throw new Error(`This archive requires ${marker.target}.`);
  const destination = path.join(prefix, `atlas-${marker.version}-${marker.target}`);
  const current = path.join(prefix, 'current');
  const command = path.join(bin, 'atlas');
  if (!remove && (inside(source, destination) || inside(destination, source))) throw new Error('Installation must be outside the extracted source bundle.');
  const expected = path.join('current', 'bin', 'atlas');
  const commandTarget = path.join(prefix, expected);
  const stat = filename => fs.lstatSync(filename, { throwIfNoEntry: false });
  const managedLink = (filename, target) => stat(filename)?.isSymbolicLink() && path.resolve(path.dirname(filename), fs.readlinkSync(filename)) === target;
  const installedMarker = path.join(destination, 'bundle.json');
  if (remove) {
    if (stat(destination)?.isSymbolicLink() || !fs.existsSync(installedMarker) || !fs.readFileSync(installedMarker).equals(fs.readFileSync(path.join(source, 'bundle.json')))) throw new Error(`Refusing removal: exact installed bundle marker is unavailable at ${destination}.`);
    if (managedLink(current, destination)) {
      if (managedLink(command, commandTarget)) fs.unlinkSync(command);
      fs.unlinkSync(current);
    }
    fs.rmSync(destination, { recursive: true });
    process.stdout.write(`Removed ${destination}\nProject content and durable drafts remain in their existing locations.\n`);
    return;
  }
  if (stat(command) && !managedLink(command, commandTarget)) throw new Error(`An unrelated command already exists: ${command}`);
  if (stat(current)) {
    if (!stat(current).isSymbolicLink()) throw new Error(`An unrelated entry already exists: ${current}`);
    const previous = path.resolve(prefix, fs.readlinkSync(current));
    if (path.dirname(previous) !== prefix || !fs.existsSync(path.join(previous, 'bundle.json'))) throw new Error(`The current link does not select a managed Atlas version: ${current}`);
  }
  fs.mkdirSync(prefix, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  if (stat(destination)) {
    if (stat(destination).isSymbolicLink() || !fs.existsSync(installedMarker) || !fs.readFileSync(installedMarker).equals(fs.readFileSync(path.join(source, 'bundle.json')))) throw new Error(`A different build already occupies ${destination}. Select another prefix.`);
  } else {
    const pending = fs.mkdtempSync(path.join(prefix, '.atlas-install-'));
    try { fs.cpSync(source, pending, { recursive: true, verbatimSymlinks: true }); fs.renameSync(pending, destination); }
    finally { fs.rmSync(pending, { recursive: true, force: true }); }
  }
  const pendingLink = `${current}.${process.pid}.pending`;
  try { fs.symlinkSync(path.basename(destination), pendingLink); fs.renameSync(pendingLink, current); }
  finally { fs.rmSync(pendingLink, { force: true }); }
  if (!stat(command)) fs.symlinkSync(commandTarget, command);
  process.stdout.write(`Installed Atlas ${marker.version}\nCommand: ${command}\nRun: "${command}" open\n`);
  if (!(process.env.PATH || '').split(path.delimiter).includes(bin)) process.stdout.write(`For the short atlas command, add this directory to the shell PATH: ${bin}\n`);
  process.stdout.write(`Update: run install.sh from a new Atlas archive with the same prefix and bin directory.\nRemove this version: "${destination}/uninstall.sh" --prefix "${prefix}" --bin-directory "${bin}"\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { install(); } catch (error) { process.stderr.write(`Atlas installation: ${error.message}\n`); process.exitCode = 2; }
}
