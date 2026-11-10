import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { ModelSelector } = await jiti.import("./ModelSelector.tsx");
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
  // 菜单只在打开时挂载,SSR 不产出内容,所以形状断言落在组件源码上。
  const source = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

  assert.match(source, /DropdownMenuRadioGroup/);
  assert.match(source, /<DropdownMenuRadioItem/);
  assert.match(source, /<DropdownMenuLabel/);
  assert.match(source, /<DropdownMenuTrigger asChild>/);
  // 参考实现没有搜索框:不再携带 Command/Popover。
  assert.doesNotMatch(source, /CommandInput|<Popover/);
  // 触发钮带下拉箭头(参考形态)。
  assert.match(source, /ChevronDownIcon className="size-3 shrink-0 text-muted-foreground"/);
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
