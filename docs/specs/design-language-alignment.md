# 设计语言对齐（shadcn / AI Elements）

状态：待审阅（本文只描述终态与执行顺序，不含实现）

## 1. 目标与不变量

**目标**：整个界面只有一套设计语言——官方组件是唯一真源，我们自己的信息全部落在官方组件的既有槽位上。

三条不变量：

1. **样式只有一处真源**。`components/ui/*` 用官方源码；`app/globals.css` 不再有 `@layer components` 里的组件覆盖层（`cn-trace-*`、`cn-code-block-*`）。
2. **信息不丢**。用量、成本、`stream-token-rate` 速率、压缩、cache-miss、扩展状态、chip、子代理、队列、plan、sources、上下文余量——全部保留，但载体必须是官方样式（`TraceDescription` 那种行内小字 / `Item` / `Tooltip` / `Progress` / `Alert`），不再有自造的小方块与细条。**用量行不使用胶囊/`Badge`**：官方 trace 示例里 meta 就是图标加数字的行内文字。
3. **对话正文不受高度限制**。上限只约束过程块与可折叠内容（见第 5 节）。

## 2. 真源

本地已下载，全部离线可用：

- `/tmp/shadcn/reg/{trace,code-block,item,attachment,message-scroller,message,bubble,marker}.base-rhea.json` —— **官方组件源码**（`files[0].content`）。
- `/tmp/shadcn/docs_components_base_*.md`、`/tmp/shadcn/pattern_*.md` —— 官方文档与 pattern 示例。
- `/tmp/shadcn/utils_shimmer.md` —— shimmer 工具类。

**唯一可用的组件源码是 `base-rhea`（Base UI 版）**。`*.new-york.json` 是下载失败留下的 HTML 页面，不可用作参考。

因此每个组件都要做**语法等价改写**，且只改语法：

| Base UI | 本项目（Radix） |
|---|---|
| `render={<Button />}` | `<Button asChild>` |
| `h-(--collapsible-panel-height)` 动画变量 | Radix `Collapsible` 的 `data-state=open/closed` + 等价 CSS 动画 |
| `data-ending-style` / `data-starting-style` | `data-state=closed` / `data-state=open` |

类名、间距、颜色、圆角、字号一律照抄，不做本地化改写。

## 3. 底座逐项差异（我们 vs 官方）

### 3.1 `components/ui/trace.tsx`

| 元素 | 现在 | 官方 |
|---|---|---|
| `Trace` | 无子项选择器规则 | `flex w-full min-w-0 flex-col gap-2` + 含行子项：`w-fit max-w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30` |
| `TraceLine` | `text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.55]` | `flex w-fit max-w-full min-w-0 items-center gap-2 text-sm text-muted-foreground transition-colors ...` |
| `TraceIcon` | 基本一致 | `flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 [[data-slot=trace-title]~&]:-ml-1` |
| `TraceTitle` | `shrink-0 whitespace-nowrap`（不截断） | `min-w-0 truncate motion-reduce:shimmer-none`（**截断**） |
| `TraceDescription` | `min-w-0 flex-1 basis-0 truncate`（吃掉整行并截断） | `shrink-0 text-muted-foreground/70 tabular-nums`（**不截断、不占宽**） |
| 折叠触发 | 本地组合 | `group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 has-[[data-status=error]]:text-destructive` |
| 折叠内容 | `mt-2 mb-1 border-l pr-1 pl-4 leading-relaxed` | `mt-2 mb-1 ml-[calc(--spacing(2)-1px)] min-w-0 border-l pr-1 pl-4 leading-relaxed wrap-break-word text-muted-foreground` |

> 关键差异：**title 截断 / description 不截断**。现在正好相反，这才是行内出现"粗短标题 + 灰色长命令 + 右对齐时长"的直接原因。

### 3.2 `components/ui/code-block.tsx`

| 项 | 现在 | 官方 |
|---|---|---|
| 容器 | `rounded-lg text-sm` | `rounded-2xl text-sm data-[size=sm]:rounded-xl data-[size=sm]:text-xs` |
| 默认变体 | `border border-input text-foreground dark:bg-input/30` | `bg-muted text-foreground ring-1 ring-foreground/5 dark:ring-foreground/10` |
| destructive | `border border-destructive/30` | `bg-destructive/5 text-destructive ring-1 ring-destructive/15 dark:bg-destructive/10 dark:ring-destructive/20` |
| 焦点环 | `ring-ring/50` | `ring-ring/30` |

