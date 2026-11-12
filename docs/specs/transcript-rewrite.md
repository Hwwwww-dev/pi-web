# 转录区重构规格：严格按 shadcn AI Elements pattern 重写

状态：待实施（本文只描述目标，不改代码）

范围：`components/MessageView.tsx`、`components/ActivityRows.tsx`、`components/ChatWindow.tsx`（过程分组与轮末）、`lib/tool-view.ts`（新建）、`components/transcript/*`（新建）

---

## 0. 权威来源与硬规则

### 0.1 权威来源（改代码前必须逐条打开）

本地副本在 `/tmp/shadcn/`（官方 md 原文）与 `/tmp/ai-el/`（AI SDK Elements 旧实现，仅作对照，**不作为实现依据**）。

| 用途 | 文件 |
| --- | --- |
| 元素总览、「三层结构」定义 | `/tmp/shadcn/docs_ai-elements.md` |
| **底座**：Trace 全量（Composition / Features / Status / Description / Collapsible / Open State / Link / Dialog / Sheet / Group / Sources / Chain of Thought / Commit / **Whole Turn** / Reasoning / Tool / API） | `/tmp/shadcn/docs_components_base_trace.md` |
| **底座**：CodeBlock 全量（Header / Actions / Line Numbers / Wrap / Diff / Height / Max Height / Size / Trace / Message / Syntax Highlighting / Terminal Output / Streaming） | `/tmp/shadcn/docs_components_base_code-block.md` |
| 底座：Message（Message / MessageContent / MessageHeader / MessageFooter / MessageAvatar） | `/tmp/shadcn/docs_components_base_message.md` |
| 底座：Bubble（Bubble / BubbleContent / variants / align） | `/tmp/shadcn/docs_components_base_bubble.md` |
| pattern：Tool | `/tmp/shadcn/pattern_tool.md` |
| pattern：Terminal | `/tmp/shadcn/pattern_terminal.md` |
| pattern：Reasoning | `/tmp/shadcn/pattern_reasoning.md` |
| pattern：Chain of Thought | `/tmp/shadcn/pattern_chain-of-thought.md` |
| pattern：Task | `/tmp/shadcn/pattern_task.md` |
| pattern：Plan | `/tmp/shadcn/pattern_plan.md` |
| pattern：Queue | `/tmp/shadcn/pattern_queue.md` |
| pattern：Sources | `/tmp/shadcn/pattern_sources.md` |
| pattern：Stack Trace | `/tmp/shadcn/pattern_stack-trace.md` |
| pattern：Subagent | `/tmp/shadcn/pattern_subagent.md` |
| pattern：Context | `/tmp/shadcn/pattern_context.md` |
| pattern：Message | `/tmp/shadcn/pattern_message.md` |
| pattern：Checkpoint（Marker 语义参考） | `/tmp/shadcn/pattern_checkpoint.md` |

仓库内已适配的底座（**唯一实现**，不改）：

- `components/ui/trace.tsx` — 导出 `Trace`、`TraceLine`、`TraceIcon`、`TraceTitle`、`TraceDescription`、`TraceCollapsible`、`TraceCollapsibleTrigger`、`TraceCollapsibleContent`。已接 `--chat-font-size-offset`、`status="running"` 的 shimmer、错误态配色。
- `components/ui/code-block.tsx` — 导出 `CodeBlock`、`CodeBlockHeader`、`CodeBlockTitle`、`CodeBlockActions`、`CodeBlockCopyButton`、`CodeBlockContent`、`CodeBlockLine`、`CodeBlockFooter`。
- `components/ui/message.tsx` — `Message`、`MessageGroup`、`MessageContent`、`MessageHeader`、`MessageFooter`、`MessageAvatar`。
- `components/ui/bubble.tsx` — `BubbleGroup`、`Bubble`、`BubbleContent`、`BubbleReactions`。

### 0.2 硬规则（违反即返工）

1. **只用官方 pattern 的组合**。过程区的每一行都是 `Trace` → `TraceLine`（→ `TraceCollapsible`）；任何输出都是 `CodeBlock`（代码/终端）、`Markdown`（正文）、`DiffView`（补丁）或媒体元素。不允许自拼卡片、自造标题栏、自造边框、自造分割线。
2. **每一行都要有图标**。`TraceIcon` 在标题前表示动作类型；在标题后表示指示（跳转箭头、状态）。
3. **`TraceLine` 是 `span`，本身不可点击**。要可点必须包在 `TraceCollapsibleTrigger` 里（折叠），或包在 `<a>` / 官方按钮里（跳转）。
4. **`children` 只放 content，不放 layout**。标题一句话一个行；计数/时长/路径摘要进 `TraceDescription`。
5. **状态只映射到 `status`**：`"running" | "error" | "pending"`。running 的 shimmer 由底座提供，不自己加动画。
6. **标题时态按官方规则**：进行中现在时（`正在运行 pnpm build`）、完成无时态（`运行 pnpm build`）、失败（`运行失败：pnpm build` → `status="error"`）。
7. **长内容靠 `CodeBlock` 自己封顶**：`size="sm"`，`wrap`（工具输出换行），`className="max-h-64"`。不自己算高度比例。
8. **错误行**：`status="error"` + `CircleXIcon`，且**内容顶部重复完整错误**（官方明确：标题会截断）。
9. **嵌套层级最多三层**：轮（过程分组）→ 步骤行 → 输出。需要更深时把中间层换成 `CodeBlock` 里的文本。
10. **组件不读 pi 消息**。所有"这行是什么"的判断集中在 `lib/tool-view.ts`（第 4 节），pattern 组件只吃 `ToolView` 与纯 props。
11. **不新增第三方依赖**。官方示例中的 Base UI 专有写法在本项目改写为 radix 等价物：`render={<Button/>}` → `<Button asChild>`（这是唯一允许的语法替换，视觉不得改变）。
12. **i18n 全量走 `t()`**，新增 key 放 `lib/i18n/messages/{zh-CN,en}.ts` 的 `chat.trace.*` 命名空间。

---

## 1. 目标

把「过程区」重写成官方三层结构：

```
轮   TurnTrace        一行总览（Worked for 2m 4s, 1 command failed）+ 展开后的全部步骤
步骤 TraceLine        工具 / 思考 / 计划 / 队列 / 来源 / 子代理 / 错误各一行
输出 TraceCollapsibleContent 里的 CodeBlock / Markdown / DiffView / 媒体
```

`MessageView` 退回消息级组装：用户气泡 = `Message` + `Bubble`；助手正文 = `Message` + `MessageContent` + `Markdown`；轮末 = `MessageFooter` + 用量行。

---

## 2. 非目标

- 不改 `components/ui/*`（除按官方文档补齐缺口组件，见第 3.2 节）。
- 不动 `MarkdownBody`、`DiffView`、`CodemodeToolView`、`AnsiText`、`SessionChatPanel` 的内部实现（只作为 pattern 的 content slot 使用）。
- 不改 pi 数据契约（`toolCall` / `toolResult` / `usage` / `durationMs` / `isError` / `cwd` 形状不变）。
- 不引入 `@shadcn/react`（`MessageScroller`）、shiki、streamdown、motion。
- 不做服务端计算、不做跨会话历史速率统计。

---

## 3. 分层与文件

### 3.1 分层

```
L3  组装   components/MessageView.tsx        消息级：Message / Bubble / MessageContent / MessageFooter
           components/ChatWindow.tsx         轮级：TurnTrace 的位置、过程分组、轮末
L2  pattern components/transcript/*.tsx      Turn | Tool | Terminal | Reasoning | Task | Plan | Queue
                                             Sources | StackTrace | Subagent | Context | Media
L1  底座   components/ui/{trace,code-block,message,bubble}.tsx（官方，已适配）
L0  数据   lib/tool-view.ts                  纯函数：pi 消息 → ToolView
```

