import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionTree, sessionRowTitle } = await jiti.import("./SessionTree.tsx");
const { buildSessionTree, SIDEBAR_ROW_HEIGHTS } = await jiti.import("@/lib/session-tree.ts");
const source = await readFile(new URL("./SessionTree.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");
const buttonSource = await readFile(new URL("./ui/button.tsx", import.meta.url), "utf8");

const h = React.createElement;
const MINUTE = 60_000;
const NOW = Date.now();

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n");
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
}

const noop = () => {};
const defaults = {
  rows: [],
  layout: "desktop",
  emptyLabel: null,
  loading: false,
  error: null,
  renamingRootId: null,
  confirmDeleteRootId: null,
  activeMenuRowKey: null,
  onSelectFamily: noop,
  onToggleGroup: noop,
  onShowMore: noop,
  onShowLess: noop,
  onTogglePinned: noop,
  onArchiveFamily: noop,
  onRestoreFamily: noop,
  onOpenRowMenu: noop,
  onRowContextMenu: noop,
  onRenameCommit: noop,
  onRenameCancel: noop,
  onDeleteConfirm: noop,
  onDeleteCancel: noop,
  onGroupNew: noop,
  onGroupMenu: noop,
  onPinEmptyGroup: noop,
  onOpenOtherProject: noop,
  onOpenArchive: noop,
};

function render(props) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(SessionTree, { ...defaults, ...props }))));
}

/** The markup of one rendered row, from its opening tag to the next row. */
function rowMarkup(html, key) {
  const part = html.split(/(?=<div class="session-tree-row )/).find((chunk) => chunk.includes(`data-row-key="${key}"`));
  assert.ok(part, `row ${key} not rendered`);
  return part;
}

function renderedKeys(html) {
  return [...html.matchAll(/data-row-key="([^"]+)"/g)].map((match) => match[1]);
}

function session(id, extra = {}) {
  const modified = new Date(NOW - 5 * MINUTE).toISOString();
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/work/app",
    projectRoot: "/work/app",
    projectKey: "/work/app",
    created: modified,
    modified,
    messageCount: 3,
    firstMessage: `first ${id}`,
    ...extra,
  };
}

const project = { key: "/work/app", root: "/work/app", name: "app", pinned: false, current: true };

function sessionRow(root, { context = "group", status = {}, rowProject = project } = {}) {
  return {
    kind: "session",
    key: `session:${context}:${root.id}`,
    family: { root, subagents: [], latestModified: root.modified },
    context,
    project: rowProject,
    status: { running: false, awaiting: false, unread: false, selected: false, transient: false, ...status },
  };
}

function groupRow(extra = {}, projectExtra = {}) {
  const groupProject = { ...project, ...projectExtra };
  return { kind: "group", key: `group:${groupProject.key}`, project: groupProject, expanded: true, running: 0, awaiting: 0, unread: 0, ...extra };
}

const footer = [{ kind: "footer-open", key: "footer-open" }];

test("the pinned header toggles the section and shows activity dots only while collapsed", () => {
  const collapsed = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 3, collapsed: true, running: 1, awaiting: 0, unread: 2 }],
  }), "pinned-header");
  // A group header's height: both are section headers.
  assert.match(collapsed, /^<div class="session-tree-row session-tree-pinned-header[^"]*" style="top:0;height:28px" data-row-key="pinned-header">/);
  assert.match(collapsed, /<button [^>]*class="[^"]*session-tree-pinned-toggle[^"]*"[^>]*aria-expanded="false">/);
  // Its chevron leads, in the chevron column, decoration only; no pin icon.
  assert.match(collapsed, /aria-expanded="false"><svg[^>]*width="12" height="12"[^>]*stroke-width="3"[^>]*aria-hidden="true">[\s\S]*?<\/svg><span class="[^"]*session-tree-pinned-label[^"]*">Pinned<\/span><span class="[^"]*session-tree-pinned-count[^"]*">· 3<\/span><span class="[^"]*session-tree-pinned-dot is-running[^"]*"/);
  assert.doesNotMatch(collapsed, /session-tree-group-icon/);
  assert.match(collapsed, /class="[^"]*session-tree-pinned-dot is-running[^"]*" role="img" title="Agent running…" aria-label="Agent running… \(1\)"/);
  assert.match(collapsed, /class="[^"]*session-tree-pinned-dot is-unread[^"]*" role="img" title="New session activity" aria-label="New session activity \(2\)"/);
  assert.doesNotMatch(collapsed, /session-tree-pinned-dot is-awaiting/);
  assert.doesNotMatch(collapsed, /rotate-90/);

  const expanded = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 3, collapsed: false, running: 1, awaiting: 1, unread: 2 }],
  }), "pinned-header");
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /rotate-90/);
  assert.doesNotMatch(expanded, /session-tree-pinned-dot/);
});

test("a collapsed pinned header shows an awaiting dot of its own, without the running one", () => {
  const collapsed = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 2, collapsed: true, running: 0, awaiting: 2, unread: 0 }],
  }), "pinned-header");
  assert.match(collapsed, /class="[^"]*session-tree-pinned-dot is-awaiting[^"]*" role="img" title="Agent waiting for your input" aria-label="Agent waiting for your input \(2\)"/);
  assert.doesNotMatch(collapsed, /session-tree-pinned-dot is-running/);
});

