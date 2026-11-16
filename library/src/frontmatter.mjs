import MarkdownIt from 'markdown-it';

const MAX_TEXT_LENGTH = 4 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_VALUES = 100_000;
const markdown = new MarkdownIt('commonmark', { html: true, linkify: false, typographer: false });

function fail(code, message, offset) {
  const error = new Error(message);
  error.code = code;
  if (offset !== undefined) error.offset = offset;
  throw error;
}

function checkUnicode(value, offset = 0) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("JSON_UNICODE", "Unpaired high surrogate.", offset + index);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("JSON_UNICODE", "Unpaired low surrogate.", offset + index);
    }
  }
}

/** Parse JSON without accepting duplicate keys or lossy integer values. */
export function parseStrictJson(text) {
  if (typeof text !== "string") fail("JSON_SYNTAX", "JSON input must be text.");
  if (text.length > MAX_TEXT_LENGTH) fail("JSON_LIMIT", "JSON input exceeds the text limit.");
  checkUnicode(text);
  let cursor = 0;
  let values = 0;

  function whitespace() {
    while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor += 1;
  }

  function string() {
    const start = cursor;
    cursor += 1;
    let result = "";
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '"') {
        checkUnicode(result, start);
        return result;
      }
      if (character.charCodeAt(0) < 0x20) {
        fail("JSON_SYNTAX", "Unescaped control character in a string.", cursor - 1);
      }
      if (character !== "\\") {
        result += character;
        continue;
      }
      const escape = text[cursor++];
      const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (Object.hasOwn(escapes, escape)) {
        result += escapes[escape];
      } else if (escape === "u") {
        const digits = text.slice(cursor, cursor + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
          fail("JSON_UNICODE", "Invalid Unicode escape.", cursor - 2);
        }
        result += String.fromCharCode(Number.parseInt(digits, 16));
        cursor += 4;
      } else {
        fail("JSON_SYNTAX", "Invalid string escape.", cursor - 2);
      }
    }
    fail("JSON_SYNTAX", "Unterminated string.", start);
  }

  function value(depth) {
    whitespace();
    values += 1;
    if (values > MAX_VALUES) fail("JSON_LIMIT", "JSON input exceeds the value limit.", cursor);
    const character = text[cursor];
    if (character === '"') return string();
    if (character === "{" || character === "[") {
      if (depth >= MAX_DEPTH) fail("JSON_LIMIT", "JSON input exceeds the nesting limit.", cursor);
      const object = character === "{";
      const closing = object ? "}" : "]";
      const result = object ? {} : [];
      const keys = new Set();
      cursor += 1;
      whitespace();
      if (text[cursor] === closing) {
        cursor += 1;
        return result;
      }
      while (true) {
        whitespace();
        if (object) {
          if (text[cursor] !== '"') fail("JSON_SYNTAX", "Expected an object key.", cursor);
          const keyOffset = cursor;
          const key = string();
          if (keys.has(key)) fail("JSON_DUPLICATE_KEY", `Duplicate object key: ${JSON.stringify(key)}.`, keyOffset);
          keys.add(key);
          whitespace();
          if (text[cursor] !== ":") fail("JSON_SYNTAX", "Expected a colon after an object key.", cursor);
          cursor += 1;
          Object.defineProperty(result, key, {
            value: value(depth + 1), enumerable: true, configurable: true, writable: true,
          });
        } else {
          result.push(value(depth + 1));
        }
        whitespace();
        if (text[cursor] === closing) {
          cursor += 1;
          return result;
        }
        if (text[cursor] !== ",") fail("JSON_SYNTAX", `Expected a comma or ${closing}.`, cursor);
        cursor += 1;
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(cursor));
    if (!match) fail("JSON_SYNTAX", "Expected a JSON value.", cursor);
    const result = Number(match[0]);
    if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result))) {
      fail("JSON_NUMBER", "JSON numbers must be finite and integers must be safe.", cursor);
    }
    cursor += match[0].length;
    return result;
  }

  const result = value(0);
  whitespace();
  if (cursor !== text.length) fail("JSON_SYNTAX", "Unexpected content after a JSON value.", cursor);
  return result;
}

function visibleText(tokens) {
  return tokens.flatMap(token => {
    if (token.type === 'text' || token.type === 'code_inline' || token.type === 'fence' || token.type === 'code_block') return [token.content];
    if (token.type === 'html_inline' || token.type === 'html_block') return [token.content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')];
    if (token.type === 'softbreak' || token.type === 'hardbreak') return [' '];
    return token.children ? [visibleText(token.children)] : [];
  }).join('');
}

// An explanation has a letter or digit in the text of a block that is not a heading.
function hasExplanation(tokens) {
  let heading = false;
  return tokens.some(token => {
    if (token.type === 'heading_open') { heading = true; return false; }
    if (token.type === 'heading_close') { heading = false; return false; }
    return !heading && /[\p{L}\p{N}]/u.test(visibleText([token]));
  });
}

export function markdownSections(body) {
  const tokens = markdown.parse(body, {}), sections = [];
  let current;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'heading_open' && token.tag === 'h2' && token.level === 0) {
      current = { title: visibleText([tokens[index + 1]]).trim(), tokens: [] };
      sections.push(current);
      index += 2;
    } else if (current) current.tokens.push(token);
  }
  return sections.map(({ title, tokens }) => ({ title, hasExplanation: hasExplanation(tokens) }));
}

