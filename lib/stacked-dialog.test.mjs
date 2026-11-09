import assert from "node:assert/strict";
import test from "node:test";
import { focusAfterChange, focusIfLost } from "./stacked-dialog.ts";

/**
 * A node of a minimal DOM tree: listeners keyed by type, function and capture
 * flag, as `EventTarget` keys them.
 */
class FakeNode {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.isConnected = true;
    this.focused = [];
  }

  focus(options) {
    this.focused.push(options);
  }

  /** Inclusive, as `Node.contains()` is. */
  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

/** Settings open on the page over the trust dialog's elements. */
function page(t) {
  const document = new FakeNode("document");
  const body = new FakeNode("body", document);
  const settingsButton = new FakeNode("settings button", body);
  const dialogButton = new FakeNode("trust dialog button", new FakeNode("trust dialog", body));
  document.activeElement = settingsButton;
  document.body = body;
  t.after(() => { document.activeElement = null; });
  return { document, body, settingsButton, dialogButton };
}

test("focus that fell to the page goes to the given element; focus anywhere else stays", (t) => {
  const { document, body, settingsButton, dialogButton } = page(t);
  // Trust… had focus and the reload removed it: the browser puts focus on body.
  document.activeElement = body;
  assert.equal(focusIfLost(document, settingsButton), true);
  assert.deepEqual(settingsButton.focused, [{ preventScroll: true }]);
  document.activeElement = null;
  assert.equal(focusIfLost(document, settingsButton), true);
  // The user had moved on: their focus stays.
  document.activeElement = dialogButton;
  assert.equal(focusIfLost(document, settingsButton), false);
  assert.equal(settingsButton.focused.length, 2);
  // Nothing to move it to.
  document.activeElement = body;
  assert.equal(focusIfLost(document, null), false);
});

test("after a change, focus goes back to the control it was started from, or to the fallback", (t) => {
  const { document, body, settingsButton, dialogButton } = page(t);
  const control = new FakeNode("switch", body);
  // The switch was disabled while the change ran, so the browser put focus on body.
  document.activeElement = body;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  assert.deepEqual(control.focused, [{ preventScroll: true }]);
  assert.deepEqual(settingsButton.focused, []);
  // Disabled still (a server that may not be turned on again), or gone with its pane: the fallback.
  control.disabled = true;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  control.disabled = false;
  control.isConnected = false;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  assert.equal(control.focused.length, 1);
  assert.equal(settingsButton.focused.length, 2);
  // Focus the user put elsewhere meanwhile stays.
  control.isConnected = true;
  document.activeElement = dialogButton;
  assert.equal(focusAfterChange(document, control, settingsButton), false);
  // Nothing had focus when the change started (a click that focuses nothing): nothing moves.
  document.activeElement = body;
  assert.equal(focusAfterChange(document, null, settingsButton), false);
  assert.equal(settingsButton.focused.length, 2);
});
