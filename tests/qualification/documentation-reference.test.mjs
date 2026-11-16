import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import MarkdownIt from 'markdown-it';
import { TOOLS } from '../../apps/agent/src/tools.mjs';

// The CLI's help table and the MCP server's TOOLS list own what exists. The command reference and the tool reference
// are held to them: one ### heading for each command or tool and for nothing else, and in each section every option
// and every input field. Each check returns every problem at once, so one run shows the whole repair.

const cli = fileURLToPath(new URL('../../apps/cli/src/cli.mjs', import.meta.url));
const page = name => fileURLToPath(new URL(`../../docs/reference/${name}`, import.meta.url));
const parser = new MarkdownIt();
const run = promisify(execFile);

/** What `atlas --help` and `atlas help COMMAND` print, for every command the overview lists. */
async function helpTable() {
  const json = async args => JSON.parse((await run(process.execPath, [cli, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout);
  const overview = await json(['--help']);
  const commands = await Promise.all(overview.commands.map(({ command }) => json(['help', command])));
  return { general: Object.keys(overview.options), commands };
}

const flag = text => text.trim().split(/\s+/u)[0];
/** A command's own options: those its help lists, and every flag its usage forms give after the command word. */
function commandOptions({ command, usage, options = {} }) {
  const flags = new Set(Object.keys(options).map(flag));
  for (const form of usage) {
    const word = form.match(new RegExp(`(?:^|\\s)${command}(?=\\s|$)`, 'u'));
    const own = word ? form.slice(word.index + word[0].length) : form.replace(/^atlas\b/u, '');
    for (const found of own.matchAll(/(?<![\w-])--[a-z][a-z-]*/gu)) flags.add(found[0]);
  }
  return flags;
}

const inlineText = token => (token.children ?? []).filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.content).join('').trim();

/**
 * The page as sections: each heading of level 1 to 3 with what follows it up to the next such heading. A section holds
 * the inline code spans of its prose and tables (fenced blocks are left out) and its tables, each as its header cells
 * and, for each row, the code spans of its first cell.
 */
function sections(markdown) {
  const tokens = parser.parse(markdown, {});
  const result = [{ level: 0, title: '', codes: [], tables: [] }];
  let table = null, row = null, cell = 0, header = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'heading_open' && Number(token.tag.slice(1)) <= 3) {
      result.push({ level: Number(token.tag.slice(1)), title: inlineText(tokens[index + 1]), codes: [], tables: [] });
      index += 2;
      continue;
    }
    const current = result.at(-1);
    if (token.type === 'table_open') current.tables.push(table = { header: [], rows: [] });
    else if (token.type === 'thead_open') header = true;
    else if (token.type === 'thead_close') header = false;
    else if (token.type === 'tr_open') { row = []; cell = 0; }
    else if (token.type === 'tr_close' && !header) table.rows.push(row);
    else if (token.type === 'th_open' || token.type === 'td_open') cell++;
    else if (token.type === 'inline') {
      const codes = (token.children ?? []).filter(child => child.type === 'code_inline').map(child => child.content);
      current.codes.push(...codes);
      if (table && header) table.header.push(inlineText(token));
      else if (table && cell === 1) row.push(...codes);
    }
    if (token.type === 'table_close') table = null;
  }
  return result;
}

/** The first-cell code spans of every table in `section` whose first header cell is `name`. */
const column = (section, name) => section.tables.filter(table => table.header[0] === name).flatMap(table => table.rows.map(row => row[0])).filter(Boolean);

function headingProblems(file, all, expected) {
  const problems = [], counts = new Map();
  for (const section of all.filter(item => item.level === 3)) counts.set(section.title, (counts.get(section.title) ?? 0) + 1);
  for (const name of expected) if (!counts.has(name)) problems.push(`${file}: no ### ${name} heading, though ${name} exists`);
  for (const [name, count] of counts) {
    if (!expected.includes(name)) problems.push(`${file}: ### ${name} is not one of the ${expected.length} that exist`);
    else if (count > 1) problems.push(`${file}: ### ${name} appears ${count} times`);
  }
  return problems;
}

function compare(problems, where, kind, expected, documented) {
  for (const name of expected) if (!documented.has(name)) problems.push(`${where}: ${kind} ${name} is not documented`);
  for (const name of documented) if (!expected.has(name)) problems.push(`${where}: ${kind} ${name} is documented but does not exist`);
}

/**
 * docs/reference/cli.md: one ### per command; in each command's section an Option table naming exactly its options and
 * an INPUT field table naming exactly its INPUT fields; before the first command, an Option table naming exactly the
 * global options of `atlas --help`.
 */
export function checkCommandReference(markdown, { general, commands }, file = 'docs/reference/cli.md') {
  const all = sections(markdown);
  const problems = headingProblems(file, all, commands.map(item => item.command));
  const first = all.findIndex(item => item.level === 3);
  const before = { tables: all.slice(0, first < 0 ? all.length : first).flatMap(item => item.tables) };
  compare(problems, `${file}, before the commands`, 'global option', new Set(general.map(flag)), new Set(column(before, 'Option').map(flag)));
  for (const help of commands) {
    const section = all.find(item => item.level === 3 && item.title === help.command);
    if (!section) continue;
    const where = `${file}, ### ${help.command}`;
    compare(problems, where, 'option', commandOptions(help), new Set(column(section, 'Option').map(flag)));
    compare(problems, where, 'INPUT field', new Set(Object.keys(help.input ?? {})), new Set(column(section, 'INPUT field')));
  }
  return problems;
}

