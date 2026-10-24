/** A template read or confirmation cannot replace edits made after it began. */
export function createGitTemplateDraftGuard(initial: string) {
  let value = initial; let blocked = false; let revision = 0;
  return {
    observe(next: string, disabled: boolean) {
      if (next !== value || disabled !== blocked) revision += 1;
      value = next; blocked = disabled;
    },
    ticket() { return { value, revision }; },
    accepts(ticket: { value: string; revision: number }) { return !blocked && ticket.revision === revision && ticket.value === value; },
  };
}
