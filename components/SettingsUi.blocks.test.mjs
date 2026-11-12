import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  addSourceKeySubmits,
  ConfigAddSourcePanel,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigFooterStatus,
  ConfigNotice,
  ConfigSaveTarget,
  ConfigScopeSwitch,
  ConfigScopeTag,
  ConfigTrustNotice,
} = await jiti.import("./SettingsUi.tsx");

const h = React.createElement;
const render = (element) => renderToStaticMarkup(element);
const noop = () => {};

test("a scope tag shows the caller's label and tints only the project scope", () => {
  const project = render(h(ConfigScopeTag, { scope: "project" }, "项目"));
  assert.match(project, /data-slot="badge" data-variant="secondary"/);
  assert.match(project, /class="[^"]*config-scope-tag[^"]*bg-primary\/10 text-primary"/);
  assert.match(project, />项目<\/span>$/);
  const global = render(h(ConfigScopeTag, { scope: "global" }, "global"));
  assert.doesNotMatch(global, /bg-primary\/10/);
  assert.match(global, /bg-secondary text-secondary-foreground/);
});

test("a scope switch shows why an option is unavailable as visible text", () => {
  const options = [
    { value: "global", label: "global" },
    { value: "project", label: "project", disabled: true },
  ];
  const html = render(h(ConfigScopeSwitch, {
    value: "global",
    options,
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }));
  assert.match(html, /role="radiogroup" data-slot="toggle-group"[^>]*aria-label="Scope"/);
  assert.match(html, /<button[^>]*aria-checked="true"[^>]*>global<\/button>/);
  const reasonId = html.match(/<span id="([^"]+)" class="config-scope-switch-reason[^"]*">Project installs are unavailable<\/span>/)?.[1];
  assert.ok(reasonId, "the reason is rendered as text");
  // The disabled option points at the visible reason instead of a tooltip.
  assert.match(html, new RegExp(`<button[^>]*aria-checked="false"[^>]*aria-describedby="${reasonId}"[^>]*disabled=""[^>]*>project<\\/button>`));
  assert.doesNotMatch(html, /title=/);
});

test("a scope switch says nothing while every option is available", () => {
  const html = render(h(ConfigScopeSwitch, {
    value: "project",
    size: "small",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project" }],
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }));
  assert.match(html, /class="group\/toggle-group[^"]* text-xs"/);
  assert.doesNotMatch(html, /config-scope-switch-reason|aria-describedby|disabled=/);
});

test("a scope switch keeps the caller's controls on its line and the reason under both", () => {
  const html = render(h(ConfigScopeSwitch, {
    value: "global",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project", disabled: true }],
    label: "Scope",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }, h("button", { type: "button" }, "Install")));
  // An Install button inside the switch's own column would sit centered
  // against the switch plus its reason, out of line with the switch.
  assert.match(
    html,
    /^<div class="config-scope-switch-field[^"]*"><div class="config-scope-switch-row[^"]*"><div dir="ltr" role="radiogroup"[^>]*>[\s\S]*?<\/div><button type="button">Install<\/button><\/div><span id="[^"]+" class="config-scope-switch-reason[^"]*">Project installs are unavailable<\/span><\/div>$/,
  );
});

test("a save target is the scope switch with the path it writes to, the reason and the caller's lines under both", () => {
  const html = render(h(ConfigSaveTarget, {
    value: "global",
    options: [{ value: "global", label: "global" }, { value: "project", label: "project", disabled: true }],
    label: "Save to",
    path: "~/.pi/agent/mcp.json",
    disabledReason: "Project installs are unavailable",
    onChange: noop,
  }, h("p", null, "Trust project…")));
  assert.match(
    html,
    /^<div class="config-save-target[^"]*"><div class="config-scope-switch-field[^"]*"><div class="config-scope-switch-row[^"]*"><div dir="ltr" role="radiogroup"[^>]*aria-label="Save to"[^>]*>[\s\S]*?<\/div><span class="config-save-target-path[^"]*">~\/<wbr\/>\.pi\/<wbr\/>agent\/<wbr\/>mcp\.json<\/span><\/div><span id="[^"]+" class="config-scope-switch-reason[^"]*">Project installs are unavailable<\/span><\/div><p>Trust project…<\/p><\/div>$/,
  );
  // The path is shown whole, never cut short behind a tooltip; a narrow pane breaks it between folders.
  assert.doesNotMatch(html, /title=/);
  const windows = render(h(ConfigSaveTarget, { value: "global", options: [], label: "Save to", path: "C:\\Users\\me\\mcp.json", onChange: noop }));
  assert.match(windows, /<span class="config-save-target-path[^"]*">C:\\<wbr\/>Users\\<wbr\/>me\\<wbr\/>mcp\.json<\/span>/);
});

