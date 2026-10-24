interface ModalBackgroundElement<T> {
  inert: boolean;
  readonly dataset: { motionState?: string };
  contains(element: T): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Preserve application-owned background states separately from modal isolation. */
export function createModalBackgroundController<T extends ModalBackgroundElement<T>>() {
  const originals = new Map<T, { inert: boolean; ariaHidden: string | null }>();
  return (elements: readonly T[], active?: T): void => {
    const present = new Set(elements);
    for (const element of originals.keys()) if (!present.has(element)) originals.delete(element);
    for (const element of elements) {
      if (!originals.has(element)) originals.set(element, { inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
      const original = originals.get(element)!;
      const foreground = Boolean(active && (element === active || element.contains(active)));
      const closing = element.dataset.motionState === 'closing';
      const blocked = closing || Boolean(active && !foreground);
      // A modal can first be observed while a higher layer has already isolated it.
      // Returning to that active layer must release isolation, not restore that
      // temporary inert/aria-hidden state as though it belonged to the application.
      element.inert = blocked || (!foreground && original.inert);
      if (blocked) element.setAttribute('aria-hidden', 'true');
      else if (foreground || original.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', original.ariaHidden);
    }
    if (!active) originals.clear();
  };
}
