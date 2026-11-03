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
  // The app's 10px (6px on touch) scrollbar took its height out of the 36px
  // bar: 36px tabs were clipped (#1225), stretched ones squeezed to 26px.
  const html = renderTabBar(12);
  assert.match(html, /<div role="tablist" class="tabbar-scroll/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.tabbar-scroll \{\s*scrollbar-width: none;\s*\}/);
  assert.match(css, /\.tabbar-scroll::-webkit-scrollbar \{\s*display: none;\s*\}/);
  const [list] = classes(html, "tablist");
  // The bar's height (36px, 44px on a phone or touch screen).
  assert.match(list, /h-\[var\(--top-bar-height\)\]/);
  assert.match(list, /overflow-x-auto/);
  assert.match(list, /overflow-y-hidden/);
  assert.match(list, /items-stretch/);
  const tabs = classes(html, "tab");
  assert.equal(tabs.length, 12);
  for (const tab of tabs) {
    assert.doesNotMatch(tab, /\bh-\d/);
    assert.match(tab, /items-center/);
  }
});