其余（header/footer/title/actions/content/line 变体）按源码逐项恢复。

### 3.3 需要新增的官方组件（仓库目前没有）

`components/ui/item.tsx`、`attachment.tsx`、`marker.tsx` 从 `reg/*.base-rhea.json` 取源码落地（同样做 Base UI → Radix 语法等价：`render`/`useRender` → `asChild` + `Slot.Root`）。

`message-scroller.tsx` **不纳入**：它 import `@shadcn/react/message-scroller`（仓库没有该包，方案禁止新增依赖），现有滚动逻辑保留。`highlight.tsx` 由 `SourceCodeView` 的高亮链承担，不单独引入。

### 3.4 需要删除的本地层

- `app/globals.css` 的 `@layer components`：`.cn-trace-line`、`.cn-trace-icon`、`.cn-trace-collapsible-content(-inner)`、`.cn-code-block*`（约 50 行）。样式回到组件内。
- `docs/specs/transcript-rewrite.md` 第 1 节里"自拼卡片/自定档位"的表述同步修正（第 7 节验收时一并改）。

## 4. 自研元素 → 官方槽位

每个自研信息都必须能指认落在哪个官方槽位；指认不出来的，说明它不该存在。

| 自研信息 | 现在的位置 | 官方槽位 | 落法 |
|---|---|---|---|
| 用量 / 成本 / token（`lib/session-stats-format.ts`, `components/UsageBar.tsx`, `components/TranscriptNotices.tsx`） | 自绘统计条 + 自绘提示行 | 行内小字（`text-xs text-muted-foreground tabular-nums`，官方 Trace 示例的 meta 形态）+ `HoverCard` 里的 `Progress` + `Alert` | 数字用图标加文字，**不套胶囊、不加底色**；余量明细进 `HoverCard` |
| `lib/stream-token-rate.ts` 速率 | 与统计同行 | `TraceDescription`（运行中行内 meta）或 `Badge` | 运行中紧跟当前行标题，`tabular-nums`，`text-muted-foreground/70` |
| 压缩（compaction） | `ActivityRows.CompactionRow` 自绘 | Chain of Thought：`TraceLine` + `TraceCollapsible` | 标题 `Compacted N messages`，摘要进折叠 |
| cache-miss 提示（`lib/transcript-notices.ts`） | 自绘细条 | `Alert` | 一条 `Alert`，数字用 `Badge` |
| 扩展状态 / TODD / YOLO（`ExtensionStatusBar`, `ExtensionWidgets`） | 自绘胶囊 | `Badge variant="outline"` + `Separator` | 一行 Badge，`Separator` 分隔左右两组 |
| 工具 chip（读/写路径、文件跳转） | 自绘 chip | `Button variant="outline" size="sm" className="rounded-full"` | 官方示例里跳转就是这种胶囊 |
| 子代理（`SessionChatPanel`） | 自绘面板 | `Subagent` pattern | 1:1 抄结构 |
| 队列（`lib/queued-submissions.ts` 渲染） | 自绘行 | `Queue` pattern | 同上 |
| plan / todo | 自绘 | `Plan` pattern | 同上 |
| sources / 引用 | `SourcesTrace` | `Sources` + `InlineCitation` pattern | 同上 |
| 上下文余量（`ContextBadge`） | 自绘 | `Progress` + `TraceDescription` | 同上 |
| minimap（`ChatMinimap`） | 自绘（`color-mix`） | `ScrollArea` + token 色 | 保留功能，颜色改 token |
| 分支切换（`BranchNavigator`） | 自绘 | `DropdownMenu` + `Badge` | 官方菜单语汇 |
| 终端（`TerminalPanel`） | 自绘 + xterm 主题 | `Terminal` pattern 外壳 | 外壳用 pattern，xterm 自身调色板保留但取值改 `--terminal-*` |
| diff / patch（`DiffView`, `PatchDiffFiles`） | 自绘 | `CodeBlock` 行变体 `added`/`removed` | 用 `highlighted/added/removed`，不自绘底色 |
| 媒体（图片/视频） | 自绘 | `Attachment` | 官方附件组件 |

### 4.1 自定义事件默认折叠

