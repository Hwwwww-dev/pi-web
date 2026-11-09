# 自研 UI / 组件 / 功能的 shadcn 替换方案

盘点范围：`components/`（业务组件与 `ui/`）、`hooks/`、`lib/` 的交互基础设施。
判断标准：shadcn 官方组件（含其生态依赖）能提供等价能力才列入替换；纯业务逻辑（会话流、文件访问、markdown 渲染等）不在候选之列。

## 结论

- 已有 37 个 `components/ui/` 官方组件，但**采用率低**：dialog 仅 1 处（SettingsPanel）、sonner 1 处、command 1 处，大量浮层/菜单/弹窗仍是自研条件渲染。
- 可替换的自研交互基础设施约 **1900+ 行**（SidebarMenu 1178、useResizablePanel 323、stacked-dialog 201、useTheme 169、useDialogMaxHeight 38），加上散落各处的自研浮层外壳（AppShell 头部四面板、DirectoryPicker、ChatWindow 引用浮层、ExtensionWidgetPanel）。
- 真正无可替换的只有业务 hooks 和渲染类组件（minimap、markdown、diff、终端等）。

## 一、已经是 shadcn，无需处理

| 组件 | 实现载体 |
|---|---|
| 模型选择器 | `ModelSelector.tsx` = Popover + Command |
| 分支切换器 | `BranchNavigator.tsx` = Popover |
| 聊天输入控件（工具预设菜单等） | `ChatInput.tsx` = DropdownMenu |
| 设置面板弹窗 | `SettingsPanel.tsx` = ui/dialog |
| 侧栏 toast | `SessionSidebar.tsx` = sonner（SidebarToast.tsx 已删，`SidebarToast.test.mjs` 是残留测试文件，顺手删除） |
| **Base 系列（shadcn 新版 base-ui 组件）** | `ui/code-block.tsx`（FileViewer/DiffView/MarkdownBody/MermaidBlock/SvgBlock/TerminalPanel/ActivityRows 七处）、`ui/trace.tsx`、`ui/message.tsx`、`ui/bubble.tsx`（ActivityRows/MessageView）均已安装并在用 |
| agent 切换器清单 | `AgentSessionPanel.tsx`：外壳已是 PopoverContent，`role="listbox"` 是其内的语义清单，保留 |
| 字号/外观滑块 | `FontSettings.tsx`、`SettingsPanel.tsx` = ui/slider |

## 二、可替换 —— shadcn 组件现成（无需新依赖）

### A1. AppShell 头部四个顶部面板 ✅ 已完成（批次 2）

- 四面板改为受控 **Popover** + `PopoverAnchor virtualRef={topBarRef}`（锚定头部容器，面板宽度取 `--radix-popover-anchor-width`；session 卡片 align="end"）；外点/Esc/进出动画由 Radix 承担，手拼的 pointer-events/data-state 动画类删除。
- 删除 `hooks/useOutsideDismiss.ts`（全项目已无使用者）；`useDelayedUnmount` 在 AppShell 的四处使用删除（hook 本身保留给 ExtensionWidgets）。触发按钮保持原 toggle（非 PopoverTrigger，避免与指针点击双重处理）。

### A2. SidebarMenu——判定修正：已经是 Radix 实现，保留（此前"1178 行自研"系未读全文的误判）

- 实际现状：外壳就是 Radix——桌面 `DropdownMenuPrimitive`、手机 `DialogPrimitive`（`modal={false}`，注释明确 "The shell is Radix: a DropdownMenu on a desktop, a Dialog on a phone"）。碰撞定位、Escape（捕获相、标记已处理，避免误触"停 agent"）、pointer-down-outside、焦点圈全部由 Radix 承担；旧的手写 CSS（app/sidebar-menu.css）在更早的迁移中已并入 Tailwind 类。
- 不走 `ui/dropdown-menu.tsx` 包装层的原因（文件内注释写明）：隐藏零尺寸 trigger 停在锚点坐标（point/rect 锚定，非真实按钮）；项保持自定义标记以支持单字母快捷键、行内次级按钮、自定义 body（WorktreeCreateForm）、过滤字段——这些是 Radix menu collection 与 shadcn DropdownMenuItem 都表达不了的**产品功能**；手机 sheet 是非模态（下层抽屉保留自己的关闭），`ui/sheet.tsx` 不支持 modal=false。
- 结论：**保留**。重写只会退化功能或重造同样的原语接线；"引擎置换"无从谈起。三个使用方（SessionTree/SessionSidebar/ProjectWorktreePicker）不动。