### 3.2 文件清单

| 文件 | 职责 | 状态 |
| --- | --- | --- |
| `lib/tool-view.ts` | `ToolView` 类型 + `toToolView()`（`prepare` / `kindOf` / 每个 kind 一个 `*View`）+ `humanizeToolName` / `countDiffLines` / `resultSources` / `imageSource` / `getWrittenFileText` | **已实现** |
| `lib/tool-view.test.mjs` | 20 条断言：每个 kind、未知工具标题、流式入参、空结果、错误态、多文件补丁、来源去重、待办状态 | **已实现** |
| `components/transcript/TraceRow.tsx` | 私有基元：`TraceLine` + 折叠 + 记忆 + 状态图标（被其余 pattern 复用，不单独使用） | 新建 |
| `components/transcript/ToolTrace.tsx` | 通用工具行（read/write/edit/grep/mcp/未知工具） | 新建 |
| `components/transcript/TerminalTrace.tsx` | bash / powershell | 新建 |
| `components/transcript/ReasoningTrace.tsx` | 思考块 | 新建（替代 `ThinkingRow`） |
| `components/transcript/TaskTrace.tsx` | 同类工具的合并组 + 计数标题 | 新建（替代 `ToolGroupRow`） |
| `components/transcript/PlanTrace.tsx` | 不实现：pi 无 `plan` 工具，计划态由 `QueueTrace` 的待办/已完成两段承担（第 5.6 节） | 取消 |
| `components/transcript/QueueTrace.tsx` | `todo` 工具 | 新建 |
| `components/transcript/SourcesTrace.tsx` | `web_search` 结果 | 新建 |
| `components/transcript/StackTraceTrace.tsx` | 任何错误输出（工具失败、异常栈） | 新建 |
| `components/transcript/SubagentTrace.tsx` | `Agent` / `get_subagent_result` | 新建 |
| `components/transcript/TurnTrace.tsx` | 轮总览行 + 内部 `<Trace>` | 新建（替代 `ProcessDetailsGroup`） |
| `components/transcript/ContextBadge.tsx` | ctx% HoverCard + Progress | 新建 |
| `components/transcript/MediaTrace.tsx` | 图片 / 视频 / 音频 | 新建 |
| `components/ui/hover-card.tsx` | 官方 HoverCard（radix 适配，与现有 `ui/*` 同风格） | 新建（第 14 节第 3 条已定） |

### 3.3 依赖方向（禁止反向）

```
MessageView / ChatWindow → transcript/* → ui/trace + ui/code-block + ui/message + ui/bubble
                                       → DiffView / AnsiText / MarkdownBody / CodemodeToolView
                       all → lib/tool-view
```

`transcript/*` 不得 import `ChatWindow`、`MessageView`、`ActivityRows`。

---

## 4. 数据层：`lib/tool-view.ts`

### 4.1 类型（已实现：`lib/tool-view.ts`）

```ts
export type ToolViewKind =
  | "terminal" | "file-read" | "file-write" | "file-edit" | "search"
  | "web" | "codemode" | "subagent" | "mcp" | "queue" | "generic";

export type ToolViewStatus = "running" | "error" | "pending" | "done";

export interface ToolViewStep { title: string; status: ToolViewStatus; description?: string }

export interface ToolViewSection {
  kind: "code" | "diff" | "markdown" | "fields" | "steps";
  /** 同屏同时有参数与结果时，详情块上方的标签走 `chat.activity.parameters/result`。 */
  label?: "parameters" | "result";
  text?: string;
  language?: string;
  files?: SplitDiffFile[];
  fields?: ToolField[];
  steps?: ToolViewStep[];
}

export interface ToolViewSource { title: string; url: string }

export interface ToolView {
  kind: ToolViewKind;
  status: ToolViewStatus;
  /** 一行一句话，不带长参数。 */
  title: string;
  /** 标题后的摘要：文件预览、命令首行、profile。 */
  description?: string;
  /** 折叠后的内容，按顺序渲染。空数组 = 该行不可展开。 */
  sections: ToolViewSection[];
  /** 该行自己的完整文本（shell 命令），进 `CodeBlockHeader` 与复制按钮。 */
  command?: string;
  /** 状态相关标题的目标（命令/文件名/路径/查询词）：进行中拼「正在运行 …」，失败拼「运行失败：…」。 */
  target?: string;
  /** 可点击的文件 chip，最多显示 4 个；相对路径按会话 cwd 解析（`resolveLocalFilePath`）。 */
  filePaths: string[];
  /** 结果里的图片（data URL），渲染在行外。 */
  images: string[];
  sources?: ToolViewSource[];
  subagent?: { sessionId: string; label: string };
  diffStat?: { added: number; removed: number };
  /** 入参还在流式写入：`sections` 恒为空，行只显示标题。 */
  streamingInput: boolean;
  /** 失败时的首行输出，供 `status="error"` 的行显示。 */
  error?: string;
  /** 展开记忆 key（= `toolCallId`）。 */
  foldKey: string;
}

export function toToolView(input: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  t: (key: string, params?: TranslationParams) => string;
}): ToolView;
```

结构与分界：

- `prepare()` 只读一遍消息，产出内部 `Prepared`（结果文本、图片、patch、字段、命令、codemode、mcp 标签…）。
- `kindOf()` 按固定优先级返回 kind（`mcp` → `subagent` → `codemode` → `terminal` → 写 → 编辑 → 读取 → 搜索 → 网络 → 队列 → 其它），每个 kind 一个 `*View(p)` 构造函数，`toToolView` 只做 `switch`。
- 翻译函数 `t` 由调用方注入，模块本身不读 React context、不做 IO，可直接在 Node 里测。
- **不含** usage / ctx / 颜色 / JSX：用量与 ctx 仍由调用方渲染在行尾（第 8 节第 3 条）。
- 复用导出：`countDiffLines`、`resultSources`、`imageSource`、`getWrittenFileText`、`humanizeToolName`（`tool-view-labels.ts` 已合并进本文件，图标由 `components/transcript/*` 按 kind 决定）。

### 4.2 判定表（`kindOf()` 的实现顺序）

| 条件 | kind | 图标（lucide） | 标题 | sections |
| --- | --- | --- | --- | --- |
| 结果 `details` 带 `{server, tool}` | `mcp` | `PlugIcon` | `server/tool` | `fields(入参)` + `code(结果, json)` |
| `Agent` / `get_subagent_result` / `steer_subagent` | `subagent` | `BotIcon` | `运行子代理`，description=`profile · 描述` | `markdown(报告)` 或 `fields`；`subagent` 供打开 tab |
| `codemode` 且入参完整 | `codemode` | `CodeIcon` | `运行脚本`，description=代码首行 | `code(脚本, typescript)` + `steps(脚本内调用)` + `code(结果)` |
| `bash` / `powershell` 且入参完整 | `terminal` | `SquareTerminalIcon` | `运行 <命令首行>` | `code(输出)`；完整命令在 `command` |
| `write` | `file-write` | `PenIcon` | `写入 <文件名>` | `code(文件内容, 该文件语言)`；无内容时 `fields` + `code(入参 json)`；`code(结果)` |
| `edit` / `apply_patch` | `file-edit` | `PenIcon` | `编辑 <文件名>` 或 `编辑 N 个文件` | `diff(patch)`；apply_patch 用 `files[]`；`diffStat` |
| `read` / `ls` / `find` | `file-read` | `BookOpenIcon` | `读取 <文件名>` | `fields` 或 `code(入参 json)`；`code(结果, 该文件语言)` |
| `grep` / `glob` | `search` | `SearchIcon` | `搜索 <pattern>` | `fields(入参)` + `code(结果)` |
| `web_search` / `web_fetch` / `fetch` | `web` | `GlobeIcon` | `来源 N`（结果含 URL）否 `抓取 <query/url>` | 有 URL：`sources[]`，无 sections；否则 `fields` + `markdown(结果)` |
| 计划类工具（`todo`）且入参有 `todos[]` | `queue` | `ListTodoIcon` | `N 项待办` 或 `N 项已完成` | `steps(条目, 状态)` |
| 其它（含扩展工具） | `generic` | `WrenchIcon` | 人类化工具名（4.3） | `fields` 或 `code(入参 json)`；`code/markdown(结果)` |