现状：`ActivityRows.CustomRow` 把正文直接渲染在行下（`pi-goal-audit-event`、`plugin-hook-context` 这类），只有一个 `detailsExpanded` 控制“显示详情”，正文本身永远展开；标题带一段长描述 + 右侧时长。

目标（与其它过程行同形）：

- 整块包在 `TraceCollapsible` 里，`defaultOpen={false}`：**进会话时默认收起**。
- 触发行：`TraceLine` + `TraceIcon`（事件图标）+ `TraceTitle`（事件名，如 `pi-goal-audit-event`，单行截断）+ 可选 `TraceDescription`（短 meta）+ 行尾 chevron。事件体那段自然语言摘要不进标题，避免变成“标题 + 长描述”两列。
- 正文（`MarkdownBody`）进 `TraceCollapsibleContent`，同时受 `--card-max-height` 限制（第 5 节）。
- 「复制 / 显示详情」两个按钮移到折叠内容**底部**，不再占标题行。

验收：打开任何会话，自定义事件行全部收起；展开后才是正文。

### 4.2 todo 工具 → `Plan` pattern

现状：`todo` 工具行把原始参数 JSON 当作参数卡片渲染（图二），与其它工具没有区别。

目标（官方 `pattern_plan.md` 原样）：

```
TraceCollapsible defaultOpen
  TraceCollapsibleTrigger
    TraceLine status={running|""}
      TraceIcon        RouteIcon
      TraceTitle       Plan: <当前 in_progress 任务的 subject，无则 Plan>
      TraceDescription {done} of {total} done
  TraceCollapsibleContent
    Trace
      TraceLine status={pending|running|""}
        TraceIcon  CircleCheckIcon | CircleDotIcon | CircleIcon
        TraceTitle <task.subject>
```

映射：`tasks[].status`：`completed` → done、`in_progress` → running、`pending` → pending；`action: create|update` 不影响渲染，仅在 `Plan` 标题缺名时作回退（`Plan: create`）。

参数卡片：`todo` 行**不再渲染参数 JSON**；原始参数仅在下拉菜单的“看参数”里可选（不在默认展开路径上）。`结果` 卡片保留。

验收：todo 行显示为 `Plan: …` + `N of M done` + 缩进步骤行（勾/点/空圈），随状态刷新。

## 5. 高度策略

| 位置 | 上限 |
|---|---|
| 用户消息、assistant 正文（含最后一条回答） | **无上限** |
| 工具参数 / 结果 / 终端输出 / 代码块 | `CodeBlock` 自身 `max-h` + 内部滚动 |
| 自定义事件、压缩详情 | 限高（`--card-max-height`） |
| 折叠内部（默认收起） | 限高 |
| 图片 / 视频 | 限高 + 点击放大 |

实现要点：`SafeMarkdownBody` 的高度上限移除，只保留"超大文本（>100 000 字符）转纯文本、点击展开"这一职责；`MessageView.tsx:838`（assistant 正文）与 `ActivityRows` 的自定义事件分别决定是否套上限。
自定义事件：正文在折叠内容里，**默认收起**（第 4.1 节），展开后受上限约束。

**双重滚动条是硬错误**：任何一条用户/assistant 消息内部出现纵向滚动条（外层对话已能滚动）都说明上限被套到了正文上。要求：

- 正文（`MessageView` 的用户消息与 assistant 回答）不套 `max-h` / `overflow-auto`，无论长短、无论是否最后一条。
- 页面里只允许这些地方出现纵向滚动：对话区本身、代码块内部、`--card-max-height` 限高的过程块（仅展开态）、文件面板、设置面板。
- 验收时逐条数：任意消息内部 `scrollHeight > clientHeight` 且 `overflow-y:auto` 即失败。

`docs/specs/transcript-rewrite.md` 的 7.1 条同步改写。

## 6. 字号

- 放弃 `13.5px + var(--chat-font-size-offset)` 这种自定档位；行文字、代码、正文一律 `text-sm` / `text-xs` / `text-base`（官方档位）。
- 用户的字号偏好保留，改为**缩放根字号**（`html { font-size: … }`，rem 生效），不改任何类名，因此视觉档位仍与官方一致。

## 7. 列表之外的界面

同一套语汇，逐块替换：

