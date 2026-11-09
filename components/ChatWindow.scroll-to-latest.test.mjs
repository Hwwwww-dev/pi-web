import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

function elementBlock() {
  const start = source.indexOf("size-[34px] cursor-pointer rounded-full");
  assert.notEqual(start, -1, "scroll-to-latest button not found");
  const buttonStart = source.lastIndexOf("<Button", start);
  const buttonEnd = source.indexOf("</Button>", start);
  assert.notEqual(buttonStart, -1);
  assert.notEqual(buttonEnd, -1);
  return source.slice(buttonStart, buttonEnd);
}

test("shows the scroll-to-latest button only when the viewport is detached from the tail", () => {
  const block = elementBlock();
  // Visibility is a conditional-utility toggle so the exit transition can play.
  assert.match(block, /showScrollToBottom && !pendingScrollRestore\s*\n\s*\? "pointer-events-auto visible translate-y-0 scale-100 opacity-\[0\.28\]/);
  assert.match(block, /: "pointer-events-none invisible translate-y-1 scale-\[0\.96\] opacity-0"/);
});

test("floats the scroll-to-latest button centered over the composer's 700px card", () => {
  const gate = source.indexOf("{!isEmptyNew && (");
  const marker = source.indexOf("size-[34px] cursor-pointer rounded-full", gate);
  assert.notEqual(gate, -1);
  assert.notEqual(marker, -1);
  const container = source.slice(gate, marker);
  const block = elementBlock();

  // The wrapper spans the pane, but the button anchors to an inner mx-auto
  // max-w-[700px] layer — the same column as the composer card — and centers
  // itself on it, so a wide pane cannot strand it at the pane edge.
  assert.match(
    container,
    /className="pointer-events-none absolute inset-x-0 bottom-full z-30"/,
  );
  assert.match(container, /className="relative mx-auto w-full max-w-\[700px\]"/);
  assert.match(block, /absolute left-1\/2 -translate-x-1\/2 bottom-\[14px\] max-sm:bottom-\[10px\]/);
  // z-30 clears the minimap rail's zIndex 25, which otherwise covers the
  // button's whole strip and swallows its clicks.
  // The detached-tail state is a faint floating chip; hover or focus reveals it.
  assert.match(block, /rounded-full border border-border bg-card p-0 text-muted-foreground shadow-sm/);
  assert.match(block, /hover:opacity-100 hover:bg-secondary hover:text-foreground/);
  assert.match(block, /onClick=\{\(\) => scrollToBottom\("smooth"\)\}/);
});

test("keeps the visible button faint until hover or focus", () => {
  const block = elementBlock();

  assert.match(block, /opacity-\[0\.28\]/);
  assert.match(block, /hover:opacity-100/);
  assert.match(block, /focus-visible:opacity-100 focus-visible:bg-secondary focus-visible:text-foreground/);
});

test("fades the button in and out without motion when motion is reduced", () => {
  const block = elementBlock();

  assert.match(block, /invisible translate-y-1 scale-\[0\.96\] opacity-0/);
  // The ghost Button's transition-all carries the fade; reduced motion drops
  // only the slide/scale.
  assert.match(block, /duration-\[160ms\]/);
  assert.match(block, /motion-reduce:translate-y-0 motion-reduce:scale-100/);
});

test("jumps to the live tail with the shared smooth scroll helper", () => {
  const block = elementBlock();

  assert.match(block, /aria-label=\{t\("chat.scrollToLatest"\)\}/);
  assert.match(source, /scrollToBottom, scrollToMessage,/);
});

test("exposes the detached-tail flag from the session hook without a ref read", () => {
  assert.match(hookSource, /const \[showScrollToBottom, setShowScrollToBottom\] = useState\(false\)/);
  assert.match(
    hookSource,
    /const shouldShow = shouldShowScrollToLatest\(scrollTop, clientHeight, scrollHeight\);\s*setShowScrollToBottom\(\(previous\) => \(previous === shouldShow \? previous : shouldShow\)\);/,
  );
  assert.match(hookSource, /promptAnchorActive,\s*showScrollToBottom,\s*\/\/ Refs/);
});
