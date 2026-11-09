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

### A2. SidebarMenu（自研菜单系统，1178 行，最大的单块）

- 现状：`SidebarMenu.tsx` 自研 role=menu 浮层 + 手机端底部 sheet（role=dialog aria-modal），自研焦点环、Escape 堆叠、动画；使用者：`SessionTree.tsx`（行菜单）、`SessionSidebar.tsx`（筛选/分组菜单）、`ProjectWorktreePicker.tsx`（项目/工作树 picker）。
- 替换为（按场景分流）：
  - 纯菜单项场景（行菜单、归档/置顶/重命名/排序）→ **DropdownMenu**（含 CheckboxItem / RadioGroup）；
  - 带表单/自定义内容的场景（WorktreeCreateForm、筛选字段、picker 面板）→ 桌面 **Popover** + 手机 **Sheet**（bottom side）。
- 风险：手机 sheet 与桌面浮层的响应式切换逻辑（`isMobile` 分支）要在 Popover/Sheet 两形态间重排；`role="menuitemradio"` 的多选菜单用 DropdownMenu CheckboxItem 表达。
- 工作量：大（涉及 3 个使用方）。收益：删 ~1178 行自研焦点/键盘/动画/层叠代码，无障碍语义交给 Radix。

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

## 三、可替换 —— 需要新增 shadcn 生态依赖

### B1. hooks/useResizablePanel.ts（323 行）→ Resizable（react-resizable-panels）

- 现状：侧栏与右侧文件面板两处拖宽：pointer 拖拽 + CSS 变量 + localStorage + 键盘调整 + clamp 持久化策略（窗口过窄的临时 clamp 不保存）。
- 替换为：shadcn **Resizable**（`react-resizable-panels`，shadcn 官方组件之一）。
- 风险：AppShell 顶层布局要从 flex 宽度变量改为 `PanelGroup/Panel/ResizeHandle` 结构（牵动聊天列/文件面板/侧栏三层）；`persistClamp` 语义要用其 `storage` 适配层重实现。
- 收益：删 323 行 hook + 两个实例的接线；标准 handle 拖拽/双击重置/键盘语义。
- 工作量：中偏大。

### B2. hooks/useTheme.ts（169 行）→ next-themes（shadcn 官方主题方案）

- 现状：自研 useSyncExternalStore 全局主题 store（preference/system 跟随/localStorage），外加自研的视图过渡动画起点（ToggleOrigin）。
- 替换为：**next-themes**（ThemeProvider + useTheme），shadcn 所有主题示例的标配。
- 风险：ToggleOrigin 起点动画 next-themes 不提供，需保留一个薄包装或放弃该效果；`lib/theme.ts` 是全局真值源，替换波及 ThemeIcon、设置页外观区块、useTerminalTheme（后者独立不受影响）。
- 收益：删 169 行 store 代码；SSR 闪烁（blocking script）由 next-themes 处理，比现在更稳。
- 工作量：中。

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

## 五、建议执行批次

1. **批次 1（小，纯删除自研基础设施）**：A4 引用浮层、A5 扩展组件卡、A10 KeepAliveDock 菜单、A11 RadioGroup（新增 `ui/radio-group.tsx`）、A12 扩展请求对话框（连带删 A7 `useDialogMaxHeight`）、A8 use-mobile 归位 + 删 SidebarToast.test.mjs 残留 + A13 三项类级推广（spinner/Collapsible/图标按钮 Tooltip）。A9（SourceCodeView 高亮统一、删 react-syntax-highlighter）可并入本批或单独提交。
2. **批次 2（中）**：A1 头部四面板 → Popover（删 useOutsideDismiss/useDelayedUnmount）、A3 DirectoryPicker → Dialog。
3. **批次 3（大）**：A2 SidebarMenu 分流 DropdownMenu/Popover/Sheet（1178 行，三个使用方）。
4. **批次 4（新依赖）**：B1 Resizable、B2 next-themes。
5. 批次 2/3 完成后统一删除 `lib/stacked-dialog.ts`（A6）。

每批次独立提交，可单独回滚。批次 1–3 不引入任何新 npm 依赖（radio-group 是复制官方组件源码，非新包）。

## 六、结论

自研交互 UI 至此全部盘点完毕（70 个业务组件 + 30 个 hooks + lib 交互基础设施逐一核对）：可替换项 A1–A13 + B1–B2 共 15 项，替换完成后可删除的自研基础设施合计约 **2100 行**（SidebarMenu 1178、useResizablePanel 323、stacked-dialog 201、useTheme 169、useDialogMaxHeight 38、useOutsideDismiss + useDelayedUnmount ~120、各浮层外壳散码 ~100）；其余均为无 shadcn 对应的业务组件与 hooks，保留。
