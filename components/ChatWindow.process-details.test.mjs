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