test("a detail grid pairs each label with its value", () => {
  const html = render(h(ConfigDetailGrid, null,
    h(ConfigDetailGridRow, { label: "Status", tone: "plain", style: { color: "red" } }, "loaded"),
    h(ConfigDetailGridRow, { label: "Path", mono: true }, "~/x"),
    h(ConfigDetailGridRow, { label: "Installed path", tone: "error" }, "Not found"),
  ));
  // The grid is the official Table, and the grid values wrap anywhere; the tone classes keep their hook names.
  assert.match(html, /<div data-slot="table-container"[^>]*><table data-slot="table" class="[^"]*config-detail-grid"><tbody data-slot="table-body"/);
  assert.match(html, /<tr data-slot="table-row" class="[^"]*config-detail-grid-row[^"]*"><td data-slot="table-cell" class="[^"]*config-detail-grid-label[^"]*">Status<\/td><td data-slot="table-cell" class="[^"]*config-detail-grid-value min-w-0 whitespace-normal align-top \[overflow-wrap:anywhere\]" style="color:red">loaded<\/td><\/tr>/);
  assert.match(html, /<tr data-slot="table-row" class="[^"]*config-detail-grid-row[^"]*"><td data-slot="table-cell" class="[^"]*config-detail-grid-label[^"]*">Path<\/td><td data-slot="table-cell" class="[^"]*config-detail-grid-value is-muted is-mono min-w-0 whitespace-normal align-top \[overflow-wrap:anywhere\] text-muted-foreground font-mono">~\/x<\/td><\/tr>/);
  assert.match(html, /<tr data-slot="table-row" class="[^"]*config-detail-grid-row[^"]*"><td data-slot="table-cell" class="[^"]*config-detail-grid-label[^"]*">Installed path<\/td><td data-slot="table-cell" class="[^"]*config-detail-grid-value is-error min-w-0 whitespace-normal align-top \[overflow-wrap:anywhere\] text-destructive">Not found<\/td><\/tr>/);
});

test("a footer status with details opens a visible list instead of a tooltip", () => {
  assert.equal(render(h(ConfigFooterStatus, { summary: "3 ext" })), '<span class="config-footer-status-summary">3 ext</span>');
  const html = render(h(ConfigFooterStatus, {
    summary: "2 diagnostics",
    tone: "error",
    details: ["error: a: broken", "warning: b"],
  }));
  // The official Collapsible replaced the native <details>; forceMount keeps
  // the list in the static markup the way <details> always rendered it.
  assert.match(html, /^<div data-state="closed" data-slot="collapsible" class="config-footer-status-details"><button type="button" aria-expanded="false" data-state="closed" data-slot="collapsible-trigger" class="config-footer-status-summary is-error text-destructive w-fit cursor-pointer text-left">2 diagnostics<\/button>/);
  assert.match(html, /<div data-state="closed" id="radix-[^"]*" data-slot="collapsible-content" class="data-\[state=closed\]:hidden"><ul class="config-footer-status-list[^"]*"><li>error: a: broken<\/li><li>warning: b<\/li><\/ul><\/div><\/div>$/);
  assert.doesNotMatch(html, /title=/);
});

test("a trust notice offers its button only when the caller can trust the project", () => {
  assert.equal(
    render(h(ConfigTrustNotice, { message: "Project plugins are not loaded." })),
    '<div role="status" class="config-notice px-4 py-2 text-xs text-muted-foreground">Project plugins are not loaded.</div>',
  );
  // A label without a handler would be a button that does nothing.
  assert.doesNotMatch(render(h(ConfigTrustNotice, { message: "x", trustLabel: "Trust project" })), /<button/);
  const html = render(h(ConfigTrustNotice, { message: "x", trustLabel: "Trust project", onTrust: noop }));
  assert.match(html, /^<div role="status" class="config-notice[^"]*has-action[^"]*"><span class="config-notice-text[^"]*">x<\/span><button data-slot="button" data-variant="outline" data-size="xs"[^>]*>Trust project<\/button><\/div>$/);
  assert.match(render(h(ConfigNotice, { action: h("a", { href: "#" }, "Open") }, "Off")), /class="config-notice[^"]*has-action/);
});