| 区域 | 现状 | 目标 |
|---|---|---|
| 设置面板（`SettingsPanel`, `SettingsUi`, `ModelsConfig`, `SkillsConfig`, `PluginsConfig`, `McpConfig`, `AgentsConfig`） | 贴边、`rounded-none`、`border-b` 分隔 | `Card` + `Tabs` + `Item` + `Separator` |
| 侧栏（`SessionSidebar`, `SessionTree`, `SidebarMenu`, `ProjectWorktreePicker`） | `border-r` 分栏、`color-mix` 底色、inset 选中条 | `bg-muted/40` 分区、`data-[selected]:bg-background shadow-sm` |
| 顶部抽屉（`ToolDefinitionsPanel`, `SystemPromptPanel`, `DebugPanel`） | 贴顶、`rounded-t-none` | `Popover`/`Sheet` 浮层，三边 8px |
| 文件面板（`TabBar`, `FileToolbar`, `FileExplorer`, `FileViewer`） | 自绘标签与工具栏，详见 7.1 | `Tabs` + `ScrollArea` + `ToggleGroup` |
| 输入区（`ChatInput`, `ModelSelector`, `NewSessionContextBar`） | 自绘胶囊与状态点 | `PromptInput` / `ModelSelector` pattern + `Badge` |

清理目标（当前计数）：

- `rounded-none` / `rounded-t-none`：33 处
- `border-r` 分栏：11 处
- `color-mix(`：15 处（`ChatMinimap`, `ui/bubble`, `MermaidBlock`, `MessageView`, `DiffView`, `SkillsConfig`, `FileExplorer`, `SvgBlock`, `SidebarMenu`, `FileViewer`）
- `shadow-[inset`：2 处- 行内 hex：48 处（`ModelsConfig` 7、`ChatWindow` 6、`ChatInput` 6、`SessionSidebar` 5、`AppShell` 5 等）
- 自定义布局类：约 78 个（`markdown` 102 个与 ANSI 32 个保留）

品牌色与终端主题不留字面量：新增 `--brand-*`、沿用 `--terminal-*`。

### 7.1 文件面板（`TabBar` / `FileToolbar`）

**Tab 条**（`components/TabBar.tsx`）：现在是“一条 muted 轨道 + 活动段抬底”的自绘实现，活动段只有 `bg-background` 没有边框，在白色面板上看着像浮空、边缘发虚。

目标（官方 `Tabs` 结构）：

- 轨道：`inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]`。
- 段：`rounded-md border border-transparent px-2 py-1 text-xs`；活动段 `bg-background shadow-sm dark:border-input dark:bg-input/30`。
- 关闭按钮：`size-4 rounded-sm opacity-60 hover:opacity-100`（官方 `Tabs` 不带，但需与按钮语汇一致，用 `Button variant="ghost" size="icon"` 的 `size-4` 规格）。
- 拖拽排序、中键关闭、滚轮横滚（`globals.css` 的 `.tabbar-scroll` 隐藏滚动条）全部保留。

**工具栏**（`components/FileToolbar.tsx`）：现在一行塞进路径、meta、live 点、`Source/Preview/Diff` 三按钮、`@`、复制、下载，窄屏时路径被压成 `d …gnment.md m…`、按钮挤在一起。

目标（分两组，官方 `ToggleGroup` + `Button`）：

- 左侧：`Breadcrumb` 形式的路径 + meta（次要信息 `text-muted-foreground`）。
- 右侧：
  - 视图切换用 `ToggleGroup type="single" size="sm"`（`Source / Preview / Diff`），不再用三个独立 `Button`。
  - 次要动作（`@` 插入引用、复制、下载）用 `Button variant="ghost" size="icon-sm"`，每个都带 `Tooltip`；宽度 `< 640px` 时这三个收进一个 `DropdownMenu`（`…`）。
- 行内间距：`gap-2`，组内 `gap-1`；高度对齐 `Button size="sm"`（`h-8`）。

新增 `lib/design-language.test.mjs`，扫描 `components/**`、`app/**`（`app/globals.css` 的 markdown/ANSI 区白名单），命中即失败：

1. `rounded-none`、`rounded-t-none`、`rounded-b-none`
2. `color-mix(`
3. `shadow-[inset`
4. `#[0-9a-fA-F]{3,8}` 形式的内联颜色（`--brand-/--terminal-` 变量定义处除外）
5. `border-b border-border`、`border-t border-border`、`border-r border-border` 作为布局分隔（markdown 表格除外）

