class AtlasPortalShell extends HTMLElement {
  connectedCallback() {
    this.returnFocus = null;
    this.navigation = this.querySelector('#navigation-panel');
    this.context = this.querySelector('#context-panel');
    this.openButtons = [...this.querySelectorAll('[data-open-panel]')];

    for (const button of this.openButtons) {
      button.addEventListener('click', () => this.openPanel(button.dataset.openPanel, button));
    }
    for (const button of this.querySelectorAll('[data-close-panel]')) button.addEventListener('click', () => this.closePanels());
    this.querySelector('[data-close-context]')?.addEventListener('click', () => this.setDesktopContext(false));
    this.querySelector('[data-open-context]')?.addEventListener('click', () => this.setDesktopContext(true));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.dataset.mobilePanel) this.closePanels();
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        this.querySelector('[data-global-search]')?.focus();
      }
    });
  }

  openPanel(name, trigger) {
    this.returnFocus = trigger;
    document.body.dataset.mobilePanel = name;
    for (const button of this.openButtons) button.setAttribute('aria-expanded', String(button.dataset.openPanel === name));
    const panel = name === 'navigation' ? this.navigation : this.context;
    window.requestAnimationFrame(() => panel?.querySelector('a, button, input')?.focus());
  }

  closePanels() {
    delete document.body.dataset.mobilePanel;
    for (const button of this.openButtons) button.setAttribute('aria-expanded', 'false');
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  setDesktopContext(open) {
    this.dataset.context = open ? 'open' : 'closed';
    this.querySelector('[data-close-context]')?.setAttribute('aria-expanded', String(open));
    this.querySelector('[data-open-context]')?.setAttribute('aria-expanded', String(open));
  }
}

if (!customElements.get('portal-shell')) customElements.define('portal-shell', AtlasPortalShell);
