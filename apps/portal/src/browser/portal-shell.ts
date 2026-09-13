const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

class AtlasPortalShell extends HTMLElement {
  private events: AbortController | undefined;

  connectedCallback() {
    this.events?.abort();
    this.events = new AbortController();
    const { signal } = this.events;
    const navigation = this.querySelector<HTMLElement>('#navigation-panel');
    const reader = this.querySelector<HTMLElement>('#reader');
    const header = this.querySelector<HTMLElement>('.mobile-header');
    const trigger = this.querySelector<HTMLButtonElement>('[data-open-navigation]');
    const help = this.querySelector<HTMLDialogElement>('#portal-help');
    if (!navigation || !reader || !header || !trigger) throw new Error('Incomplete Atlas navigation controls.');
    const mobile = window.matchMedia('(max-width: 760px)');
    const updateNavigation = () => {
      const open = mobile.matches && this.dataset.navigation === 'open';
      navigation.inert = mobile.matches && !open;
      reader.inert = open;
      header.inert = open;
      trigger.setAttribute('aria-expanded', String(open));
    };
    const openNavigation = (focusTarget = navigation.querySelector<HTMLElement>('[data-close-navigation]')) => {
      if (!mobile.matches) return;
      this.dataset.navigation = 'open';
      updateNavigation();
      window.requestAnimationFrame(() => {
        if (this.dataset.navigation === 'open') focusTarget?.focus();
      });
    };
    const closeNavigation = (restoreFocus = true) => {
      const wasOpen = this.dataset.navigation === 'open';
      delete this.dataset.navigation;
      updateNavigation();
      if (wasOpen && restoreFocus) trigger.focus();
    };
    const containFocus = (event: KeyboardEvent) => {
      const controls = [...navigation.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    trigger.addEventListener('click', () => openNavigation(), { signal });
    for (const button of this.querySelectorAll('[data-close-navigation]')) {
      button.addEventListener('click', () => closeNavigation(), { signal });
    }
    for (const button of this.querySelectorAll('[data-toggle-areas]')) {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('aria-controls');
        const target = targetId ? this.querySelector<HTMLElement>(`#${targetId}`) : null;
        if (!target) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        target.hidden = !expanded;
      }, { signal });
    }
    mobile.addEventListener('change', () => {
      closeNavigation(false);
      if (document.activeElement?.closest('[inert]') || document.activeElement?.getClientRects().length === 0) reader.focus();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (help?.open) return;
      if (event.key === 'Escape' && this.dataset.navigation === 'open') {
        event.preventDefault();
        closeNavigation();
      }
      if (event.key === 'Tab' && this.dataset.navigation === 'open') containFocus(event);
      const editing = document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !editing) {
        event.preventDefault();
        const search = this.querySelector<HTMLElement>('[data-reader-search]') ?? this.querySelector<HTMLElement>('[data-global-search]');
        if (mobile.matches && search?.closest('#navigation-panel')) openNavigation(search);
        else {
          closeNavigation(false);
          search?.focus();
        }
      }
    }, { signal });
    updateNavigation();
  }

  disconnectedCallback() {
    this.events?.abort();
  }
}

if (!customElements.get('portal-shell')) customElements.define('portal-shell', AtlasPortalShell);