判定顺序的两处要点：

- `mcp` 先于一切：MCP 工具的注册名是 `mcp__server__tool`，可能与其他名字撞形，只有结果的 `details` 能给出 `server/tool`。
- `terminal` 的判据是"入参完整且有 `command`"，所以流式入参不会假装成终端行。
- `web_search` / `web_fetch` 由 `lib/tool-categories.ts` 的 `isWebToolName()` 识别（该函数原本只认 `webfetch`/`websearch`/`fetch`，pi 的实际工具名是 `web_search`/`web_fetch`，已补齐）。

### 4.3 兜底规则（已实现）

- `humanizeToolName()`：去掉 `mcp__server__` 前缀 → `_`/`-` 变空格 → 驼峰拆词 → 首字母大写。`get_subagent_result` → `Get subagent result`，`mcp__docs__searchDocs` → `Search Docs`。
- **禁止**把入参 JSON 原文当标题。入参一律走 `fields`（`lib/tool-fields.ts` 的 `toolFieldsOfInput`；非扁平入参整体退回 JSON 视图）。
- 结果为空（`""` 或 `"(no output)"`）：不加结果 section。
- 流式入参（`block.rawInput !== undefined`）：`sections` 恒为空，标题的 description 由调用方显示"正在生成参数"（第 7.3 节）。
- `edit` / `apply_patch` 有 patch 时丢弃 `"ok"` 之类的结果文本（当前界面同样不显示）；无 patch 时仍显示结果。
- 失败：`status="error"`，`error` 取结果首行；`apply_patch` 的 `details.result.failures` 非空即使 `isError` 缺失也算失败。

### 4.4 与 UI 的分界

- 判断"是什么工具、标题说什么、详情有哪些段" → `lib/tool-view.ts`。
- 判断"哪个图标、哪句中文" → `components/transcript/*`（图标）+ i18n `chat.trace.*`（文案）。
- 判断"怎么渲染" → `components/transcript/*`。
- 判断"这条消息是用户还是助手" → `MessageView`。

`lib/tool-view.test.mjs`（20 条，已通过）：每个 kind 一条、未知工具标题、流式入参不产 section、空结果不产 section、错误态、apply_patch 多文件、来源去重、待办状态、diff 计数。
## 5. pattern 规格

每个 pattern 给出：官方骨架（逐字）→ 本项目实现（目标代码）→ 允许的差异 → 禁止。

### 5.0 全部 pattern 共用的行规则

官方组件不规定排版细节，以下是本项目必须一致的约束（每个 pattern 都适用）：

| 约束 | 取值 | 理由 |
| --- | --- | --- |
| 行宽 | 占满内容区宽度 | 长标题出省略号，折叠箭头始终留在行尾（`70%` 上限在手机上把命令挤断，已移除） |
| 换行 | 标题单行 `truncate`，描述同一行；参数/结果才换行 | 元素不能一个上一个下 |
| 字号 | 行文字 `13.5px + var(--chat-font-size-offset)`；标题与描述同号 | 用户要求字体统一 |
| 字体样式 | 不用斜体；时间、计数用 `tabular-nums` | 横平竖直 |
| 图标列 | `TraceIcon` 固定 `size-4`，同一列对齐 | 行与行左边缘对齐 |
| 缩进 | 子内容用 `TraceCollapsibleContent` 的官方内缩，不叠加自定义 padding | 层级只靠一层缩进 |

### 5.1 Turn（整轮）—— 官方 `trace` 文档「Whole Turn」

**官方骨架**

```tsx
<TraceCollapsible defaultOpen>
  <TraceCollapsibleTrigger>
    <TraceLine status="error">
      <TraceTitle>Worked for 2m 4s, 1 command failed</TraceTitle>
    </TraceLine>
  </TraceCollapsibleTrigger>
  <TraceCollapsibleContent keepMounted className="flex flex-col gap-2">
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon><BrainIcon /></TraceIcon>
            <TraceTitle>Thought</TraceTitle>
            <TraceDescription>12s</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
      </TraceCollapsible>
      {/* 步骤行继续 */}
    </Trace>
  </TraceCollapsibleContent>
</TraceCollapsible>
```

**本项目实现** `components/transcript/TurnTrace.tsx`

```tsx
export function TurnTrace({ summary, status, defaultOpen, children }: {
  summary: string;                 // "处理详情 · 8 终端 · 2 文件"
  status?: "error";
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <TraceCollapsible defaultOpen={defaultOpen} onOpenChange={...}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceTitle>{summary}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="flex flex-col gap-2">
        <Trace className="gap-1.5">{children}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
```

- 位置不变：仍由 `ChatWindow` 渲染在轮内正文之前，`ProcessDetailsGroup` 换成 `TurnTrace`。
- 计数语义不变（`chat.processDetails` + 各类计数），仍按 `TOOL_CATEGORY_LABEL_KEYS` 生成。
- `defaultOpen` 规则不变：本轮已有最终答复则收起，否则展开。
- 轮内有失败工具时 `status="error"`（新增，官方示例的同一行也这么做）。

**允许的差异**：标题文案走 i18n；`keepMounted` 保留以维持展开时的 DOM 状态（官方示例同写法）。
**禁止**：自己加背景、边框、圆角、吸顶；自己算高度。

### 5.2 Tool（通用工具行）—— `pattern_tool.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine>
        <TraceIcon><TerminalIcon /></TraceIcon>
        <TraceTitle>Ran git status --short</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <CodeBlock size="sm">
        <CodeBlockContent wrap className="max-h-64">{output}</CodeBlockContent>
      </CodeBlock>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/ToolTrace.tsx`（`TraceRow` 基元 + 通用内容）

```tsx
<Trace>
  <TraceCollapsible open={open} onOpenChange={onToggle}>
    <TraceCollapsibleTrigger>
      <TraceLine status={status === "error" ? "error" : undefined}>
        <TraceIcon><FileTextIcon /></TraceIcon>
        <TraceTitle>{view.title}</TraceTitle>
        {view.description && <TraceDescription>{view.description}</TraceDescription>}
        {view.status === "running" && <TraceDescription>{t("chat.trace.running")}</TraceDescription>}
        {view.error && <TraceIcon><CircleXIcon /></TraceIcon>}
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted className="mt-1 flex flex-col gap-2">
      {view.sections.map(renderSection)}
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

- 行尾时长与用量仍由调用方追加（第 8 节），不进 `ToolView`。
- 有 `action` 且无 `sections` 时：`<a>` 包 `TraceLine` + 尾部 `<TraceIcon><ArrowUpRightIcon /></TraceIcon>`（官方 Sources 同形）。
- `sections` 为空：不渲染 `TraceCollapsible`，直接 `TraceLine`（官方 States 里的纯行）。

**允许的差异**：内容 slot 由 `CodeBlock` / `DiffView` / `MarkdownBody` / `MediaTrace` 决定。

### 5.3 Terminal —— `pattern_terminal.md`

**官方骨架** 与 5.2 相同，标题 `Ran <command>`，内容 `CodeBlock size="sm"` + `CodeBlockContent wrap className="max-h-64"`。

**本项目实现** `components/transcript/TerminalTrace.tsx`

