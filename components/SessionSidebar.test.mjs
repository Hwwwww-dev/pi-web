import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import vm from "node:vm";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar, nearestEnabledKey, handOffDisabledKeyFocus, sameIdsOr } = await jiti.import("./SessionSidebar.tsx");
const { buildSessionTree, getRowOffsets, getVisibleRowIndices } = await jiti.import("@/lib/session-tree.ts");
const { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH } = await jiti.import("@/lib/panel-layout.ts");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const dockSource = await readFile(new URL("./KeepAliveDock.tsx", import.meta.url), "utf8");
const treeSource = await readFile(new URL("./SessionTree.tsx", import.meta.url), "utf8");
const searchSource = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sidebarStyles = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");
const explorerSource = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};
const BASE = Date.parse("2026-10-01T00:00:00.000Z");

function between(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(start, -1, `${startAnchor} not found`);
  assert.notEqual(end, -1, `${endAnchor} not found after ${startAnchor}`);
  return source.slice(start, end);
}

/** A sidebar callback's body: from its declaration to the next `const` of the component. */
function callbackBody(name) {
  return between(`const ${name} = `, "\n  const ");
}

function session(id, { project = "/work/alpha", modified = BASE, ...rest } = {}) {
  const time = new Date(modified).toISOString();
  return {
    path: `${project}/${id}.jsonl`,
    id,
    cwd: project,
    projectRoot: project,
    projectKey: project,
    created: time,
    modified: time,
    messageCount: 1,
    firstMessage: id,
    ...rest,
  };
}

function treeInput(overrides = {}) {
  return {
    sessions: [],
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...overrides,
  };
}

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

/** The opening tag of the element with this id. */
function openingTag(html, id) {
  const match = html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`));
  assert.ok(match, `#${id} not rendered`);
  return match[0];
}

test("scrolling keeps the focused session and the viewport mounted without expanding the whole tree", () => {
  const sessions = Array.from({ length: 2000 }, (_, index) => session(`s${index}`, { modified: BASE - index * 60_000 }));
  const { rows } = buildSessionTree(treeInput({ sessions, currentProject: { key: "/work/alpha", root: "/work/alpha" }, moreShown: { "/work/alpha": 5000 } }));
  const offsets = getRowOffsets(rows, "desktop");
  const lastSessionIndex = rows.findLastIndex((row) => row.kind === "session");
  for (const [scrollTop, focusedIndex] of [[0, lastSessionIndex], [30000, 1]]) {
    const indices = getVisibleRowIndices(offsets, scrollTop, 335, 240, [focusedIndex]);
    for (let index = 0; index < rows.length; index++) {
      const intersects = offsets[index + 1] > scrollTop && offsets[index] < scrollTop + 335;
      if (intersects) assert.ok(indices.includes(index), `row ${index} in the viewport is mounted`);
    }
    assert.ok(indices.includes(focusedIndex), "an inline rename survives scrolling");
    assert.ok(indices.length < 60, "only a window of the tree is mounted");
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});

test("subagents fold into their main session row, which carries their running, unread and selected state", () => {
  const child = session("child", { relation: { kind: "subagent", parentSessionId: "main", profile: "explore", description: "", status: "running" } });
  const { rows } = buildSessionTree(treeInput({
    sessions: [session("main"), child],
    runningIds: new Set(["child"]),
    unreadIds: new Set(["child"]),
    selectedSessionId: "child",
    currentProject: { key: "/work/alpha", root: "/work/alpha" },
  }));
  const sessionRows = rows.filter((row) => row.kind === "session");
  assert.deepEqual(sessionRows.map((row) => row.family.root.id), ["main"]);
  assert.deepEqual(sessionRows[0].status, { running: true, awaiting: false, unread: true, selected: true, transient: false });
});

test("only Shift skips the session deletion confirmation", () => {
  assert.match(
    callbackBody("requestDelete"),
    /if \(shiftKey\) \{\s*void performDelete\(family\);\s*\} else \{[\s\S]*?setConfirmDeleteRootId\(family\.root\.id\);/,
  );
});

test("on a desktop the files sit below the sessions by default, both in view", () => {
  // The server renders the default placement on a desktop (useFilesPlacement
  // and useIsMobile's server snapshots): the stacked layout.
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  assert.match(html, /^<div class="session-sidebar is-files-below" style="--sidebar-files-height:320px">/);
  // No tabs: the brand (its name says the versions a click shows), then New
  // and the sessions' search. No view options.
  assert.match(html, /<div class="sidebar-header"><button type="button" class="sidebar-brand" aria-label="Pi Web, versions: web [^",]+, pi [^",]+">Pi Web<\/button><span class="sidebar-header-spacer"><\/span><button type="button" class="sidebar-new-button"/);
  assert.doesNotMatch(html, /role="tablist"|role="tab"|role="tabpanel"|View options|sidebar-title/);
  assert.match(html, /<span class="sidebar-new-label">New<\/span><\/button><button type="button" title="Search conversations" aria-label="Search conversations" aria-expanded="false" aria-controls="session-search-input" class="sidebar-search-toggle">/);
  // Two regions, both shown: the sessions, the separator, the files.
  const sessions = openingTag(html, "session-sidebar-panel-sessions");
  const files = openingTag(html, "session-sidebar-panel-files");
  assert.equal(sessions, '<div id="session-sidebar-panel-sessions" role="region" aria-label="Sessions" class="sidebar-panel sidebar-sessions-panel">');
  assert.equal(files, '<div id="session-sidebar-panel-files" role="region" aria-label="Files" class="sidebar-panel sidebar-files-panel">');
  const separator = html.slice(html.indexOf('role="separator"') - 200, html.indexOf(files));
  assert.ok(html.indexOf(sessions) < html.indexOf('role="separator"') && html.indexOf('role="separator"') < html.indexOf(files), "sessions, separator, files");
  assert.match(separator, /<div aria-label="Resize file browser" aria-orientation="horizontal" aria-valuemax="2000" aria-valuemin="220" aria-valuenow="320" aria-valuetext="320 px" role="separator" tabindex="0" aria-controls="session-sidebar-panel-files" class="panel-resize-handle sidebar-files-resize-handle" data-resize-handle="sidebar-files" title="Resize file browser: Drag to resize\. Double-click or press Enter to reset\."><\/div>$/);
  // The files section: one header row (folds it; the files' keys at its
  // end in the files tab's order, the file search last), then its body: the
  // picker's one row and the tree. No row of keys under the picker; nothing
  // changed, so no count after the label.
  const filesPanel = html.slice(html.indexOf(files) + files.length);
  assert.match(filesPanel, /^<div class="sidebar-files-section"><button type="button" class="sidebar-files-section-toggle" aria-expanded="true" aria-controls="session-sidebar-files-body"><svg width="12" height="12"[^>]*stroke-width="3"[^>]*class="session-tree-chevron is-open"[^>]*>[\s\S]*?<\/svg><span class="sidebar-files-section-label">Files<\/span><\/button><div class="sidebar-files-keys" role="group" aria-label="File actions"><button type="button" title="Open workspace terminal" aria-label="Open workspace terminal" class="sidebar-tool-button">/);
  assert.match(filesPanel, /<div id="session-sidebar-files-body" class="sidebar-files-body"><div class="sidebar-files-head"><div class="project-picker is-row" role="group"/);
  assert.match(filesPanel, /<div class="sidebar-files-scroll scrollbar-subtle">/);
  assert.doesNotMatch(filesPanel, /sidebar-files-toolbar|sidebar-files-title|sidebar-files-actions|sidebar-files-section-search|sidebar-files-changes/);
  assert.doesNotMatch(filesPanel, /sidebar-files-section-count/);
  // Pins and archive not loaded yet: the tree waits instead of flashing archived rows.
  assert.match(html, /<div class="session-tree-message">Loading\.\.\.<\/div>/);
  // Without a folder the files' search has nothing to search.
  assert.match(render(), /<button type="button" disabled="" title="Search files" aria-label="Search files" aria-expanded="false" aria-controls="file-search-input" class="sidebar-tool-button">/);
});

test("the fold's and the archive view's motions in the CSS last as long as the hook's phase", async () => {
  const { SIDEBAR_MOTION_MS } = await jiti.import("@/hooks/useSidebarMotion.ts");
  // A phase ends on its element's own end event, else a little after
  // SIDEBAR_MOTION_MS (hooks/useSidebarMotion.ts): every motion it waits for
  // lasts that long.
  for (const [selector, property] of [
    [".session-sidebar.is-files-below.is-files-folding .sidebar-files-panel", "transition"],
    [".session-sidebar.is-files-below.is-files-folding .sidebar-toast-region", "transition"],
    [".sidebar-archive-view.is-entering", "animation"],
    [".sidebar-archive-view.is-leaving", "animation"],
  ]) {
    assert.match(sidebarRule(selector), new RegExp(`(?:^|\\s)${property}: [\\w-]+ ${SIDEBAR_MOTION_MS}ms `), selector);
  }
});

test("still, the sidebar renders as it did before it moved: nothing inert, no fold under way, no archive view", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  assert.doesNotMatch(html, / inert[ =>]|is-files-folding|sidebar-archive-view|is-entering|is-leaving/);
  assert.match(html, /<div class="sidebar-sessions-views"><div class="sidebar-sessions-view">/);
  assert.equal(openingTag(html, "session-sidebar-files-body"), '<div id="session-sidebar-files-body" class="sidebar-files-body">');
  assert.match(html, /role="separator"/, "the open section's separator");
});

/** The files section header row's keys group, as rendered below the sessions. */
function sectionKeys(html) {
  const row = html.slice(html.indexOf('<div class="sidebar-files-section">'), html.indexOf('<div id="session-sidebar-files-body"'));
  return row.slice(row.indexOf('<div class="sidebar-files-keys"'));
}

/** Each key's name and state, in order. */
function keyLabels(markup) {
  return [...markup.matchAll(/<button type="button"( disabled="")? title="([^"]+)" aria-label="\2"( aria-pressed="(true|false)")?( aria-expanded="(true|false)" aria-controls="[^"]+")? class="[^"]+"/g)]
    .map((match) => `${match[2]}${match[1] ? " (disabled)" : ""}${match[4] ? ` pressed=${match[4]}` : ""}${match[6] ? ` expanded=${match[6]}` : ""}`);
}