test("a collapsed group shows awaiting families apart from running ones", () => {
  const mixed = rowMarkup(render({ rows: [groupRow({ expanded: false, running: 1, awaiting: 2, unread: 0 })] }), "group:/work/app");
  assert.match(mixed, /aria-label="Agent running… \(1\)"/);
  assert.match(mixed, /<span class="[^"]*session-tree-summary-awaiting[^"]*" role="img" title="Agent waiting for your input" aria-label="Agent waiting for your input \(2\)"><span class="[^"]*session-tree-summary-dot[^"]*"><\/span>2<\/span>/);

  // Only awaiting: the amber count, no spinner.
  const awaiting = rowMarkup(render({ rows: [groupRow({ expanded: false, running: 0, awaiting: 1, unread: 0 })] }), "group:/work/app");
  assert.match(awaiting, /session-tree-summary-awaiting/);
  assert.doesNotMatch(awaiting, /session-tree-summary-running/);
  assert.doesNotMatch(awaiting, /sidebar-spin/);
});

test("a collapsed group shows its running and unread counts and labelled actions", () => {
  const html = rowMarkup(render({
    rows: [groupRow({ expanded: false, running: 2, unread: 1 }, { pinned: true, current: false })],
  }), "group:/work/app");
  assert.match(html, /^<div class="session-tree-row session-tree-group[^"]*" style="top:0;height:34px"/);
  assert.match(html, /<button [^>]*class="[^"]*session-tree-group-toggle[^"]*"[^>]*aria-expanded="false" title="\/work\/app">/);
  // The chevron leads, inside the toggle (the whole header still toggles)
  // and hidden from its accessible name; then the name, its pin, the summary.
  assert.match(html, /title="\/work\/app"><svg[^>]*width="12" height="12"[^>]*stroke-width="3"[^>]*aria-hidden="true"><path[^>]*><\/path><\/svg><span class="[^"]*session-tree-group-name[^"]*">app<\/span>/, "the chevron precedes the name");
  assert.match(html, /<span class="[^"]*session-tree-group-name[^"]*">app<\/span><svg[^>]*class="lucide[^"]*"[\s\S]*?<\/svg><span class="[^"]*session-tree-summary[^"]*">/);
  // No folder: a project group is no second file tree.
  assert.doesNotMatch(html, /session-tree-group-icon/);
  assert.match(html, /<svg[^>]*class="lucide[^"]*" role="img" aria-label="Pinned"/);
  assert.match(html, /aria-label="Agent running… \(2\)"/);
  assert.match(html, /aria-label="New session activity \(1\)"/);
  assert.match(html, /aria-label="New session in app" title="New session in app"/);
  assert.match(html, /aria-label="app actions" title="app actions" aria-haspopup="menu" aria-expanded="false"/);

  const expanded = rowMarkup(render({ rows: [groupRow({ expanded: true, running: 2, unread: 1 })] }), "group:/work/app");
  assert.match(expanded, /session-tree-group[^"]*is-current/);
  assert.match(expanded, /aria-expanded="true" title="\/work\/app"/);
  assert.doesNotMatch(expanded, /session-tree-summary/);
  assert.doesNotMatch(expanded, /lucide lucide-pin/);
});

test("a group's ⋯ shows its open menu; its + starts a session at once", () => {
  const more = rowMarkup(render({ rows: [groupRow()], activeMenuRowKey: "group:/work/app" }), "group:/work/app");
  assert.match(more, /session-tree-group[^"]*is-current is-active/);
  assert.match(more, /class="[^"]*session-tree-group-action[^"]*is-active[^"]*"[^>]*aria-label="app actions"[^>]*aria-expanded="true"/);

  // The + opens nothing and never waits: no popup, busy or disabled state.
  const plus = rowMarkup(render({ rows: [groupRow()] }), "group:/work/app").match(/<button[^>]*aria-label="New session in app"[^>]*>/)[0];
  assert.match(plus, /class="[^"]*session-tree-group-action[^"]*"[^>]*aria-label="New session in app" title="New session in app">$/);
});

test("an idle session row shows its short time, branch and both actions", () => {
  const root = session("idle", { isWorktree: true, branch: "feat/rows" });
  const html = rowMarkup(render({ rows: [sessionRow(root)] }), "session:group:idle");
  assert.match(html, /^<div class="session-tree-row session-tree-session[^"]*is-child[^"]*" style="top:0;height:32px" data-row-key="session:group:idle">/);
  // Nothing before the title: it gets the room; the time sits at the right.
  // A saved session's title is a real link to it (middle-click, Ctrl/Cmd-click).
  // The branch keeps the upstream icon and type; the tooltip keeps the ⑂ glyph.
  assert.match(html, /<a class="[^"]*session-tree-main[^"]*" href="\?session=idle" title="[^"]*"><span class="[^"]*session-tree-title[^"]*">first idle<\/span><span class="max-w-\[78px\][^"]*"><svg[^>]*width="10" height="10"[^>]*aria-hidden="true">[\s\S]*?<\/svg>feat\/rows<\/span><span class="[^"]*min-w-\[26px\][^"]*">5m<\/span><\/a>/);
  assert.match(html, /title="first idle\n3 msgs · 5 minutes ago · ⑂ feat\/rows"/);
  assert.match(html, /class="[^"]*session-tree-action session-tree-quick-action[^"]*"[^>]*aria-label="Archive" title="Archive"/);
  assert.match(html, /class="[^"]*session-tree-action session-tree-more-action[^"]*"[^>]*aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(html, /aria-current/);
});

test("a branch chip needs a linked worktree", () => {
  const html = render({ rows: [sessionRow(session("main", { branch: "main" }))] });
  assert.doesNotMatch(html, /git-branch/);
  assert.doesNotMatch(html, /⑂/);
});

test("a fork's row keeps its name's suffix in view; other titles stay one span", () => {
  const fork = { kind: "fork", originSessionId: "src" };
  const named = rowMarkup(render({ rows: [sessionRow(session("copy", { name: "PR#1030 状态栏命令按钮 · 3f9a", relation: fork }))] }), "session:group:copy");
  assert.match(named, /<span class="[^"]*session-tree-title[^"]*has-fork-suffix[^"]*"><span class="min-w-0 truncate">PR#1030 状态栏命令按钮<\/span><span class="shrink-0 whitespace-pre"> · 3f9a<\/span><\/span><span class="[^"]*min-w-\[26px\][^"]*">/);
  assert.match(named, /title="PR#1030 状态栏命令按钮 · 3f9a\n/, "the tooltip has the whole name");
  // Not a fork, no suffix, or no name: the title is cut as a whole.
  for (const extra of [
    { name: "Weekly sync · 2024" },
    { name: "Plan · beta", relation: fork },
    { firstMessage: "ask · 3f9a", relation: fork },
  ]) {
    const html = render({ rows: [sessionRow(session("other", extra))] });
    assert.doesNotMatch(html, /has-fork-suffix|whitespace-pre/);
    assert.match(html, /<span class="[^"]*session-tree-title[^"]*">[^<]+<\/span>/);
  }
});

test("a running row shows the labelled breathing dot and cannot be archived from the row", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("run"), { status: { running: true, unread: true } })] }), "session:group:run");
  // The dot takes the time's place at the right, and the row says it is running.
  assert.match(html, /class="session-tree-row session-tree-session[^"]*is-running[^"]*"/);
  assert.match(html, /<span class="[^"]*session-tree-title[^"]*">first run<\/span><span class="[^"]*text-accent[^"]*" title="Agent running…"><span class="relative size-1\.5[^"]*bg-success[^"]*" role="img" aria-label="Agent running…" aria-hidden="false"><\/span><\/span>/);
  assert.doesNotMatch(html, /session-tree-slot/);
  assert.doesNotMatch(html, /session-tree-unread/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /aria-label="More actions"/);
});

