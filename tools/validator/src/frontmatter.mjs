export function splitFrontMatter(text) {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  if (lines[0] !== '---') return { error: 'missing', frontMatter: null, body: text };
  const close = lines.indexOf('---', 1);
  if (close < 0) return { error: 'unclosed', frontMatter: null, body: '' };
  return { error: null, frontMatter: lines.slice(1, close).join('\n'), body: lines.slice(close + 1).join('\n') };
}

export function parseFrontMatter(source) {
  const split = splitFrontMatter(source);
  if (split.error) return { ...split, value: null, errors: [] };
  const errors = [];
  let value = null;
  try {
    JSON.parse(split.frontMatter);
    value = decodeJsonTokens(split.frontMatter, errors);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push('Front matter must contain one JSON object.');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ...split, value: errors.length === 0 ? value : null, errors };
}

// JSON.parse owns syntax. Decode tokens independently to preserve exact member names.
function decodeJsonTokens(source, errors) {
  const containers = [];
  let root;
  const append = (value) => {
    const container = containers.at(-1);
    if (!container) root = value;
    else if (container.keys) container.values.push([container.key, value]);
    else container.values.push(value);
  };
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/gu;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      containers.push({ values: [], ...(token === '{' ? { keys: new Set() } : {}) });
    } else if (token === '}' || token === ']') {
      const container = containers.pop();
      append(container.keys ? Object.fromEntries(container.values) : container.values);
    } else if (token.startsWith('"')) {
      const text = JSON.parse(token);
      if (!text.isWellFormed()) errors.push(`A JSON string at offset ${match.index} contains an unpaired Unicode surrogate.`);
      let next = match.index + token.length;
      while (/[ \t\r\n]/u.test(source[next] ?? '')) next += 1;
      if (source[next] === ':') {
        const container = containers.at(-1);
        if (container.keys.has(text)) errors.push(`Duplicate JSON object key ${JSON.stringify(text)} at offset ${match.index}.`);
        container.keys.add(text);
        container.key = text;
      } else append(text);
    } else if (token === 'true' || token === 'false' || token === 'null') {
      append(token === 'null' ? null : token === 'true');
    } else {
      const number = Number(token);
      if (!Number.isFinite(number)) errors.push(`A JSON number at offset ${match.index} is non-finite.`);
      else if (Number.isInteger(number) && !Number.isSafeInteger(number)) {
        errors.push(`A JSON number at offset ${match.index} is an unsafe integer.`);
      }
      append(number);
    }
  }
  return root;
}
