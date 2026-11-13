// The browser entry. A publication was prerendered at export: read its data, then hydrate.
// A local session reads its Atlas from the authenticated loopback service after the first paint.
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Root } from './App.tsx';
import { Store, type Host } from './store.ts';
import type { View } from './model.ts';
import './style.css';

const publication = document.body.dataset.mode === 'publication';
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('token')) {
  sessionStorage.setItem('atlas-token', fragment.get('token')!);
  history.replaceState({}, '', location.pathname + location.search);
}
const token = sessionStorage.getItem('atlas-token');
const readPublication = async (): Promise<View> => (await fetch('./data.json')).json();

const host: Host = {
  publication,
  readPublication,
  async api(path, data, method) {
    const response = await fetch(`./api/${path}`, { method: method ?? (data ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? 'Request failed.');
    return value;
  },
  location: () => location,
  history: { push: (state, url) => history.pushState(state, '', url), replace: (state, url) => history.replaceState(state, '', url), back: () => history.back() },
  later: (callback, ms) => setTimeout(callback, ms),
  cancel: timer => clearTimeout(timer as number),
  frame: callback => { requestAnimationFrame(callback); },
  clipboard: text => navigator.clipboard.writeText(text),
};

const preloaded = publication ? await readPublication().catch(() => null) : null;
const store = new Store(host, preloaded);
const container = document.getElementById('root');
if (!container) throw new Error('index.html needs a #root element');
if (container.firstElementChild) hydrateRoot(container, <Root store={store} />);
else createRoot(container).render(<Root store={store} />);
