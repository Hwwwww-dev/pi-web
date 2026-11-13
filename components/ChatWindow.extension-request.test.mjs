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
    /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"[\s\S]*?<ExtensionDialog[\s\S]*?<ExtensionCustomPanel[\s\S]*?className="relative flex min-h-0 flex-col shrink-0"[\s\S]*?{chatInputElement}/,
  );
  assert.match(dialogSource, /"absolute inset-0 z-\[90\] flex/);
  assert.match(dialogSource, /pointer-events-none/);
  assert.match(dialogSource, /pointer-events-auto/);
  assert.match(customSource, /"absolute inset-0 z-\[95\] flex/);
  assert.match(customSource, /pointer-events-none/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /wrapperRef\.current = node;/);
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
  // Dialog and option texts are stripped of ANSI codes before markdown
  // rendering (the styled header keeps its TUI rendering elsewhere).
  assert.match(dialogSource, /<MarkdownBody>\{stripAnsi\(request\.message\)\}<\/MarkdownBody>/);
  // Options render inside the shadcn base QuestionnaireChoice with the same
  // inert wrapper and ANSI stripping as the old hand-rolled buttons.
  assert.match(dialogSource, /<QuestionnaireChoice[\s\S]*?<div inert>\s*<MarkdownBody>\{stripAnsi\(option\)\}<\/MarkdownBody>/);
});

test("preserves title newlines like pi's TUI and keeps long titles from hiding the body", () => {
  const header = dialogSource.slice(dialogSource.indexOf("<DialogContent"), dialogSource.indexOf("{request.method === \"confirm\""));
  assert.match(header, /<ExtensionDialogTitle title=\{multiSelect \? stripAnsi\(multiSelect\.question \|\| request\.title\) : stripAnsi\(request\.title\)\} \/>/);
  // #890: a non-shrinkable header grows to its full text height, pushing the
  // option list and the footer past the dialog's overflow edge. The header has
  // to be allowed to shrink and scroll instead.
  assert.match(header, /shrink min-h-0[\s\S]*?max-h-\[180px\] overflow-y-auto/);
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
  assert.match(hookSource, /extensionDialogs, setExtensionDialogs\] = useState<ExtensionUiDialogRequest\[\]>\(\[\]\)/);
  assert.match(hookSource, /enqueueExtensionUiRequest\(queue, request\)/);
  assert.match(hookSource, /removeExtensionUiRequest\(queue, request\.id\)/);
  assert.match(hookSource, /removeExtensionUiRequest\(queue, event\.id as string\)/);
  // ‹ › pager steps through answered questions (read-only) and back to the
  // live one; Escape in review mode returns instead of cancelling.
  assert.match(dialogSource, /chat\.question\.pager/);
  assert.match(dialogSource, /const totalQuestions = \(answered\?\.length \?\? 0\) \+ \(queueTotal \?\? 1\)/);
  assert.match(dialogSource, /const stepToPrevious = /);
  assert.match(dialogSource, /chat\.question\.backToCurrent/);
  assert.match(dialogSource, /if \(reviewIndex !== null\) \{\s*\n\s*setReviewIndex\(null\);/);
});

