import { DatabaseSync } from 'node:sqlite';

const MAX_INDEXES = 8;
const MAX_QUERY_LENGTH = 4096;
const MAX_QUERY_TOKENS = 128;
const MAX_EXCERPT_CODE_POINTS = 320;
const TYPES = new Set(['map', 'area', 'point', 'resource', 'check']);
const indexes = new WeakMap();
const recentIndexes = new Set();
const collectedIndexes = new FinalizationRegistry(closeIndex);

function invalid(message) {
  const error = new Error(message);
  error.name = 'AtlasToolError';
  error.code = 'atlas.tools.invalid-argument';
  throw error;
}

function closeIndex(index) {
  if (index.closed) return;
  index.closed = true;
  recentIndexes.delete(index);
  collectedIndexes.unregister(index);
  index.database.close();
}

function indexRecords(records) {
  let index = indexes.get(records);
  if (index && !index.closed) {
    recentIndexes.delete(index);
    recentIndexes.add(index);
    return index;
  }
  // Evicted entries hold no record array or read view. Their databases close
  // immediately; a still-live array rebuilds its index on its next query.
  while (recentIndexes.size >= MAX_INDEXES) closeIndex(recentIndexes.values().next().value);
  const database = new DatabaseSync(':memory:', { allowExtension: false });
  try {
    database.exec(`
      PRAGMA temp_store = MEMORY;
      CREATE VIRTUAL TABLE documents USING fts5(id, title, summary, path, body, tokenize = 'unicode61');
      CREATE TABLE record_types (rowid INTEGER PRIMARY KEY, type TEXT NOT NULL);
      CREATE VIRTUAL TABLE query_terms USING fts5(text, tokenize = 'unicode61');
      CREATE VIRTUAL TABLE query_vocabulary USING fts5vocab(query_terms, 'instance');
      BEGIN;
    `);
    const insertDocument = database.prepare('INSERT INTO documents(rowid, id, title, summary, path, body) VALUES (?, ?, ?, ?, ?, ?)');
    const insertType = database.prepare('INSERT INTO record_types(rowid, type) VALUES (?, ?)');
    records.forEach((record, position) => {
      if (!record || !TYPES.has(record.type)) invalid('Each search record must have a supported type.');
      const columns = ['id', 'title', 'summary', 'path', 'body'].map((key) => {
        const value = record[key] ?? '';
        if (typeof value !== 'string') invalid(`Search record ${key} must be a string.`);
        return value;
      });
      insertDocument.run(position + 1, ...columns);
      insertType.run(position + 1, record.type);
    });
    database.exec('COMMIT');
    index = {
      database,
      closed: false,
      deleteQuery: database.prepare('DELETE FROM query_terms'),
      insertQuery: database.prepare('INSERT INTO query_terms(rowid, text) VALUES (1, ?)'),
      queryTokens: database.prepare('SELECT term FROM query_vocabulary ORDER BY offset LIMIT ?'),
    };
    indexes.set(records, index);
    recentIndexes.add(index);
    collectedIndexes.register(records, index, index);
    return index;
  } catch (error) {
    database.close();
    throw error;
  }
}

function tokensFor(index, query) {
  index.deleteQuery.run();
  try {
    index.insertQuery.run(query);
    const tokens = index.queryTokens.all(MAX_QUERY_TOKENS + 1).map(({ term }) => term);
    if (tokens.length > MAX_QUERY_TOKENS) invalid(`Search queries must contain at most ${MAX_QUERY_TOKENS} Unicode61 tokens.`);
    return tokens;
  } finally {
    index.deleteQuery.run();
  }
}

function boundedExcerpt(source) {
  const characters = [];
  for (const character of source) {
    if (characters.length === MAX_EXCERPT_CODE_POINTS) {
      characters[MAX_EXCERPT_CODE_POINTS - 1] = '…';
      break;
    }
    characters.push(character);
  }
  return characters.join('');
}

// Internal input is one immutable row per source record. The caller owns Point
// identity grouping, public ordering, pagination, and observation provenance.
export function searchRecords(records, query, { mode = 'ranked', types } = {}) {
  if (!Array.isArray(records)) invalid('Search records must be an array.');
  if (typeof query !== 'string') invalid('Search query must be a string.');
  if (query.length > MAX_QUERY_LENGTH) invalid(`Search queries must contain at most ${MAX_QUERY_LENGTH} UTF-16 code units.`);
  if (query.includes('\0')) invalid('Search queries must not contain NUL.');
  if (mode !== 'ranked' && mode !== 'fts') invalid('Search mode must be ranked or fts.');
  if (types !== undefined && (!Array.isArray(types) || types.some((type) => !TYPES.has(type)))) {
    invalid('Search types must be an array of supported types.');
  }
  const selectedTypes = types === undefined ? [...TYPES] : [...new Set(types)];
  const index = indexRecords(records);
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      items: records.flatMap((record, position) => selectedTypes.includes(record.type) ? [{ index: position, score: 0, excerpt: '' }] : []),
      query: { mode, expression: '' },
    };
  }
  const tokens = tokensFor(index, trimmed);
  const expression = mode === 'fts' ? trimmed : [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
  if (!expression) return { items: [], query: { mode, expression } };
  // An empty scope still parses the expression. A constant-false SQL predicate
  // would let SQLite skip MATCH and silently accept malformed FTS syntax.
  const typeClause = selectedTypes.length ? `AND record_types.type IN (${selectedTypes.map(() => '?').join(', ')})` : '';
  let rows;
  try {
    rows = index.database.prepare(`
      SELECT documents.rowid - 1 AS "index",
             -bm25(documents, 8.0, 5.0, 2.0, 1.0, 1.0) AS score,
             snippet(documents, -1, '⟦', '⟧', ' … ', 24) AS excerpt
      FROM documents JOIN record_types ON record_types.rowid = documents.rowid
      WHERE documents MATCH ? ${typeClause}
      ORDER BY score DESC, documents.rowid ASC
    `).all(expression, ...selectedTypes);
  } catch (error) {
    if (error.code !== 'ERR_SQLITE_ERROR') throw error;
    invalid(`Invalid FTS5 search expression: ${error.message}`);
  }
  return { items: selectedTypes.length ? rows.map(({ index: position, score, excerpt }) => ({ index: position, score, excerpt: boundedExcerpt(excerpt) })) : [], query: { mode, expression } };
}