## 9. 执行阶段

| 阶段 | 内容 | 提交 |
|---|---|---|
| S1 | `trace.tsx`、`code-block.tsx`、`message.tsx`、`bubble.tsx` 恢复官方源码；新增 `item.tsx`、`attachment.tsx`、`marker.tsx`；删除 `globals.css` 组件覆盖层 | `3eb739a1` + `377583fa`（偏差记录） |
| S2 | 转录区收口：自定义事件默认折叠；todo → `Plan` pattern；正文解除限高；`ActivityRows` 死代码确认无残留 | `16ddebb1` |
| S3 | 自研元素映射（第 4 节逐行）：用量/速率/压缩/cache-miss/状态栏/chip/子代理/队列/plan/sources/上下文/minimap/分支/diff/媒体 | `aaac80a4`、`6ec90b2a`、`96e644cb`、`6615e489` |
| S4 | 列表外界面（第 7 节）：设置、侧栏、抽屉、TabBar、文件面板、输入区；扩展状态标签大小写归一 | `273bc872`、`53999b69` |
| S5 | 门禁测试 + `transcript-rewrite.md` 同步 + 截图比对 | `53999b69`（门禁）与本轮文档提交 |

每个阶段自检：`tsc --noEmit`、`eslint`、该阶段相关测试；S5 之后完整跑一遍，再构建。

## 10. 验收

1. 同一视口并排比对官方示例截图，逐项量：行字号 14px、图标 16px、gap 8px、折叠缩进 16px + 1px rail、块底 `--muted`、圆角 `--radius`（`size="sm"` 用 `rounded-xl`）、无边框、无粗体行、meta 紧跟标题且不截断。
2. 第 4 节表格逐行认领：每个自研信息能指出它现在落在哪个官方槽位。
3. 长回答（>40vh）自然展开、不出现块内滚动条；用户消息同样不出现块内滚动条（不得出现双重滚动条，第 5 节）；工具输出仍然限高。
4. 打开会话时自定义事件行全部收起（第 4.1 节）；`todo` 行显示 `Plan: … N of M done` 与步骤行，不出现原始 JSON（第 4.2 节）。
5. 设置、侧栏、抽屉、文件面板无 `rounded-none`、无分割线、无 `color-mix`、无 hex；Tab 活动段有边框（`dark:border-input`）；<640px 时工具栏只剩路径 + 视图切换 + `…`。
6. 门禁测试通过；`tsc`、`eslint`、全部相关测试通过。

## 11. 风险与决策

| 项 | 决策 |
|---|---|
| 官方源码是 Base UI 版 | 只做语法等价改写（`render=` → `asChild`、动画变量），类名照抄 |
| 折叠动画 | Base UI 的高度变量用 Radix `data-state` + 等价 CSS 动画实现；动画参数与官方一致（200ms） |
| `wiring.test.mjs` 依赖 `cn-trace-*` 类名 | 断言改为官方 `data-slot`，只改断言不改行为 |
| `demo/components/` 镜像 | 与本轮改动同步；`demo/components/AppShell.tsx.orig` 已在上一轮删除 |
| markdown / ANSI 自定义类 | 保留（prose 与终端语义），只清理布局类 |
| 终端 xterm 调色板 | 保留，颜色取值收进 `--terminal-*` |
| 官方 `scroll-fade-x/y` utility | 本仓未注册（`shadcn/tailwind.css` 未引入），`code-block` 内联类里省去，不加假类 |
| `@shadcn/react/message-scroller` | 不引入依赖；消息列表滚动用现有实现 |
| 用户字号偏好 | 改缩放根字号，不引入自定档位 |
| “直角清零”的边界 | 只在**自绘背景**的面板/卡片上禁止 `rounded-none`：列表行、`TabsList` 内的段、填充整行的骨架屏没有表面可圆，官方自己也是这么写的。门禁用「同一行出现裸 `bg-*` 才判定」表达这条边界 |
| `Subagent` 行 | 本机官方语料没有 `agent.tsx` 源码，按 trace 槽位组合（标题+状态+折叠内容）实现，未自创子代理专属视觉 |
| 行内 hex 保留项 | 主题色 `<meta>`/manifest（浏览器读不到 CSS 变量）、favicon 画布、xterm 调色板、`ModelsConfig` 六级思考强度色阶（无对应令牌）、设置里的主题预览色块；其余 hex 已清零 |
| 扩展状态标签大小写 | 自由文本按 `lib/label-case.ts` 归一：单词首字母大写，纯辅音的缩写（mcp/ssh/lsp）全大写，已有大写与译文不动 |
| 行标题的两段结构 | 动作（`Ran` / `Read` / `Thinking`）与对象（命令、文件名）分开渲染：动作 `shrink-0 whitespace-nowrap` **永不省略**，对象 `min-w-0 truncate` 承担省略；描述同样只做 `truncate`（用户要求：工具名称不得被省略） |
| 详情块的标签 | 参数/结果的标签进官方 `CodeBlockHeader`/`CodeBlockTitle`，不再在卡片外另起一行 caption |
| 行间距 | 不覆盖官方 `Trace` 的 `gap-2`；此前各处 `gap-1`/`gap-1.5` 覆盖让列表显得拥挤，已全部去掉 |
| 活跃会话悬浮块 | 官方 `Button variant="outline" size="xs" rounded-full shadow-xs` 胶囊 + `Popover`（`rounded-lg p-1`），不再自绘贴边标签 |

