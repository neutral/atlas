// The server entry: the same Root rendered to static HTML. The build renders the first paint
// of a local session; an export renders its publication so it reads before any script runs.
import { prerender } from 'react-dom/static';
import { Root } from './App.tsx';
import { Store, type Host } from './store.ts';
import type { View } from './model.ts';

const unavailable = () => { throw new Error('Not available while prerendering.'); };

/** The Portal's markup for `data`, or for an Atlas still opening when `data` is null. */
export async function renderPortal(data: View | null, publication: boolean): Promise<string> {
  const host: Host = {
    publication,
    api: async () => unavailable(),
    readPublication: async () => unavailable(),
    location: () => ({ pathname: '/', search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost' }),
    history: { push() {}, replace() {}, back() {} },
    later: () => 0,
    cancel() {},
    frame() {},
  };
  const { prelude } = await prerender(<Root store={new Store(host, data)} />);
  return new Response(prelude).text();
}
