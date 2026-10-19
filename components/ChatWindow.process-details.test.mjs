import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("groups the leading segment when the history page starts mid-turn", () => {
  // A turn longer than the initial page loses its anchor; the head of the page
  // (messages before the first anchor) renders as flat activity rows instead of
  // standalone messages, and regroups once earlier messages finish loading.
  assert.match(source, /if \(hasEarlierMessages && messages\.length > 0 && !isMessageGroupAnchor\(messages\[0\]\)\)/);
  assert.match(source, /const headItems = buildTurnActivityItems\(/);
  assert.match(source, /key="head-activity"/);
});

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  // An error or truncation notice alone is no answer: the turn's earlier text
  // sits in Process details and must stay visible (#906). A turn with no final
  // answer at all renders flat (nothing collapses); otherwise the group's
  // defaultExpanded follows the answer's presence.
  assert.match(source, /if \(finalAssistantIdx === -1\) \{[\s\S]*?rendered\.push\(renderMessage\(renderIdx, \{ showModelLabel: true \}\)\);/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("resets process details when the turn gains or loses its final answer", () => {
  // useState only reads defaultExpanded on mount; keying on answer availability
  // makes an answered turn start collapsed even if it first rendered unanswered.
  assert.match(
    source,
    /<ProcessDetailsGroup key=\{finalAnswerMessage \? "answered" : "unanswered"\}[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
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
