import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TabBar } = await jiti.import("./TabBar.tsx");

function renderTabBar(count) {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts` }));
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {} })));
}

/** The class string of every element with that role. */
function classes(html, role) {
  return [...html.matchAll(new RegExp(`<div role="${role}"[^>]* class="([^"]*)"`, "g"))].map(([, cls]) => cls);
}

test("overflowing tabs keep the whole bar: the strip has no scrollbar", () => {
  // The app's 10px (6px on touch) scrollbar took its height out of the bar:
  // full-height tabs were clipped (#1225), stretched ones squeezed.
  const html = renderTabBar(12);
  assert.match(html, /<div role="tablist" class="tabbar-scroll/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.tabbar-scroll \{\s*scrollbar-width: none;\s*\}/);
  assert.match(css, /\.tabbar-scroll::-webkit-scrollbar \{\s*display: none;\s*\}/);
  const [list] = classes(html, "tablist");
  // The pill bar's fixed height (R2-1: the panel bar is 46px).
  assert.match(list, /h-\[46px\]/);
  assert.match(list, /overflow-x-auto/);
  assert.match(list, /overflow-y-hidden/);
  assert.match(list, /items-center/);
  const tabs = classes(html, "tab");
  assert.equal(tabs.length, 12);
  for (const tab of tabs) {
    // One tab, one pill: a fixed pill height on every row.
    assert.match(tab, /h-\[30px\]/);
    assert.match(tab, /items-center/);
    assert.match(tab, /rounded-full/);
  }
});
