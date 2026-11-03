import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const themeOptionsSource = await readFile(new URL("../lib/theme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");

test("the trust dialog Settings › MCP opens stacks above Settings", () => {
  const zIndex = (selector) => Number(cssSource.match(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+);`))?.[1]);
  assert.ok(zIndex(".project-trust-backdrop") > zIndex(".settings-dialog-backdrop"));
});

test("an Add in Settings › MCP hands the folder's new trust to the page, which every section reloads on", () => {
  // Adding a project server writes .pi/mcp.json (the folder now requires trust) and may trust a
  // fresh folder in the same step; the page takes that status only for the folder Settings shows.
  assert.match(shellSource, /<SettingsPanel[\s\S]*?onProjectTrustChanged=\{handleProjectTrustChanged\}[\s\S]*?\/>/);
  assert.match(shellSource, /const handleProjectTrustChanged = useCallback\(\(cwd: string, status: ProjectTrustStatus\) => \{\n\s*if \(cwd === projectTrustCwd\) setProjectTrust\(status\);\n\s*\}, \[projectTrustCwd\]\);/);
  // Nothing was rebuilt on the server, so the chat keeps its session key.
  const handler = shellSource.slice(shellSource.indexOf("const handleProjectTrustChanged"), shellSource.indexOf("}, [projectTrustCwd]);", shellSource.indexOf("const handleProjectTrustChanged")));
  assert.doesNotMatch(handler, /setSessionKey|setModelsRefreshKey/);
});

test("trusting from Settings › MCP reloads, in place, the other mounted sections whose answer depends on trust", async () => {
  // Visited sections stay mounted (hidden), so each one that reads trust takes the page's
  // status. Still keyed by cwd alone: a remount would drop an install under way or a draft.
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(panelSource, new RegExp(`<${name} embedded key=\\{cwd\\} cwd=\\{cwd\\}[^\\n]*? trust=\\{projectTrust\\} `), name);
  }
  const read = (name) => readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8");
  const [skills, plugins, agents] = await Promise.all(["SkillsConfig", "PluginsConfig", "AgentsConfig"].map(read));
  // Skills and Plugins report "not loaded" and disable the Project scope from the trust at load
  // time: a new decision loads the list again, keeping the selection and update checks; the
  // first load stays the cwd effect's.
  for (const [src, load] of [[skills, "loadSkills"], [plugins, "loadPlugins"]]) {
    assert.match(src, new RegExp(
      "const trustKey = projectTrustReloadKey\\(trust\\);\\n\\s*const loadedTrustKeyRef = useRef\\(trustKey\\);\\n\\s*useEffect\\(\\(\\) => \\{\\n"
      + "\\s*if \\(loadedTrustKeyRef\\.current === trustKey\\) return;\\n\\s*loadedTrustKeyRef\\.current = trustKey;\\n"
      + `\\s*void ${load}\\(\\);\\n\\s*\\}, \\[trustKey, ${load}\\]\\);`,
    ), load);
  }
  // Agents: only the model list (GET /api/models leaves out an untrusted project's extensions).
  assert.match(agents, /const response = await fetch\(`\/api\/models\?cwd=\$\{encodeURIComponent\(cwd\)\}`[\s\S]*?\}, \[cwd, trustKey\]\);/);
  // Models reads models.json, auth and enabledModels, none of which follows trust.
  assert.match(panelSource, /sectionHost\("models", <ModelsConfig embedded cwd=\{cwd\} onClose=\{onClose\} \/>\)/);
});

test("offers every palette and system theme selection with native radios", () => {
  for (const preference of ["auto", "light", "mist", "lilac", "sand", "rose", "dark", "pine", "dusk", "ember"]) {
    assert.match(themeOptionsSource, new RegExp(`id: "${preference}"`));
  }
  assert.match(panelSource, /THEME_OPTIONS\.map/);
  assert.match(panelSource, /type="radio"/);
  assert.match(panelSource, /onChange=\{\(\) => setThemePreference\(option\.id\)\}/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
});

test("keeps language selection in General settings", () => {
  assert.match(panelSource, /t\("common\.language"\)/);
  assert.match(panelSource, /className="settings-language-options"/);
  assert.match(panelSource, /setLocale\(plugin\.id/);
});

test("groups fonts, chat font size and width in one section, chat behavior in another, without row backgrounds", () => {
  const appearanceSection = panelSource.slice(
    panelSource.indexOf('{detail === "appearance"'),
    panelSource.indexOf('{detail === "chat"'),
  );
  const chatSection = panelSource.slice(
    panelSource.indexOf('{detail === "chat"'),
    panelSource.indexOf('{detail === "shell"'),
  );

  assert.doesNotMatch(appearanceSection, /settings-chat-content|<FontSettings/);
  // Typography lives inside the chat section (main's layout): FontSettings and
  // the two range rows render between the switches.
  assert.match(chatSection, /className="settings-chat-options"[\s\S]*<FontSettings \/>/);
  assert.equal((chatSection.match(/className="settings-chat-option settings-chat-range-option"/g) ?? []).length, 2);
  for (const key of ["chatContentWidth", "chatContentFontSize"]) {
    assert.match(chatSection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.match(chatSection, /className="settings-chat-options"/);
  assert.equal((chatSection.match(/className="settings-chat-option(?: |")/g) ?? []).length, 8);
  assert.equal((chatSection.match(/<ConfigSwitch/g) ?? []).length, 4);
  for (const key of ["thinkingExpandedDefault", "chatContentWidth", "chatContentFontSize", "quoteSelection", "completionSound", "enterSendMode", "enterSendModeEnter", "enterSendModeCtrlEnter"]) {
    assert.match(chatSection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.doesNotMatch(panelSource, /ThinkingIcon|settings-thinking-/);
  const chatOptionStyles = cssSource.match(/\.settings-chat-option \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(chatOptionStyles, /font-size: 12px/);
  assert.doesNotMatch(chatOptionStyles, /background/);
});

test("keeps General free of divider rows", () => {
  assert.match(panelSource, /className="settings-dialog-header"/);
  assert.match(cssSource, /\.settings-dialog-header \{[\s\S]*?display: flex[\s\S]*?align-items: center[\s\S]*?min-height: 50px/);
  // sections.find survives upstream's navigation rework as the phone's section-level
  // title lookup — a label read, not a per-section divider header.
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
});

test("uses a fixed section rail on desktop and a phone home list of sections", () => {
  assert.match(panelSource, /className="settings-phone-home[ "]/);
  assert.match(panelSource, /className="settings-phone-home-item[ "]/);
  assert.match(panelSource, /className="settings-section-rail"/);
  assert.match(panelSource, /className=\{cn\(\s*"settings-section-rail-item /);
  // The active section reads as the current page; hover and the focus ring are
  // the shared recipes (bg-accent / hover:bg-secondary / ring-ring).
  assert.match(panelSource, /selected\s*\?\s*"bg-accent font-medium text-foreground"\s*:\s*"bg-transparent text-muted-foreground enabled:hover:bg-secondary"/);
  assert.match(panelSource, /aria-current=\{selected \? "page" : undefined\}/);
  assert.match(cssSource, /\.settings-section-rail \{[\s\S]*?width: 200px/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-section-rail \{[\s\S]*?display: none/);
  assert.doesNotMatch(panelSource, /width: isMobile \? "100%" : 188/);
  assert.match(panelSource, /<main[^>]*className="settings-dialog-main"/);
  assert.doesNotMatch(panelSource, /<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
});

test("labels agent profiles as sub-agents", () => {
  assert.match(enSource, /"common\.agents": "Sub-agents"/);
  assert.match(enSource, /"agents\.new": "New sub-agent"/);
  assert.match(zhSource, /"common\.agents": "子代理"/);
  assert.match(zhSource, /"agents\.new": "新建子代理"/);
});

test("sections use lucide glyphs: a robot for sub-agents, sliders for General", () => {
  assert.match(panelSource, /agents: BotIcon/);
  assert.match(panelSource, /general: SlidersHorizontalIcon/);
  assert.match(panelSource, /models: CpuIcon/);
  assert.match(panelSource, /skills: LayersIcon/);
  assert.match(panelSource, /plugins: PuzzleIcon/);
  assert.match(panelSource, /mcp: ServerIcon/);
  assert.match(panelSource, /className="settings-section-icon shrink-0"/);
  // No hand-drawn svg remains: every icon in the panel is a lucide component.
  assert.doesNotMatch(panelSource, /<svg/);
  assert.doesNotMatch(cssSource, /\.settings-section-icon\.is-agent/);
});

test("keeps password authentication to one login field and one settings action", () => {
  assert.equal((loginSource.match(/type="password"/g) ?? []).length, 1);
  assert.doesNotMatch(loginSource, /type="(?:text|email)"/);
  assert.match(loginSource, /autoComplete="current-password"/);
});

test("the login page returns only to a destination safeLoginDestination() accepts", () => {
  assert.match(loginSource, /safeLoginDestination\(destination, window\.location\.origin\)/);
});
