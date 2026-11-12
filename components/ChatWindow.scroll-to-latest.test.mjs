import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("one scroll-to-latest control, and it is the official one", () => {
  // The hand-rolled ghost button and the official MessageScrollerButton sat on
  // top of each other; only the official one may render.
  assert.equal(source.includes("size-8 cursor-pointer rounded-full p-0 text-muted-foreground"), false);
  assert.equal(source.includes("showScrollToBottom"), false);
  assert.match(source, /<MessageScrollerButton[\s\S]*?chat\.scrollToLatest/);
});

test("the scroller keeps its official defaults for prepends and the initial anchor", () => {
  assert.match(source, /<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">/);
  // Hand-rolled compensation must not sit next to the official one.
  assert.equal(source.includes("preserveScrollOnPrepend={false}"), false);
  // The last user message is the anchor the scroller opens at.
  assert.match(source, /scrollAnchor=\{anchorRole === "user"\}/);
});

test("nothing else writes the reader's scroll position", () => {
  // The keyboard focusin restore re-wrote scrollTop and window.scrollY on the
  // same frame the viewport shrank, which is what made the list jump.
  assert.equal(source.includes("window.scrollTo(0, pageTop)"), false);
  // A per-chunk rAF scroll fought the provider's own autoScroll.
  assert.equal(hookSource.includes("liveFollowFrameRef"), false);
  assert.equal(hookSource.includes("showScrollToBottom"), false);
});

test("no background read of the whole branch", () => {
  assert.equal(source.includes("PREFETCH_MAX_PAGES"), false);
  assert.equal(source.includes("PREFETCH_PAGE_SIZE"), false);
  // Older pages arrive only from the sentinel / "load earlier" request.
  assert.match(source, /observer\.observe\(sentinel\)/);
});
