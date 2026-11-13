import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { ModelSelector, groupModelOptions } = await jiti.import("./ModelSelector.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(ModelSelector, {
        onChange() {},
        ...props,
      }),
    ),
  );
}

test("renders the shadcn menu shape: radio items, provider labels, chevron trigger", async () => {
  // 菜单仅在打开时挂载，SSR 不产出内容，因此形状断言基于组件源码。
  const source = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

  assert.match(source, /DropdownMenuRadioGroup/);
  assert.match(source, /<DropdownMenuRadioItem/);
  assert.match(source, /<DropdownMenuLabel/);
  assert.match(source, /<DropdownMenuTrigger asChild>/);
  // 参考实现无搜索框，故不引入 Command/Popover。
  assert.doesNotMatch(source, /CommandInput|<Popover/);
  // 触发钮带下拉箭头（与参考实现一致）。
  assert.match(source, /ChevronDownIcon className="size-3 shrink-0 text-muted-foreground"/);
});

test("groups models by provider and labels each group with the provider's display name", () => {
  const options = [
    { provider: "aiflashapi", providerName: "AI Flash API", modelId: "one", name: "One" },
    { provider: "aiflashapi", modelId: "two", name: "Two" },
    { provider: "commandcode", modelId: "three", name: "Three" },
  ];

  const groups = groupModelOptions(options);
  assert.deepEqual(groups.map((group) => group.provider), ["aiflashapi", "commandcode"]);
  assert.deepEqual(groups.map((group) => group.providerName), ["AI Flash API", "commandcode"]);
  assert.deepEqual(groups[0].options.map((option) => option.modelId), ["one", "two"]);
});

test("names a current model outside the scope from the loaded full list", () => {
  const html = render({
    options: [{ provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" }],
    allOptions: [{ provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" }],
    value: { provider: "openai", modelId: "gpt-6-luna" },
    onShowAll() {},
  });

  assert.match(html, /GPT-6 Luna/);
});