test("select answers are two-step: click selects, confirm sends", () => {
  // shadcn base Questionnaire：点击仅选中（radio），表单提交才发送；双击选项直接发送。
  assert.match(dialogSource, /<Questionnaire\s+id="extension-ask-form"[\s\S]*?items=\{\[\{ name: "answer", required: true,[\s\S]*?onSubmit=\{submitSelectForm\}/);
  assert.match(dialogSource, /<QuestionnaireItem name="answer" required>/);
  assert.match(dialogSource, /<QuestionnaireChoice[\s\S]*?onDoubleClick=\{\(\) => onRespond\(request, \{ value: option \}\)\}/);
  assert.match(
    dialogSource,
    /const selected = Array\.from\(new FormData\(event\.currentTarget\)\.values\(\)\)\.map\(String\)\.find\(\(v\) => v\.length > 0\);\s*\n\s*if \(selected !== undefined\) onRespond\(request, \{ value: selected \}\);/,
  );
});

test("shows how many extension requests wait behind the one on screen", () => {
  const expandedHeader = dialogSource.slice(dialogSource.indexOf("<DialogContent"), dialogSource.indexOf("{request.method === \"confirm\""));
  const collapsedButton = dialogSource.slice(dialogSource.indexOf("{collapsed ? ("), dialogSource.indexOf("<DialogContent"));
  const customCollapsed = customSource.slice(customSource.indexOf("{collapsed ? ("), customSource.indexOf("<DialogContent"));
  const customExpanded = customSource.slice(customSource.indexOf("<DialogContent"));
  const waitingSource = source.slice(source.indexOf("function ExtensionWaitingCount"), source.indexOf("function ExtensionDialog("));

  assert.match(source, /<ExtensionDialog\s+key=\{extensionDialog\.id\}\s+request=\{extensionDialog\}\s+waitingCount=\{waitingExtensionDialogCount\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\} request=\{extensionCustomUi\} waitingCount=\{waitingExtensionCustomUiCount\}/);
  assert.match(waitingSource, /if \(count <= 0\) return null;[\s\S]*?t\("chat\.extensionMoreWaiting", \{ count \}\)/);
  assert.match(expandedHeader, /chat\.extensionRequest"\)\}<\/span>[\s\S]*?\{countdown\}/);
  assert.match(expandedHeader, /<ExtensionWaitingCount count=\{waitingCount\} \/>\s+\{countdown\}/);
  assert.match(collapsedButton, /<ExtensionWaitingCount count=\{waitingCount\} \/>\s+\{countdown\}/);
  assert.match(customCollapsed, /<ExtensionWaitingCount count=\{waitingCount\} \/>\s+<span[^>]*>\s+\{t\("chat\.extensionExpand"\)\}/);
  assert.match(customExpanded, /chat\.extensionPanel"\)\}<\/div>\s+<div[^>]*>\s+<ExtensionWaitingCount count=\{waitingCount\} \/>/);
});

test("fits dialogs to their code blocks and lets the user maximize them (#947)", () => {
  const dialogOnly = dialogSource.slice(0, dialogSource.indexOf("function ExtensionCustomPanel"));
  // Plain pi compatibility: nothing about size travels in the request or comes from an extension.
  assert.doesNotMatch(source, /dialogSize/);

  // A dialog opens at the historical 560px and only grows through the measured fit.
  assert.match(
    dialogOnly,
    /width: full \? "100%" : `min\(\$\{fitWidth \?\? EXTENSION_DIALOG_BASE_WIDTH\}px, 100%\)`,[\s\S]*?maxHeight: full \? "100%" : dialogMaxHeight,/
  );
  // Only blocks that scroll sideways count, and the fit never shrinks again while it is read.
  assert.match(dialogOnly, /querySelectorAll<HTMLElement>\("pre, \.markdown-table-wrap"\)/);
  assert.match(dialogOnly, /block\.scrollWidth - block\.clientWidth/);
  assert.match(dialogOnly, /prev !== null && prev >= needed \? prev : needed/);
  // Highlighted code swaps in after the first paint, so the fit watches the body.
  assert.match(dialogOnly, /new MutationObserver\(fit\)[\s\S]*?observe\(body, \{ childList: true, subtree: true, characterData: true \}\)/);

  // The maximize/restore button sits next to the collapse chevron and only affects this dialog.
  const header = dialogOnly.slice(dialogOnly.indexOf("<DialogContent"), dialogOnly.indexOf("{request.method === \"confirm\""));
  assert.match(header, /onClick=\{toggleFull\}[\s\S]*?t\("chat\.extensionMaximize"\)[\s\S]*?t\("chat\.extensionRestoreSize"\)[\s\S]*?<ExtensionSizeIcon expanded=\{full\} \/>[\s\S]*?onClick=\{\(\) => setCollapsed\(true\)\}/);
  assert.doesNotMatch(source, /localStorage|pi-extension-/);
});

test("shows a custom panel's lines whole instead of scrolling when they are wider than 920px (#947)", () => {
  // The extension wraps its lines to the width it asked for, so the panel only has to be
  // as wide as the widest of them, capped to the content region.
  assert.match(customSource, /w-max min-w-\[min\(920px,100%\)\] max-w-\[calc\(100%-2rem\)\]/);
  assert.doesNotMatch(customSource.slice(0, customSource.indexOf("\n}\n")), /toggleFull|extensionMaximize/);
});