```tsx
<Trace>
  <TraceCollapsible open={open} onOpenChange={onToggle}>
    <TraceCollapsibleTrigger>
      <TraceLine status={status === "error" ? "error" : active ? "running" : undefined}>
        <TraceIcon><TerminalIcon /></TraceIcon>
        <TraceTitle>{t("chat.trace.ran", { command: firstLine })}</TraceTitle>
        {exitCode !== undefined && exitCode !== 0 && <TraceDescription>exit {exitCode}</TraceDescription>}
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted className="mt-1">
      <CodeBlock size="sm" variant={status === "error" ? "destructive" : "default"}>
        <CodeBlockHeader>
          <CodeBlockTitle>{"$ " + command}</CodeBlockTitle>
          <CodeBlockActions><CodeBlockCopyButton value={command} /></CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-64">{output}</CodeBlockContent>
      </CodeBlock>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

- 命令进 `CodeBlockHeader`（官方 Header 的用途：一行标题 + 操作），输出进 `CodeBlockContent`。
- ANSI：`AnsiText` 结果放进 `CodeBlockContent`；`CodeBlock` 不支持 ANSI 时用 `AnsiText` + 相同 `max-h-64` 容器，不改配色。
- 错误：`variant="destructive"` + `status="error"` + 内容顶部重复错误行（官方 Stack Trace 同形）。

**允许的差异**：header 里的命令单行截断，完整命令靠 Copy 按钮；这与官方 Header 一致。

### 5.4 Reasoning —— `pattern_reasoning.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine>
        <TraceIcon><CircleCheckIcon /></TraceIcon>
        <TraceTitle>Thought</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/ReasoningTrace.tsx`

```tsx
<Trace>
  <TraceCollapsible open={open} onOpenChange={onToggle}>
    <TraceCollapsibleTrigger>
      <TraceLine status={active ? "running" : undefined}>
        <TraceIcon><BrainIcon /></TraceIcon>
        <TraceTitle>{active ? t("chat.trace.thinking") : t("chat.trace.thought")}</TraceTitle>
        {durationMs !== undefined && <TraceDescription>{formatToolDuration(durationMs)}</TraceDescription>}
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent className="whitespace-pre-wrap">
      <ReasoningText text={text} />
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

- 文案两态保留：进行中 `思考`（`status="running"` 自带 shimmer），完成 `思考完 · 15s`。
- 内容保留现有能力：流式跟随末尾、`deferred` 历史内容展开时再拉、`MAX_THINKING_CACHE_ENTRIES`、`THINKING_STREAM_TAIL_TOLERANCE`、按块渲染长思考（现有分段逻辑整体搬进 `ReasoningText`）。
- 默认展开策略沿用 `isThinkingExpandedByDefault`，`THINKING_EXPANDED_EVENT` 照发。

**禁止**：自己写闪烁/渐变；`status="running"` 已由 `trace.tsx` 提供。

### 5.5 Task（同类合并组）—— `pattern_task.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible defaultOpen>
    <TraceCollapsibleTrigger>
      <TraceLine>
        <TraceTitle>Found the project files</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted>
      <Trace>
        <TraceLine>
          <TraceIcon><SearchIcon /></TraceIcon>
          <TraceTitle>Searched for app/page.tsx</TraceTitle>
        </TraceLine>
        <a href="/files/app/page.tsx">
          <TraceLine>
            <TraceIcon><FileTextIcon /></TraceIcon>
            <TraceTitle>Read app/page.tsx</TraceTitle>
          </TraceLine>
        </a>
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/TaskTrace.tsx`

- 触发条件不变：连续同类工具（`getToolCategory()` 相同）合并成一组。
- 标题：`8 终端` / `3 文件`；进行中再加 `TraceDescription`（`1 失败` 时 `status="error"`）。
- 内容：`<Trace>` 内逐行 = 各自的 pattern 行（5.2–5.10），不再走子级折叠以外的东西。
- 搜索命中在组内时，仍在组尾塞 `<span data-search-target hidden>`（现有行为）。
- 组记忆 key 沿用 `groupKey`。

**允许的差异**：组内行保留完整 pattern（官方示例里嵌套行是简化的单行；这里输出必须可展开）。

### 5.6 Plan —— 不单独实现（并入 5.7 Queue）

pi 的工具表里没有 `plan` 工具（内置只有 `bash`/`edit`/`find`/`grep`/`ls`/`powershell`/`read`/`write`；计划能力由 `todo` 工具与子代理 profile 承担）。为一个不存在的工具写 `PlanTrace` 属于对未来设计，故取消该文件。

官方的 Plan pattern 与 Queue pattern 的差别只有两点：**标题里带 `2 / 5 done`**、**未完成项分 `pending` 与 `running` 两态**。这两点由 5.7 的行承担：

- `queue` 行的标题已给出 `N 项待办` / `N 项已完成`；
- `ToolViewStep.status` 已保留 `pending`（`CircleIcon`）与 `running`（`CircleDotIcon` + shimmer）两态，条目按原顺序渲染。

若将来 pi 增加 `plan` 工具，只需在 `kindOf()` 里加一个 kind 并复用 `queueView` 的渲染，不必新增 pattern。

### 5.7 Queue —— `pattern_queue.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible defaultOpen>
    <TraceCollapsibleTrigger>
      <TraceLine><TraceIcon><ListTodoIcon /></TraceIcon><TraceTitle>2 to do</TraceTitle></TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace>
        <TraceLine><TraceIcon><CircleIcon /></TraceIcon><TraceTitle>Update the registry snapshots</TraceTitle></TraceLine>
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine><TraceIcon><ListChecksIcon /></TraceIcon><TraceTitle>1 completed</TraceTitle></TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace>
        <TraceLine><TraceIcon><CircleCheckIcon /></TraceIcon><TraceTitle>Add a changeset</TraceTitle></TraceLine>
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/QueueTrace.tsx`

- 两段：`N 待办`（`ListTodoIcon` + `CircleIcon`）与 `N 已完成`（`ListChecksIcon` + `CircleCheckIcon`）；空的段不渲染。
- `todo` 工具的入参即队列快照；条目描述（若有）作为 `TraceLine` 的第二行 → 用 `TraceCollapsible` 包该条目。

### 5.8 Sources —— `pattern_sources.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine><TraceIcon><GlobeIcon /></TraceIcon><TraceTitle>Used {n} sources</TraceTitle></TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace>
        {sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
            <TraceLine>
              <TraceIcon><GlobeIcon /></TraceIcon>
              <TraceTitle>
                {s.title ?? new URL(s.url).hostname}
                <span className="sr-only"> (opens in a new tab)</span>
              </TraceTitle>
              <TraceIcon><ArrowUpRightIcon /></TraceIcon>
            </TraceLine>
          </a>
        ))}
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/SourcesTrace.tsx`

- 触发：`web_search` 结果里的 URL 列表（解析失败时整行退化为 `ToolTrace`）。
- 标题 `来源 · N`；行内 `TraceTitle` = 标题或域名，尾部 `ArrowUpRightIcon`。
- 失败态：`status="error"` + `CircleXIcon`，内容顶部重复完整错误（第 5.9 节规则）。

### 5.9 Stack Trace —— `pattern_stack-trace.md`

**官方骨架**

```tsx
const [error, ...frames] = stack.split("\n").map((line) => line.trim())