### A3. DirectoryPicker（目录选择弹窗）✅ 已完成（批次 2）

- 外壳换 **Dialog**（`showCloseButton={false}` + sr-only DialogTitle；backdrop、Escape、焦点陷阱、按压起点守卫全部内建）；`busy` 时在 `onEscapeKeyDown`/`onInteractOutside` preventDefault 保持原"校验中不可关"语义；panel 面板样式类原样迁移。
- 内嵌"新建子目录"小弹窗保留：它是面板内的嵌套覆盖层（absolute inset-0 相对 panel），不是全屏模态，AlertDialog/嵌套 Dialog 反而改变形态。收益：删 backdrop/层级/焦点代码。

### A4. ChatWindow 引用追问浮层（quote 输入 portal）——评估后放弃

- 现状：`ChatWindow.tsx` 行 1656 `createPortal` 到 body 的 fixed 浮层，锚点是**动态文字选区坐标**（quotedSelection.top/left），随选区出现/消失（toolbar→输入两态）。
- 放弃理由：Radix 的锚定模型是元素锚（即使 virtual element 也要自行维护选区 rect 的同步与清理），选区驱动的浮动工具栏用固定定位跟随选区本就是正确形态（GitHub/Notion 同款）；套 Popover 增加的 Esc/外点关闭对选区生命周期是冗余（选区消失即关）。

### A5. ExtensionWidgetPanel（扩展组件展开卡）——评估后放弃

- 现状：`ExtensionWidgets.tsx` 条件渲染 `absolute bottom-full left-0` 卡片。
- 放弃理由：面板锚定的是 pill **行**（shelf 根），不是单个 pill——Popover 的 trigger 锚定模型不适配；该组件的 SSR 静态渲染测试断言 `<section`/`<pre` 输出，Radix 的 portal 渲染与之不兼容。现有受控面板已带退出动画，保留。

### A6. lib/stacked-dialog.ts ✅ 已完成（批次 2，死代码清理）

- 核查结论：文件名有误导——Escape 堆叠半边（listenForStackedDialogEscape / listenForPanelEscape / openStackedDialog / focusModalPanel）**本就是 0 使用者的死代码**；活跃的只有 `focusIfLost`（24 处）/ `focusAfterChange`（2 处）跨面板焦点恢复工具，Radix 无对应，保留。
- 已删除 Escape 半边及其测试（201 → 63 行），文件头注明 Radix DismissableLayer 现在承担该职责。

### A7. hooks/useDialogMaxHeight.ts（38 行）——保留

- 现状：扩展对话框的 max-height 以**其锚定的聊天面板**（而非视口）为界（useDialogMaxHeight(wrapperRef)，#947 的 fit-width/最大化体系一部分）。
- 结论：这些对话框是聊天列内嵌面板，不是 Radix Dialog 的全屏模态形态，Dialog 化不成立；hook 保留。

### A8. hooks/useIsMobile.ts——评估后放弃

- 放弃理由：自研版是 shadcn 官方 use-mobile 的**超集**（useIsMobile 640px 断点与 globals.css 对齐 + useIsNarrowMobile 480px + useCoarsePointer 指针类型），官方版单一 768px hook 会丢功能，非纯文件归位。

## 三、评估后保留 —— 需新依赖的两项，读实接线后判定为"现状即最佳实践"

### B1. hooks/useResizablePanel.ts（323 行）——保留

- **决定性证据**：宽度注入方式（`--sidebar-width` CSS 变量 + flex 布局消费）正是 shadcn 官方 `ui/sidebar.tsx` 自身的模式——项目当前实现**已经是** shadcn 生态对"可调侧栏宽度"的标准做法；`Resizable`（react-resizable-panels）适合新设计的 PanelGroup 布局，而这里是既有 shell。
- 接管成本：AppShell 顶层 DOM 全部重构为 PanelGroup/Panel/PanelResizeHandle（牵动聊天列/文件面板/侧栏三层、sticky 头部 z 上下文、KeepAliveDock 锚定、inert/invisible 逻辑）；`persistClamp`（窄窗口的临时 clamp 不落盘）与 `reclampWidth`（窗口变化重钳制）要在库的 storage/onLayout 之上重写为自定义代码——净删除量趋零。
- 结论：保留 hook（有测试覆盖），文档化"shadcn Sidebar 同款 CSS 变量模式"。

### B2. hooks/useTheme.ts（169 行）——保留

