// One Root for both sides: the export prerenders it and the browser hydrates or renders it.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { I18nProvider, RouterProvider } from 'react-aria-components';
import { StoreContext, useStore, useStoreState } from './controls.tsx';
import { DialogHost } from './dialogs.tsx';
import { Notices, ReadingPane, TitleStrip, Workspace } from './reader.tsx';
import type { Store } from './store.ts';

/** A passing message, kept above any dialog and readable by assistive technology while one is open. */
function Notice() {
  const state = useStoreState(), [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const notice = state.notice;
  return createPortal(<div id="notice" data-react-aria-top-layer="true" role="status" aria-live="polite" className={notice ? `visible${notice.attend ? ' attend' : ''}` : undefined}>{notice?.message ?? ''}</div>, document.body);
}

function Portal() {
  const store = useStore(), state = useStoreState(), started = useRef(false);
  useEffect(() => {
    store.surface.scrollToId = id => { const target = document.getElementById(id); target?.scrollIntoView({ block: 'start' }); return Boolean(target); };
    if (!started.current) { started.current = true; void store.run(() => store.start()); }
    const pop = (event: PopStateEvent) => void store.run(() => store.restoreReader(event.state));
    const unload = (event: BeforeUnloadEvent) => store.beforeUnload(event);
    // Authored cross-references are plain links in rendered Markdown; follow them inside the reader.
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || anchor.target === '_blank') return;
      if (store.navigateHref(anchor.href)) event.preventDefault();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click); };
  }, [store]);
  return (
    <>
      <TitleStrip />
      <Notices />
      <main id="app" className={state.readingFocus ? 'reading-focus' : undefined}>
        <Workspace />
        <ReadingPane />
      </main>
      <Notice />
      <DialogHost />
    </>
  );
}

export function Root({ store }: { store: Store }) {
  return (
    <StrictMode>
      <I18nProvider locale="en-US">
        <RouterProvider navigate={href => { if (!store.navigateHref(href)) window.location.assign(href); }}>
          <StoreContext.Provider value={store}>
            <Portal />
          </StoreContext.Provider>
        </RouterProvider>
      </I18nProvider>
    </StrictMode>
  );
}