<Trace>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine status="error">
        <TraceIcon><CircleXIcon /></TraceIcon>
        <TraceTitle>Failed: {error}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <div className="flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs">
        <p className="text-destructive">{error}</p>
        <ol>
          {frames.map((frame, i) => (
            <li key={i} className={frame.includes("node_modules") ? undefined : "text-foreground"}>{frame}</li>
          ))}
        </ol>
      </div>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/StackTraceTrace.tsx`

- 触发：工具结果 `isError`、`bash` 非零退出且无输出解析、异常栈。
- 标题 `运行失败：<cmd>` / `编辑失败：<path>`（`status="error"`）。
- 内容：顶部完整错误（`text-destructive`）+ 栈帧列表；`node_modules` 帧保持 muted，自家帧 `text-foreground`。
- 无栈时只渲染错误文本，不造空 `<ol>`。

### 5.10 Subagent —— `pattern_subagent.md`

**官方骨架**

```tsx
<Trace>
  <TraceCollapsible>
    <TraceCollapsibleTrigger>
      <TraceLine>
        <TraceIcon><CircleCheckIcon /></TraceIcon>
        <TraceTitle>Ran the research agent</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted className="flex flex-col gap-3">
      <Trace>
        <TraceLine>
          <TraceIcon><CircleCheckIcon /></TraceIcon>
          <TraceTitle>Ran grep -rn cacheKey scripts</TraceTitle>
        </TraceLine>
      </Trace>
      <p>The cache is keyed on the commit SHA.</p>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</Trace>
```

**本项目实现** `components/transcript/SubagentTrace.tsx`

- 标题 `运行子代理` / `运行子代理 <name>`；进行中 `status="running"` + `TraceDescription`（已运行时长）。
- 内容：`<Trace>` 内是子代理做的事，下面是报告正文（`MarkdownBody`）。步骤取自 `view.sections` 的 `steps` 段，由 `subagentView` 从 `result.details` 的运行记录生成；当前内置 subagent 的 details 不带 step 记录，因此行内只渲染报告正文，等 producer 提供 steps 后自动出现。
- 行尾动作保留：点击打开子代理 tab（`onOpenSubagent`），沿用 `SessionChatPanel`，不改。
- 后台运行未完成：只有 `TraceLine`（`status="running"`），没有内容区。

### 5.11 Context —— `pattern_context.md`

**官方骨架**

```tsx
<HoverCard>
  <HoverCardTrigger delay={10} closeDelay={100} render={<Button variant="outline" size="sm" />}>
    {percent}% context
  </HoverCardTrigger>
  <HoverCardContent className="flex w-64 flex-col gap-3">
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">Context</span>
      <span className="text-muted-foreground">{used} / {limit}</span>
    </div>
    <Progress value={percent} aria-label="Context used" />
  </HoverCardContent>
</HoverCard>
```

**本项目实现** `components/transcript/ContextBadge.tsx`

- radix 写法：`<HoverCardTrigger asChild><Button variant="ghost" size="sm" /></HoverCardTrigger>`。
- 数据来自现有 `ctxTokens` / `ctxWindow`（`UsageBar` 已算好），不新增请求。
- `formatTokens()` 与现有会话 stats 的紧凑格式保持一致（`lib/session-stats-format.ts`）。

**允许的差异**：触发器用 `ghost`/`sm` 而非 `outline`，以免轮末出现第二个描边按钮。

### 5.12 Message / Bubble（消息级）—— `pattern_message.md` + `docs_components_base_*`

**官方骨架**

```tsx
<Message align="end">
  <MessageContent>
    <Bubble align="end" variant="muted"><BubbleContent>{text}</BubbleContent></Bubble>
  </MessageContent>
</Message>

<Message>
  <MessageContent className="gap-2">
    <p>{text}</p>
    <MessageFooter><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button></MessageFooter>
  </MessageContent>