- **决定性证据**：next-themes 的核心价值（阻塞式防闪烁初始化脚本）项目已自备——`app/layout.tsx` 注入 `THEME_INIT_SCRIPT`（lib/theme.ts），与 next-themes 内部机制同款；换库只把一段脚本换成另一段。
- 直接冲突：next-themes 的 `useTheme` 首帧返回 `undefined`（防 hydration 不匹配），而 MermaidBlock/SourceCodeView 需要**首帧立即解析**主题为图表/代码着色；弥补它就得在包装层重读 localStorage——等于重造现有 store。
- 无法承接的行为：origin 视图过渡动画（450ms clip-path 圆形展开）与 Safari 后台丢事件的 focus/visibilitychange 补同步——都要留在包装层，包装后公开 API 不变、净删除约 60 行、新增一个依赖。
- 结论：保留。

## 四、保留自研（shadcn 无对应，或替换得不偿失）

| 项 | 原因 |
|---|---|
| ChatMinimap（导轨/预览卡） | 纯业务几何，无任何 shadcn 对应 |
| SessionTree 虚拟滚动 | shadcn 无虚拟化方案；引入 @tanstack/react-virtual 属新依赖+重构，不在"shadcn 替换"范畴 |
| TabBar（文件标签页，role=tab） | 动态文件 tab 集带关闭/中键/拖拽语义，Radix Tabs 的固定面板模型不适配；shadcn 无文件标签组件 |
| KeepAliveDock 本体（可拖拽圆钮） | 无对应；其菜单浮层见 A10 |
| FileExplorer / FileViewer / DelimitedTable / SourceCodeView | 文件面板业务组件 |
| MarkdownBody / AnsiText / TuiText / MermaidBlock / SvgBlock / DiffView | 渲染类 |
| DebugPanel / TerminalPanel / ExtensionStatusBar / SessionChatPanel | 业务面板 |
| useAgentSession / useSessionUiState / useStreamingSelector | 会话流核心，非 UI |
| useKeyboardShortcuts / useViewportHeight / usePageHidden / useScrollbarVisibility / useSidebarMotion / useFontPreferences / useEnterSendMode / useChatAppearance / useAudio / usePrismLanguages | 交互/平台细节，shadcn 无对应 |
| useDragDrop / useGroupDrag | 拖放业务（shadcn 无拖放组件） |
| ProjectTrustDialog / OAuthPastePanel / McpAddServer 等 | 内容型面板，替换意义只在"外壳换 Dialog/Popover"，随 A 类顺带评估 |

### A9. SourceCodeView 的语法高亮内核 → 统一到 CodeBlock + Prism（可选）

- 现状：`SourceCodeView.tsx`（155 行，DiffView/GitPanel/FileViewer 引用）用 **react-syntax-highlighter**（vs / vscDarkPlus 两套主题 + 自研行号/懒渲染），而项目另有 Prism 体系（`highlight-queue` / `prism-languages` / `usePrismLanguages`，MarkdownBody 用）——两套高亮体系并存；外壳层 FileViewer/DiffView 已经用 Base CodeBlock 的行变体。
- 替换为：高亮内核换成已有 Prism 链路，行号/换行布局沿用 CodeBlock 行变体（`cn-code-block-line`），删除 react-syntax-highlighter 及其 @types 依赖。
- 风险：SourceCodeView 的行号 gutter、wrap、超过阈值延迟渲染逻辑要迁到 Prism 版本；DiffView 的共享 FILE_CODE_STYLE 需同步。
- 工作量：中。严格说不是"换 shadcn 组件"（code-block 不做高亮），而是借 CodeBlock 统一掉第二套高亮依赖。

### A10. KeepAliveDock 的会话菜单浮层 ✅ 已完成（批次 1）

- 受控 `Popover` + `PopoverAnchor`（圆钮保持 pointer 拖拽/点击手势，不接管 click）；外点关闭交给 Radix（`onPointerDownOutside` 豁免圆钮，避免"外点先关、pointer-up 再开"的竞态）；Esc 捕获 stopPropagation 保留（防止冒泡触发"停 agent"）；`onOpenAutoFocus` preventDefault 保持原"不抢焦点"行为。删除自研 outside-dismiss effect、panelRef 与手写进场动画。

### A11. 自研单选组 → ui/radio-group ✅ 已完成（批次 1）