test("an unread row shows the labelled unread dot", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("new"), { status: { unread: true } })] }), "session:group:new");
  assert.match(html, /<span class="[^"]*" title="New activity"><span class="relative size-1\.5[^"]*bg-accent[^"]*" role="img" aria-label="New session activity"><\/span><\/span>/);
});

test("an awaiting row shows the amber dot in the spinner's slot", () => {
  const html = rowMarkup(render({
    rows: [sessionRow(session("ask"), { status: { running: true, awaiting: true, unread: true } })],
  }), "session:group:ask");
  // Awaiting wins the slot (it is the one thing worth knowing), and the row is
  // still the running row it is: same class, same actions, no archive button.
  assert.match(html, /class="session-tree-row session-tree-session[^"]*is-running[^"]*"/);
  assert.match(html, /<span class="[^"]*session-tree-title[^"]*">first ask<\/span><span class="[^"]*" title="Agent waiting for your input"><span class="session-tree-awaiting" role="img" aria-label="Agent waiting for your input"><\/span><\/span>/);
  assert.doesNotMatch(html, /sidebar-spin/);
  assert.doesNotMatch(html, /session-tree-unread/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /aria-label="More actions"/);
});

test("the selected row is marked and its menu button reports an open menu", () => {
  const row = sessionRow(session("sel"), { status: { selected: true } });
  const html = rowMarkup(render({ rows: [row], activeMenuRowKey: row.key }), row.key);
  assert.match(html, /class="session-tree-row session-tree-session[^"]*is-selected[^"]*is-menu-open[^"]*"/);
  assert.match(html, /<a class="[^"]*session-tree-main[^"]*" href="\?session=sel" title="[^"]*" aria-current="true">/);
  assert.match(html, /class="[^"]*session-tree-action session-tree-more-action[^"]*is-active[^"]*"[^>]*aria-expanded="true"/);
});

test("a transient row offers no actions at all", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("tmp"), { status: { transient: true } })] }), "session:group:tmp");
  assert.doesNotMatch(html, /session-tree-actions/);
  assert.doesNotMatch(html, /More actions/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /session-tree-title[^"]*">first tmp</);
  // No file yet, so no link another tab could not load: still a button.
  assert.match(html, /<button [^>]*class="[^"]*session-tree-main[^"]*"[^>]*title="[^"]*"><span class="[^"]*session-tree-title[^"]*">first tmp<\/span>/);
  assert.doesNotMatch(html, /<a |href=/);
  const selected = rowMarkup(render({ rows: [sessionRow(session("tmp"), { status: { transient: true, selected: true } })] }), "session:group:tmp");
  assert.match(selected, /<button [^>]*class="[^"]*session-tree-main[^"]*"[^>]*title="[^"]*" aria-current="true">/);
});

