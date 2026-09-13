import assert from 'node:assert/strict';import test from 'node:test';import {compareCodePoints,validFullDate} from '../src/index.mjs';
import { substantiveBody } from '../src/markdown.mjs';
test('validFullDate applies Gregorian calendar rules',()=>{assert.equal(validFullDate('2024-02-29'),true);assert.equal(validFullDate('2026-02-29'),false);assert.equal(validFullDate('2000-02-29'),true);assert.equal(validFullDate('1900-02-29'),false);assert.equal(validFullDate('2026-13-01'),false);});
test('code-point ordering is not locale collation',()=>{const values=['z','ä','a','Z'];assert.deepEqual(values.sort(compareCodePoints),['Z','a','z','ä']);});

test('body substance requires included text after normalization', () => {
  for (const body of ['', '  \n', '# Heading\n', '<!-- comment -->\n', '<div></div>\n', '```\n```\n', '> # Heading\n']) {
    const result = substantiveBody(body);
    assert.equal(result.text, '', body);
    assert.equal(result.hasContentBlock, false, body);
  }
});

test('substantive blocks retain text, code, link labels, and image descriptions', () => {
  for (const body of ['A useful statement.\n', '<div>A useful statement.</div>\n', '```\nconst value = 1;\n```\n', '[Evidence](source.md)\n', '![Boundary diagram](diagram.svg)\n']) {
    const result = substantiveBody(body);
    assert.ok(result.scalarCount > 0, body);
    assert.equal(result.hasContentBlock, true, body);
  }
});
