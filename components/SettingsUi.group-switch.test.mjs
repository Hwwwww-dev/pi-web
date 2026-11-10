import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ConfigSidebarGroupLabel, ConfigSidebarGroupStatus, ConfigSidebarGroupSwitch } = await jiti.import("./SettingsUi.tsx");

function renderSwitch(enabled, total) {
  return renderToStaticMarkup(React.createElement(ConfigSidebarGroupLabel, {
    aside: React.createElement(ConfigSidebarGroupSwitch, {
      enabled,
      total,
      label: "Switch the group",
      onChange() {},
    }),
  }, "global"));
}

test("a group switch is on only while every row of the group is", () => {
  // Like the Models panel's provider switch: partial reads as off beside its count.
  assert.match(renderSwitch(3, 3), /aria-checked="true"/);
  assert.match(renderSwitch(2, 3), /aria-checked="false"/);
  assert.match(renderSwitch(0, 3), /aria-checked="false"/);
  assert.match(renderSwitch(2, 3), /<span class="font-mono text-\[11px\] text-muted-foreground">2\/3<\/span>/);
});

test("the group switch shares the heading row and uses the regular switch", () => {
  const html = renderSwitch(1, 2);
  assert.match(html, /^<div class="config-sidebar-group-label[^"]*"><span class="min-w-0 truncate">global<\/span><span class="inline-flex shrink-0 items-center gap-1.5">/);
  assert.match(html, /data-slot="switch" data-size="default"/);
  assert.doesNotMatch(html, /data-size="sm"/);
  assert.match(html, /aria-label="Switch the group"/);
});

test("a group's status shows only what the last switch left undone", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ConfigSidebarGroupStatus, {})), "");
  const html = renderToStaticMarkup(React.createElement(ConfigSidebarGroupStatus, {
    note: "1 filtered package stayed on",
    error: "Could not change 1 of 2 packages",
  }));
  assert.match(html, /role="status" class="text-muted-foreground">1 filtered package stayed on/);
  assert.match(html, /role="alert" class="text-destructive">Could not change 1 of 2 packages/);
});
