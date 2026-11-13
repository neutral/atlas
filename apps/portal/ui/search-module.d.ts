// The Library's search module. The browser loads it at run time as ./search.js, served beside
// the Portal, so the Portal ranks exactly as the Library, the CLI and the agent tools do.
declare module 'atlas-search' {
  export type SearchResult = {
    kind: 'point' | 'facet'; id: string; tree: string; title: string; type?: string; uncertainty?: string;
    on?: { point?: string; branch?: string };
    snippet: { text: string; start: number; end: number; totalLength: number };
  };
  export function searchRecords(
    atlas: { points: unknown[]; facets: unknown[] },
    options: { query: string; kinds: string[]; tree?: string; limit: number; offset: number; presentation: 'summary' | 'full' },
  ): SearchResult[];
}
