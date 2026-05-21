const MODAL_SHORTCUT_CAPTURE_SELECTOR = [
  '[data-testid="command-palette"]',
  '[data-slot="dialog-popup"]',
  '[data-slot="sheet-popup"]',
  '[data-slot="alert-dialog-popup"]',
].join(", ");

function resolveElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

export function isModalShortcutCaptureActive(target: EventTarget | null): boolean {
  const element = resolveElement(target) ?? document.activeElement;
  return element instanceof Element && element.closest(MODAL_SHORTCUT_CAPTURE_SELECTOR) !== null;
}

export function isEditableShortcutTarget(
  target: EventTarget | null,
  options?: { allowComposer?: boolean },
): boolean {
  const element = resolveElement(target);
  if (!element) {
    return false;
  }

  if (options?.allowComposer && element.closest('[data-testid="composer-editor"]')) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }

  return element.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