/** Every property of an input schema, nested ones by their path: `facet.tree`, `changes[].path`. */
function schemaFields(schema, prefix = '') {
  const fields = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    fields.push(`${prefix}${name}`);
    if (property.type === 'object') fields.push(...schemaFields(property, `${prefix}${name}.`));
    if (property.type === 'array' && property.items?.type === 'object') fields.push(...schemaFields(property.items, `${prefix}${name}[].`));
  }
  return fields;
}

/**
 * docs/reference/mcp.md: one ### per tool; in each tool's section every field of its input schema, each named as a
 * word within an inline code span: `limit`, `{ tree, id }` or `facet.tree`. A nested field is named by its own name.
 */
export function checkToolReference(markdown, tools, file = 'docs/reference/mcp.md') {
  const all = sections(markdown);
  const problems = headingProblems(file, all, tools.map(tool => tool.name));
  for (const tool of tools) {
    const section = all.find(item => item.level === 3 && item.title === tool.name);
    if (!section) continue;
    const words = new Set(section.codes.flatMap(code => code.match(/[A-Za-z0-9_]+/gu) ?? []));
    for (const field of schemaFields(tool.inputSchema)) {
      const name = field.split(/[.[\]]+/u).filter(Boolean).at(-1);
      if (!words.has(name)) problems.push(`${file}, ### ${tool.name}: input field ${field} is not named in inline code`);
    }
  }
  return problems;
}

const report = problems => `${problems.length} problems:\n${problems.join('\n')}`;

test('the command reference has every command, option and INPUT field of the help table, and nothing else', async () => {
  const problems = checkCommandReference(await readFile(page('cli.md'), 'utf8'), await helpTable());
  assert.deepEqual(problems, [], report(problems));
});

test('the tool reference has every tool and every input field of TOOLS, and no other tool', async () => {
  const problems = checkToolReference(await readFile(page('mcp.md'), 'utf8'), TOOLS);
  assert.deepEqual(problems, [], report(problems));
});

test('the reference checks name exactly what is missing, extra or repeated', () => {
  const help = {
    general: ['--root PATH'],
    commands: [
      { command: 'open', usage: ['atlas open [PROJECT] [--port N]', 'atlas --root PATH [--state-home PATH] open [--no-browser]'], options: { '--atlas PATH': '' } },
      { command: 'stale', usage: ['atlas --root PATH stale [INPUT | --full]'], input: { limit: '', offset: '' } },
      { command: 'mcp', usage: ['atlas --root PATH mcp'] },
    ],
  };
  const commands = [
    '| Option | Meaning |', '| --- | --- |', '| `--root PATH` | x |', '',
    '### open', '', '```text', 'atlas open --port N --no-browser --atlas PATH', '### stale', '```', '',
    '| Option | Meaning |', '| --- | --- |', '| `--port N` | x |', '| `--frob` | x |', '',
    '### stale', '', '| INPUT field | Meaning |', '| --- | --- |', '| `limit` | x |', '| `full` | x |', '',
    '### frob', '', '### stale', '',
  ].join('\n');
  assert.deepEqual(checkCommandReference(commands, help, 'cli.md'), [
    'cli.md: no ### mcp heading, though mcp exists',
    'cli.md: ### stale appears 2 times',
    'cli.md: ### frob is not one of the 3 that exist',
    'cli.md, ### open: option --atlas is not documented',
    'cli.md, ### open: option --no-browser is not documented',
    'cli.md, ### open: option --frob is documented but does not exist',
    'cli.md, ### stale: option --full is not documented',
    'cli.md, ### stale: INPUT field offset is not documented',
    'cli.md, ### stale: INPUT field full is documented but does not exist',
  ]);
  const tools = [
    { name: 'atlas_inspect', inputSchema: { properties: { facet: { type: 'object', properties: { tree: {}, id: {} } }, limit: {} } } },
    { name: 'atlas_prepare', inputSchema: { properties: { changes: { type: 'array', items: { type: 'object', properties: { path: {}, content: {} } } } } } },
  ];
  const reference = [
    '### `atlas_inspect`', '', '`facet` is `{ tree, identity }`; limit is a number.', '',
    '### atlas_prepare', '', '| Field | Meaning |', '| --- | --- |', '| `changes` | entries `{ path, content }` |', '',
    '### atlas_launch', '',
  ].join('\n');
  assert.deepEqual(checkToolReference(reference, tools, 'mcp.md'), [
    'mcp.md: ### atlas_launch is not one of the 2 that exist',
    'mcp.md, ### atlas_inspect: input field facet.id is not named in inline code',
    'mcp.md, ### atlas_inspect: input field limit is not named in inline code',
  ]);
});
