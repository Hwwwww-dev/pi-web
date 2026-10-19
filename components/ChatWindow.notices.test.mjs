import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("renders temporary notices once at the top right of the chat column", () => {
  const noticeShelfUsages = source.match(/<NoticeShelf notices=\{notices\}/g) ?? [];

  assert.equal(noticeShelfUsages.length, 1);
  assert.match(
    source,
    /position: "absolute",\s*top: 12,\s*left: 0,\s*right: 0,[\s\S]*?justifyContent: "flex-end",[\s\S]*?<NoticeShelf notices=\{notices\} floating onPauseChange=\{setNoticePaused\} onDismiss=\{dismissNotice\} \/>/,
  );
});

test("pauses only for a visible notice", () => {
  assert.match(
    hookSource,
    /noticeState\.visible\.some\(\(notice\) => notice\.id === pausedNoticeId\)\) return/,
  );
});

test("centres a one-line notice in the card the entrance animation pins", () => {
  const minHeight = Number(source.match(/const NOTICE_MIN_HEIGHT_PX = (\d+);/)[1]);
  const lineBox = Number(source.match(/const NOTICE_LINE_BOX_PX = (\d+);/)[1]);

  // The padding is half of what one line leaves of the card - the two 1px
  // borders and a 21px line box out - so the line sits in the middle of the
  // card. Filling the card's min-height from the top instead leaves its
  // leftover under the text, which pushes the line above the centre.
  assert.match(source, /const NOTICE_TEXT_PADDING_Y_PX = \(NOTICE_MIN_HEIGHT_PX - 2 - NOTICE_LINE_BOX_PX\) \/ 2;/);
  const padding = (minHeight - 2 - lineBox) / 2;

  // Both keyframes pin the card to one line's height while a notice animates in
  // and out (the "backwards" fill returns the height to the inline styles after
  // it), so the text between the borders has to add up to exactly that height.
  const animatedHeight = Number(globals.match(/@keyframes notice-shelf-in \{[\s\S]*?height: (\d+)px/)[1]);
  assert.equal(2 * padding + lineBox + 2, animatedHeight);
});

test("measures the notice line box from the card's own font size and line height", () => {
  const lineBox = Number(source.match(/const NOTICE_LINE_BOX_PX = (\d+);/)[1]);
  const card = source.match(/className="notice-shelf-item"[\s\S]*?fontSize: (\d+),\s*lineHeight: ([\d.]+),/);
  assert.equal(Number(card[1]) * Number(card[2]), lineBox);
});
