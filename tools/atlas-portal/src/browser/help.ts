const dialog = document.querySelector<HTMLDialogElement>('#portal-help');

if (dialog) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-open-help]')];
  let opener: HTMLButtonElement | undefined;
  let startedOnBackdrop = false;

  const outsideDialog = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom);
  };

  for (const button of buttons) {
    button.hidden = false;
    button.addEventListener('click', () => {
      opener = button;
      dialog.showModal();
    });
  }
  dialog.querySelector('[data-close-help]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('pointerdown', (event) => {
    startedOnBackdrop = event.button === 0 && outsideDialog(event);
  });
  dialog.addEventListener('click', (event) => {
    if (startedOnBackdrop && outsideDialog(event)) dialog.close();
    startedOnBackdrop = false;
  });
  dialog.addEventListener('close', () => {
    startedOnBackdrop = false;
    const visible = (button: HTMLButtonElement) => button.isConnected
      && button.getClientRects().length > 0 && !button.closest('[inert]');
    const target = opener && visible(opener) ? opener : buttons.find(visible);
    target?.focus({ preventScroll: true });
  });
}
