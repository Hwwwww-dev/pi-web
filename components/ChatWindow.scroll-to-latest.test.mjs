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

test("one page at a time: the next request waits for the last one to render", () => {
  // The sentinel and the row are inert while a page is in flight *or* while the
  // page that just landed has not been painted yet.
  assert.match(source, /if \(loadingOlderRef\.current \|\| pageRenderingRef\.current\) return;/);
  // Every path (sentinel, click, minimap, search) goes through this helper, so the
  // wait lives here instead of in each caller.
  assert.match(source, /if \(pageRenderingRef\.current\) \{\s*await new Promise<void>\(\(resolve\) => pageRenderWaitersRef\.current\.push\(resolve\)\);/);
  assert.match(source, /if \(context\) \{\s*pageRenderingRef\.current = true;/);
  // Released after the prepend is in the rendered window and a frame was painted.
  assert.match(source, /if \(visibleCount < messages\.length\) return;\s*const frame = requestAnimationFrame\(\(\) => \{\s*pageRenderingRef\.current = false;/);
  assert.match(source, /\}, \[visibleCount, messages\.length, olderPageState\]\);/);
});

test("the earlier-messages row is a real button", () => {
  assert.match(source, /ref=\{setSentinel\}\s*type="button"\s*onClick=/);
  assert.match(source, /disabled=\{olderPageState !== "idle"\}/);
  assert.match(source, /t\("chat\.loadingEarlier"\)/);
  // A div with the label was the old shape: not clickable, and it started a
  // request merely by becoming visible.
  assert.equal(source.includes('ref={setSentinel} className="py-3 text-center text-xs text-muted-foreground"'), false);
});

test("clearing the gate re-arms the sentinel without a scroll round-trip", () => {
  // IntersectionObserver only reports a change; recreating it makes the initial
  // report fire for a sentinel that is still on screen, so paging continues.
  assert.match(source, /\}, \[sentinel, visibleCount, historyCursor, hasEarlierMessages, session, loadOlderPage, sessionIdRef, scrollContainerRef, olderPageState\]\);/);
});

test("a minimap jump reads one page at a time, never the whole branch", () => {
  const jump = source.slice(
    source.indexOf("const revealTurnForMinimap"),
    source.indexOf("const revealTurnForMinimap") + 2000,
  );
  // No bulk window widening: the prepend sync effect keeps the window at the
  // loaded count, so a jump cannot render a second copy of everything at once.
  assert.doesNotMatch(jump, /messagesLenRef\.current \* 2/);
  // Same page size as scrolling; the anchor stops the loop.
  assert.doesNotMatch(jump, /tail: 100|tail: 200/);
  assert.match(jump, /await loadOlderPage\(sid, snapshot\.historyCursor\)/);
  // A cursor that stopped moving would fetch the same page again.
  assert.match(jump, /if \(snapshot\.historyCursor === cursor\) break;/);
  // A turn that is not on this branch is not chased further.
  assert.match(jump, /if \(!snapshot\.historyCursor \|\| !snapshot\.hasEarlierMessages\) break;/);
});