test("every saved row's title links to its session, encoded, in every context and state", () => {
  const cases = [
    [sessionRow(session("a/b?c&d #%")), "?session=a%2Fb%3Fc%26d%20%23%25"],
    [sessionRow(session("pin"), { context: "pinned" }), "?session=pin"],
    [sessionRow(session("old"), { context: "archive" }), "?session=old"],
    [sessionRow(session("run"), { status: { running: true } }), "?session=run"],
    [sessionRow(session("ask"), { status: { running: true, awaiting: true } }), "?session=ask"],
    [sessionRow(session("new"), { status: { unread: true } }), "?session=new"],
  ];
  for (const [row, href] of cases) {
    const html = rowMarkup(render({ rows: [row] }), row.key);
    const link = html.match(/<a [^>]*>/)?.[0] ?? "";
    assert.equal(link.match(/href="([^"]*)"/)?.[1], href, row.key);
    assert.match(link, /^<a class="[^"]*session-tree-main[^"]*" href=/, row.key);
    // Never target: a plain click would leave this tab too.
    assert.doesNotMatch(link, /target=|rel=/, row.key);
    // The link holds the title, branch and meta only; the row's buttons stay outside it.
    const inside = html.slice(html.indexOf(link), html.indexOf("</a>"));
    assert.doesNotMatch(inside, /<button|<a [\s\S]*<a /, `${row.key}: no control nested in the link`);
    assert.match(html, /<\/a>(<span class="[^"]*session-tree-actions[^"]*">|<\/div>)/, row.key);
  }
  // A fork's two-span title sits inside the link the same way.
  const fork = rowMarkup(render({ rows: [sessionRow(session("copy", { name: "Plan · 3f9a", relation: { kind: "fork", originSessionId: "src" } }))] }), "session:group:copy");
  assert.match(fork, /<a class="[^"]*session-tree-main[^"]*" href="\?session=copy" title="[^"]*"><span class="[^"]*session-tree-title[^"]*has-fork-suffix[^"]*">/);
  // Rename and delete-confirm rows have no link.
  assert.doesNotMatch(rowMarkup(render({ rows: [sessionRow(session("r"))], renamingRootId: "r" }), "session:group:r"), /<a /);
  assert.doesNotMatch(rowMarkup(render({ rows: [sessionRow(session("d"))], confirmDeleteRootId: "d" }), "session:group:d"), /<a /);
});

test("pinned rows name their project and archived rows offer restore with the family's time", () => {
  const pinned = rowMarkup(render({ rows: [sessionRow(session("pin"), { context: "pinned" })] }), "session:pinned:pin");
  assert.match(pinned, /<span class="[^"]*min-w-\[26px\][^"]*"><span class="inline-block max-w-\[70px\][^"]*">app<\/span><\/span>/);
  assert.match(pinned, /aria-label="Archive"/);

  // Never the archive time: a session whose last message was two hours ago
  // says 2h however recently it was archived (#1351).
  const archived = rowMarkup(render({
    rows: [sessionRow(session("old", { modified: new Date(NOW - 2 * 60 * MINUTE).toISOString() }), { context: "archive" })],
  }), "session:archive:old");
  assert.match(archived, /class="session-tree-row session-tree-session[^"]*is-archived[^"]*"/);
  assert.doesNotMatch(archived, /session-tree-slot/);
  assert.match(archived, /<span class="[^"]*min-w-\[26px\][^"]*">2h<\/span>/);
  assert.match(archived, /aria-label="Restore" title="Restore"/);
  assert.doesNotMatch(archived, /aria-label="Archive"/);
});

test("the phone layout uses tall rows, keeps ⋯ and drops the archive quick button", () => {
  const html = render({ layout: "mobile", rows: [groupRow(), sessionRow(session("m"))] });
  assert.match(html, /^<div class="session-tree[^"]*is-mobile[^"]*">/);
  assert.match(rowMarkup(html, "group:/work/app"), /style="top:0;height:40px"/);
  const row = rowMarkup(html, "session:group:m");
  assert.match(row, /style="top:40px;height:40px"/);
  assert.match(row, /aria-label="More actions"/);
  assert.doesNotMatch(row, /aria-label="Archive"/);
});

test("a summary row without details shows an ellipsis instead of a message count", () => {
  const html = render({ rows: [sessionRow(session("p", { detailsPending: true, name: "Named" }))] });
  assert.match(html, /title="Named\n… · 5 minutes ago"/);
});

test("rename mode swaps the row for a field seeded with the title", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("r", { name: "Old name" }))], renamingRootId: "r" }), "session:group:r");
  assert.match(html, /class="session-tree-row session-tree-session[^"]*is-renaming[^"]*"/);
  assert.match(html, /<input data-slot="input" class="[^"]*session-tree-rename[^"]*" aria-label="Rename" value="Old name"\/>/);
  assert.doesNotMatch(html, /session-tree-actions/);
});

test("a named project shows its name as plain text in its header, the path as the tooltip", () => {
  const named = { name: "Thermal <b>Models</b>", customName: "Thermal <b>Models</b>" };
  const raw = renderToStaticMarkup(h(I18nProvider, null, h(SessionTree, { ...defaults, rows: [groupRow({}, named)] })));
  assert.match(raw, /title="\/work\/app"><svg[^>]*class="lucide[^"]*rotate-90[^"]*"[\s\S]*?<\/svg><span class="[^"]*session-tree-group-name[^"]*">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span>/);
  assert.doesNotMatch(raw, /<b>/, "never markup");
  const html = render({ rows: [groupRow({}, named)] });
  assert.match(html, /aria-label="New session in Thermal <b>Models<\/b>"/);
  assert.match(html, /aria-label="Thermal <b>Models<\/b> actions"/);
});

