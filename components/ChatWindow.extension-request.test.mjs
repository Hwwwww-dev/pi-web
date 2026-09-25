import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("confines extension overlays to the content region above the composer", () => {
  assert.doesNotMatch(source, /function ExtensionRequestSheet/);
  assert.match(
    source,
    /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"[\s\S]*?<ExtensionDialog[\s\S]*?<ExtensionCustomPanel[\s\S]*?className="relative shrink-0"[\s\S]*?{chatInputElement}/,
  );
  assert.match(dialogSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(dialogSource, /pointerEvents: "none"/);
  assert.match(dialogSource, /pointerEvents: "auto"/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(customSource, /pointerEvents: "none"/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /ref=\{wrapperRef\}/);
  assert.match(customSource, /const dialogMaxHeight = useDialogMaxHeight\(wrapperRef\);/);
  assert.match(customSource, /maxHeight: dialogMaxHeight/);
});

test("adds collapse without replacing cancel", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.doesNotMatch(dialogSource, /chat\.extensionSkip/);
});

test("renders extension confirmation and options as markdown", () => {
  assert.match(source, /import \{ MarkdownBody \} from "\.\/MarkdownBody"/);
  assert.match(dialogSource, /<MarkdownBody>\{request\.message\}<\/MarkdownBody>/);
  assert.match(dialogSource, /role="button"[\s\S]*?data-extension-option[\s\S]*?<div inert>[\s\S]*?<MarkdownBody>\{option\}<\/MarkdownBody>/);
  assert.match(dialogSource, /ref=\{index === 0 \? focusFirstOption : undefined\}/);
});

test("preserves title newlines like pi's TUI and keeps long titles from hiding the body", () => {
  const header = dialogSource.slice(dialogSource.indexOf('role="dialog"'), dialogSource.indexOf("{request.method === \"confirm\""));
  assert.match(header, /<ExtensionDialogTitle title=\{multiSelect \? multiSelect\.question \|\| request\.title : request\.title\} \/>/);
  assert.match(header, /maxHeight: 180, overflowY: "auto" \}\}>/);
});

test("renders option preview blocks in the dialog title as markdown", () => {
  assert.match(source, /PREVIEW_HEADING_RE = \/\^--- \(\.\+\) preview ---\$\//);
  assert.match(source, /<MarkdownBody>\{segment\.markdown\}<\/MarkdownBody>/);
});

test("resets collapse state when a new extension request arrives", () => {
  assert.match(source, /<ExtensionDialog\s+key=\{extensionDialog\.id\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});

test("queues concurrent requests and pages over pending ones", () => {
  // Requests append to a queue; responses and ui_closed remove by id.
  assert.match(hookSource, /extensionDialogQueue, setExtensionDialogQueue\] = useState<ExtensionUiDialogRequest\[\]>\(\[\]\)/);
  assert.match(hookSource, /current\.some\(\(item\) => item\.id === request\.id\) \? current : \[\.\.\.current, request\]/);
  assert.match(hookSource, /current\.filter\(\(item\) => item\.id !== request\.id\)/);
  assert.match(hookSource, /current\.filter\(\(item\) => item\.id !== event\.id\)/);
  // ‹ › pager steps through answered questions (read-only) and back to the
  // live one; Escape in review mode returns instead of cancelling.
  assert.match(dialogSource, /chat\.question\.pager/);
  assert.match(dialogSource, /const totalQuestions = \(answered\?\.length \?\? 0\) \+ \(queueTotal \?\? 1\)/);
  assert.match(dialogSource, /const stepToPrevious = /);
  assert.match(dialogSource, /chat\.question\.backToCurrent/);
  assert.match(dialogSource, /if \(reviewIndex !== null\) \{\s*\n\s*setReviewIndex\(null\);/);
});

test("select answers are two-step: click selects, confirm sends", () => {
  assert.match(dialogSource, /const \[selectedOption, setSelectedOption\] = useState<string \| null>\(null\)/);
  assert.match(dialogSource, /onClick=\{\(\) => setSelectedOption\(\(current\) => current === option \? null : option\)\}/);
  assert.match(dialogSource, /onDoubleClick=\{\(\) => \{\s*\n\s*setSelectedOption\(option\);\s*\n\s*onRespond\(request, \{ value: option \}\);\s*\n\s*\}\}/);
  assert.match(dialogSource, /request\.method === "select" \? \([\s\S]{0,400}disabled=\{selectedOption === null\}/);
});
