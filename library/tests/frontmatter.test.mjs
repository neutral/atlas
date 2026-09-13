import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFrontMatter, splitFrontMatter } from '../src/frontmatter.mjs';
import { RESOLVED_PROFILE, STRUCTURAL_PROFILE, validateAtlas } from '../src/index.mjs';

const document = (json, body = '') => `---\n${json}\n---\n${body}`;
const invalidJson = [
  ['YAML mapping', 'type: atlas\nformat: 1'],
  ['empty input', ''],
  ['line comment', '{"key": 1 // comment\n}'],
  ['block comment', '{"key": /* comment */ 1}'],
  ['trailing object comma', '{"key": 1,}'],
  ['trailing array comma', '{"key": [1,]}'],
  ['multiple objects', '{} {}'],
  ['top-level array', '[]'],
  ['top-level null', 'null'],
  ['top-level string', '"text"'],
  ['top-level number', '1'],
  ['non-JSON whitespace', '{\u00a0"key": 1}'],
  ['duplicate key', '{"key": 1, "key": 2}'],
  ['duplicate decoded key', String.raw`{"key": 1, "\u006bey": 2}`],
  ['nested duplicate key', '{"items": [{"key": 1, "key": 2}]}'],
  ['non-finite number', '{"key": 1e309}'],
  ['negative non-finite number', '{"key": -1e309}'],
  ['unsafe integer', '{"key": 9007199254740993}'],
  ['unsafe negative integer', '{"key": -9007199254740993}'],
  ['unsafe exponent integer', '{"key": 9007199254740992e0}'],
  ['unpaired high surrogate value', String.raw`{"key": "\ud800"}`],
  ['unpaired low surrogate value', String.raw`{"key": "\udc00"}`],
  ['unpaired surrogate key', String.raw`{"\ud800": "value"}`],
];

test('JSON front matter preserves values and Markdown without interpreting body syntax', () => {
  const value = {
    text: 'A "quoted" \\ value: [] {} 1e309',
    emoji: '\u{1f600}',
    values: [null, true, false, 0.125, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
    items: [{ key: 1 }, { key: 2 }],
    nested: { key: { key: 3 } },
  };
  const body = '\n# Heading\n\nBody with YAML-looking text: yes\n\n---\n';
  const parsed = parseFrontMatter(document(JSON.stringify(value, null, 2), body));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.value, value);
  assert.equal(parsed.body, body);
});

test('decoded key identity uses exact strings and remains local to each object', () => {
  const parsed = parseFrontMatter(document(String.raw`{"\u00e9": 1, "e\u0301": 2, "items": [{"same": 1}, {"same": 2}], "__proto__": {"safe": true}}`));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.value['é'], 1);
  assert.equal(parsed.value['e\u0301'], 2);
  assert.ok(Object.hasOwn(parsed.value, '__proto__'));
  assert.equal(Object.getPrototypeOf(parsed.value), Object.prototype);
});

test('successive parses preserve decoded keys independently of previous object shapes', () => {
  const first = parseFrontMatter(document(String.raw`{"a":1,"\\":1}`));
  const second = parseFrontMatter(document(String.raw`{"a":1,"\u0062":2}`));
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
  assert.deepEqual(first.value, { a: 1, '\\': 1 });
  assert.deepEqual(second.value, { a: 1, b: 2 });
});

test('paired escaped surrogates and safe exponent integers are accepted', () => {
  const parsed = parseFrontMatter(document(String.raw`{"\ud83d\ude00": "\ud83d\ude00", "number": 9007199254740991e0}`));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.value['\u{1f600}'], '\u{1f600}');
  assert.equal(parsed.value.number, Number.MAX_SAFE_INTEGER);
});

test('front matter rejects malformed or lossy JSON without exposing a value', () => {
  for (const [label, source] of invalidJson) {
    const parsed = parseFrontMatter(document(source));
    assert.ok(parsed.errors.length > 0, label);
    assert.equal(parsed.value, null, label);
  }
  const rawSurrogate = parseFrontMatter(document(`{"key":"${String.fromCharCode(0xd800)}"}`));
  assert.match(rawSurrogate.errors.join(' '), /unpaired Unicode surrogate/u);
  assert.equal(rawSurrogate.value, null);
});

test('delimiter handling retains CRLF support and distinguishes missing from unclosed headers', () => {
  const parsed = parseFrontMatter('---\r\n{"key": true}\r\n---\r\n\r\nBody\r\n');
  assert.deepEqual(parsed.value, { key: true });
  assert.equal(parsed.body, '\nBody\n');
  assert.equal(splitFrontMatter('{"key": true}').error, 'missing');
  assert.equal(splitFrontMatter('---\n{"key": true}').error, 'unclosed');
});

test('both validation profiles reject invalid JSON and withhold normalized output', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-json-frontmatter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [label, source] of invalidJson) {
    fs.writeFileSync(path.join(directory, 'atlas.md'), document(source));
    for (const profile of [STRUCTURAL_PROFILE, RESOLVED_PROFILE]) {
      const result = validateAtlas(directory, { profile, specificationRevision: 'test' });
      assert.equal(result.complete, true, label);
      assert.equal(result.valid, false, label);
      assert.deepEqual(result.diagnostics.map(item => item.code), ['atlas.frontmatter.invalid-json'], label);
      assert.equal(result.normalized, undefined, label);
    }
  }
});