test("a project's rename swaps its header for a name field seeded with the name shown", () => {
  const html = rowMarkup(render({ rows: [groupRow({}, { name: "Thermal Models", customName: "Thermal Models" })], renamingProjectKey: "/work/app" }), "group:/work/app");
  assert.match(html, /^<div class="session-tree-row session-tree-group[^"]*is-current is-renaming[^"]*" style="top:0;height:34px" data-row-key="group:\/work\/app">/);
  assert.match(html, /<input data-slot="input" class="[^"]*session-tree-rename[^"]*" aria-label="Project name" maxLength="80" value="Thermal Models"\/>/);
  assert.doesNotMatch(html, /session-tree-group-toggle|session-tree-group-actions/);
  // Another group, or none being renamed: the header as usual.
  assert.match(rowMarkup(render({ rows: [groupRow()], renamingProjectKey: "/elsewhere" }), "group:/work/app"), /session-tree-group-toggle/);
});

test("delete confirmation shows a shortened title and both answers", () => {
  const html = rowMarkup(render({
    rows: [sessionRow(session("d", { name: "A very long session title that keeps going" }))],
    confirmDeleteRootId: "d",
  }), "session:group:d");
  assert.match(html, /class="session-tree-row session-tree-session[^"]*is-confirming[^"]*"/);
  assert.match(html, /<span class="[^"]*session-tree-confirm-text[^"]*">Delete A very long session ti…\?<\/span>/);
  assert.match(html, /<button [^>]*class="[^"]*session-tree-confirm-delete[^"]*"[^>]*><svg[^>]*><path[\s\S]*?<\/svg>Delete<\/button>/);
  assert.match(html, /<button [^>]*class="[^"]*session-tree-confirm-cancel[^"]*"[^>]*>Cancel<\/button>/);
  assert.doesNotMatch(html, /More actions/);
});