## 12. 不做

- 不改任何 pi 扩展 API、SSE 协议、会话文件格式、数据字段。
- 不改 markdown 渲染语义与 ANSI 解析。
- 不新增第三方依赖（除从官方源码纳入的组件）。
- 不为"未来主题"预留抽象；不改动与本次无关的业务逻辑。

## 13. 变更记录（本轮实现）

- S1–S4 各阶段提交见第 9 节表格；每阶段自检 `tsc --noEmit`、`eslint`、该阶段测试。
- 门禁：`lib/design-language.test.mjs`（第 6 节）扫描 `components/ app/ hooks/ lib/`，白名单逐条写在测试里并注明理由。
- 标签大小写：`lib/label-case.ts` + `lib/label-case.test.mjs`，`ExtensionStatusBar` 的列表、纯文本、命令三类 pill 都过它。
- 截图：桌面 1440 与 390px、浅深各一组，取自真实会话（dev 30221），行标题修复后重拍；比对结论见第 10 节逐项。

## 14. 全局收敛清单（逐块核对，一块一提交）

S1–S5 只把**消息列表的骨架**换成了官方组件。用户指出的“看起来还是老样子”来自其余仍有自制边框、分割线、胶囊、任意字号的界面。下面每一行都按“现状 → 官方落点 → 验收”写清，逐块执行，一块一个 commit，做完把该行标为 ✅。

统一原则（每一块都适用）：

- 只用官方组件已定义的形状：列表用 `Item`/`ItemGroup`，字段用 `Field`/`FieldGroup`，表格用 `Table`，容器用 `Card`/`Separator`/`Empty`，状态用 `Badge variant="outline"`，进度用 `Progress`，弹层用 `Dialog`/`Sheet`/`Popover`/`DropdownMenu`。
- 不出现：自制分割线（`border-t`/`border-b` 行）、自制胶囊（`rounded-full` + 底色）、任意字号（`text-[13px]` 这类，除非是等宽数字）、`shadow-[...]`、`style={{...}}` 内联布局。
- 每个面的正文行只保留“一行一件事”：图标 + 一句标题，必要的一行描述；其余信息进折叠内容或 `HoverCard`。

