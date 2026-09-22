import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight } = await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    fullHeight: 844,
    visibleHeight: 510,
    viewportScale: 1,
  }), true);
});

test("detects the keyboard when the whole layout viewport shrinks with it (iOS PWA)", () => {
  // innerHeight, clientHeight, and visualViewport.height all shrink together,
  // so only the no-keyboard high-water mark makes the delta visible.
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    fullHeight: 844,
    visibleHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    fullHeight: 844,
    visibleHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    fullHeight: 844,
    visibleHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    fullHeight: 844,
    visibleHeight: 422,
    viewportScale: 2,
  }), false);
});

test("does not override Android resizes-content, where the visible height equals the full height", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    fullHeight: 844,
    visibleHeight: 844,
    viewportScale: 1,
  }), false);
});