test("show more, empty groups, footer links and archive groups", () => {
  const html = render({
    rows: [
      { kind: "pinned-more", key: "pinned-more", hidden: 0, canShowLess: true },
      { kind: "group-more", key: "more:/work/app", projectKey: "/work/app", hidden: 3, canShowLess: false },
      { kind: "group-more", key: "more:/work/big", projectKey: "/work/big", hidden: 24, canShowLess: true },
      { kind: "group-empty", key: "empty:/work/app", project },
      { kind: "spacer", key: "footer-spacer" },
      { kind: "archive-group", key: "archive:/work/app", project, count: 2, expanded: true },
      { kind: "archive-group", key: "archive:/work/old", project: { ...project, key: "/work/old", root: "/work/old", name: "old" }, count: 5, expanded: false },
      { kind: "footer-open", key: "footer-open" },
      { kind: "footer-archived", key: "footer-archived", count: 4 },
    ],
  });
  assert.match(rowMarkup(html, "pinned-more"), /<button [^>]*class="[^"]*session-tree-more-toggle[^"]*"[^>]*data-more-action="less">Show less<\/button><\/div>/);
  assert.doesNotMatch(rowMarkup(html, "pinned-more"), /data-more-action="more"/);
  assert.match(rowMarkup(html, "more:/work/app"), /<button [^>]*class="[^"]*session-tree-more-toggle[^"]*"[^>]*data-more-action="more">Show more · 3<\/button><\/div>/);
  assert.doesNotMatch(rowMarkup(html, "more:/work/app"), /data-more-action="less"/);
  assert.match(
    rowMarkup(html, "more:/work/big"),
    /data-more-action="more">Show more · 24<\/button><button [^>]*class="[^"]*session-tree-more-toggle[^"]*"[^>]*data-more-action="less">Show less<\/button>/,
  );
  // Without sessions only a pin keeps a project listed once another one is current (#1476).
  assert.match(
    rowMarkup(html, "empty:/work/app"),
    /style="top:78px;height:28px" data-row-key="empty:\/work\/app"><span class="[^"]*session-tree-group-empty-label[^"]*">No sessions yet<\/span><button [^>]*class="[^"]*session-tree-more-toggle[^"]*"[^>]*>Pin to keep<\/button><\/div>/,
  );
  const pinnedEmpty = render({ rows: [{ kind: "group-empty", key: "empty:/work/app", project: { ...project, pinned: true } }] });
  assert.match(rowMarkup(pinnedEmpty, "empty:/work/app"), /No sessions yet<\/span><\/div>/);
  assert.doesNotMatch(html, /footer-spacer/);
  // The archive's project header is a group header that folds its rows: the
  // chevron, the name, the count; ⋯ for its archived sessions, no "+".
  const archiveHeader = rowMarkup(html, "archive:/work/app");
  assert.match(archiveHeader, /class="session-tree-row session-tree-group session-tree-archive-group[^"]*is-current[^"]*"/);
  assert.match(archiveHeader, /<button [^>]*class="[^"]*session-tree-group-toggle[^"]*"[^>]*aria-expanded="true" title="\/work\/app"><svg[^>]*class="lucide[^"]*rotate-90[^"]*"[\s\S]*?<span class="[^"]*session-tree-group-name[^"]*">app<\/span><span class="[^"]*session-tree-archive-group-count[^"]*">· 2<\/span><\/button>/);
  assert.match(archiveHeader, /aria-label="Archived sessions of app"[^>]*aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(archiveHeader, /New session/);
  assert.match(rowMarkup(html, "archive:/work/old"), /aria-expanded="false" title="\/work\/old"><svg[^>]*class="lucide[^"]*"/);
  assert.match(rowMarkup(html, "footer-open"), /<button [^>]*class="[^"]*session-tree-footer-button[^"]*"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="[^"]*session-tree-footer-label[^"]*">Open another project…<\/span><\/button>/);
  assert.match(rowMarkup(html, "footer-archived"), /<span class="[^"]*session-tree-footer-label[^"]*">Archived · 4<\/span><svg[^>]*class="lucide[^"]*session-tree-footer-chevron[^"]*"/);
});

test("loading replaces the rows; the empty label shows only without session, group or archive-group rows", () => {
  const loading = render({ loading: true, rows: [groupRow(), ...footer], emptyLabel: "No sessions found" });
  assert.match(loading, /<div role="status" aria-label="Loading..." class="[^"]*"><div data-slot="skeleton"/);
  assert.equal((loading.match(/data-slot="skeleton"/g) ?? []).length, 3);
  assert.deepEqual(renderedKeys(loading), []);
  assert.doesNotMatch(loading, /No sessions found/);

  const empty = render({ rows: footer, emptyLabel: "No sessions found" });
  assert.match(empty, /<div data-slot="empty-description" class="[^"]*">No sessions found<\/div><\/div><\/div><div class="[^"]*session-tree-scroll[^"]*">/);
  assert.deepEqual(renderedKeys(empty), ["footer-open"]);

  assert.doesNotMatch(render({ rows: [groupRow(), ...footer], emptyLabel: "No sessions found" }), /No sessions found/);

  const foldedArchive = render({
    rows: [
      { kind: "archive-group", key: "archive:/work/app", project, count: 2, expanded: false },
      {
        kind: "archive-group",
        key: "archive:/work/old",
        project: { ...project, key: "/work/old", root: "/work/old", name: "old" },
        count: 5,
        expanded: false,
      },
    ],
    emptyLabel: "No archived sessions",
  });
  assert.doesNotMatch(foldedArchive, /No archived sessions/);
  assert.deepEqual(renderedKeys(foldedArchive), ["archive:/work/app", "archive:/work/old"]);
  assert.doesNotMatch(render({ rows: footer, emptyLabel: null }), /data-slot="empty"/);

  const failed = render({ rows: footer, emptyLabel: "No sessions found", error: "HTTP 500" });
  assert.match(failed, /<div data-slot="alert" role="alert" class="[^"]*session-tree-error[^"]*">/);
  assert.match(failed, /<div data-slot="alert-description" class="[^"]*">HTTP 500<\/div>/);
  assert.doesNotMatch(failed, /No sessions found/);
});

test("only rows near the viewport are mounted, plus the ones that must stay", () => {
  const rows = Array.from({ length: 200 }, (_, index) => sessionRow(session(`s${index}`)));
  const plain = render({ rows });
  assert.match(plain, /<div class="[^"]*session-tree-inner[^"]*" style="height:6400px">/);
  const keys = renderedKeys(plain);
  // An unmeasured viewport counts as 600px, plus 240px of overscan below.
  assert.equal(keys.length, Math.ceil((600 + 240) / 32));
  assert.equal(keys[0], "session:group:s0");

  const kept = renderedKeys(render({
    rows,
    activeMenuRowKey: "session:group:s150",
    renamingRootId: "s120",
    confirmDeleteRootId: "s180",
  }));
  assert.deepEqual(kept.slice(-3), ["session:group:s120", "session:group:s150", "session:group:s180"]);
  assert.match(render({ rows, renamingRootId: "s120" }), /style="top:3840px;height:32px" data-row-key="session:group:s120"/);
});

test("a reveal request keeps its row mounted", () => {
  const rows = Array.from({ length: 200 }, (_, index) => sessionRow(session(`s${index}`)));
  const at = Date.now();
  // Mounted before the scroll, so focus can go to it in the commit that scrolls.
  const kept = renderedKeys(render({ rows, reveal: { id: 1, at, rowKey: "session:group:s150" } }));
  assert.equal(kept.at(-1), "session:group:s150");
  assert.deepEqual(renderedKeys(render({ rows, reveal: { id: 1, at, rowKey: "group:missing" } })), renderedKeys(render({ rows })));
});

test("renders the model built from a catalog with unique row keys", () => {
  const sessions = [
    session("a", { modified: new Date(NOW - MINUTE).toISOString() }),
    session("b", { cwd: "/work/other", projectRoot: "/work/other", projectKey: "/work/other" }),
    session("sub", { relation: { kind: "subagent", parentSessionId: "a", profile: "x", description: "", status: "running" } }),
  ];
  const model = buildSessionTree({
    sessions,
    uiState: { version: 1, revision: 0, sessions: { b: { pinnedAt: NOW } }, projects: {} },
    runningIds: new Set(["sub"]),
    unreadIds: new Set(),
    selectedSessionId: "a",
    currentProject: { key: "/work/app", root: "/work/app" },
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
  });
  const html = render({ rows: model.rows });
  const keys = renderedKeys(html);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, ["pinned-header", "session:pinned:b", "group:/work/app", "session:group:a", "footer-open"]);
  const familyRow = rowMarkup(html, "session:group:a");
  assert.match(familyRow, /is-selected/);
  assert.match(familyRow, /aria-label="Agent running…"/);
  assert.match(rowMarkup(html, "session:pinned:b"), /<span class="inline-block[^"]*">other<\/span>/);
});