test("the add panel lays out the catalog, save target, source box, caller controls and examples", () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add plugin",
    catalogs: [{ href: "https://pi.dev/packages", label: "pi.dev/packages" }],
    target: h("div", { className: "save-target" }, "~/.pi/agent/{npm,git}"),
    inputLabel: "Source",
    inputId: "plugin-source",
    placeholder: "npm:@scope/package",
    value: "",
    canSubmit: false,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Examples",
    examples: ["npm:a", "git:b"],
    error: "boom",
  }, h("div", { className: "caller-controls" }, "controls")));
  assert.match(html, /<div class="config-detail-title[^"]*">Add plugin<\/div><span class="config-add-source-catalogs[^"]*"><a href="https:\/\/pi\.dev\/packages" target="_blank" rel="noopener noreferrer" class="config-add-source-catalog[^"]*">pi\.dev\/packages<\/a><\/span>/);
  // Where it saves comes first under the title, before the source box.
  assert.match(html, /<\/a><\/span><\/div><div class="save-target">~\/\.pi\/agent\/\{npm,git\}<\/div><\/div><div role="group" data-slot="field"/);
  assert.match(html, /<label data-slot="field-label"[^>]*>Source<\/label><input data-slot="input"[^>]*id="plugin-source" aria-label="Source" placeholder="npm:@scope\/package" value=""\/>/);
  // The caller's controls sit between the box and the examples.
  assert.match(html, /<\/div><div class="caller-controls">controls<\/div><div class="config-add-source-examples[^"]*">/);
  assert.match(html, /<div class="config-add-source-examples-label[^"]*">Examples<\/div>/);
  assert.match(html, /<button data-slot="button" data-variant="outline" data-size="default" class="[^"]*config-add-source-example[^"]*" type="button">npm:a<\/button><button data-slot="button" data-variant="outline" data-size="default" class="[^"]*config-add-source-example[^"]*" type="button">git:b<\/button>/);
  assert.match(html, /<div role="alert" class="config-add-source-error[^"]*">boom<\/div>/);
});

test("a labeled example shows what it is beside its text", () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add MCP server",
    catalogs: [{ href: "https://mcp.so/", label: "mcp.so" }],
    target: "~/.pi/agent/mcp.json",
    inputLabel: "Server to add",
    placeholder: "",
    value: "",
    canSubmit: false,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Supported formats",
    examples: [{ label: "Zed settings", value: '{ "context_servers": {} }' }, "plain"],
  }));
  assert.match(html, /<button data-slot="button" data-variant="outline" data-size="default" class="[^"]*config-add-source-example has-label[^"]*" type="button"><span class="config-add-source-example-label text-xs text-muted-foreground">Zed settings<\/span><span class="config-add-source-example-value font-mono text-xs">\{ &quot;context_servers&quot;: \{\} \}<\/span><\/button>/);
  assert.match(html, /<button data-slot="button" data-variant="outline" data-size="default" class="[^"]*config-add-source-example[^"]*" type="button">plain<\/button>/);
});

test("the multiline add box is a textarea where Enter adds a line and Cmd/Ctrl+Enter submits", () => {
  const html = render(h(ConfigAddSourcePanel, {
    title: "Add MCP server",
    catalogs: [{ href: "https://mcp.so/", label: "mcp.so" }],
    target: "~/.pi/agent/mcp.json",
    inputLabel: "Server to add",
    inputId: "mcp-add-source",
    placeholder: "https://…",
    value: "npx x",
    canSubmit: true,
    onValueChange: noop,
    onSubmit: noop,
    examplesLabel: "Examples",
    examples: [],
    multiline: true,
  }));
  assert.match(html, /<textarea data-slot="textarea"[^>]*id="mcp-add-source" aria-label="Server to add" placeholder="https:\/\/…" rows="5" spellCheck="false" autoCapitalize="off" autoCorrect="off">npx x<\/textarea>/);
  assert.doesNotMatch(html, /<input/, "no single-line box beside it");

  const key = (overrides) => ({ key: "Enter", metaKey: false, ctrlKey: false, nativeEvent: { isComposing: false }, keyCode: 13, ...overrides });
  assert.equal(addSourceKeySubmits(key({})), false, "a plain Enter is a line break");
  assert.equal(addSourceKeySubmits(key({ metaKey: true })), true);
  assert.equal(addSourceKeySubmits(key({ ctrlKey: true })), true);
  assert.equal(addSourceKeySubmits(key({ ctrlKey: true, nativeEvent: { isComposing: true } })), false, "an input method picks a candidate");
  assert.equal(addSourceKeySubmits(key({ metaKey: true, keyCode: 229 })), false, "Safari's composing Enter");
  assert.equal(addSourceKeySubmits(key({ key: "a", metaKey: true })), false);
});
