# 转录区与 shadcn AI Elements / Trace 体系

pi-web 的消息列表（过程区、工具卡、思考块、用量行）按 shadcn 官方
`ui.shadcn.com/docs/ai-elements/base/*` 的 pattern 组织。本文记录读完全部官方
文档后的结论、映射关系与改造边界。改 `components/ActivityRows.tsx`、
`components/MessageView.tsx`、`components/ui/{trace,code-block,message,bubble}.tsx`
之前先读这篇。实施计划、保留清单、token 速率口径与步骤拆分见
`docs/specs/transcript-rewrite.md`。

## 1. 两个体系的现状

- `elements.ai-sdk.dev`（旧 **AI SDK Elements**）已迁移到
  `ui.shadcn.com/docs/ai-elements/base/*`（**shadcn AI Elements**）。旧库的
  `Tool`/`Task`/`ChainOfThought`/`Reasoning` 各自是独立组件、依赖 `shiki`、
  `streamdown`、`motion`、`tokenlens`。
- 新库把这一切收进两个底层组件：**`Trace`**（竖线时间轴）和
  **`Code Block`**（shiki 高亮），其余全是 pattern = 用 `Trace` 拼出来的用法，
  没有自己的文件、没有额外依赖。
- 本仓库**已经是新体系的一半**：`components/ui/{trace,code-block,message,bubble,
  button-group,input-group,spinner,empty,field}.tsx` 就是官方 base 版本（`data-slot`
  风格、`cn-*` 类名）。非标准的是**组合层**：`ActivityRows.tsx`（1548 行）和
  `MessageView.tsx`（997 行）自己拼了一套行/卡/分组，没有按 pattern 组织。

结论：不需要引入新依赖，需要的是把组合层重写成 pattern。

## 2. Trace 体系（唯一的底层）

```tsx
<Trace>                                 // 竖线容器，行与行之间画连接线
  <TraceCollapsible>                    // 有内容可展开的行
    <TraceCollapsibleTrigger>
      <TraceLine status="running|error|pending">
        <TraceIcon><TerminalIcon /></TraceIcon>
        <TraceTitle>Ran pnpm build</TraceTitle>
        <TraceDescription>1.2s</TraceDescription>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted>…</TraceCollapsibleContent>
  </TraceCollapsible>
  <TraceLine>…</TraceLine>              // 没有内容可展开的行
</Trace>
```

- `TraceLine` 的 `status`：`running`（标题 shimmer）、`error`（destructive）、
  `pending`（60% 透明）。本仓 `trace.tsx` 已把字号接到
  `--chat-font-size-offset`，标题与说明同一行、同一字号。
- `TraceDescription` 是行尾的次要说明（时长、`2 of 5 done`、`12s`）。
- `keepMounted` 让折叠区保留挂载（步骤的展开状态不丢）。
- `TraceCollapsible` 的 `open`/`defaultOpen`/`onOpenChange` 是受控开关；
  pattern 的统一做法是 `open={user ?? running}`：流式时自动开、结束自动收，
  用户手动点过之后用户的选择优先（本仓的展开记忆就落在这里）。

## 3. 官方 pattern 清单与映射

| pattern | 结构 | pi-web 对应 | 保留/新增 |
| --- | --- | --- | --- |
| **Tool** | `TraceCollapsible` + `TraceLine`，内容 `CodeBlock size="sm"` | 通用工具行（read/glob/grep/edit/write/未知工具/mcp） | 新增组合 |
| **Terminal** | 同上，标题 `Ran <cmd>`，内容为输出 | `bash` 分支 | 命令块 + 分割线 + 结果块（保留命令/结果分离） |
| **Task** | 折叠行内再套 `<Trace>` 步骤 | 过程分组（"处理详情 · 计数"） | 新增，替代 `TraceCollapsibleRow` 分组 |
| **Plan** | 折叠行 + 每步 `CircleCheck/CircleDot/Circle` 图标 + `TraceDescription` 计数 | `plan` 工具 | 解析成功才用，失败按普通文本 |
| **Queue** | 两个折叠节（To do / Completed） | `todo` 工具 | 同上 |
| **Reasoning** | 折叠行，标题 `Thinking` / `Thought for 5s` | 思考块 | 新增，替代自研 ThinkingRow |
| **Chain of Thought** | 摘要行 `Researched in 3 steps` 展开成步骤 | 过程分组摘要 | 与 Task 二选一，用 Task 的分组语义 |
| **Stack Trace** | `status="error"` + 首行错误 + frames 折叠 | 工具失败 | 用于命令/脚本类失败 |
| **Sources** | 折叠行 `Used N sources` + 链接行 | `web_search` | 域名 Badge 走 pattern 的 Search Results |
| **Context** | `HoverCard` + `Progress`，`42% context` | 轮末 ctx% | 只用于 ctx% 悬浮；token/tps 行保留文本 |
| **Message** | `Message` + `MessageContent` + `Bubble` + `MessageFooter` | 一条消息 | 升级组合方式 |
| **Subagent** | 折叠行内嵌套 `<Trace>` + 报告 | `Agent` 工具 | 新增 |
| **Message Scroller** | `MessageScrollerProvider/Viewport/Content/Item`，`scrollAnchor` | 转录滚动容器 | 可选（需新依赖 `@shadcn/react`） |
| **Test Results / Confirmation / Checkpoint / File Tree / Inline Citation / Suggestion / Model Selector / Prompt Input / Attachment / Item / Empty / Shimmer** | 各主题组件 | 本仓无对应场景（或已有等价实现） | 不采用 |