test("row titles fall back from the name to the first message to the id", () => {
  assert.equal(sessionRowTitle(session("x", { name: "Named" })), "Named");
  assert.equal(sessionRowTitle(session("x", { firstMessage: "y".repeat(80) })), "y".repeat(50));
  assert.equal(sessionRowTitle(session("abcdefghijklmnop", { firstMessage: "" })), "abcdefghijkl");
  const skill = '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nbody\n</skill>\n\nthe diff';
  assert.equal(sessionRowTitle(session("x", { firstMessage: skill })), "/skill:review the diff");
});

test("the rows' styling stays tokened: the components' classes, the CSS's whitelist", () => {
  // The rewritten app/sidebar.css is the virtualizer's geometry, the measured
  // insets, the fit states and the motion: still flat and theme-quiet.
  assert.doesNotMatch(css, /&/, "no CSS nesting");
  assert.doesNotMatch(css, /@starting-style|prefers-color-scheme/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no literal colors: tokens only");
  // The tree's own classes carry no colors of their own either: every state's
  // markup colors itself through token utilities, never a literal.
  const html = render({
    layout: "mobile",
    rows: [
      { kind: "pinned-header", key: "pinned-header", count: 2, collapsed: true, running: 1, awaiting: 1, unread: 1 },
      groupRow({ expanded: false, running: 2, awaiting: 1, unread: 1 }, { pinned: true }),
      sessionRow(session("run"), { status: { running: true, awaiting: false, unread: true } }),
      sessionRow(session("ask"), { status: { running: true, awaiting: true } }),
      sessionRow(session("sel"), { status: { selected: true } }),
      sessionRow(session("d", { name: "A long title that goes on" }), undefined),
      sessionRow(session("old"), { context: "archive" }),
      ...footer,
    ],
    confirmDeleteRootId: "d",
  });
  assert.doesNotMatch(html, /class="[^"]*#[0-9a-fA-F]{3,8}[^"]*"/, "no literal colors in the rows' classes: token utilities only");
});

test("a row's controls fit its height with room to spare: 34px rows on a desktop (children 32px), 40px on a phone", () => {
  /** A Button size variant's height, from the component's own scale. */
  const sizeHeight = (variant) => {
    const match = buttonSource.match(new RegExp(`"?${variant}"?: "([^"]+)"`));
    assert.ok(match, `${variant} size exists`);
    const h = match[1].match(/(?:^|\s)(?:h-\[(\d+)px\]|h-(\d+)|size-(\d+))/);
    assert.ok(h, `${variant} has a height`);
    return Number(h[1] ?? h[2] ?? h[3]) * 4;
  };
  // A session row's ⋯ and archive (icon-xs, 32px on a phone), its rename
  // field, its delete confirmation's buttons; a group header's + and ⋯. At
  // least 2px clear above and below.
  const desktop = SIDEBAR_ROW_HEIGHTS.desktop;
  for (const variant of ["icon-xs", "xs"]) assert.ok(sizeHeight(variant) + 4 <= desktop.session, `${variant} fits a ${desktop.session}px row`);
  assert.match(source, /size="icon-xs"\s+className=\{`session-tree-action session-tree-quick-action/, "the archive/restore quick button is the item's size");
  assert.match(source, /size="icon-xs"\s+className=\{`session-tree-action session-tree-more-action/, "the row's ⋯ is the item's size");
  assert.match(source, /isMobile \? " size-8" : ""/, "a phone's action keys are the touch size");
  assert.match(source, /session-tree-rename min-w-0 flex-1\$\{mobile \? " h-8" : " h-7"\}/, "the rename field: 28px, the phone's 32px");
  assert.match(source, /variant="destructive" size="xs" className="session-tree-confirm-delete/, "the delete answer is the small size");
  assert.ok(sizeHeight("icon-xs") + 4 <= desktop.group, "a group header's keys fit its 34px row");
  assert.match(source, /session-tree-group-action cursor-pointer\$\{isMobile \? " size-8" : " size-6"\}/, "a group's + and ⋯: 24px, the phone's 32px");
  const mobile = SIDEBAR_ROW_HEIGHTS.mobile;
  const rowHeight = Math.min(mobile.session, mobile.group);
  assert.ok(sizeHeight("icon-sm") + 4 <= rowHeight, "a phone's action keys fit its 40px row");
  assert.ok(8 * 4 + 4 <= rowHeight, "the phone's rename field (h-8) fits its 40px row");
});

test("headers lead with their chevron, and every row's text starts in one column", () => {
  // The left inset is 6px in every browser, the grid the brand, the files'
  // header, the picker and the file tree keep; a classic scrollbar takes its
  // room from the right only.
  assert.match(cssRule(".session-tree-scroll"), /--session-tree-inset-left: 6px;\s*--session-tree-inset-right: max\(0px, calc\(6px - var\(--session-tree-scrollbar, 0px\)\)\);/);

  // The text column: the toggle's left padding, the 12px chevron and the
  // gap. Session titles, "show more", the empty group's note, the archive's
  // project names and the footer's labels (their 12px icons in the
  // chevron column) start there too.
  const classOf = (hook) => {
    const match = source.match(new RegExp(hook + ' ([^`"]+)'));
    assert.ok(match, `${hook} carries its own classes`);
    return match[1];
  };
  const has = (classes, utility) => new RegExp(`(?:^|\\s)${utility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(classes);
  // 20px from the row's edge: the toggle's 5px, the 12px chevron, the 3px gap.
  const toggle = classOf("session-tree-group-toggle");
  assert.ok(has(toggle, "pl-[5px]") && has(toggle, "gap-[3px]"), "the header toggle's text column");
  assert.match(source, /ChevronRightIcon size=\{12\} strokeWidth=\{3\} className=\{`size-3 /, "the headers' 12px chevrons");
  // A family's child sits one step deeper than the group's own rows.
  assert.match(source, /context === "pinned" \? "pl-5" : "is-child pl-8"/, "pinned rows at the text column, children a step deeper");
  // The footer's labels start there too (its 12px icons in the chevron column).
  const footerButton = classOf("session-tree-footer-button");
  assert.ok(has(footerButton, "pl-[5px]") && has(footerButton, "gap-[3px]"), "the footer's text column");
  assert.deepEqual([...source.matchAll(/<(?:FolderPlus|Archive)Icon size=\{(\d+)\}(?: className="[^"]*")? \/>\s*<span className="session-tree-footer-label/g)].map((match) => Number(match[1])), [12, 12]);
  // These rows span the whole width, so their padding is the inset's 6px plus
  // the text column's 20px; the pinned header's toggle starts its chevron at
  // the inset plus 5px.
  const textColumn = source.match(/const TEXT_COLUMN = "([^"]+)"/)?.[1] ?? "";
  assert.ok(has(textColumn, "pl-[26px]"), "the full-width rows' text column");
  assert.ok(/session-tree-row session-tree-more[^`]*\$\{TEXT_COLUMN\}/.test(source) && /session-tree-row session-tree-group-empty[^`]*\$\{TEXT_COLUMN\}/.test(source), "both full-width rows share it");
  const pinnedToggle = classOf("session-tree-pinned-toggle");
  assert.ok(has(pinnedToggle, "pl-[11px]"), "the pinned section's chevron in the same column");

  // One rhythm: session rows and every project header (a group's, the
  // archive's) are one height, 34px — the draft item's (40px on a phone) —
  // with a family's child a step under it (the draft's is-child, 32px,
  // deeper in too); the pinned section's label, the empty note and the
  // footer are the 28px step under that; only "show more" is shorter.
  assert.deepEqual(SIDEBAR_ROW_HEIGHTS.desktop, { "pinned-header": 28, session: 34, "pinned-more": 26, group: 34, "group-more": 26, "group-empty": 28, spacer: 8, "footer-open": 28, "footer-archived": 28, "archive-group": 34 });
  for (const [layout, height] of [["desktop", 34], ["mobile", 40]]) {
    for (const kind of ["session", "group", "archive-group"]) {
      assert.equal(SIDEBAR_ROW_HEIGHTS[layout][kind], height, `${layout} ${kind}`);
    }
  }
  for (const [layout, height] of [["desktop", 28], ["mobile", 40]]) {
    for (const kind of ["pinned-header", "group-empty", "footer-open", "footer-archived"]) {
      assert.equal(SIDEBAR_ROW_HEIGHTS[layout][kind], height, `${layout} ${kind}`);
    }
  }
  assert.deepEqual(SIDEBAR_ROW_HEIGHTS.mobile.session, SIDEBAR_ROW_HEIGHTS.mobile.group);
});

test("group headers draw nothing for a drag while idle", () => {
  // Three groups (the spacers between them render nothing), then the footer.
  const rows = [
    groupRow({}, { key: "/work/a", name: "a", pinned: true }),
    groupRow({}, { key: "/work/b", name: "b" }),
    groupRow({}, { key: "/work/c", name: "c", current: false }),
    { kind: "spacer", key: "footer-spacer" },
    ...footer,
  ];
  const html = render({ rows, onMoveGroup: noop });
  assert.match(html, /^<div class="session-tree[^"]*">/);
  assert.doesNotMatch(html, /session-tree-drag-|session-tree-drop-line|is-group-dragging|is-drag-armed/);
  // Headers keep their markup: the drag adds listeners, no attributes (and never draggable="true").
  assert.match(rowMarkup(html, "group:/work/b"), /^<div class="session-tree-row session-tree-group[^"]*is-current[^"]*" style="top:34px;height:34px" data-row-key="group:\/work\/b">/);
  assert.doesNotMatch(html, /draggable/);
});

test("SessionTree.tsx has no RegExp lookbehind (Safari 16.2)", () => {
  assert.doesNotMatch(source, /\(\?<[=!]/, "no RegExp lookbehind (Safari 16.2)");
});

test("the drag ghost is shorter than a header", () => {
  // The ghost is a one-line pill shorter than a header (useGroupDrag reads
  // its height to keep it clear of the pointer and the line). Its height is
  // its own class now.
  assert.match(source, /session-tree-drag-ghost [^`]*h-\[22px\]/);
  assert.ok(22 < SIDEBAR_ROW_HEIGHTS.desktop.group, "shorter than a header");
});
