import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const traceRowSource = await readFile(new URL("./transcript/TraceRow.tsx", import.meta.url), "utf8");

test("groups the leading segment when the history page starts mid-turn", () => {
  // A turn longer than the initial page loses its anchor; the head of the page
  // (messages before the first anchor) renders as flat activity rows instead of
  // standalone messages, and regroups once earlier messages finish loading.
  assert.match(source, /if \(hasEarlierMessages && messages\.length > 0 && !isMessageGroupAnchor\(messages\[0\]\)\)/);
  assert.match(source, /const headItems = buildTurnActivityItems\(/);
  assert.match(source, /key="head-activity"/);
});

test("expands process details when a completed turn has no final answer", () => {
  // The fold's open state lives in the trace hook, which reads defaultOpen once.
  assert.match(traceRowSource, /useTraceFold\(foldKey, defaultOpen\)/);
  // An error or truncation notice alone is no answer: the turn's earlier text
  // sits in Process details and must stay visible (#906). A turn with no final
  // answer at all renders flat (nothing collapses); otherwise the fold's
  // defaultOpen follows the answer's presence.
  assert.match(source, /if \(finalAssistantIdx === -1\) \{[\s\S]*?rendered\.push\(renderMessage\(renderIdx, \{ showModelLabel: true \}\)\);/);
  assert.match(
    source,
    /<TurnTrace[\s\S]*?defaultOpen=\{!finalAnswerMessage\}/,
  );
});

test("the settled fold takes over the live fold's state and starts collapsed once answered", () => {
  // LiveTurnTrace 与 TurnTrace 用同一把分段折叠键 process:{entryId}:{段序号}
  // 记录展开/收起选择（活动按中途回复切段，每段一个行内大折叠）；完成态挂载
  // 按 defaultOpen 兑底（有最终答案 → 收起），状态跨 settle 交换帧逐段保留，
  // 不再有“先展开再自动收起”的 justSettled 过渡。
  assert.match(
    source,
    /const turnParts = splitTurnParts\(activityItems\)/,
  );
  assert.match(
    source,
    /<TurnTrace[\s\S]*?foldKey=\{processKey === undefined \? undefined : `process:\$\{processKey\}:\$\{partIdx\}`\}[\s\S]*?defaultOpen=\{!finalAnswerMessage\}/,
  );
  assert.match(
    source,
    /<LiveTurnTrace[\s\S]*?foldKey=\{entryIds\[userIdx\] === undefined \? undefined : `process:\$\{entryIds\[userIdx\]\}:\$\{partIdx\}`\}/,
  );
  // 首条 assistant 条目落盘前的思考期也挂折叠（消死区）：与 isLiveTail 首段同键 :0。
  assert.match(
    source,
    /livePreTurn[\s\S]*?<LiveTurnTrace[\s\S]*?foldKey=\{entryIds\[userIdx\] === undefined \? undefined : `process:\$\{entryIds\[userIdx\]\}:0`\}[\s\S]*?mergeStreaming/,
  );
  assert.doesNotMatch(source, /justSettled/);
  // 气泡只画文本：思考与工具由折叠承担，避免每个工具先平铺再收进去的两次折。
  assert.match(
    source,
    /content: streamingMessage\.content\.filter\(\(block\) => block\.type === "text"\)/,
  );
});

test("the settled fold summary shows duration, four buckets and failures — never 处理详情", () => {
  // 结算段标题（2026-11-20 用户确认）：工作了 X · N 个读取 · N 个编辑 · N 个
  // 运行 · N 个子代理 · N 个失败（非零才显示）；时长取首尾 ts，取不到累计条目
  // duration 兑底；「处理详情」兑底废除。
  assert.match(source, /segBuckets = \{ read: 0, edit: 0, run: 0, subagent: 0 \}/);
  assert.match(source, /t\("chat\.activity\.categoryCount", \{ count, label: t\(labelKey\) \}\)/);
  assert.match(source, /t\("chat\.activity\.failedCount", \{ count: segFailed \}\)/);
  assert.doesNotMatch(source, /processDetails/);
});

test("passes a grouped turn's MessageViews the same copies on every render (#1005)", async () => {
  // Fresh copies per render re-ran every visible answer's markdown on each
  // chat update, e.g. on every key typed into an extension's custom panel.
  // The turn's view model is cached by an entry fingerprint so its object
  // identities survive list recomputes.
  assert.doesNotMatch(source, /withAssistantBlocks\(/);
  assert.match(source, /const turnView = getFinishedTurnView\(\{/);
  assert.match(source, /const \{ finalAnswerMessage, writtenFiles, activityItems, processBlockLimitByIdx \} = turnView;/);
  // lib/turn-view.ts caches the view model by entry fingerprint.
  const turnViewSource = await readFile(new URL("../lib/turn-view.ts", import.meta.url), "utf8");
  assert.match(turnViewSource, /const cached = finishedTurnViewCache\.get\(fingerprint\);/);
});

test("skips custom messages without display and counts them nowhere (#1043)", () => {
  // pi's TUI never renders them; one card per idle session restart flooded the chat.
  assert.match(source, /const msg = options\.messageOverride \?\? messages\[idx\];[\s\S]*?if \(isHiddenCustomMessage\(msg as \{ role\?: AgentMessage\["role"\]; display\?: boolean \}\)\) return null;/);
  assert.match(
    source,
    /if \(processMessage\.role === "custom" && isHiddenCustomMessage\(processMessage\)\) continue;/,
  );
});