</Message>
```

**本项目实现** `components/MessageView.tsx`

- 用户消息：`<Message align="end">` + `<MessageContent>` + `<Bubble align="end" variant="muted"><BubbleContent>` + 现有编辑/fork/引用按钮进 `MessageFooter`。
- 助手消息：`<Message><MessageContent className="gap-2">` 内依次是
  1. `AssistantMessageHeader`（`↓ tokens` + `t/s` 徽章）——位置、字号、配色、动画全部不动（第 6 节）；
  2. `TurnTrace`/`Trace` 过程行；
  3. 正文 `MarkdownBody`；
  4. 轮末用量行（`formatUsage`）+ 复制。
- `MessageFooter` 承载复制/耗时；`MessageHeader` 只在显示模型名时用。

**禁止**：把 `Bubble` 用在助手的流式正文上（官方 Bubble 是消息表面，长正文会得到气泡边框）。

### 5.13 官方无 pattern 的内容（补丁 / 媒体 / 参数表）

规则：**不发明 pattern**，用官方底座组合。

| 内容 | 组合 |
| --- | --- |
| 文件补丁 | `CodeBlock` + `CodeBlockHeader`（文件名）+ `CodeBlockContent` 内现有 `DiffView`；或按官方 Diff 示例逐行 `CodeBlockLine variant="added" \| "removed"`（单文件小补丁） |
| 多文件补丁 | `TaskTrace` 内逐文件一行 `TraceLine`（`FileTextIcon` + 路径 + `+48 −12` 描述），展开后是 `DiffView` |
| 图片 | `TraceCollapsibleContent` 内现有缩略图 + 点击预览组件，外用 `max-h-64` 封顶 |
| 视频 / 音频 | `<video controls playsInline className="max-w-full rounded-md" />` / `<audio controls className="w-full" />`，**不得**按文本展示 |
| 入参键值 | `CodeBlock size="sm"` + `CodeBlockLine`（`label` muted + 值），来自 `lib/tool-fields.ts` |
| codemode 脚本 | `TraceLine`（`CodeIcon`，`运行脚本`）→ `CodeBlock`（脚本）→ 嵌套 `<Trace>`（脚本内每次调用一行） |

---

## 6. token 速率：`lib/stream-token-rate.ts`（本次不改）

### 6.1 唯一实现与四个导出

文件：`lib/stream-token-rate.ts`（40 行，无 React、无副作用、无 IO）。测试：`lib/stream-token-rate.test.mjs`（4 条用例）。

| 导出 | 签名 | 语义 | 边界 |
| --- | --- | --- | --- |
| `StreamRateStart` | `{ at: number; tokens: number }` | 一条回复的起表点：**首个 token 出现的时刻**与该时刻的累计 token 估算值 | 不是"请求开始时刻" |
| `streamRateKey` | `(message: { provider?, model?, timestamp? }) => string \| null` | 回复身份：`` `${provider}/${model}@${timestamp}` `` | `timestamp` 不是数字时返回 `null`（无身份的回复不跨挂载记忆） |
| `streamRateStart` | `(key, tokens, now) => StreamRateStart` | 起表/取表：有记录直接返回；无记录则以 `{ at: now, tokens }` 新建并**立即**写入 Map | 中途加入（刷新页面）只从当下计时，此前已流出的 token 不计入 |
| `streamTokensPerSecond` | `(start, tokens, now) => number \| null` | `(tokens − start.tokens) ÷ ((now − start.at) ÷ 1000)` | `elapsed ≤ 0.25s` 返回 `null`，避免首帧除以近零时间得到虚高值 |

常量：`MAX_TRACKED_REPLIES = 32`（超出按插入序淘汰最旧的一条，`starts.delete(starts.keys().next().value!)`）。

### 6.2 为什么状态在模块级 `Map`，不在组件里

文件头注释原文即结论：**切会话会 remount `ChatWindow`**。计时器若放组件内，重挂载后会把"已经流出的全部 token"除以"重挂载后经过的时间"，算出虚高速率。`stream-token-rate.test.mjs` 第 1 条用例就是这条：20 s 后回到原会话，`streamRateStart` 必须仍返回旧的 `{ at: 10000, tokens: 20 }`，速率从 50 t/s 连续涨到 75 t/s，而不是跳变。

同理，第 4 条用例锁定淘汰行为：第 33 条回复写入后，最早那条记录的 key 已失效，重新取表返回新记录。

### 6.3 调用点（`components/MessageView.tsx`，逐字保留）

| 位置 | 作用 |
| --- | --- |
| `:47` `RATE_HOLD_MS = 6000` | 流束结束后速率与 token 数停留 6 s，而不是随 `isStreaming=false` 瞬间消失 |
| `:577–579` `rateKey = streamRateKey(message)` / `streamRateKeyRef` | 每条消息一个身份；每次渲染刷新 ref，供 300ms tick 读取最新 key |
| `:588–604` `estimatedTokens`（`useMemo`，依赖 `[blockItems, isStreaming]`） | 逐 block 调 `getTokenEstimateText()` + `estimateUpdatedTokens(cache, text)`，前缀相同的后缀只算增量；`isStreaming=false` 时清缓存并归零；`getTokenEstimateText()` 返回 `null` 的 block 被跳过 |
| `:583` `lastRateRef`（`:607–609` 写入） | 记录流式期间最后一帧 `{ tokens, tps }`，供停留期显示 |
| `:605–606` `estimatedTokensRef` | 每渲染同步，tick 闭包读它而不是读 state |
| `:611` `heldRate` | `!isStreaming && holdRate` 时为最后一帧读数，否则 `null` |
| `:673–681` | 流束结束：`streamStartRef.current = null`、`setTps(null)`；若有 `lastRateRef` 则 `setHoldRate(true)` + `setTimeout(..., RATE_HOLD_MS)` |
| `:710–714` `tick()` 的速率计算 | `tokens === 0` 直接返回不起表；`streamStartRef.current ??= streamRateStart(streamRateKeyRef.current, tokens, now)`；`streamTokensPerSecond(...)`；`rate !== null` 才 `setTps(rate)` |
| `:716` `setInterval(tick, 300)` | 固定 300ms 采样，不随 chunk 触发 |
| `:734–735` | `<AssistantMessageHeader estimatedTokens={isStreaming ? Math.round(estimatedTokens) : heldRate ? heldRate.tokens : 0} tps={isStreaming ? tps : heldRate ? heldRate.tps : null} />` |

`estimateTokens()`（`MessageView.tsx:48`）：CJK 一字一 token，其余 3.5 字符一 token。这是**估算层**，与 pi 的 `usage.output` 不是同一个数。

### 6.4 显示规则（`AssistantMessageHeader`，`MessageView.tsx:462`）

- 容器：`flex min-h-[calc(1.5em+2px)] items-center gap-1.5 font-mono text-[11px] tabular-nums`。
- token 数：`ArrowDownIcon`（`size-2.5`、`strokeWidth 1.5`）+ 整数（不补千分位、不设最小宽度），`title` 为 `i18n.estimatedTokens`。
- 速率为 `null` 时不渲染徽章；否则 `Badge variant="ghost"`、`px-1.5 py-0 text-[10px]`、文本恒为 `${tps.toFixed(1)} t/s`（一位小数）。
- 五档（按 `tps` 降序判断）：

| 速率 | 样式 |
| --- | --- |
| `> 120` | 文字白 + 流动彩虹层 `.tps-rainbow`（`absolute inset-y-0 left-0 rounded-[inherit]`），`animationDuration = max(0.3, 50 / tps)` 秒（保留两位小数），文字 `relative whitespace-nowrap` |
| `≥ 50` | `bg-info/15 text-info` |
| `≥ 30` | `bg-success/15 text-success` |
| `≥ 15` | `bg-warning/15 text-warning` |
| `< 15` | `bg-destructive/15 text-destructive` |

- 彩虹参数（用户定稿）：`70px` 周期 / `L0.70` / `C0.25` / 8 色；暗色主题在 `app/globals.css` 压到 `L0.55` / `C0.22`。
- 位置：渲染在 assistant 消息的 blocks **之前**；流式且不显示模型名时 `mt-1.5 pl-1`，让 token 数与工具行图标列对齐。

### 6.5 速率的三个层级，只有第一个在用

| 层 | 数据 | 公式 | 现状 |
| --- | --- | --- | --- |
| 流式中（实时） | 估算 token + 起表点 | `(当前估算 − 起表估算) ÷ 已耗时` | **已实现**，口径是"从起表到现在的平均"，分母含模型停顿，数字会缓慢漂移 |
| 单次响应（已完成） | `usage.output` + `message.durationMs`（pi 1.1） | `output ÷ durationMs` | 未展示，这是真正的解码速率 |
| 一轮 | `Σ usage.output` + `getTurnDurationMs()`（`lib/turn-duration.ts`） | `output ÷ 整轮耗时` | 未展示，含工具等待与思考 |

**每个工具没有速率**：工具行的 `duration` 是工具自身运行时间，`usage` 是"发起这次调用的那条 assistant 消息的用量"，一次请求可并发多个工具调用，相除不是模型生成速度。工具行只显示 `formatToolDuration(duration)`。

### 6.6 本次重构的边界

- `lib/stream-token-rate.ts` 与 `lib/stream-token-rate.test.mjs` **一行不改**。
- `MessageView` 的 `RATE_HOLD_MS`、300ms tick、`streamStartRef` / `streamRateKeyRef` / `lastRateRef` / `heldRate` 逻辑**原样保留**，只把外层容器换成 `Message` / `MessageContent`。
- `AssistantMessageHeader` **不迁入** `components/transcript/`，仍由 `MessageView` 渲染在 blocks 之前；`toFixed(1)`、五档阈值、彩虹动画参数、`mt-1.5 pl-1` 对齐位全部不动。
- 验收：新旧截图并列比对 token 数、徽章数值与配色档位、停留 6 s；任何信息增减单独提出确认，不允许夹在重构里。

### 6.7 若要滑动窗口（单独决策，默认不做）

改动只发生在 `lib/stream-token-rate.ts` 内部：新增采样缓冲（`Array<{ at, tokens }>`，窗口 2–3 s），`streamTokensPerSecond` 改为按窗口两端求差；四个导出的签名与 `MessageView` 的调用点不变。默认不做的原因：现有口径与 TUI 的心智模型一致，滑动窗口会让同一段回复的数值跳动更明显。

## 7. 状态、交互与性能

### 7.1 默认展开

| 行 | 默认 |
| --- | --- |
| Turn | 本轮无最终答复时展开 |
| 运行中的工具/思考 | 展开（跟随末尾） |
| 已完成工具 | 收起 |
| Plan / Queue 待办段 | 展开（官方 `defaultOpen`） |
| StackTrace | 收起（错误标题已可见） |
| 用户手动开合 | 覆盖默认，记入 `lib/tool-call-expansion.ts` / `lib/thinking-expansion-preference.ts` |

### 7.2 展开记忆

- key：`foldKey`（工具调用 id；合并组用 `groupKey`）。
- 机制沿用现有 `isToolCallExpanded` / `setToolCallExpanded`（模块级 `Set`，抗 remount）与 `COLLAPSIBLE_EXPANDED_EVENT`（保持展开时把末尾滚进视野）。
- 重挂载来源必须继续保持覆盖：流式 → `message_end` → 过程详情 → 会话文件读取。

### 7.3 流式

- `TraceLine status="running"` 由底座 shimmer；不额外订阅。
- 每 chunk 只重渲染订阅者：`TraceRow` 与各 pattern 用 `memo`，props 保持浅稳定；继续走 `useStreamingSelector`。
- 参数未到（`rawInput` 存在）时：只渲染 `TraceLine`（`正在生成参数…` + tail chevron），不渲染 `TraceCollapsible`。

### 7.4 键盘与无障碍

- 折叠由 `TraceCollapsibleTrigger` 提供键盘可达性；不要给 `TraceLine` 挂 `onClick`。
- 全行可点的跳转用 `<a>` / `<button>` 包裹，`sr-only` 提示"（在新标签页打开）"。
- 全局 Esc 仍归 `useKeyboardShortcuts`：不在任何过程行里拦截 `Escape`。

### 7.5 搜索与滚动

- `data-message-text` / `data-search-target` 属性必须原样保留（会话内搜索、minimap、滚动锚定依赖它们）。
- 组内命中仍补隐藏锚点。
- `[content-visibility:auto]` 外壳保留在 `ChatWindow`。

---

## 8. 必须保留的现有行为（逐条落点）

| # | 行为 | 落点 |
| --- | --- | --- |
| 1 | toolCall/toolResult 配对，参数未到也有占位行 | `6.3` + `ToolTrace` |
| 2 | 错误态（`isError`、退出码、失败文案）、成功无输出不渲染空框 | `5.3` `5.9` + `4.3` |
| 3 | 工具行时长 + 发起请求的用量（`UsageBar`）；轮末 `↑入 ↓出 ⛁缓存 $成本 ctx%` | 不改，留在 `ActivityRows`/`MessageView`/`ChatWindow` |
| 4 | 展开记忆（按会话、抗 remount） | `6.2` |
| 5 | 思考两态 + 手机字号 offset + 流式跟随 | `5.4` |
| 6 | 稳定 key、`useStreamingSelector`、延迟渲染、图片懒加载、Prism 队列 | 保留（`lib/message-keys.ts`、`lib/highlight-queue.ts`、`hooks/usePrismLanguages.ts`） |
| 7 | 历史 toolResult 图片缓存、`?tail=&deferThinking=&deferMedia=` | 不改读页参数与缓存层 |
| 8 | 终端：stdout/stderr 配对、不 reflow、ANSI、退出码 | `5.3` |
| 9 | read/write/edit：补丁 diff（单列/双列、行号、`+48 −12`）、写文件预览 | `5.2` `5.13` |
| 10 | codemode：脚本 + 脚本内调用嵌套 | `5.13` |
| 11 | 子代理：运行态、结果、独立 tab | `5.10` |
| 12 | MCP：`server/tool` 标签，不露原始名 | `4.2`（`lib/mcp-tool-display.ts`） |
| 13 | 未知/扩展工具标题人类化，禁止裸 JSON | `4.3` |
| 14 | 计划类（`todo`/`plan`/`compress`）可解析用 Plan/Queue，否则按文本 | `5.6` `5.7` |
| 15 | `web_search`：标题 + URL 列表 + 失败态 | `5.8` |
| 16 | 媒体：图片预览、`<video controls playsInline>`、`<audio controls>` | `5.13` |
| 17 | Markdown 管线（sanitize、KaTeX、mermaid、```svg 只走 `<img>`、锚点、Windows 路径、用户消息 raw HTML 当文本） | `5.12`（不改 `MarkdownBody`） |
| 18 | 系统消息/usage/compaction 条目不入对话；side chat 隐藏边界；custom 折叠 | 不改 `entryToUiMessage` / `isHiddenCustomMessage` |
| 19 | 断点、Safari 16.2（禁 lookbehind）、dev 期禁 `next build` | 全流程 |
| 20 | Esc 归全局 | `6.4` |
| 21 | 流式跟随、滚动锚定、minimap、新消息提示 | `6.5` |
| 22 | i18n 全量 `t()`、主题走 CSS 变量与 ANSI 调色板 | `0.2 #12` |
| 23 | 过程分组计数标题（`处理详情 · 1 压缩 · 3 计划 · 8 终端`） | `5.1` |
| 24 | 内容折叠边界/自定义消息折叠 | `5.1` + 现有 `CustomRow` |
| 25 | `demo/components/` 逐字节镜像 + 源码断言测试 | 第 8 节第 6 步 |
| 26 | 速率行（`↓ tokens` + `${tps.toFixed(1)} t/s` + 五档配色 + 彩虹层 + 6s 停留） | 不改（`MessageView.tsx:462` / `:710`） |

