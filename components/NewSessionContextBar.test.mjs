import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { NewSessionContextBar } = await jiti.import("./NewSessionContextBar.tsx");
const source = await readFile(new URL("./NewSessionContextBar.tsx", import.meta.url), "utf8");
const pickerSource = await readFile(new URL("./ProjectWorktreePicker.tsx", import.meta.url), "utf8");
const heroSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const contextSource = await readFile(new URL("../lib/new-session-context.ts", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

const context = {
  cwd: "/work/app-worktrees/feature",
  project: { key: "app-key", root: "/work/app" },
  worktrees: [
    { path: "/work/app", branch: "main", isMain: true },
    { path: "/work/app-worktrees/feature", branch: "feature/x", isMain: false },
  ],
  currentWorktreePath: "/work/app-worktrees/feature",
  projects: [{ key: "app-key", root: "/work/app" }],
};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(NewSessionContextBar, {
    context,
    mobile: false,
    initialFocus: null,
    onInitialFocusDone: noop,
    onPick: noop,
    onUseDefaultDirectory: noop,
    onOpenFolder: noop,
    onRefreshWorktrees: noop,
    onCreateWorktree: async () => ({ error: "unused" }),
    ...props,
  })));
}

test("the bar shows the project's name and the worktree's branch as two menu buttons", () => {
  const html = render();
  // No visible label: the folder icon says what the row is; the group keeps its name.
  assert.match(html, /^<div class="new-session-context [^"]*"><div class="project-picker is-inline [^"]*" role="group" aria-label="New session location"><button /);
  assert.equal((html.match(/New session location/g) ?? []).length, 1);
  // The project: a 12px folder icon, its name in code type, a chevron; the
  // full path is the tooltip (and the menu's rows), never the button's text.
  assert.match(html, /<button [^>]*class="[^"]*project-picker-button is-project[^"]*" type="button" title="\/work\/app" aria-haspopup="menu" aria-expanded="false"><svg[^>]*width="12" height="12"[^>]*class="lucide[^"]*project-picker-icon[^"]*" aria-hidden="true"><path[^>]*><\/path><\/svg><span class="[^"]*project-picker-name[^"]*"><span class="[^"]*project-picker-leaf[^"]*">app<\/span><\/span><svg[^>]*width="9" height="9"[^>]*class="lucide[^"]*project-picker-chevron[^"]*rotate-90[^"]*" aria-hidden="true">/);
  assert.doesNotMatch(html, /project-picker-path[^"]*"><span[^>]*>\/work\/app</);
  // The worktree: the branch icon (the accent for a linked checkout), the
  // branch cut at its left, a chevron; no "main" note and no count.
  assert.match(html, /<button [^>]*class="[^"]*project-picker-button[^"]*" type="button" title="Worktree: \/work\/app-worktrees\/feature" aria-haspopup="menu" aria-expanded="false"><svg[^>]*width="11" height="11"[^>]*class="lucide[^"]*project-picker-icon is-linked[^"]*"[\s\S]*?<\/svg><span class="[^"]*project-picker-path[^"]*"><span[^>]*>feature\/x<\/span><\/span><svg[^>]*width="9" height="9"[^>]*class="lucide[^"]*project-picker-chevron[^"]*rotate-90[^"]*"[\s\S]*?<\/svg><\/button><\/div><\/div>$/);
  const main = render({ context: { ...context, currentWorktreePath: "/work/app" } });
  assert.match(main, /class="lucide[^"]*project-picker-icon[^"]*" aria-hidden="true">[\s\S]*?<span class="[^"]*project-picker-path[^"]*"><span[^>]*>main<\/span><\/span><svg[^>]*width="9"/);
  assert.doesNotMatch(main, /project-picker-note|is-linked/);
  assert.doesNotMatch(html, /project-picker-note|project-picker-divider|style=/);
  // The side padding is the header's (ChatWindow), on phones too.
  assert.match(render({ mobile: true }), /^<div class="new-session-context [^"]*"><div class="project-picker is-inline [^"]*"/);
});

test("the project's name is the menus': its display name, else its folder's, its parent only where names collide", () => {
  const twins = { ...context, projects: [{ key: "app-key", root: "/work/app" }, { key: "other", root: "/other/app" }] };
  // The parent and "/" outside the name's own span: the parent is cut first.
  assert.match(render({ context: twins }), /<span class="[^"]*project-picker-name[^"]*"><span class="[^"]*project-picker-parent[^"]*">work<\/span>\/<span class="[^"]*project-picker-leaf[^"]*">app<\/span><\/span>/);
  // A project the user named: that name alone, the path still the tooltip.
  const named = { ...twins, project: { ...context.project, alias: "Thermal <b>Models</b>" } };
  const html = render({ context: named });
  assert.match(html, /title="\/work\/app"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="[^"]*project-picker-name[^"]*"><span class="[^"]*project-picker-leaf[^"]*">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span><\/span>/);
  assert.doesNotMatch(html, /project-picker-parent|is-alias/);
  // A name only the list knows (a move names its project by key and root).
  const listed = { ...context, projects: [{ key: "app-key", root: "/work/app", alias: "Listed" }] };
  assert.match(render({ context: listed }), /<span class="[^"]*project-picker-name[^"]*"><span class="[^"]*project-picker-leaf[^"]*">Listed<\/span><\/span>/);
});

test("the worktree button needs a worktree list: a non-git folder or a subdirectory has none", () => {
  const html = render({ context: { ...context, cwd: "/work/app/sub", project: { key: "/work/app/sub", root: "/work/app/sub" }, worktrees: null, currentWorktreePath: null } });
  assert.match(html, /title="\/work\/app\/sub"[^>]*>[\s\S]*?<span class="[^"]*project-picker-name[^"]*"><span class="[^"]*project-picker-leaf[^"]*">sub<\/span><\/span>/);
  assert.doesNotMatch(html, /Worktree:|project-picker-divider|is-inactive/);
  assert.equal((html.match(/aria-haspopup="menu"/g) ?? []).length, 1);
  // A detached checkout shows its path, cut at its left as a branch is.
  assert.match(
    render({ context: { ...context, worktrees: [{ path: "/work/app", branch: null, isMain: true }], currentWorktreePath: "/work/app" } }),
    /title="Worktree: \/work\/app"[^>]*>[\s\S]*?picker-path[^"]*"><span[^>]*>\/work\/app<\/span>/,
  );
});

test("client code stays parseable by Safari 16.2", () => {
  for (const file of [source, pickerSource, heroSource, contextSource]) {
    assert.doesNotMatch(file, /\(\?<[=!]/, "no RegExp lookbehind");
  }
  // The link's box: padding offset by equal negative margins, so hover and
  // focus never move the line.
  const update = heroSource.match(/new-session-update inline-flex[^"]*-my-\[(\d+)px\] px-1 py-\[(\d+)px\]/);
  assert.ok(update, "the update link's margins offset its padding");
  assert.equal(update[1], update[2]);
  // The hero centres the row under the brand lockup now (ChatWindow wraps it
  // in a justify-center flex), so the old left-edge pull is gone: the row's
  // margin carries no horizontal component.
  const row = source.match(/new-session-context ([^"]*)/);
  assert.ok(row);
  assert.doesNotMatch(row[1], /-?mx-|-?ml-|-?mr-/, "no horizontal margin on the bar");
  // The inline boxes never take a share of the row (60% of a lone project
  // button, in a repo subdirectory, once left it 0px wide): fixed minimum
  // widths and shrink factors only.
  assert.match(pickerSource, /projectBoxFlex = inline \? "min-w-14"/);
  assert.match(pickerSource, /worktreeBoxFlex = inline \? "min-w-18 shrink-\[1000000\]"/);
});