- 新增 `components/ui/radio-group.tsx`（官方源码，统一 radix-ui 包的 `Indicator` 命名）。
- `SettingsPanel.tsx` 外观主题三选：native sr-only radio + `has-[:checked]` → RadioGroup + sr-only RadioGroupItem + `has-[[data-state=checked]]`，卡片视觉不变，方向键/roving focus 由 Radix 承担。
- 语言选择行与 ChatInput 思考级别行保持 `role="radio"` Button 行：它们是弹层内的菜单行形态（官方在菜单内的单选惯例），不套表单 RadioGroup。

### A12. 扩展请求多选对话框 → ui/checkbox ✅ 已完成（批次 1，范围修正）

- 多选选项卡：自研 `role="checkbox"` div + 手写 Enter/Space + 手绘 ✓ 方框 → label 包 `ui/checkbox`（Radix 语义/Space/勾选图标内建），卡片视觉经 `has-[[data-state=checked]]` 保留；`focusFirstOption` 泛化为 HTMLElement。
- 外壳 Dialog 化不成立（A7 结论：聊天列内嵌面板设计），`useDialogMaxHeight` 保留。

### A13. 最佳实践推广档（类级/属性级，非组件替换）

- native `title={t(...)}` tooltip：全项目 **~90 处**（FileExplorer 14、SessionTree 12、ChatInput 12、SessionSidebar 10、ChatWindow 9…）。shadcn 最佳实践是 **Tooltip** 组件（`ui/tooltip.tsx` 已有，3 处在用）。全量替换成本高、native title 也有触达成本为零的价值：建议只对**纯图标按钮**（无文字、语义依赖 tooltip）批量换 Tooltip，文字按钮保留 title。
- `animate-spin` 手写 spinner：7 处——评估后放弃：ui/spinner 内建英文 `aria-label="Loading"`（项目 i18n、多数 spinner 是装饰性旁注），且各处尺寸/动画时长定制不同；`animate-spin` 本身就是标准做法。
- `SettingsUi.tsx` native `<details>` 折叠 → Collapsible ✅ 已完成（批次 1，`config-footer-status*` 类名保留为测试锚点）。
- 大量 `role="alert"` / `role="status"`（55 处）：是提示文字的语义角色，不是组件问题；仅在需要样式化提示条时用 ui/alert 包裹。

## 五、执行批次（最终状态）

1. **批次 1 ✅ 已完成（67ac080）**：A10 KeepAliveDock 菜单 → 受控 Popover、A12 多选卡 → ui/checkbox、A11 新增 `ui/radio-group.tsx` 接入外观三选、A13.3 `<details>` → Collapsible、删 SidebarToast.test.mjs 残留。评估后放弃：A4（选区坐标锚定）、A5（pill 行锚定 + SSR 测试）、A8（自研 useIsMobile 是官方超集）、A13.2 spinner（英文 aria-label 不合 i18n）。A9（SourceCodeView 高亮统一）待做。
2. **批次 2 ✅ 已完成（d5a4390）**：A1 头部四面板 → 受控 Popover（virtualRef 锚头部、sideOffset 0、全宽条 avoidCollisions=false，删 useOutsideDismiss）、A3 DirectoryPicker → Dialog、A6 stacked-dialog 删 Escape 死代码半边（201 → 63 行，焦点工具保留）。
3. **批次 3 ✅ 核对后结案**：A2 SidebarMenu 经全文核对已是 Radix 实现（见上文判定修正），无重写必要。
4. **批次 4 ✅ 评估后结案**：B1/B2 均为"现状即 shadcn 最佳实践"（见上文证据），不引入依赖。
5. 未尽事项：A9（SourceCodeView 的 react-syntax-highlighter → Prism 统一）、A13.1 纯图标按钮的 Tooltip 批量替换——两者都是独立可做的小批次，与"能用 shadcn 替换的已全部替换"无冲突（A9 换的是高亮内核不是 shadcn 组件，A13.1 是类级推广）。

## 六、结论

自研交互 UI 盘点完毕（70 个业务组件 + 30 个 hooks + lib 交互基础设施逐一核对，含读全文后的判定修正）。最终动手替换 7 项（A1、A3、A10、A11、A12、A13.3、A6 死代码），删自研代码约 **550 行**（useOutsideDismiss 90 + useResizablePanel 之外的浮层外壳/动画类 ~150、stacked-dialog Escape 半边 ~140、散点 ~170）；评估后保留 8 项，每项都有具体证据（锚定模型不适配、SSR 测试约束、自研超集、i18n 冲突、shadcn 官方同款模式、next-themes 首帧 undefined 冲突）。SidebarMenu 与 useResizablePanel/useTheme 的保留判定推翻了本文档初版的估算——以本版为准。
