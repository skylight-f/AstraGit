import assert from 'node:assert/strict';
import test from 'node:test';
import { createModalBackgroundController } from '../apps/desktop/src/renderer/ui/modalBackground.ts';

class Surface {
  inert = false;
  dataset = {};
  attributes = new Map();
  children = [];
  contains(element) { return this.children.includes(element); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function assertReachable(surface) {
  assert.equal(surface.inert, false);
  assert.notEqual(surface.getAttribute('aria-hidden'), 'true');
}

test('closing an error layer restores the underlying confirmation and keeps the application isolated', () => {
  const sync = createModalBackgroundController();
  const application = new Surface();
  const confirmation = new Surface();
  const error = new Surface();
  // The lower confirmation may be registered after it was hidden by the error.
  confirmation.inert = true;
  confirmation.setAttribute('aria-hidden', 'true');
  sync([application, confirmation, error], error);
  assertReachable(error);
  assert.equal(confirmation.inert, true);

  error.dataset.motionState = 'closing';
  sync([application, confirmation, error], confirmation);
  assertReachable(confirmation);
  assert.equal(application.inert, true);
  assert.equal(error.inert, true);
  assert.equal(error.getAttribute('aria-hidden'), 'true');

  confirmation.dataset.motionState = 'closing';
  sync([application, confirmation]);
  assertReachable(application);
  assert.equal(confirmation.inert, true);
});

test('nested confirmations can close in either order and restore preexisting background accessibility', () => {
  const sync = createModalBackgroundController();
  const application = new Surface();
  application.setAttribute('aria-hidden', 'false');
  const intentionallyHidden = new Surface();
  intentionallyHidden.inert = true;
  intentionallyHidden.setAttribute('aria-hidden', 'true');
  const lower = new Surface();
  const upper = new Surface();
  sync([application, intentionallyHidden, lower], lower);
  sync([application, intentionallyHidden, lower, upper], upper);
  assert.equal(lower.inert, true);
  // The lower dialog can unmount while a nested error remains open.
  sync([application, intentionallyHidden, upper], upper);
  assertReachable(upper);
  assert.equal(application.inert, true);
  upper.dataset.motionState = 'closing';
  sync([application, intentionallyHidden, upper]);
  assertReachable(application);
  assert.equal(application.getAttribute('aria-hidden'), 'false');
  assert.equal(intentionallyHidden.inert, true);
  assert.equal(intentionallyHidden.getAttribute('aria-hidden'), 'true');
});

test('reopening a closing portal releases its own isolation and still blocks other roots', () => {
  const sync = createModalBackgroundController();
  const application = new Surface();
  const modal = new Surface();
  sync([application, modal], modal);
  modal.dataset.motionState = 'closing';
  sync([application, modal]);
  assert.equal(modal.inert, true);
  modal.dataset.motionState = 'open';
  sync([application, modal], modal);
  assertReachable(modal);
  assert.equal(application.inert, true);
  sync([application]);
  assertReachable(application);
});

test('an inline modal keeps its containing root reachable and restores its original state afterwards', () => {
  const sync = createModalBackgroundController();
  const root = new Surface();
  root.inert = true;
  root.setAttribute('aria-hidden', 'true');
  const otherRoot = new Surface();
  const modal = new Surface();
  root.children.push(modal);
  sync([root, otherRoot], modal);
  assertReachable(root);
  assert.equal(otherRoot.inert, true);
  sync([root, otherRoot]);
  assert.equal(root.inert, true);
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  assertReachable(otherRoot);
});