| # | 面 | 现状问题 | 官方落点 | 验收 | 状态 |
|---|---|---|---|---|---|
| A | 消息列表（`MessageView`/`TurnTrace`/`ActivityRows`/`TranscriptNotices`） | 每行挂时长与 usage；组内再套一层 `Trace`；行内 meta 太多 | `Trace` 行只留 icon+title(+description)；时长只在思考行与折叠组头；usage 每 turn 一行行内小字；**收起=一行一件事，展开=完整命令/参数/结果（不二次截断）**，见 `transcript-rewrite.md` 7.2 | 单行最多两段文字；动作名不省略；展开后信息完整；无胶囊、无边框、无自制底色 | ✅ |
| B | 系统提示与工具定义（`ToolDefinitionsPanel`、系统消息卡） | 自制列表 + 参数表 + “必填/可选”自绘标记 | `ItemGroup`/`Item` + `Table` + `Badge variant="outline"` + `CodeBlock` | 无自制边框/分割线；参数表走官方 `Table` | ✅ |
| C | 调试面板（`DebugPanel`/`debug-panel-state`） | 卡片套卡片、自绘进度条、自制 grid | `Item`列表 + `Badge outline` + `Progress` + `Table` | 一层卡片；状态全走 `Badge` | ✅ |
| D | 设置外壳（`SettingsPanel`） | 顶栏分割线、行分割线、下划线 tab | 已改：官方 segmented `Tabs` + 手机 `Item` 列表 | 无分割线、无直角、tab 为官方形状 | ✅ |
| E | 设置内页（`ModelsConfig`/`McpConfig`/`SkillsConfig`/`PluginsConfig`/`EnabledModelsSection`/`AgentsConfig`/`SettingsUi`） | `border-t`/`border-b` 行、卡片叠分割线、自制表头 | `ItemGroup` 分组 + `Field` 行 + `Table`；`SettingsUi` 只保留官方 `Card`/`Empty` 组合 | 无 `border-t/b` 行；字号只用官方档位 | ✅ |
| F | 侧栏与菜单（`SessionSidebar`/`SessionTree`/`SidebarMenu`/`ProjectWorktreePicker`/`NewSessionContextBar`/`KeepAliveDock`） | 自制行高与选中底色、贴边胶囊 | `Item size="xs"` / `DropdownMenu` / `Sheet` / `Button variant="outline" size="xs"` | 行高由 `Item` 决定；选中态用官方 `data-[state]` | ✅ |
| G | 文件面（`FileToolbar`/`FileExplorer`/`FileViewer`/`TabBar`/`DelimitedTable`/`GitPanel`） | 自制工具栏分组、表格斑马线 | `Tabs`/`Button`/`Table`/`Empty`/`ScrollArea` | 工具栏只剩官方按钮组；表格走 `Table` | ✅ |
| H | 终端（`TerminalPanel`/`TerminalExtraKeys`） | 自制状态条与按钮排布 | `Card` + `Badge` + `Button size="xs"`；保留 `--terminal-*` 调色板 | 状态走 `Badge`；按钮全官方尺寸 | ✅ |
| I | 输入区（`ChatInput`/`ModelSelector`/`PromptInput`） | 自制圆角与阴影、按钮尺寸混杂 | 官方 `prompt-input` pattern：`InputGroup` + `Textarea` + `Popover` | 无自制阴影；按钮只用官方尺寸 | ✅ |
| J | 媒体与 Markdown（`ImagePreview`/`MermaidBlock`/`SvgBlock`/`MarkdownBody`） | 自制图片边框、自制工具栏 | `Attachment`/`Dialog`/`CodeBlock`/官方工具栏 `Button group` | 无自制边框；工具栏为官方组合 | ✅ |
| K | 扩展 UI（`ExtensionStatusBar`/`ExtensionWidgets`/扩展弹窗） | 已改状态标签；弹窗仍自制 | `Badge outline`/`Button`/`Sheet`/`Dialog` | 扩展弹窗走官方 `Sheet`/`Dialog` | 🔄 |

执行顺序：A → B → C → E → F → G → H → I → J → K，每块完成后跑门禁与相关测试并单独提交，本文档同步把状态改为 ✅。
记录在案的例外（官方组件无法承载的结构，理由写在这里，代码里保持同一做法）：

- `SessionTree` 与会话侧栏的虚拟滚动行：行高与位置是测量值（`rowStyle(top, height)`），因此行容器仍是 `div role="treeitem"`，不给它套 `Item`（`Item` 自带 `rounded-2xl`/`py-2`/`flex-wrap`，会推翻测量结果）；选中态与行内形状沿用官方 token。
- `DelimitedTable` 的虚拟化表格（十万行 CSV）：单元格是绝对定位的行网格，`Table` 的 `<tr>` 布局无法承载虚拟化，保留 div grid；它是「一整张网格」，`border-b` 由门禁显式放行。
- `SidebarMenu` 手机端是底部 `Sheet` 形状，用官方 `Button`/`Input` 组成内容，外壳保留既有动画与 `--sidebar-*` 变量。
- 扩展弹窗（`ChatWindow` 的 `ExtensionDialog`）锚定在聊天面板内部、高度受面板限制，保留面板内浮层；内部控件全部为官方 `Button`/`Badge`/`MarkdownBody`。

