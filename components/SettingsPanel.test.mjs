import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const trustSource = await readFile(new URL("./ProjectTrustDialog.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const themeOptionsSource = await readFile(new URL("../lib/theme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");

test("the trust dialog Settings › MCP opens stacks above Settings", () => {
  // Both surfaces sit above every in-page overlay; the trust dialog mounts
  // after and stacks one level higher (z-[1100] vs the panel's z-[1000]).
  assert.match(panelSource, /"settings-phone-safe z-\[1000\] /);
  assert.match(trustSource, /"settings-phone-safe z-\[1100\] /);
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
  assert.match(panelSource, /models: <ModelsConfig embedded cwd=\{cwd\} onClose=\{onClose\} \/>,/);
});

test("offers system, light and dark selection with native radios (shadcn theme only)", () => {
  for (const preference of ["auto", "light", "dark"]) {
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

test("groups fonts, chat font size and width with the chat switches, without row backgrounds", () => {
  const chatOptions = panelSource.slice(
    panelSource.indexOf("const chatOptions = ("),
    panelSource.indexOf("// The keep-alive group"),
  );
  assert.doesNotMatch(chatOptions, /settings-theme-options/);
  // Typography lives with the chat switches: FontSettings and the two slider rows
  // render between them, in both the phone's detail and the desktop's card.
  assert.match(chatOptions, /className="flex w-full flex-col gap-2\.5"[\s\S]*<FontSettings \/>/);
  assert.equal((chatOptions.match(/<Slider/g) ?? []).length, 2);
  for (const key of ["chatContentWidth", "chatContentFontSize"]) {
    assert.match(chatOptions, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.equal((chatOptions.match(/<Field\b/g) ?? []).length, 7);
  assert.equal((chatOptions.match(/<ConfigSwitch/g) ?? []).length, 4);
  for (const key of ["thinkingExpandedDefault", "chatContentWidth", "chatContentFontSize", "quoteSelection", "completionSound", "enterSendMode", "enterSendModeEnter", "enterSendModeCtrlEnter"]) {
    assert.match(chatOptions, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  assert.doesNotMatch(panelSource, /ThinkingIcon|settings-thinking-/);
  // The rows carry no background of their own: Field lays them out, the Card is the surface.
  assert.doesNotMatch(chatOptions, /settings-chat-option/);
  assert.doesNotMatch(cssSource, /\.settings-chat-option/);
});

test("the desktop dialog is a section rail beside the scrolling sections", () => {
  // Desktop: the vertical Tabs rail (a muted 200px column) beside the sections;
  // the active trigger reads as a raised item on the muted rail.
  assert.match(panelSource, /<Tabs[\s\n]*orientation="vertical"/);
  assert.match(panelSource, /w-\[200px\] shrink-0 flex-col border-r bg-muted\/40/);
  assert.match(panelSource, /data-\[state=active\]:bg-background data-\[state=active\]:font-medium data-\[state=active\]:shadow-sm/);
  const desktopGeneral = panelSource.slice(
    panelSource.indexOf("if (!isPhone) {"),
    panelSource.indexOf("<ConfigSplitView>"),
  );
  for (const key of ["appearance", "chat", "sidebar"]) {
    assert.match(desktopGeneral, new RegExp(`<ConfigCard title=\\{t\\("settings\\.${key}"\\)\\}>`), key);
  }
  assert.match(desktopGeneral, /\{pushCard\}/);
  assert.match(panelSource, /title=\{t\("settings\.pushPermission"\)\}/);
  assert.match(desktopGeneral, /\{keepAliveCard\}/);
  assert.match(panelSource, /title=\{t\("settings\.keepAlive"\)\}\s*description=\{t\("settings\.keepAliveDescription"\)\}/);
  assert.match(desktopGeneral, /<ConfigCard title=\{t\("common\.language"\)\}>/);
  assert.match(desktopGeneral, /\{logOutBlock\}/);
  // The phone keeps its split view with the sub-section list.
  assert.match(panelSource, /<ConfigSplitView>/);
  assert.match(panelSource, /<ConfigSidebar>/);
  // Form rows read as the draft's frow2: a Field row, its description muted under the label.
  assert.match(panelSource, /<FieldDescription id="settings-files-placement-description" className="text-xs">/);
});

test("keeps General free of divider rows", () => {
  // The only chrome above a level is the phone's 50px header; sections render
  // as Cards, never as divider-topped sections.
  assert.match(panelSource, /min-h-\[50px\]/);
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
  // The old grid header rules are gone; the phone title keeps only its cut.
  assert.doesNotMatch(cssSource, /\.settings-dialog-header/);
  assert.doesNotMatch(cssSource, /\.settings-phone-back/);
});

test("uses a fixed section rail on desktop and a phone home list of sections", () => {
  // Desktop: the TabsList rail; phone home: a list of sections opened by
  // openSectionFromHome; the section level turns them into chips.
  assert.match(panelSource, /<TabsList variant="line" className="h-auto min-h-0 w-full flex-1 flex-col items-stretch gap-0\.5 overflow-y-auto bg-transparent p-3">/);
  assert.match(panelSource, /openSectionFromHome/);
  assert.match(panelSource, /aria-current=\{selected \? "page" : undefined\}/);
  assert.match(panelSource, /variant=\{selected \? "secondary" : "ghost"\}/);
  // The pre-Tabs self-drawn rail classes are gone from panel and stylesheet
  // (the aria-describedby id prefix `settings-phone-home-*` is not a class).
  assert.doesNotMatch(panelSource, /className="[^"]*settings-(section-rail|phone-home)/);
  assert.doesNotMatch(cssSource, /\.settings-(section-rail|phone-home)/);
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
