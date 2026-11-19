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

test("the official scroller owns following, prepend anchoring and the bottom edge", () => {
  // autoScroll 只在 agent 运行时打开：跟随的对象是流式输出。空闲时它恒为 false，
  // 折叠展开的高度增长就进不了 `handleResize` 的 `scrollToEnd()`，也不会把展开块
  // 顶出视口。行窗口与手工前插保位都已删除，因此这里不能再有自己的跟随状态机。
  assert.match(source, /<MessageScrollerProvider autoScroll=\{agentRunning\} defaultScrollPosition="end" scrollEdgeThreshold=\{scrollEdgeThreshold\}>/);
  // 阈值同时就是吸附范围（库在范围内会把模式续回 following-bottom 并跟到底）。
  // 100px 约一行：把最后一条滑到输入条上方时不算贴底，往上翻的人不会被拽回；
  // 内容末端那层 167–169px 的垫底不进吸附区。
  assert.match(source, /const scrollEdgeThreshold = 100;/);
  // 尾部新增行的补滚用「插入之前」的贴底状态（atBottomRef，由滚动监听维护）：
  // 插入之后再量距离，量到的就是新气泡自己的高度，越长的消息越不会跟。
  assert.match(source, /lastRowKeyRef[\s\S]{0,1600}?if \(!atBottomRef\.current\) return;[\s\S]{0,300}?scrollerApiRef\.current\?\.scrollToEnd\(\{ behavior: "instant" \}\)[\s\S]{0,200}?startFollowSettle\(\);/);
  assert.doesNotMatch(source, /distanceToBottom > Math\.max\(120/);
  // 图片行的高度要等加载完才定：跟到底后挂 ResizeObserver 继续跟，静止 1s 或读者
  // 自己滚（wheel/touchstart）就撤。没这层，带图的消息发出去就落在视口上方。
  assert.match(source, /const startFollowSettle = useCallback\(\(\) => \{[\s\S]{0,1400}?new ResizeObserver\(\(\) => \{[\s\S]{0,200}?scrollToEnd\(\{ behavior: "instant" \}\)/);
  assert.match(source, /window\.addEventListener\("wheel", cancel, \{ passive: true \}\)/);
  assert.match(source, /window\.setTimeout\(stopFollowSettle, 1000\)/);
  // 折叠不再自带钉位：既不写 scrollTop，也不再有 pi-web:trace-fold 这条契约。
  assert.doesNotMatch(source, /foldPinRef|pi-web:trace-fold/);
  assert.doesNotMatch(source, /autoScroll=\{false\}|autoScroll=\{!foldInFlight\}/);
  assert.doesNotMatch(source, /useChatFollow|chat-follow|lib\/scroll-anchor/);
  // Hand-rolled compensation must not sit next to the official one.
  assert.equal(source.includes("preserveScrollOnPrepend={false}"), false);
  // 不传 scrollAnchor：官方给锚点行 align-start 置顶并在尾部垫 spacer，
  // 与贴底跟随互抢（"底"分裂成真底与假底）。
  assert.doesNotMatch(source, /scrollAnchor=/);
  // 内容盒高度必须紧贴内容：`min-h-full` 让官方对「内容末端」的测量在短会话里
  // 多出一屏空白，end 恒 true，跟随模式再也回不到 following-bottom（任何 1px
  // 上滑就脱开）。shadcn 的 ui/ 不手改，在调用点用 tailwind-merge 盖掉。
  assert.match(source, /<MessageScrollerContent[\s\S]{0,400}?className="min-h-0 /);
});

test("no render window: every loaded row stays mounted", () => {
  // 渲染行窗口一裁，翻页读进来的历史就真的不在 DOM 里了（这正是"丢消息"的来源）。
  // 离屏行不做 content-visibility 跳过：它们仍在 DOM 里，只是不参与绘制优化。
  assert.doesNotMatch(source, /visibleCount|getVisibleRenderWindow|VISIBLE_PAGE_SIZE/);
});

test("nothing else writes the reader's scroll position", () => {
  // The keyboard focusin restore re-wrote scrollTop and window.scrollY on the
  // same frame the viewport shrank, which is what made the list jump.
  assert.equal(source.includes("window.scrollTo(0, pageTop)"), false);
  // A per-chunk rAF scroll fought the provider's own autoScroll.
  assert.equal(hookSource.includes("liveFollowFrameRef"), false);
  assert.equal(hookSource.includes("showScrollToBottom"), false);
  // 程序化跳转一律走官方命令（它会把模式置为 settling-jump 并抑制跟随）；
  // 只剩“官方 api 还没挂上”时的到底兜底。
  assert.doesNotMatch(source, /container\.scrollTop \+=/);
  assert.match(source, /scrollerApiRef\.current\?\.scrollToMessage\(/);
});

test("no background read of the whole branch", () => {
  assert.equal(source.includes("PREFETCH_MAX_PAGES"), false);
  assert.equal(source.includes("PREFETCH_PAGE_SIZE"), false);
  // Older pages arrive only from the sentinel / "load earlier" request: the top-of-list
  // scroll listener and the click handler both call loadOlderPage.
  assert.match(source, /container\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
});

test("one page at a time: the next request waits for the last one to render", () => {
  // The sentinel and the row are inert while a page is in flight *or* while the
  // page that just landed has not been painted yet.
  assert.match(source, /if \(loadingOlderRef\.current \|\| pageRenderingRef\.current\) return;/);
  // Every path (sentinel, click, minimap, search) goes through this helper, so the
  // wait lives here instead of in each caller.
  assert.match(source, /if \(pageRenderingRef\.current\) \{\s*await new Promise<void>\(\(resolve\) => pageRenderWaitersRef\.current\.push\(resolve\)\);/);
  assert.match(source, /if \(context\) \{\s*pageRenderingRef\.current = true;/);
});

test("the earlier-messages row is a real button", () => {
  assert.match(source, /ref=\{setSentinel\}\s*type="button"\s*variant="ghost"\s*onClick=/);
  assert.match(source, /disabled=\{olderPageState !== "idle"\}/);
  assert.match(source, /t\("chat\.loadingEarlier"\)/);
  // A div with the label was the old shape: not clickable, and it started a
  // request merely by becoming visible.
  assert.equal(source.includes('ref={setSentinel} className="py-3 text-center text-xs text-muted-foreground"'), false);
});

test("clearing the gate re-arms the sentinel without a scroll round-trip", () => {
  // 监听 scroll 的 effect 重建后会自行先试一次：上一页落地时读者仍在顶部即继续加载，
  // 无需再次滚动。
  assert.match(source, /\}, \[sentinel, historyCursor, hasEarlierMessages, session, loadOlderPage, sessionIdRef, scrollContainerRef, olderPageState\]\);/);
});

test("a minimap jump reads one window, never the whole branch", () => {
  const jump = source.slice(
    source.indexOf("const revealTurnForMinimap"),
    source.indexOf("const revealTurnForMinimap") + 1700,
  );
  // 目标不在窗口里就取一窗（该轮居中），落地后按 entryId 定位；拖拽划过未加载
  // 区由单飞闸收敛成一次请求，只补跳最新目标。
  assert.match(jump, /await jumpToEntry\(sid, activeLeafId, entryId\)/);
  assert.match(jump, /setPendingRevealEntryId\(target\.entryId\)/);
  assert.match(jump, /minimapJumpInFlightRef/);
  assert.doesNotMatch(jump, /tail: 100|tail: 200/);
});
