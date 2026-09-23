import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { GitPanel } = await jiti.import("./GitPanel.tsx");
const source = await readFile(new URL("./GitPanel.tsx", import.meta.url), "utf8");

test("exports a component", () => {
  assert.equal(typeof GitPanel, "function");
});

test("renders the four push-navigation layers behind data-gitpanel-view", () => {
  assert.match(source, /data-gitpanel-view=\{view\.type\}/);
  for (const layer of ["log", "files", "diff"]) {
    assert.match(source, new RegExp(`view\\.type === "${layer}"`));
  }
  assert.match(source, /setView\(\{ type: "files", commit \}\)/);
  assert.match(source, /setView\(\{ type: "diff", commit, file \}\)/);
});

test("back navigation pops one layer and repository switch resets to the log layer", () => {
  assert.match(source, /onClick=\{\(\) => setView\(\{ type: "log" \}\)\}/);
  assert.match(source, /onClick=\{\(\) => setView\(\{ type: "files", commit \}\)\}/);
  const selectHandler = source.match(/const selectRepository = \(repositoryRoot: string\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(selectHandler);
  assert.match(selectHandler, /setView\(\{ type: "log" \}\)/);
});

test("defaults to the session cwd repository, then the first scanned entry", () => {
  assert.match(source, /trimTrailingSlash\(repo\.repositoryRoot\) === trimTrailingSlash\(cwd\)/);
  assert.match(source, /cwdRepo\?\.repositoryRoot \?\? data\.repositories\[0\]\?\.repositoryRoot \?\? null/);
});

test("all copy goes through i18n gitPanel keys", () => {
  const keys = [...source.matchAll(/t\("(gitPanel\.[a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, `expected gitPanel keys, got ${keys.join(",")}`);
  assert.ok(keys.includes("gitPanel.selectRepository"));
  assert.ok(keys.includes("gitPanel.emptyLog"));
  assert.ok(keys.includes("gitPanel.loadMore"));
  assert.ok(keys.includes("gitPanel.back"));
  // Rendered strings must not bypass translations.
  assert.doesNotMatch(source, />\s*Loading\s*</);
});

test("log layer shows empty state and a load-more control", () => {
  assert.match(source, /gitPanel\.emptyLog/);
  assert.match(source, /gitPanel\.loadMore/);
  assert.match(source, /void loadCommits\(selectedRepo, commits\.length\)/);
});

test("commit rows and controls keep 36px touch targets", () => {
  assert.match(source, /LIST_ROW_MIN_HEIGHT = 36/);
  assert.match(source, /CONTROL_MIN_HEIGHT = 36/);
  assert.match(source, /minHeight: LIST_ROW_MIN_HEIGHT/);
  assert.match(source, /minHeight: CONTROL_MIN_HEIGHT/);
});

test("diff layer scrolls horizontally without wrapping", () => {
  assert.match(source, /data-gitpanel-diff\b[\s\S]*?whiteSpace: "pre", overflowX: "auto"/);
  assert.match(source, /data-gitpanel-diff-path\b[\s\S]*?wordBreak: "break-all"/);
});

test("narrow mobile stretches the toolbar select to full row width", () => {
  assert.match(source, /const narrowMobile = useIsNarrowMobile\(\);/);
  assert.match(source, /data-gitpanel-narrow=\{narrowMobile \? "true" : "false"\}/);
  assert.match(source, /flex: narrowMobile \? "1 1 100%" : 1/);
  assert.doesNotMatch(source, /max-width: 640|max-width: 480/);
});

test("back navigation stays in-panel: no gesture routing, no new breakpoints", async () => {
  assert.doesNotMatch(source, /popstate|touchstart|touchmove|history\.(push|replace)State/);
  const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  for (const line of appShell.split("\n").filter((line) => line.includes("GIT_"))) {
    assert.doesNotMatch(line, /max-width: \d+/, line.trim());
  }
});

test("repository options show relative path and current branch", () => {
  assert.match(source, /repo\.relativePath === "\." \|\| repo\.relativePath === ""/);
  assert.match(source, /`\$\{repo\.name\} \(\$\{repo\.relativePath\} · \$\{repo\.branch\}\)`/);
  assert.match(source, /`\$\{repo\.name\} \(\$\{repo\.branch\}\)`/);
});

test("manual rescan bypasses the discovery cache with refresh=1", () => {
  assert.match(source, /async \(refresh = false\) => \{/);
  assert.match(source, /refresh \? "&refresh=1" : ""/);
  // Only the mount-time load uses the TTL cache; the rescan button and error retry force a fresh scan.
  assert.match(source, /onClick=\{\(\) => \{ void loadRepositories\(true\); \}\}/);
  assert.match(source, /renderError\(reposError, \(\) => \{ void loadRepositories\(true\); \}\)\}/);
});

test("desktop full-width splits the diff view into list above patch", () => {
  assert.match(source, /fullWidth\?: boolean;/);
  assert.match(source, /export function GitPanel\(\{ cwd, fullWidth = false \}: Props\)/);
  assert.match(source, /data-gitpanel-split/);
  assert.match(source, /view\.type === "diff" && fullWidth && \(/);
  assert.match(source, /view\.type === "diff" && !fullWidth && renderDiffLayer\(view\.commit, view\.file\)/);
});

test("commit rows show author and locale-aware relative time (story 6)", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format";/);
  assert.match(source, /formatRelativeTime\(new Date\(commit\.timestamp \* 1000\), locale\)/);
  assert.doesNotMatch(source, /formatCommitTime/);
});

test("diff layer header keeps the commit hash (story 10)", () => {
  const diffLayer = source.match(/const renderDiffLayer = \(commit: CommitSummary, file: CommitFileChange\) => \([\s\S]*?\n  \);/)?.[0];
  assert.ok(diffLayer);
  assert.match(diffLayer, /\{commit\.shortHash\}/);
  assert.match(diffLayer, /data-gitpanel-diff-path/);
});