> 26 项中 3、6、7、18、20、21、26 属于"**重构期间不许碰**"的旁路；其余属于"重写但语义必须一致"。

---

## 9. 实施步骤

### 第 1 步：数据层（零 UI 变化）——已完成

- 新建 `lib/tool-view.ts`、`lib/tool-view.test.mjs`（`tool-view-labels.ts` 合并进前者，见 4.1）。
- `components/ActivityRows.tsx` 未改（`git diff` 为空）；测试直接断言映射结果。
- 同轮修复：`lib/tool-categories.ts` 的 `isWebToolName()` 补上 `web_search` / `web_fetch`（之前只认 `webfetch`/`websearch`/`fetch`，pi 的真实工具名漏判成 `other`）。
- 新增 i18n：`chat.trace.*`（en / zh-CN / zh-TW 各 16 条；`lib/i18n/registry.test.mjs` 要求每个 locale 的键集与 en 完全相等，新增 key 必须三处同步）。
- 验收：`tsc --noEmit` 通过、`node --test lib/tool-view.test.mjs` 20/20、`npm run lint` 无新增告警。

### 第 2 步：底座 pattern（只新增文件）

- 新建 `components/transcript/*`（5.1–5.13）。
- 用一个 dev 探针页（30221）逐 pattern 渲染假数据，截图：桌面 1440 / iPhone 390 × 浅色 / 深色。
- 验收：与 `/tmp/shadcn` 对应示例截图并列比对，行高、图标列、摘要截断一致。
- 探针页用完即删（`app/transcript-probe/`），不进 commit。

### 第 3 步：换血过程区（一分支一 commit）

顺序：terminal → files → search/web → codemode → subagent → mcp → plan/queue → generic → 分组（Task）→ Turn。

- 每分支：`tsc` + `npm run lint` + `node --test components/<该分支相关>.test.mjs`，再截图比对。
- 每分支提交信息写明"替换 X 行，输出改为 Y"。

### 第 4 步：消息级

- `MessageView` 换 `Message` / `MessageContent` / `Bubble` / `MessageFooter`。
- `AssistantMessageHeader` 位置、`RATE_HOLD_MS`、300ms tick、`heldRate`、`toFixed(1)`、五档配色、`tps-rainbow` 参数**逐字保留**。
- 轮末用量行仍用 `formatUsage() → StatPart[]` + `formatDurationPart`。
- 验收：一整轮真实会话（bash 长输出、edit、web_search、子代理、错误、媒体）与改动前截图并列比对。

### 第 5 步：删除旧实现

- 删 `ActivityRows.tsx` 中已被替代的行渲染；保留仍被引用的导出（`formatToolDuration`、`TOOL_DURATION_MIN_MS`、`CompactionSummaryDetails` 等，删除前逐个 grep 调用点）。
- 同时删掉已迁入 `lib/tool-view.ts` 的局部副本：`getWrittenFileText`、`countDiffStat`、`getResultDiff`、`getApplyPatchFiles`、`imageSource`、`getMessageImages`，改为从 `tool-view.ts` 导入。
- 删 `ChatWindow` 的 `ProcessDetailsGroup`。

### 第 6 步：镜像与测试

- 同步 `demo/components/`（逐字节）。
- 更新源码断言测试：`MessageView.test.mjs`、`ChatWindow.process-details.test.mjs`、`AppShell.workspace-memory.test.mjs` 中与本文件结构相关的正则。
- 验收：`tsc --noEmit` 与 `npm run lint` 全绿；`npm test` 相对基线无新增失败（基线 `6cd7d33c` 本身有 120 条失败，分布在未涉及的 mcp 路由/host/sign-in、pi-sdk-internals、AppShell/MobilePwaLayout、useAgentSession、builtin-extensions 等文件；本次新增测试全过）。

---

## 10. 验证

