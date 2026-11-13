import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { viewportInset } = await jiti.import("./useViewportHeight.ts");

test("slides the shell up by exactly what the keyboard covers", () => {
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 510 }), 334);
});

test("stays at zero when the shell already ends at the visible viewport (Android resizes-content)", () => {
  assert.equal(viewportInset({ shellHeight: 510, visibleHeight: 510 }), 0);
});

test("never returns a negative inset when the visual viewport reports taller than the shell", () => {
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 845 }), 0);
});

test("rounds fractional visual viewport heights so the composer does not sit a pixel low", () => {
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 543.6 }), 300);
});

test("keeps a bottom bar's gap out of the viewport instead of leaving it blank", () => {
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 810 }), 34);
});

// iOS pans the visible viewport down to reveal the focused field; that pan
// already moved the shell, so only what the pan leaves covered counts.
test("takes the visible viewport's own pan out of the inset", () => {
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 510, pan: 44 }), 290);
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 800, pan: 44 }), 0);
  assert.equal(viewportInset({ shellHeight: 844, visibleHeight: 444, pan: 64 }), 336);
});
