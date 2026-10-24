import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitTemplateDraftGuard } from '../apps/desktop/src/renderer/git/gitTemplateDraftGuard.ts';

test('a delayed default template cannot replace typing even when the user clears back to the original empty value', () => {
  const draft = createGitTemplateDraftGuard(''); const request = draft.ticket();
  draft.observe('my own message', false); draft.observe('', false);
  assert.equal(draft.accepts(request), false);
});
test('template replacement confirmation expires when manual or AI content changes', () => {
  const draft = createGitTemplateDraftGuard('existing AI message'); const confirmation = draft.ticket();
  draft.observe('improved manual message', false);
  assert.equal(draft.accepts(confirmation), false); assert.equal(draft.accepts(draft.ticket()), true);
});
test('starting another operation or hiding the project invalidates an outstanding template read', () => {
  const draft = createGitTemplateDraftGuard(''); const request = draft.ticket();
  draft.observe('', true); assert.equal(draft.accepts(request), false);
  draft.observe('', false); assert.equal(draft.accepts(request), false); assert.equal(draft.accepts(draft.ticket()), true);
});
test('an unchanged draft accepts a current template without invalidating a request merely because of a rerender', () => {
  const draft = createGitTemplateDraftGuard('existing'); const request = draft.ticket();
  draft.observe('existing', false); draft.observe('existing', false);
  assert.equal(draft.accepts(request), true);
});