/** A rule's declarations in app/sidebar.css (its first rule for the selector). */
function sidebarRule(selector) {
  const start = sidebarStyles.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} not found`);
  return sidebarStyles.slice(sidebarStyles.indexOf("{", start) + 1, sidebarStyles.indexOf("}", start));
}

function px(rule, property) {
  const match = rule.match(new RegExp(`(?:^|\\s)${property}: ([^;]+);`));
  assert.ok(match, `${property} not set`);
  return match[1].split(/\s+/).map((value) => Number.parseFloat(value));
}

/**
 * The files' right inset below the sessions (where the header row's keys and
 * the picker's boxes end) beside a session tree scrollbar this wide.
 */
function filesInsetRight(scrollbar) {
  const match = sidebarRule(".session-sidebar.is-files-below").match(/(?:^|\s)--sidebar-files-inset-right: max\((\d+)px, calc\(var\(--session-tree-scrollbar, 0px\) \+ (\d+)px\)\);/);
  assert.ok(match, "the files' right inset follows the session tree's scrollbar");
  return Math.max(Number(match[1]), scrollbar + Number(match[2]));
}

test("below the sessions the section's header row holds the files' keys in the files tab's order, the search last", () => {
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  const keys = sectionKeys(html);
  // A group of their own (the picker's names only the project and
  // worktree), in the files tab's order: the folder's actions, then the
  // tree's two views (what it lists, its changes), then the file search,
  // which the files tab leaves to the toolbar row. The search is the
  // files' (the toolbar row's is the sessions'), an expandable control,
  // not a toggle. Seven keys always there, so none ever moves.
  assert.match(keys, /^<div class="sidebar-files-keys" role="group" aria-label="File actions">/);
  assert.deepEqual(keyLabels(keys), [
    "Open workspace terminal",
    "Open in file manager",
    "Upload files to project root",
    "Refresh file list",
    "Show ignored files pressed=false",
    "0 changed files (disabled) pressed=false",
    "Search files expanded=false",
  ]);
  assert.equal((keys.match(/<button /g) ?? []).length, 7);
  // Their icons are 13px, a size under the files tab's 14px, in the sidebar
  // icons' one stroke (the files tab's keys keep 14px:
  // SessionSidebar.tabs.test.mjs).
  assert.deepEqual([...keys.matchAll(/<svg width="(\d+)" height="(\d+)"[^>]*stroke-width="(\d+)"/g)].map((match) => match.slice(1).join(",")), Array(7).fill("13,13,2"));
  // The head under the row is the picker alone: no second row of keys, no
  // search in the toolbar row's place.
  const head = html.slice(html.indexOf('<div class="sidebar-files-head">'), html.indexOf('<div class="sidebar-files-scroll'));
  assert.doesNotMatch(head, /sidebar-tool-button|sidebar-files-actions/);
  // Without a folder they wait, disabled, in the same places; so does the
  // terminal without a handler, where the files tab leaves it out.
  assert.deepEqual(keyLabels(sectionKeys(render())), [
    "Open workspace terminal (disabled)",
    "Open in file manager (disabled)",
    "Upload files to project root (disabled)",
    "Refresh file list (disabled)",
    "Show ignored files (disabled) pressed=false",
    "0 changed files (disabled) pressed=false",
    "Search files (disabled) expanded=false",
  ]);
  assert.deepEqual(keyLabels(sectionKeys(render({ selectedCwd: "/work/alpha" }))).slice(0, 3), [
    "Open workspace terminal (disabled)",
    "Open in file manager",
    "Upload files to project root",
  ]);

  // The keys share their group's width alike, 18 to 26px each. The group
  // never shrinks under its seven keys' minimum nor grows past their
  // maximum, and its grow factor, far above the toggle's (1), gives it the
  // room the toggle's content leaves before the toggle takes any.
  const keyRule = sidebarRule(".sidebar-files-keys .sidebar-tool-button");
  assert.match(keyRule, /(?:^|\s)flex: 1 1 0;/);
  const [keyMin] = px(keyRule, "min-width");
  const [keyMax] = px(keyRule, "max-width");
  const keysGroup = sidebarRule(".sidebar-files-keys").match(/(?:^|\s)flex: (\d+) 0 calc\((\d+) \* (\d+)px\);[\s\S]*?max-width: calc\((\d+) \* (\d+)px\);/);
  assert.ok(keysGroup, "the keys' group: a grow factor, no shrink, its keys' minimum and maximum");
  const [, groupGrow, minCount, groupKeyMin, maxCount, groupKeyMax] = keysGroup.map(Number);
  assert.ok(groupGrow >= 1000, "the toggle gets a fraction of a pixel until the keys are at their widest");
  assert.deepEqual([minCount, groupKeyMin, maxCount, groupKeyMax], [7, keyMin, 7, keyMax]);
  assert.match(sidebarRule(".sidebar-files-section-toggle"), /(?:^|\s)flex: 1 1 auto;/);

  // The fit, added up from the CSS: the sidebar's width less its line, the
  // row's padding (on the right the files' inset beside the session tree's
  // classic scrollbar, Chromium's 10px) and the gap before the keys; the
  // toggle's content in Chromium's 11px system font (its 5px on either
  // side, the 12px chevron, a 3px gap, the label, then a 3px gap and the
  // count): "Files" 34px, "文件" 24px, "· 123" 26px, "· 2" 14px.
  const [scrollbar] = px(globalStyles.slice(globalStyles.indexOf("::-webkit-scrollbar {")), "width");
  const right = filesInsetRight(scrollbar);
  const [, , , left] = px(sidebarRule(".sidebar-files-section"), "padding");
  const [gap] = px(sidebarRule(".sidebar-files-section"), "gap");
  const [toggleMin] = px(sidebarRule(".sidebar-files-section-toggle"), "min-width");
  const [, toggleInset] = px(sidebarRule(".sidebar-files-section-toggle"), "padding");
  assert.equal(toggleMin, toggleInset + 12, "the toggle keeps its chevron");
  const content = (label, count = 0) => 2 * toggleInset + 12 + 3 + label + (count ? 3 + count : 0);
  const fit = (width, toggleContent) => {
    const room = width - 1 - left - right - gap;
    const key = Math.min(keyMax, Math.max(keyMin, (room - toggleContent) / 7));
    return { key, toggle: room - 7 * key };
  };
  // At the default 260px the toggle keeps all of its content, the keys
  // wider than at their minimum: about 21px beside "Files · 123", 24px
  // beside "文件 · 2".
  const filesCount = fit(SIDEBAR_DEFAULT_WIDTH, content(34, 26));
  assert.ok(filesCount.key > keyMin && filesCount.toggle >= content(34, 26), `"Files · 123" leaves ${filesCount.key}px keys`);
  assert.ok(fit(SIDEBAR_DEFAULT_WIDTH, content(24, 14)).key >= 24);
  // From 300px they are at their widest, whatever the label and count.
  assert.equal(fit(300, content(34, 26)).key, keyMax);
  // At the sidebar's 180px minimum they are at their narrowest and nothing
  // overflows: the toggle keeps more than its chevron (what does not fit
  // in it wraps out of view, whole).
  const narrowest = fit(SIDEBAR_MIN_WIDTH, content(34, 26));
  assert.equal(narrowest.key, keyMin);
  assert.ok(narrowest.toggle >= toggleMin, `${toggleMin} + ${gap} + 7 × ${keyMin} fits ${SIDEBAR_MIN_WIDTH - 1 - left - right}`);
});

test("a key disabled under the focus hands it to the nearest key still enabled, the next one first", () => {
  const keys = ["terminal", "files", "changes", "search"].map((name) => ({ name, tagName: "BUTTON", disabled: false }));
  keys.forEach((key, index) => {
    key.previousElementSibling = keys[index - 1] ?? null;
    key.nextElementSibling = keys[index + 1] ?? null;
  });
  keys[2].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "search");
  keys[3].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "files", "the file search disabled too: the one before");
  keys[1].disabled = true;
  keys[0].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]), null, "none left: the caller falls back to the toolbar row's search");
  // Only buttons count.
  keys[3].disabled = false;
  keys[3].tagName = "DIV";
  assert.equal(nearestEnabledKey(keys[2]), null);
});

test("a key just disabled hands its focus on while the focus is still on it, or fell to the page, and never takes the user's", () => {
  const focused = [];
  const key = (name) => ({ name, tagName: "BUTTON", disabled: false, focus: (options) => focused.push([name, options]) });
  const keys = ["ignored", "changes", "search"].map(key);
  keys.forEach((item, index) => {
    item.previousElementSibling = keys[index - 1] ?? null;
    item.nextElementSibling = keys[index + 1] ?? null;
  });
  const [, changes] = keys;
  const fallback = key("toolbar search");
  const body = { name: "body" };
  changes.disabled = true;

  // Current Chromium: the disabled key keeps the focus until the next
  // rendering update, after the layout effect. That counts as lost.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0), [["search", { preventScroll: true }]]);
  // A browser that blurred it at once: the focus fell to the page (or nowhere).
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: null, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["search", "search"]);
  // Focus the user put elsewhere stays.
  const elsewhere = { name: "a session row" };
  assert.equal(handOffDisabledKeyFocus({ activeElement: elsewhere, body }, changes, fallback), false);
  assert.deepEqual(focused, []);
  // No key left enabled: the fallback, still on the key or from the page.
  keys.forEach((item) => { item.disabled = true; });
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["toolbar search", "toolbar search"]);
  // Nothing to hand it to: nothing moves.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, null), false);
  assert.deepEqual(focused, []);
});

test("below the sessions the picker is one row under the header row, lined up with it and with the session rows", () => {
  // The tree's first row 4px under the boxes: the head's 2px, none in the
  // scroll box, the tree's own 2px (FileExplorer's list).
  const belowHead = sidebarRule(".session-sidebar.is-files-below .sidebar-files-head");
  const [, , headBottom, headLeft] = px(belowHead, "padding");
  const [scrollTop] = px(sidebarRule(".session-sidebar.is-files-below .sidebar-files-scroll"), "padding-top");
  const treeTop = Number(explorerSource.match(/\(changesCollapsed \|\| gitFiles\.length === 0\) && \(!fileSearchOpen \|\| !hasSearchQuery\) && \(\s*<div style=\{\{ padding: "(\d+)px \d+px" \}\}>/)[1]);
  assert.equal(headBottom + scrollTop + treeTop, 4, "the tree's first row 4px under the boxes");
  // The paths start in the text column (the chevron column's 6px + 5px, the
  // 12px chevron, a 3px gap), after the box's 1px line and 10px padding.
  const [boxLine] = px(globalStyles.slice(globalStyles.indexOf("\n.project-picker-button {")), "border");
  const [, boxPadding] = px(globalStyles.slice(globalStyles.indexOf("\n.project-picker-button {")), "padding");
  const textColumn = 6 + 5 + 12 + 3;
  assert.equal(headLeft + boxLine + boxPadding, textColumn, "the paths in the text column");
  // The boxes end where the keys end and where a session row's time does,
  // whatever room the session tree's scrollbar takes (none for an overlay
  // one, 6px on a coarse pointer, 10px in Chromium, more elsewhere): a row
  // ends 6px in or on the scrollbar's gutter, its time 4px inside it.
  const treeInset = Number(sidebarStyles.match(/--session-tree-inset-right: max\(0px, calc\((\d+)px - var\(--session-tree-scrollbar, 0px\)\)\);/)[1]);
  const [, sessionRight] = px(sidebarRule(".session-tree-session"), "padding");
  for (const scrollbar of [0, 6, 10, 17]) {
    assert.equal(filesInsetRight(scrollbar), Math.max(treeInset, scrollbar) + sessionRight, `beside a ${scrollbar}px scrollbar`);
  }
});

test("the layout, the tab and the fold chosen last never change the first render, which matches the server's", () => {
  const serverHtml = render();
  const saved = {
    "pi-web:sidebar-files-placement": "tab",
    "pi-web:sidebar-tab": "files",
    "pi-web:sidebar-files-collapsed": "true",
    "pi-web:sidebar-groups-v2": JSON.stringify({ "/work/alpha": false }),
    "pi-web:sidebar-pins-collapsed": "true",
    "pi-web:sidebar-files-show-ignored": "true",
  };
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: (key) => saved[key] ?? null, setItem() {}, removeItem() {} },
  };
  let clientHtml;
  try {
    clientHtml = render();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  // The hydrating render must match the server's HTML: the files open below
  // the sessions, whatever the browser saved.
  assert.equal(clientHtml, serverHtml);
  assert.match(clientHtml, /^<div class="session-sidebar is-files-below" style="--sidebar-files-height:320px">/);
  assert.doesNotMatch(openingTag(clientHtml, "session-sidebar-panel-files"), /hidden/);
  assert.equal(openingTag(clientHtml, "session-sidebar-files-body"), '<div id="session-sidebar-files-body" class="sidebar-files-body">');
  assert.doesNotMatch(clientHtml, /role="tablist"/);
});

test("the files tab keeps FileExplorer mounted under an always-present scroll container", () => {
  assert.match(source, /<div ref=\{explorerScrollRef\} className="sidebar-files-scroll scrollbar-subtle">\s*\{explorerCwd && \(\s*<FileExplorer/);
  assert.match(source, /useScrollbarVisibility\(explorerScrollRef\);/);
  assert.match(source, /const explorerCwd = selectedCwd \?\? selectedCwdProp \?\? null;/);
  assert.match(source, /onOpenTerminal\?\.\(explorerCwd\)/);
  assert.match(sidebarStyles, /\.sidebar-files-scroll \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
});

test("arrow keys move between the tabs and the search toggle opens the sessions tab", () => {
  const keys = source.slice(source.indexOf("const handleTabKeyDown"), source.indexOf("// A session family's pin"));
  assert.match(keys, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight" && event\.key !== "Home" && event\.key !== "End"/);
  assert.match(keys, /switchTab\(next\);\s*\(next === "sessions" \? sessionsTabRef : filesTabRef\)\.current\?\.focus\(\);/);
  assert.match(source, /if \(!sessionsShown\) \{\s*switchTab\("sessions"\);\s*setSessionSearchOpen\(true\);\s*return;\s*\}/);
});

test("does not register row-level session deletion shortcuts", () => {
  for (const text of [source, treeSource]) {
    assert.doesNotMatch(text, /"Delete"|"Backspace"/);
  }
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("the running poll carries the pin and archive revision to the UI state", () => {
  assert.match(source, /sessionUiStateRevision\?: number \| null;/);
  assert.match(
    source,
    /setRunningSessionIds\(\(previous\) => sameIdsOr\(previous, data\.runningSessionIds \?\? \[\]\)\);[\s\S]*?noteUiRevision\(data\.sessionUiStateRevision\);[\s\S]*?\}, \[loadSessions, noteUiRevision\]\);/,
  );
  assert.match(source, /noteRevision: noteUiRevision,\s*\} = useSessionUiState\(\);/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = finishedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(treeSource, /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{running\}\)`\}/);
  assert.match(treeSource, /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{unread\}\)`\}/);
  // The files tab's project menu shows the group headers' own badge.
  assert.match(treeSource, /export function ActivitySummary\(/);
  assert.match(source, /projectActivity=\{projectActivity\}/);
});

test("project activity ignores archived families", () => {
  assert.match(
    source,
    /getProjectActivity\(\s*archiveIndex\.ids\.size === 0 \? allSessions : allSessions\.filter\(\(session\) => !archiveIndex\.ids\.has\(session\.id\)\),/,
  );
  assert.match(source, /if \(!isFamilyArchived\(family, uiState, runningSessionIds\)\) continue;\s*for \(const id of familyIds\(family\)\) ids\.add\(id\);/);
  assert.match(source, /archivedSessionIds=\{archiveIndex\.ids\}/);
});

test("search results of archived families are tagged, not hidden", () => {
  assert.match(searchSource, /archivedSessionIds\?: ReadonlySet<string>;/);
  assert.match(
    searchSource,
    /\{archivedSessionIds\?\.has\(session\.id\) && \(\s*<span className="[^"']*text-\[10px\][^"']*"?>\{t\("sidebar\.archived"\)\}<\/span>/,
  );
  // The whole family counts: a subagent hit of an archived session is tagged too.
  assert.match(source, /for \(const id of familyIds\(family\)\) ids\.add\(id\);/);
});

test("formats session timestamps with the active locale", () => {
  assert.match(treeSource, /import \{ formatRelativeTime, formatShortRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(treeSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(treeSource, /formatShortRelativeTime\(family\.latestModified, locale, nowDate\)/);
  assert.match(treeSource, /formatRelativeTime\(root\.modified, locale, nowDate\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  const body = callbackBody("commitRename");
  assert.match(body, /const title = sessionRowTitle\(session\);/);
  assert.match(
    body,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;[\s\S]*?method: "PATCH"[\s\S]*?void loadSessions\(\);/,
  );
});

test("right-click lets the downstream hook claim the row before the built-in menu opens", () => {
  const body = callbackBody("handleContextMenu");
  assert.match(body, /if \(session\.id === renamingRootId \|\| session\.id === confirmDeleteRootId\) return;/);
  assert.match(
    body,
    /if \(dispatchSessionRowContextMenu\(\{[\s\S]*?refresh: \(\) => \{ void loadSessions\(\); \},\s*\}\)\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*return;\s*\}/,
  );
  const dispatched = body.indexOf("dispatchSessionRowContextMenu(");
  const transient = body.indexOf("if (session.transient) return;");
  const builtIn = body.indexOf("openRowMenu(");
  assert.ok(dispatched < transient && transient < builtIn, "dispatch, then keep the native menu for a transient row, then the built-in menu");
  assert.ok(body.lastIndexOf("event.preventDefault();") > transient, "the native menu is suppressed only for the built-in one");
  assert.match(source, /onRowContextMenu: handleContextMenu,/);
  // Renaming and delete-confirm rows offer no context menu at all.
  assert.equal((treeSource.match(/onContextMenu=/g) ?? []).length, 1);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(callbackBody("openRowMenu"), /if \(row\.status\.transient\) return;/);
  assert.match(callbackBody("startRename"), /if \(family\.root\.transient\) return;/);
  assert.match(callbackBody("performDelete"), /if \(session\.transient\) return;/);
  assert.match(callbackBody("archiveFamilies"), /families\.filter\(\(family\) => !family\.root\.transient\)/);
  assert.match(treeSource, /\{!status\.transient && \(\s*<span className="session-tree-actions">/);
});

test("row clicks go through the list selection, which moves the cwd to the session's worktree", () => {
  assert.match(source, /const handleSelectFamily = useCallback\(\(family: SessionFamily\) => \{\s*handleSelectSessionFromList\(family\.root\);\s*\}, \[handleSelectSessionFromList\]\);/);
  assert.match(source, /onSelectFamily: handleSelectFamily,/);
  assert.match(callbackBody("handleSelectSessionFromList"), /if \(s\.cwd\) setSelectedCwd\(s\.cwd\);\s*onSelectSession\(s, false, entryId, blockIndex, options\);/);
  assert.match(source, /onSelectSession=\{handleSelectSessionFromList\}/);
  // Only the list selection and the initial URL restore select a session.
  assert.equal((source.match(/\bonSelectSession\(/g) ?? []).length, 2);
});

test("expanding, collapsing or paging a group never changes the cwd", () => {
  for (const name of ["handleToggleGroup", "handleShowMore", "handleShowLess", "handleTogglePinned", "setAllGroupsExpanded", "handleGroupMenu", "moveProject"]) {
    assert.doesNotMatch(callbackBody(name), /setSelectedCwd|onCwdChange/, `${name} must not switch projects`);
  }
  // "Show more" adds SHOW_MORE_STEP families a click; "show less" folds back.
  assert.match(callbackBody("handleShowMore"), /setMoreShown\(\(prev\) => showMoreFamilies\(prev, key, row\.nextShown\)\);/);
  assert.match(callbackBody("handleShowLess"), /setMoreShown\(\(prev\) => showLessFamilies\(prev, key\)\);/);
  assert.match(callbackBody("handleToggleGroup"), /const expanded = !isGroupExpanded\(project, shownGroupExpansion\);\s*if \(all\) \{\s*setAllGroupsExpanded\(\(\) => expanded\);\s*return;\s*\}[\s\S]*?delete next\[projectKey\];\s*next\[projectKey\] = expanded;\s*saveGroupChoices\(next, \[projectKey\]\);/);
  // Alt+click on a header: every group follows it.
  assert.match(treeSource, /onClick=\{\(event\) => handlers\.current\.onToggleGroup\(project\.key, event\.altKey\)\}/);
  assert.match(callbackBody("setAllGroupsExpanded"), /for \(const project of model\.projects\) \{\s*delete next\[project\.key\];\s*next\[project\.key\] = expanded\(project\);\s*\}/);
  // "Open in Files" of another project is the one deliberate switch from a group.
  assert.match(callbackBody("openProjectInFiles"), /if \(!project\.current\) setSelectedCwd\(project\.root\);[\s\S]*?revealFiles\("project-button"\);/);
});

test("a new session moves the cwd and hands the shell the target's project", () => {
  const body = callbackBody("startNewSessionIn");
  const identity = body.indexOf("setValidatedProject({ cwd, root: projectRoot, key: projectKey })");
  const cwd = body.indexOf("setSelectedCwd(cwd);");
  const handOff = body.indexOf("onNewSession?.(createTempSessionId(), cwd, projectKey, carryComposer ? { carryComposer: true } : undefined);");
  assert.ok(identity >= 0 && identity < cwd && cwd < handOff, "identity, then cwd, then the new session");
  // The header "+" keeps the sidebar's cwd and lets the shell keep its project.
  assert.match(callbackBody("handleNewSession"), /if \(!selectedCwd\) return;\s*startNewSessionIn\(\{ cwd: selectedCwd \}\);/);
  assert.match(source, /onNewSession\?: \(sessionId: string, cwd: string, projectKey\?: string \| null, options\?: NewSessionOptions\) => void;/);
});

test("a group's + starts a session at once, in the sidebar's worktree for the current project", async () => {
  const body = callbackBody("handleGroupNew");
  const helperSource = await readFile(new URL("../lib/new-session-context.ts", import.meta.url), "utf8");
  assert.match(body, /const handleGroupNew = useCallback\(\(project: SidebarProject\) => \{\s*setMenu\(null\);\s*startNewSessionIn\(newSessionTargetForProject\(project, selectedCwd\)\);\s*\}, \[selectedCwd, startNewSessionIn\]\);/);
  // The shared target helper (lib/new-session-context.ts): a group of the
  // sidebar's current project keeps the cwd the sidebar is in (a worktree);
  // any other group gets its root.
  assert.match(source, /startNewSessionIn\(newSessionTargetForProject\(project, selectedCwd\)\);/);
  assert.match(helperSource, /cwd: project\.current && selectedCwd \? selectedCwd : project\.root,/);
  assert.doesNotMatch(body, /fetch\(|\/api\/worktrees|kind: "worktrees"/);
  assert.match(source, /onGroupNew: handleGroupNew,/);
  // Nothing of the old worktree picker is left in the sidebar.
  assert.doesNotMatch(source, /pendingGroupKey|cancelGroupNew|groupNewRequestRef|needsWorktreePicker|WorktreeCreateForm|worktreeMenuItems|createWorktreeForSession|kind: "worktrees"|sidebar\.pickWorktree|activeGroupMenu|menuRef/);
});

test("the composer's bar moves through a handle made once, with the newest closures", () => {
  const handle = source.slice(source.indexOf("useImperativeHandle(controlRef"), source.indexOf("// Header \"+\""));
  assert.match(source, /const startNewSessionInRef = useRef\(startNewSessionIn\);\s*startNewSessionInRef\.current = startNewSessionIn;/);
  assert.match(handle, /startNewSessionIn: \(target\) => startNewSessionInRef\.current\(target\),/);
  assert.match(handle, /openFolderForNewSession: \(onPicked, returnFocusTo\) => \{\s*folderPickRef\.current = onPicked;\s*folderReturnFocusRef\.current = returnFocusTo;\s*setCustomPathError\(null\);\s*setCustomPathOpen\("new-session"\);/);
  // "Use default directory" validates today's folder like a picked one, for the bar.
  assert.match(handle, /openDefaultDirectoryForNewSession: \(onPicked\) => \{\s*folderPickRef\.current = onPicked;\s*folderReturnFocusRef\.current = null;\s*void handleDefaultCwdRef\.current\("new-session"\);/);
  assert.match(source, /const handleDefaultCwdRef = useRef\(handleDefaultCwd\);\s*handleDefaultCwdRef\.current = handleDefaultCwd;/);
  // The files tab's picker uses the same two: both are stable.
  assert.match(handle, /refreshWorktrees,\s*createWorktree,\s*\}\), \[createWorktree, refreshWorktrees\]\);\s*$/);
  assert.match(source, /const refreshWorktrees = useCallback\(\(\) => setWtRefreshKey\(\(k\) => k \+ 1\), \[\]\);/);
  // A created worktree is listed at once and refetched, whether or not anyone moves there.
  const create = callbackBody("createWorktree");
  assert.match(create, /body: JSON\.stringify\(\{ cwd: project\.root, branch \}\)/);
  assert.match(create, /if \(!res\.ok \|\| data\.error \|\| !data\.path\) \{\s*const failure = worktreeCreateFailure\(data, res\.status\);/);
  const listed = create.indexOf("prev.projectKey === project.key && !prev.worktrees.some((worktree) => worktree.path === path)");
  const refetch = create.indexOf("setWtRefreshKey((k) => k + 1);\n      return { path };");
  assert.ok(listed >= 0 && listed < refetch, "listed, then refetched, then handed back");
  assert.match(create, /return \{ error: e instanceof Error \? e\.message : String\(e\) \};\s*\}\s*\}, \[t\]\);/);
  assert.match(source, /controlRef\?: Ref<SessionSidebarControl>;/);
});

test("the composer's folder pick leaves the sidebar's cwd to the shell, and Cancel gives focus back", () => {
  const commit = callbackBody("commitCustomPath");
  assert.match(commit, /useCallback\(async \(candidate\?: string, \{ remember = true, purpose = customPathOpen \} = \{\}\) => \{/);
  const branch = commit.slice(commit.indexOf('if (purpose === "new-session") {'), commit.indexOf("setValidatedProject("));
  assert.match(branch, /const pick = folderPickRef\.current;[\s\S]*?folderPickRef\.current = null;[\s\S]*?pick\?\.\(\{ cwd: data\.cwd, projectKey: data\.projectKey, projectRoot: data\.projectRoot \}\);/);
  assert.match(branch, /focusAfterCommit\(\(\) => \(opener\?\.isConnected \? opener : null\)\);\s*return;/);
  assert.doesNotMatch(branch, /setSelectedCwd|setValidatedProject|startNewSessionIn/);
  assert.match(commit, /\}, \[customPathOpen, customPathValue, customPathValidating, focusAfterCommit\]\);/);
  assert.match(callbackBody("handleCustomPathClick"), /setCustomPathOpen\("files"\);/);
  const cancel = source.slice(source.indexOf("<DirectoryPicker"), source.indexOf("onSelect={(path) => void commitCustomPath(path)}"));
  assert.match(cancel, /const opener = customPathOpen === "new-session" \? folderReturnFocusRef\.current : null;\s*folderPickRef\.current = null;\s*folderReturnFocusRef\.current = null;/);
  assert.match(cancel, /if \(opener\) focusAfterCommit\(\(\) => \(opener\.isConnected \? opener : null\)\);/);
  // focusAfterCommit is declared before the callbacks that list it as a dependency.
  assert.ok(source.indexOf("const focusAfterCommit = useCallback") < source.indexOf("const commitCustomPath = useCallback"));
});

test("the bar hears of the sidebar's cwd only when something it shows changed", () => {
  const snapshot = source.slice(source.indexOf("const newSessionContext = useMemo"), source.indexOf("// Picking a session in another group makes its project current."));
  // Worktrees only where the files tab offers its switcher: the top of a git checkout.
  assert.match(snapshot, /const listed = showWorktreeSwitcher && worktreeState !== null;/);
  assert.match(snapshot, /worktrees: listed \? worktreeState\.worktrees\.map\(\(\{ path, branch, isMain \}\) => \(\{ path, branch, isMain \}\)\) : null,/);
  assert.match(snapshot, /currentWorktreePath: listed \? currentWorktreePath : null,/);
  assert.match(snapshot, /projects: projectChoiceList,/);
  // With the names the user gave projects, the bar's project too.
  assert.match(source, /const projectChoiceList = useMemo\(\s*\(\) => mergeProjectChoices\(model\.projects, recentProjects, projectNames\),\s*\[model\.projects, recentProjects, projectNames\],\s*\);/);
  assert.match(snapshot, /project: withProjectAlias\(selectedProject, projectNames\),/);
  assert.match(snapshot, /const newSessionContextSignature = newSessionContextKey\(newSessionContext\);/);
  assert.match(snapshot, /useEffect\(\(\) => \{\s*onNewSessionContextChange\?\.\(newSessionContextRef\.current\);\s*\}, \[newSessionContextSignature, onNewSessionContextChange\]\);/);
});

test("archive keeps an undo snapshot and clears unread markers", () => {
  const body = callbackBody("archiveFamilies");
  const snapshot = body.indexOf("const snapshot = snapshotUiState(archivable.map((family) => family.root.id));");
  const apply = body.indexOf('void applyUiState({ action: "set", ids, archived: true })');
  assert.ok(snapshot >= 0 && snapshot < apply, "the snapshot is taken before the change");
  assert.match(body, /for \(const id of memberIds\) next\.delete\(id\);/);
  // More families than one request may carry go in parts, and so does their Undo.
  assert.match(body, /for \(const part of chunkForSessionUiRequests\(archivable\)\) \{\s*const ids = part\.map\(\(family\) => family\.root\.id\);\s*void applyUiState\(\{ action: "set", ids, archived: true \}\)/);
  assert.match(body, /label: t\("sidebar\.undo"\),[\s\S]*?for \(const entries of chunkForSessionUiRequests\(snapshot\)\) \{\s*void applyUiState\(\{ action: "restore", entries \}\);\s*\}\s*restoreUnread\(unreadBefore\);/);
  assert.doesNotMatch(body, /const ids = archivable\.map|entries: snapshot \}/, "never one request for every family");
  // A refused part rolls back, and its unread markers come back with it.
  assert.match(body, /\.then\(\(ok\) => \{\s*\/\/[^\n]*\n\s*if \(ok \|\| unreadBefore\.length === 0\) return;\s*const partIds = new Set\(part\.flatMap\(\(family\) => familyIds\(family\)\)\);\s*restoreUnread\(unreadBefore\.filter\(\(id\) => partIds\.has\(id\)\)\);/);
  // The session open by then has been read: its marker stays off.
  assert.match(callbackBody("restoreUnread"), /if \(id !== selectedSessionIdRef\.current\) next\.add\(id\);/);
  assert.match(body, /\{ id: "view", label: t\("sidebar\.viewArchive"\), onClick: \(\) => openArchiveView\(\) \},/);
  assert.match(callbackBody("archiveFamily"), /if \(familyIds\(family\)\.some\(\(id\) => runningSessionIds\.has\(id\)\)\) return;/);
  assert.match(callbackBody("restoreFamily"), /useCallback\(\(family: SessionFamily\) => restoreFamilies\(\[family\]\), \[restoreFamilies\]\)/);
  // A restore is batched the same way, and its Undo puts focus back in the tree.
  assert.match(callbackBody("restoreFamilies"), /for \(const part of chunkForSessionUiRequests\(ids\)\) \{\s*void applyUiState\(\{ action: "set", ids: part, archived: false \}\);\s*\}[\s\S]*?t\("sidebar\.restoredToast"/);
  // A refused save is reported once per failure.
  assert.match(callbackBody("applyUiState"), /if \(!ok\) setUiWriteFailures\(\(count\) => count \+ 1\);/);
  assert.match(source, /showToast\(t\("sidebar\.uiStateFailed", \{ error: uiStateError \?\? "" \}\)\);/);
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  // dev's two-phase listing keeps its summary URL; force and plain fetches are main's.
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1";\s*if \(force\) return "\/api\/sessions\?force=1";\s*return "\/api\/sessions";/);
  assert.match(source, /cache: "no-store"/);
  // First paint takes the summary listing; the dev hydration pass fills exact counts in later.
  assert.match(source, /if \(isFirst\) \{\s*\/\/ Header\/stat metadata/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("a cwd prop that went away and came back still moves the sidebar", () => {
  const sync = source.slice(source.indexOf("const lastSyncedCwdPropRef"), source.indexOf("// Load worktrees for the current effective cwd"));
  assert.match(sync, /if \(!selectedCwdProp\) \{\s*lastSyncedCwdPropRef\.current = null;\s*return;\s*\}/);
  assert.match(sync, /if \(selectedCwdProp !== lastSyncedCwdPropRef\.current\) \{\s*lastSyncedCwdPropRef\.current = selectedCwdProp;\s*setSelectedCwd\(selectedCwdProp\);/);
});

test("the footer opens the project list in the files tab; the archive view replaces the tree", () => {
  const footer = source.slice(source.indexOf("const handleOpenOtherProject"), source.indexOf("const sessionMenuItems"));
  // The reveal request: the files view shows, then its project menu opens.
  assert.match(footer, /const handleOpenOtherProject = \(\) => \{\s*revealFiles\("project-list"\);\s*\};/);
  // Once the tab shows, the picker's project menu opens below its button.
  assert.match(footer, /if \(target === "project-list"\) filesPickerRef\.current\?\.openMenu\("project"\);/);
  assert.match(source, /onOpenOtherProject: handleOpenOtherProject,/);
  assert.match(source, /onOpenArchive: \(\) => openArchiveView\(\),/);
  assert.match(callbackBody("openArchiveView"), /setArchiveView\(true\);[\s\S]*?setSessionSearchOpen\(false\);\s*switchTab\("sessions"\);/);
  assert.match(source, /<div className="sidebar-sessions-view" hidden=\{archiveMotion\.mainHidden\} inert=\{archiveMotion\.mainInert\}>\s*<SessionTree\s+\{\.\.\.treeProps\}\s+rows=\{model\.rows\}\s+emptyLabel=\{t\("sidebar\.noSessions"\)\}\s+reveal=\{treeReveal\}\s+onRevealHandled=\{handleRevealHandled\}\s+\/>/);
  assert.match(source, /<SessionTree\s+\{\.\.\.treeProps\}\s+rows=\{archiveRows\}\s+emptyLabel=\{t\("sidebar\.noArchived"\)\}\s+reveal=\{archiveReveal\}\s+onRevealHandled=\{handleArchiveRevealHandled\}\s+\/>/);
  assert.match(source, /const sessionMenuItems = \(row: SessionRow\): SidebarMenuItem\[\] => sessionMenuEntries\(row\.context, row\.status\)\.map\(\(entry, index\) => \{/);
  assert.match(callbackBody("handleTogglePinned"), /setPinnedCollapsed\(next\);\s*savePinnedCollapsed\(next\);/);
});

test("the files tab shows the composer bar's picker as two rows, with removal and activity", () => {
  // The picker moved into the files tab's head: the same instance as the
  // composer bar's, laid out side by side when there is room (row) and
  // stacked in the tab. Its worktree box carries removal and the project
  // menu carries activity badges.
  const filesHead = source.slice(source.indexOf('className="sidebar-files-head"'), source.indexOf('className="sidebar-files-actions"'));
  assert.match(filesHead, /<ProjectWorktreePicker\n\s*handleRef=\{filesPickerRef\}/);
  assert.match(filesHead, /layout=\{stacked \? "row" : "stacked"\}/);
  assert.match(filesHead, /projectActivity=\{projectActivity\}/);
  assert.match(filesHead, /onRemoveWorktree=\{handleRemoveWorktree\}/);
  // The keys under the picker stay in place; the actions row only renders
  // beside the picker when the layout has room for it.
  assert.match(source, /\{!stacked && explorerCwd && \(\n\s*<div className="sidebar-files-actions"/);
});

test("the files show the composer bar's picker in the tab head, asking for a project until it has one", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  const filesPanel = html.slice(html.indexOf('id="session-sidebar-panel-files"'));
  // Before the sidebar has a cwd: the picker's project box asks for one.
  assert.match(filesPanel, /aria-haspopup="menu"[^>]*>/);
  assert.match(filesPanel, /Select project…<\/span>/);
});

test("the running poll keeps the same Set while the running ids stay the same", () => {
  const previous = new Set(["a", "b"]);
  assert.equal(sameIdsOr(previous, ["b", "a"]), previous);
  assert.equal(sameIdsOr(previous, ["a", "b", "b"]), previous);
  assert.deepEqual([...sameIdsOr(previous, ["a"])], ["a"]);
  assert.deepEqual([...sameIdsOr(previous, ["a", "c"])], ["a", "c"]);
  const empty = new Set();
  assert.equal(sameIdsOr(empty, []), empty);
});

test("a read or a mark in another tab reaches this one: the storage handler adopts that tab's write", () => {
  const parse = between("function parseUnreadSessionIds(", "\nfunction loadUnreadSessionIds");
  const handler = between("const onStorage = (event: StorageEvent) => {", '\n    window.addEventListener("storage", onStorage);');
  const code = ts.transpileModule(`${parse}\n${handler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const updaters = [];
  const onStorage = vm.runInNewContext(`${code}\nonStorage`, {
    UNREAD_SESSIONS_STORAGE_KEY: "pi-web:unread-session-ids",
    sameIdsOr,
    setUnreadSessionIds: (updater) => updaters.push(updater),
  });

  // Another key's write never touches the unread markers.
  onStorage({ key: "pi-web:terminal-theme", newValue: '["a"]' });
  assert.equal(updaters.length, 0);

  // The other tab read the session: the key (or all of storage) went away.
  onStorage({ key: "pi-web:unread-session-ids", newValue: null });
  assert.deepEqual([...updaters.pop()(new Set(["a", "b"]))], []);

  // The other tab wrote a newer set; it replaces this tab's, stale markers and all.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '["a","b","b","c"]' });
  assert.deepEqual([...updaters.pop()(new Set(["a", "d"]))].sort(), ["a", "b", "c"]);

  // The same set keeps the same Set: no re-render, so no echo of the write back.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '["a"]' });
  const unchanged = new Set(["a"]);
  assert.equal(updaters.pop()(unchanged), unchanged);

  // A malformed write means no markers, not a crash.
  onStorage({ key: "pi-web:unread-session-ids", newValue: "{not json" });
  assert.deepEqual([...updaters.pop()(new Set(["a"]))], []);

  // The listener is registered for the storage event and taken off again.
  assert.match(source, /window\.addEventListener\("storage", onStorage\);/);
  assert.match(source, /window\.removeEventListener\("storage", onStorage\);/);
});

test("active-session rows show live status, message count and time", () => {
  // The active-session list moved out of the sidebar into the keep-alive dock;
  // the assertions follow the code there.
  assert.match(dockSource, /const info = sessions\.find\(\(session\) => session\.id === slot\.session\.id\) \?\? slot\.session;/);
  assert.match(dockSource, /keepalive\.statusRunning/);
  assert.match(dockSource, /keepalive\.statusDone/);
  assert.match(dockSource, /t\("sidebar\.messagesCount", \{ count: info\.messageCount \}\)/);
  assert.match(dockSource, /formatRelativeTime\(info\.modified, locale\)/);
  // Tail-first clipping, same as the project rows: the head gets the ellipsis,
  // the specific tail stays readable.
  assert.match(dockSource, /<PathLabel\n?\s*text=\{info\.cwd\}/s);
});
