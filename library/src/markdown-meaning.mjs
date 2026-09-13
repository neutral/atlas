import { inlineText, measureTokens, parseMarkdown } from './markdown.mjs';

const IDENTIFIER = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const AREA = new RegExp(`^Area: (${IDENTIFIER})$`, 'u');
const RESOURCE = new RegExp(`^Resource: (${IDENTIFIER})$`, 'u');
const CONNECTION = new RegExp(`^Connection: (${IDENTIFIER})$`, 'u');
const RESERVED = /^(Area|Relation|Resource|Reference|Connection)(?:\s*:|$)/u;

/** Derive the read model from a schema-checked local header joined with its global declarations. */
export function deriveDocumentMeaning(authored, body) {
  const value = structuredClone(authored), errors = [], tokens = parseMarkdown(body);
  const headings = headingSections(tokens);
  const error = (code, message, heading) => errors.push({ code, message, ...(heading?.line ? { line: heading.line } : {}) });
  const h1s = headings.filter(heading => heading.depth === 1);
  const title = h1s[0];
  if (h1s.length !== 1 || title?.start !== 0 || !inlineText(tokens[title.start + 1])) {
    error('atlas.markdown.title', 'A structural body must begin with exactly one non-blank level-one heading.', title);
  }
  if (title) value.title = inlineText(tokens[title.start + 1]);
  const opening = title && openingParagraph(tokens, title);
  if (!opening) error('atlas.markdown.summary', 'A structural body must have a non-blank opening paragraph immediately after its level-one heading.', title);
  else value.summary = opening;

  const associations = new Map();
  for (const heading of headings) {
    if (heading.depth < 2 || !RESERVED.test(heading.label)) continue;
    const scope = heading.parent;
    let key, target, field;
    const areaMatch = AREA.exec(heading.label), resourceMatch = RESOURCE.exec(heading.label), connectionMatch = CONNECTION.exec(heading.label);
    if (areaMatch && heading.depth === 2 && value.type === 'map') {
      const id = areaMatch[1];
      key = `area:${id}`;
      target = value.areas?.find(area => area.id === id);
      field = 'summary';
      heading.area = target;
      heading.areaId = id;
    } else if (resourceMatch && heading.depth === 2 && value.type === 'atlas') {
      key = `resource:${resourceMatch[1]}`;
      target = value.resources?.find(resource => resource.id === resourceMatch[1]);
      field = 'summary';
    } else if (connectionMatch && (heading.depth === 2 || (heading.depth === 3 && scope?.area))) {
      const id = connectionMatch[1], container = heading.depth === 3 ? scope.area : value;
      key = `connection:${id}`;
      const candidates = [];
      for (const name of ['content', 'references']) for (const entry of container[name] ?? []) if (entry.id === id) candidates.push({ entry, field: 'note' });
      if (heading.depth === 2 && value.type === 'point') {
        for (const entry of value.areas ?? []) if (entry.id === id) candidates.push({ entry, field: 'context' });
        if (value.record === 'anchor') for (const entry of value.relations ?? []) if (entry.id === id) candidates.push({ entry, field: 'note' });
      }
      if (candidates.length === 1) { target = candidates[0].entry; field = candidates[0].field; }
      else if (candidates.length > 1) error('atlas.markdown.association', `Connection ${id} has ambiguous declarations.`, heading);
    }
    if (!key) {
      error('atlas.markdown.association', `Malformed or misplaced Markdown association heading: ${heading.label}`, heading);
      continue;
    }
    if (associations.has(key)) {
      error('atlas.markdown.association', `Markdown association repeats: ${heading.label}`, heading);
      continue;
    }
    associations.set(key, heading);
    if (!target) {
      error('atlas.markdown.association', `Markdown association names no declared target: ${heading.label}`, heading);
      continue;
    }
    const text = areaMatch ? openingParagraph(tokens, heading) : sectionText(tokens, heading, headings);
    if (!text) error('atlas.markdown.section', `Markdown association must contain substantive explanation: ${heading.label}`, heading);
    else target[field] = text;
  }

  if (value.type === 'map') {
    for (const heading of headings) if (heading.depth > 1 && heading.label === 'Question' && heading.depth !== 2 && !(heading.depth === 3 && heading.parent?.area)) {
      error('atlas.markdown.association', 'A Map Question heading must be level two or a direct level-three child of a declared Area entry.', heading);
    }
    value.question = questionText(tokens, headings, 2, null, error);
    for (const area of value.areas ?? []) {
      const entry = associations.get(`area:${area.id}`);
      if (!entry) error('atlas.markdown.section', `Map Area ${area.id} requires a level-two Area entry.`);
      else area.question = questionText(tokens, headings, 3, entry, error);
    }
  }
  if (value.type === 'point') {
    for (const membership of value.areas ?? []) if (!associations.has(`connection:${membership.id}`)) {
      error('atlas.markdown.section', `Area membership ${membership.id} requires a level-two Connection explanation.`);
    }
    for (const relation of value.relations ?? []) if (!associations.has(`connection:${relation.id}`)) {
      error('atlas.markdown.section', `Relation ${relation.id} requires a level-two Connection explanation.`);
    }
  }
  return { value, errors };
}

function headingSections(tokens) {
  const headings = [], stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || token.level !== 0) continue;
    const depth = Number(token.tag.slice(1));
    while (stack.length && stack.at(-1).depth >= depth) stack.pop().end = index;
    const heading = { depth, label: tokens[index + 1].content, start: index, end: tokens.length, parent: stack.at(-1), line: (token.map?.[0] ?? 0) + 1 };
    headings.push(heading);
    stack.push(heading);
  }
  return headings;
}

function openingParagraph(tokens, heading) {
  const start = heading.start + 3;
  return tokens[start]?.type === 'paragraph_open' && tokens[start].level === 0 ? inlineText(tokens[start + 1]) : '';
}

function sectionText(tokens, heading, headings) {
  const excluded = headings.filter(child => child.start > heading.start && child.start < heading.end && RESERVED.test(child.label));
  const own = tokens.slice(heading.start + 3, heading.end).filter((_, offset) => {
    const index = heading.start + 3 + offset;
    return !excluded.some(child => index >= child.start && index < child.end);
  });
  return measureTokens(own).text;
}

function questionText(tokens, headings, depth, parent, error) {
  const questions = headings.filter(heading => heading.depth === depth && heading.label === 'Question' && (depth === 2 || heading.parent === parent));
  if (questions.length !== 1) {
    error('atlas.markdown.section', `${parent ? `Area ${parent.areaId}` : 'Map'} requires exactly one level-${depth === 2 ? 'two' : 'three'} Question section.`, parent);
    return undefined;
  }
  const text = sectionText(tokens, questions[0], headings);
  if (!text) error('atlas.markdown.section', 'A Question section must contain substantive text.', questions[0]);
  return text;
}