## 4. Code Block（官方，已在本仓）

```tsx
<CodeBlock size="sm" variant="default|destructive">
  <CodeBlockHeader>
    <CodeBlockTitle>package.json</CodeBlockTitle>
    <CodeBlockActions><CodeBlockCopyButton /></CodeBlockActions>
  </CodeBlockHeader>
  <CodeBlockContent
    language="bash"
    lineNumbers
    highlightLines={[3]}
    showLineNumbers={false}
    from={12} to={30}
    wrap={false}
    onShowMore={() => setExpanded(true)}
  >{code}</CodeBlockContent>
  <CodeBlockFooter><CodeBlockShowMore /></CodeBlockFooter>
</CodeBlock>
```

- `max-height` 不在组件里：`CodeBlockContent` 自己不限高，官方示例一律
  `className="max-h-64"` 交给调用方。本仓按"卡片不限高"处理，不传 `max-h`。
- 折叠用 `onShowMore`（回调）+ `CodeBlockFooter`，不是组件自带的开关。
- `language` 缺省 `"text"`；`lineNumbers`、`highlightLines`、`from/to`、
  `wrap`、`variant="destructive"`（错误输出）都在 `CodeBlockContent` 上。

## 5. 映射之外必须自己做的部分

官方没有、pi 必须有：

- **Diff**：`components/DiffView`（补丁双列、行号、`+48 −12`）。
- **ANSI**：终端输出带 ANSI 转义。`CodeBlockContent` 走 shiki，不支持 ANSI；
  保留 `AnsiText`，或按 `language="ansi"` 交给 shiki。
- **Codemode**：脚本 + 脚本内发起的子调用（嵌套 `<Trace>`），上游无对应物。
- **MCP / 子代理**：标签来自 `lib/mcp-tool-display.ts`；子代理按 Subagent pattern 组合。
- **未知工具兜底**：标题必须人类化（`get_search_content` → `搜索内容`），
  摘要按参数语义取，不 dump JSON。
- **媒体**：工具结果里的图片/视频/音频（pi 插件会直接产出视频），
  在 `TraceCollapsibleContent` 里渲染 `<video controls playsInline>` / `<audio>`，
  不能当文本。
- **用量与速率**：每个工具的 token/cost + 一轮结束的 token/tps/ctx 行，
  用 `TraceDescription` 与 `TranscriptNotices` 承载。

## 6. 改造边界

- 组合层重写：`ActivityRows.tsx` 拆成 `components/transcript/` 下的 pattern 组件
  （`ToolRow`、`TerminalRow`、`PlanRow`、`QueueRow`、`ReasoningRow`、`StepGroup`…），
  `MessageView.tsx` 只负责消息级别的组装。
- 不动的：`components/ui/*` 官方组件（除按需补 `data-slot` 主题）、
  `MarkdownBody`、`DiffView`、`CodemodeToolView`、`SessionChatPanel`、`AnsiText`。
- `demo/components/` 镜像必须与 `components/` 逐字节同步（源码断言测试依赖它）。

## 7. 陷阱

- **改 `lib/i18n/messages/*.ts` 后，运行中的 `next dev` 可能仍用旧字典**：SSR 把
  `chat.trace.*` 原样输出成 key，客户端水合时又拿到正确文案，于是报
  “Hydration failed … server rendered text didn't match the client”，服务端日志同时打
  `[i18n] Missing translation: <key>`。源码与 `node --test lib/i18n/registry.test.mjs`
  都是对的，重启该 dev 进程后现象消失——不要据此改代码。
- `components/ui/hover-card.tsx` 原先不存在（官方 Context pattern 依赖它），已按
  radix 版本补齐；它的 Trigger 支持 `asChild`。