| 层 | 手段 |
| --- | --- |
| 静态 | `node_modules/.bin/tsc --noEmit`、`npm run lint` |
| 单测 | `npm test`（含 `lib/tool-view.test.mjs`） |
| 视觉 | dev 探针 30221 + Playwright 截图：1440 / 390、浅/深、流式中 / 结束 / 展开 / 收起 |
| 会话 | 真实长会话：bash 长输出、edit diff、web_search、子代理、错误退出、含视频输出 |
| 生产 | `bash ~/run-pi-web-build.sh` 后由用户运行 `bash ~/run-pi-web.sh`（代理不重启生产） |

---

## 11. 风险

| 风险 | 处置 |
| --- | --- |
| 视觉变化被当成行为变化 | 第 12 节 3 条已确认；其余一律先对齐现状再谈改进 |
| 每次 chunk 触发重渲染 | pattern 组件 `memo` + 只订阅 `useStreamingSelector`；第 3 步后测帧率 |
| `demo/` 漏同步 | 改组件即同步，第 6 步统一复核 |
| Safari 16.2 | 客户端禁 lookbehind；不引入新语法依赖 |
| 16 个类别分散回归 | 第 3 步一分支一 commit，可单点回退 |
| 展开记忆 key 变化导致旧记忆失效 | `foldKey` 复用现有 id；旧 key 自然过期，不做迁移 |

---

## 12. 已确认的 3 处视觉变化（用户批准，直接实施，不再讨论）

这三条是"严格执行官方"的必然结果：

1. **终端命令的位置**：命令进 `CodeBlockHeader` 一行标题（长命令截断，完整内容靠 `CodeBlockCopyButton`），不再卡内多行平铺、不再占 4/10 高度；多行命令（heredoc）不再完整平铺。
2. **过程行不再有卡片外框**：工具/思考行为 `Trace` 纯行（无边框、无背景），层级靠缩进与图标。
3. **过程分组的标题行**：`ProcessDetailsGroup` 自拼折叠头换为 `TraceCollapsible` + `TraceLine`（带 chevron、同字号、支持 `status` shimmer）。

---

## 13. 不做

- `MessageScroller`（需 `@shadcn/react`）：现有滚动锚定/minimap 已稳定。
- `Approval` / `Confirmation`：pi 没有工具审批流。
- `Checkpoint` 的 Restore 按钮：pi 的压缩不可逆。
- 高亮引擎替换（shiki）：沿用现有 Prism。
- 速率口径扩展（单次响应 `output ÷ durationMs`、一轮 `Σ output ÷ 轮耗时`）：均未展示，不在本次范围。

---

## 14. 已定的三个技术选择（用户批准，直接实施）

1. **实时速率不加滑动窗口**：保持"起表以来平均"，`lib/stream-token-rate.ts` 一行不改。
2. **不使用 `pattern_test-results`**：bash 里的测试命令输出仍走 Terminal + `CodeBlock`。
3. **引入官方 `HoverCard`**：新建 `components/ui/hover-card.tsx`（radix 适配，与现有 `ui/*` 同风格），供 `ContextBadge` 使用；`ctx%` 悬浮显示 `已用 / 上限` + `Progress`。

---

## 附录 A：官方 API 参考（逐字，来自 `/tmp/shadcn`）

### A.1 `Trace` 系列（`docs_components_base_trace.md` §API Reference，`:1821`）

| 组件 | props | 说明原文要点 |
| --- | --- | --- |
| `Trace` | `className` | “A list of rows. It also styles any trigger or link that wraps a `TraceLine`.” |
| `TraceLine` | `status?: "running" \| "error" \| "pending"`、`className` | “One line: an icon and a title. It is a span, so it is not a button or a tab stop. Wrap it in a trigger or a link to make it do something.” |
| `TraceIcon` | `className` | “A decorative icon slot, hidden from assistive tech. Before the title it names the action; after it, it is the indicator.” |
| `TraceTitle` | `className` | “One sentence on one line. It truncates and shimmers while the line is running.” |
| `TraceDescription` | `className` | “Secondary text after the title, such as a count or a duration. **It does not truncate.**” |
| `TraceCollapsible` | `open`、`defaultOpen`（默认 `false`）、`onOpenChange`、`className` | 透传 `Collapsible` |
| `TraceCollapsibleTrigger` | `className` | “The button that opens and closes the row. Put a `TraceLine` inside it. **It adds a chevron after the line.**” |
| `TraceCollapsibleContent` | `keepMounted`（默认 `false`）、`className` | “Keep the detail mounted while closed, so nested rows keep their open state.” |

### A.2 `CodeBlock` 系列（`docs_components_base_code-block.md` §API Reference，`:1955`）

| 组件 | props | 说明原文要点 |
| --- | --- | --- |
| `CodeBlock` | `variant?: "default" \| "destructive"`、`size?: "default" \| "sm"`、`className` | `"sm"` 是“tighter padding and `text-xs` code, for tool output” |
| `CodeBlockHeader` | `className` | “A row above the content for a title and actions.” |
| `CodeBlockTitle` | `className` | “A filename or a label, with an optional icon. It truncates.” |
| `CodeBlockActions` | `className` | “Holds buttons at the end of the header. **As a direct child of `CodeBlock`, it floats.**” |
| `CodeBlockCopyButton` | `value`（必填）、其余同 `Button` | ghost 图标按钮 |
| `CodeBlockContent` | `children`、`wrap`（默认 `false`）、`lineNumbers`（默认 `false`）、`startLine`（默认 `1`）、`tabIndex`（默认 `0`）、`className` | 可聚焦滚动；`max-h-*` 通过 `className` 给 |
| `CodeBlockLine` | `variant?: "default" \| "added" \| "removed" \| "highlighted"`、`className` | 单行 |
| `CodeBlockFooter` | `className` | 内容下方一行（如 Show More） |
| `useHighlightedCode(code, language)` | — | 每行一个节点；首帧与未知语言返回纯文本行；`language` 可为 `"ansi"` |

### A.3 本项目底座的实际导出（已核对源码）

`components/ui/trace.tsx`（171 行，`export { … }` 于 `:162`）：

```
Trace, TraceLine, TraceIcon, TraceTitle, TraceDescription,
TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent
```

`components/ui/code-block.tsx`（241 行，`export { … }` 于 `:232`）：

```
CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockActions,
CodeBlockCopyButton, CodeBlockContent, CodeBlockLine, CodeBlockFooter
```

（**没有** `useHighlightedCode`；高亮走现有 `lib/highlight-queue.ts` + `hooks/usePrismLanguages.ts`，见第 8 节第 6 条。`trace.tsx` 的 content 已带 `--radix-collapsible-content-height` 与 `data-open:animate-accordion-down`，折叠动画不用另写。）

`components/ui/message.tsx`（91 行，`:84`）：`MessageGroup, Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader`。
`components/ui/bubble.tsx`（124 行，`:124`）：`BubbleGroup, Bubble, BubbleContent, BubbleReactions`。

### A.4 官方 `Status` 的写法（`trace.md` §Status）

```tsx
<Trace>
  <TraceLine><TraceIcon><CircleIcon /></TraceIcon><TraceTitle>Waiting on the registry</TraceTitle></TraceLine>
  <TraceLine status="running"><TraceIcon><LoaderIcon /></TraceIcon><TraceTitle>Installing dependencies</TraceTitle></TraceLine>
  <TraceLine status="error"><TraceIcon><CircleXIcon /></TraceIcon><TraceTitle>Failed: pnpm install</TraceTitle></TraceLine>
  <TraceLine><TraceIcon><CircleCheckIcon /></TraceIcon><TraceTitle>Ran pnpm build</TraceTitle></TraceLine>
</Trace>
```

要点：状态由**图标 + `status`** 共同表达；`pending` 用空心圆，`running` 用 loader 并且标题自带 shimmer，`error` 用 `CircleXIcon` 并把失败动作写在标题里。