function markdownLines(text) {
  if (typeof text !== "string") fail("MARKDOWN_HEADER", "Markdown input must be text.");
  if (text.length > MAX_TEXT_LENGTH) fail("JSON_LIMIT", "Markdown input exceeds the text limit.");
  checkUnicode(text);
  if (/\r(?!\n)/.test(text)) fail("MARKDOWN_LINE_ENDING", "Markdown lines end with LF or CRLF; a CR not followed by LF is not allowed.");
  return text.replace(/\r\n/g, "\n").split("\n");
}

function titleAndBody(content) {
  const tokens = markdown.parse(content.join('\n'), {});
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' && token.level === 0
    ? [{ level: Number(token.tag.slice(1)), title: visibleText([tokens[index + 1]]).trim(), start: token.map[0], end: token.map[1] - 1 }] : []);
  if (!headings.length || headings[0].level !== 1 || !headings[0].title) {
    fail("MARKDOWN_TITLE", "The first Markdown heading must be a nonblank H1 title.");
  }
  if (headings.filter((heading) => heading.level === 1).length !== 1) {
    fail("MARKDOWN_TITLE", "Markdown must contain exactly one H1 title.");
  }
  const first = headings[0];
  const body = [...content.slice(0, first.start), ...content.slice(first.end + 1)].join("\n").trim();
  if (!body || !hasExplanation(markdown.parse(body, {}))) fail("MARKDOWN_BODY", "Markdown must contain an explanation: a letter or digit outside headings, comments and markup.");
  return { title: first.title, body };
}

/** Extract a JSON header, one Markdown H1 title, and nonblank remaining text. */
export function parseMarkdown(text) {
  const lines = markdownLines(text);
  if (lines[0] !== "---") fail("MARKDOWN_HEADER", "Markdown must begin with an exact --- delimiter line.");
  const end = lines.indexOf("---", 1);
  if (end < 0) fail("MARKDOWN_HEADER", "Markdown JSON header has no closing --- delimiter line.");
  const header = parseStrictJson(lines.slice(1, end).join("\n"));
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    fail("MARKDOWN_HEADER", "Markdown JSON header must be an object.");
  }
  return { header, ...titleAndBody(lines.slice(end + 1)) };
}

/** Extract one Markdown H1 title and nonblank remaining text from a record that has no header. */
export function parsePlainMarkdown(text) {
  const lines = markdownLines(text);
  if (lines[0] === "---") fail("MARKDOWN_HEADER", "Markdown without a header must not begin with a --- delimiter line.");
  return titleAndBody(lines);
}

/**
 * A record's JSON header is not part of its Markdown: in a text that begins with one, as `parseMarkdown` reads it (a
 * `---` line, a JSON object, a closing `---` line), its lines are blanked, so that no line after it moves.
 */
export function withoutHeader(content) {
  const lines = content.split(/\r\n|\n|\r/);
  if (lines[0] !== '---') return content;
  const end = lines.indexOf('---', 1);
  if (end < 0) return content;
  try {
    const header = parseStrictJson(lines.slice(1, end).join('\n'));
    if (header === null || typeof header !== 'object' || Array.isArray(header)) return content;
  } catch { return content; }
  return [...lines.slice(0, end + 1).fill(''), ...lines.slice(end + 1)].join('\n');
}

/**
 * Headings in document order: identity, level, first source line, and whether a quote or list holds them. A record's
 * header is not a heading: a text that begins with one is read from the line after it. A heading is read as CommonMark
 * reads it, raw HTML included, and its name comes from its text content as a title's does, trimmed.
 */
export function markdownHeadings(content, { title } = {}) {
  const used = new Set();
  const identity = value => {
    const stem = value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    let slug = stem, suffix = 0;
    while (used.has(slug)) slug = `${stem}-${++suffix}`;
    used.add(slug);
    return slug;
  };
  const headings = title === undefined ? [] : [{ id: identity(title), level: 1, line: null, nested: false }];
  const tokens = markdown.parse(withoutHeader(content), {});
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'heading_open') headings.push({ id: identity(visibleText([tokens[index + 1]]).trim()), level: Number(token.tag.slice(1)), line: token.map[0], nested: token.level > 0 });
  }
  return headings;
}

/** Identical heading identity rules to the Portal's Markdown renderer. */
export function markdownHeadingIds(content, options) {
  return markdownHeadings(content, options).map(heading => heading.id);
}
