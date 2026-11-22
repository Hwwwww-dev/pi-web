/**
 * 「高级参数」页的参数表：默认值、范围、门控、生效时机。
 *
 * 这里是**唯一**的默认值来源。页面用它渲染，接线点用它取默认值，服务端用它
 * 校验与钳制。默认值全部写死成常量、不跟随上游库的默认（message-scroller、
 * 浏览器 API 都可能改默认值；手感不该因为一次升级就漂移）。
 *
 * 语言不放进 i18n 字典：参数名与说明跟着范围/门控走，写在同一个条目里比
 * 三份字典里找同一批键更容易改对，也让这份表能直接当文档读。
 */

export type AdvancedSettingKind = "switch" | "number" | "choice";

/** 改完什么时候生效，页面上每个参数旁一句小字。 */
export type AdvancedSettingEffect = "live" | "next-message" | "reload";

export const ADVANCED_GROUP_VALUES = [
  "scroll",
  "loading",
  "render",
  "image",
  "fold",
  "display",
  "reload",
  "server",
] as const;

export type AdvancedGroupId = (typeof ADVANCED_GROUP_VALUES)[number];

export interface AdvancedGroupSpec {
  id: AdvancedGroupId;
  label: LocalizedText;
  description?: LocalizedText;
}

/** 三种语言同一处写：参数名与说明不散落在 i18n 字典里。 */
export interface LocalizedText {
  zh: string;
  tw: string;
  en: string;
}

export interface AdvancedChoiceOption {
  value: string;
  label: LocalizedText;
}

interface AdvancedSettingBase {
  key: string;
  group: AdvancedGroupId;
  label: LocalizedText;
  hint?: LocalizedText;
  effect: AdvancedSettingEffect;
  /** 调了容易让人以为程序坏了的参数：默认折叠在「显示专家项」之后。 */
  expert?: boolean;
  /** 父开关的键：父开关关闭时本项整行隐藏（不是置灰）。 */
  gate?: string;
}

export interface AdvancedSwitchSpec extends AdvancedSettingBase {
  kind: "switch";
  default: boolean;
}

export interface AdvancedNumberSpec extends AdvancedSettingBase {
  kind: "number";
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface AdvancedChoiceSpec extends AdvancedSettingBase {
  kind: "choice";
  default: string;
  options: AdvancedChoiceOption[];
}

export type AdvancedSettingSpec = AdvancedSwitchSpec | AdvancedNumberSpec | AdvancedChoiceSpec;

export type AdvancedSettingValue = boolean | number | string;

export type AdvancedSettings = Record<string, AdvancedSettingValue>;

const zhTw = (zh: string, tw: string, en: string): LocalizedText => ({ zh, tw, en });

export const ADVANCED_GROUPS: AdvancedGroupSpec[] = [
  { id: "scroll", label: zhTw("消息列表 / 滚动", "訊息列表 / 捲動", "Message list / scrolling") },
  { id: "loading", label: zhTw("加载更多", "載入更多", "Loading more") },
  { id: "render", label: zhTw("渲染", "渲染", "Rendering") },
  { id: "image", label: zhTw("图片上传", "圖片上傳", "Image upload") },
  { id: "fold", label: zhTw("折叠", "摺疊", "Folding") },
  { id: "display", label: zhTw("界面显示", "介面顯示", "Interface") },
  { id: "reload", label: zhTw("重载 / 历史保留", "重載 / 歷史保留", "Reload / history") },
  { id: "server", label: zhTw("服务端", "服務端", "Server") },
];

/**
 * 参数表，按页面上的分组顺序。
 *
 * 取值范围只放"不会把程序弄坏"的那一段：下限给到 0 的地方（阈值、防抖）是
 * 关掉这项行为，上限是实测还不会卡顿的位置。
 */
export const ADVANCED_SETTINGS: AdvancedSettingSpec[] = [
  // —— 消息列表 / 滚动 ——
  {
    key: "autoScroll",
    group: "scroll",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("跟随底部", "跟隨底部", "Follow the bottom"),
    hint: zhTw("流式回复时自动贴底；上滑阅读时让位", "串流回覆時自動貼底；上滑閱讀時讓位", "Keeps the newest text in view while a reply streams"),
  },
  {
    key: "scrollEdgeThreshold",
    group: "scroll",
    kind: "number",
    default: 16,
    min: 0,
    max: 200,
    step: 1,
    unit: "px",
    effect: "live",
    label: zhTw("贴底吸附带", "貼底吸附帶", "Bottom snap zone"),
    hint: zhTw("距离底部多少像素内算“在底部”", "距離底部多少像素內算「在底部」", "How close to the end still counts as being at the bottom"),
  },
  {
    key: "scrollPreviousItemPeek",
    group: "scroll",
    kind: "number",
    default: 64,
    min: 0,
    max: 200,
    step: 1,
    unit: "px",
    effect: "live",
    label: zhTw("上翻保留上一行", "上翻保留上一行", "Previous row peek"),
    hint: zhTw("向上翻页时露出上一行的像素高度", "向上翻頁時露出上一行的像素高度", "How much of the previous row stays visible when paging up"),
  },
  {
    key: "defaultScrollPosition",
    group: "scroll",
    kind: "choice",
    default: "end",
    effect: "reload",
    label: zhTw("重开会话落点", "重開會話落點", "Where a reopened session lands"),
    options: [
      { value: "end", label: zhTw("最新消息", "最新訊息", "Newest message") },
      { value: "last-anchor", label: zhTw("最后一次提问", "最後一次提問", "Last question") },
    ],
  },

  // —— 加载更多 ——
  {
    key: "pageTurns",
    group: "loading",
    kind: "number",
    default: 3,
    min: 1,
    max: 20,
    step: 1,
    unit: "轮",
    effect: "reload",
    label: zhTw("首屏轮数", "首屏輪數", "Turns on first screen"),
    hint: zhTw("同时也决定重载时一次取几轮", "同時也決定重載時一次取幾輪", "Also the number of turns a reload requests"),
  },
  {
    key: "olderPageTurns",
    group: "loading",
    kind: "number",
    default: 3,
    min: 1,
    max: 10,
    step: 1,
    unit: "轮",
    effect: "live",
    label: zhTw("上翻一次加载", "上翻一次載入", "Turns per page up"),
    hint: zhTw("每次上滑追加的轮数", "每次上滑追加的輪數", "How many turns one swipe up adds"),
  },
  {
    key: "autoLoadDebounceMs",
    group: "loading",
    kind: "number",
    default: 200,
    min: 0,
    max: 800,
    step: 50,
    unit: "ms",
    effect: "live",
    label: zhTw("取页防抖", "取頁防抖", "Page-load debounce"),
  },
  {
    key: "prependSettleFrames",
    group: "loading",
    kind: "number",
    default: 12,
    min: 0,
    max: 40,
    step: 1,
    unit: "帧",
    effect: "live",
    expert: true,
    label: zhTw("前插稳定帧", "前插穩定幀", "Frames before pinning"),
    hint: zhTw("旧消息插到顶部后等几帧再钉住位置", "舊訊息插到頂部後等幾幀再釘住位置", "Frames to wait before pinning after older rows are prepended"),
  },

  // —— 渲染 ——
  {
    key: "maxHighlightChars",
    group: "render",
    kind: "choice",
    default: "16000",
    effect: "live",
    label: zhTw("代码高亮上限", "程式碼高亮上限", "Syntax highlight limit"),
    hint: zhTw("超过这个长度的代码不逐字上色", "超過這個長度的程式碼不逐字上色", "Longer code stays uncoloured"),
    options: [
      { value: "4000", label: zhTw("4 千字符", "4 千字元", "4k chars") },
      { value: "16000", label: zhTw("1.6 万字符", "1.6 萬字元", "16k chars") },
      { value: "64000", label: zhTw("6.4 万字符", "6.4 萬字元", "64k chars") },
    ],
  },
  {
    key: "thinkingPieceChars",
    group: "render",
    kind: "number",
    default: 8000,
    min: 2000,
    max: 32000,
    step: 1000,
    unit: "字符",
    effect: "next-message",
    expert: true,
    label: zhTw("思考分片长度", "思考分片長度", "Thinking piece size"),
  },
  {
    key: "liveOutputPreviewLines",
    group: "render",
    kind: "number",
    default: 20,
    min: 5,
    max: 50,
    step: 1,
    unit: "行",
    effect: "live",
    label: zhTw("流式输出预览行数", "串流輸出預覽行數", "Streaming output preview lines"),
  },
  {
    key: "toolUpdateCoalesceMs",
    group: "render",
    kind: "number",
    default: 150,
    min: 50,
    max: 500,
    step: 10,
    unit: "ms",
    effect: "next-message",
    expert: true,
    label: zhTw("流式增量合并间隔", "串流增量合併間隔", "Tool update coalescing"),
    hint: zhTw("调小更实时、调大更省电", "調小更即時、調大更省電", "Smaller is more immediate, larger saves battery"),
  },

  // —— 图片上传（主开关：压缩后再上传）——
  {
    key: "compressImages",
    group: "image",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("压缩后再上传", "壓縮後再上傳", "Compress before upload"),
  },
  {
    key: "imageMaxEdge",
    group: "image",
    kind: "number",
    default: 1568,
    min: 512,
    max: 4096,
    step: 8,
    unit: "px",
    effect: "live",
    gate: "compressImages",
    label: zhTw("长边上限", "長邊上限", "Longest edge"),
  },
  {
    key: "imageQuality",
    group: "image",
    kind: "number",
    default: 0.82,
    min: 0.3,
    max: 0.95,
    step: 0.01,
    effect: "live",
    gate: "compressImages",
    label: zhTw("质量", "品質", "Quality"),
  },
  {
    key: "imageSkipBelowKB",
    group: "image",
    kind: "number",
    default: 300,
    min: 0,
    max: 2048,
    step: 10,
    unit: "KB",
    effect: "live",
    gate: "compressImages",
    label: zhTw("小于此值不压缩", "小於此值不壓縮", "Skip below"),
  },
  {
    key: "imageOutputFormat",
    group: "image",
    kind: "choice",
    default: "jpeg",
    effect: "live",
    gate: "compressImages",
    label: zhTw("输出格式", "輸出格式", "Output format"),
    options: [
      { value: "jpeg", label: zhTw("JPEG", "JPEG", "JPEG") },
      { value: "webp", label: zhTw("WebP", "WebP", "WebP") },
    ],
  },
  {
    key: "showImageLimits",
    group: "image",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("启用图片上限", "啟用圖片上限", "Image limits"),
  },
  {
    key: "imageMaxMegabytes",
    group: "image",
    kind: "number",
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    unit: "MB",
    effect: "live",
    gate: "showImageLimits",
    label: zhTw("单张上限", "單張上限", "Per-image limit"),
  },
  {
    key: "imageMaxCount",
    group: "image",
    kind: "number",
    default: 10,
    min: 1,
    max: 50,
    step: 1,
    unit: "张",
    effect: "live",
    gate: "showImageLimits",
    label: zhTw("张数上限", "張數上限", "Image count limit"),
  },

  // —— 折叠 ——
  {
    key: "thinkingDefaultExpanded",
    group: "fold",
    kind: "switch",
    default: false,
    effect: "live",
    label: zhTw("思考默认展开", "思考預設展開", "Expand thinking by default"),
  },
  {
    key: "showMinimap",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("minimap", "minimap", "Minimap"),
  },
  {
    key: "showInspirationEntry",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("灵感入口", "靈感入口", "Inspiration entry"),
    hint: zhTw("隐藏后 / 命令仍可用", "隱藏後 / 指令仍可用", "The / command still works when hidden"),
  },
  {
    key: "showKeepAliveDock",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("活跃会话条", "活躍會話條", "Active sessions bar"),
  },
  {
    key: "showExtensionStatus",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("扩展状态栏", "擴充狀態列", "Extension status"),
  },
  {
    key: "showExtensionWidgets",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("扩展 widgets", "擴充 widgets", "Extension widgets"),
  },
  {
    key: "showCacheMissNotices",
    group: "display",
    kind: "switch",
    default: true,
    effect: "reload",
    label: zhTw("缓存 / 成本提示", "快取 / 成本提示", "Cache and cost notices"),
    hint: zhTw("写进 pi 的全局设置，与 pi 共用", "寫進 pi 的全域設定，與 pi 共用", "Written to pi's global settings, shared with pi"),
  },
  {
    key: "showUnreadBadge",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("未读数徽标", "未讀數徽標", "Unread badge"),
  },
  {
    key: "showSidebarVersion",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("侧栏版本号", "側欄版本號", "Sidebar version"),
  },
  {
    key: "showToolFields",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("工具参数行", "工具參數列", "Tool argument rows"),
  },
  {
    key: "showUsageLine",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("usage 行", "usage 列", "Usage line"),
  },
  {
    key: "showTerminalEntry",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("终端入口", "終端入口", "Terminal entry"),
  },
  {
    key: "showAttachmentStrip",
    group: "display",
    kind: "switch",
    default: true,
    effect: "live",
    label: zhTw("附件横向条", "附件橫向條", "Attachment strip"),
  },
  {
    key: "commandPaletteResults",
    group: "display",
    kind: "number",
    default: 20,
    min: 5,
    max: 50,
    step: 5,
    unit: "项",
    effect: "next-message",
    label: zhTw("命令面板结果数", "指令面板結果數", "File picker results"),
  },

  // —— 重载 / 历史保留 ——
  {
    key: "reloadKeepHistory",
    group: "reload",
    kind: "switch",
    default: false,
    effect: "live",
    label: zhTw("重载时保留已加载历史", "重載時保留已載入歷史", "Keep loaded history on reload"),
    hint: zhTw("关闭时手动重载与回到页面都只取首屏", "關閉時手動重載與回到頁面都只取首屏", "Off: both reload paths fall back to the first screen"),
  },
  {
    key: "reloadHistoryLimit",
    group: "reload",
    kind: "number",
    default: 1000,
    min: 100,
    max: 5000,
    step: 100,
    unit: "条",
    effect: "live",
    gate: "reloadKeepHistory",
    label: zhTw("保留历史上限", "保留歷史上限", "History limit"),
  },

  // —— 服务端（专家）——
  {
    key: "sseHeartbeatMs",
    group: "server",
    kind: "number",
    default: 30000,
    min: 5000,
    max: 120000,
    step: 5000,
    unit: "ms",
    effect: "next-message",
    expert: true,
    label: zhTw("SSE 心跳", "SSE 心跳", "SSE heartbeat"),
  },
  {
    key: "sessionIdleTimeoutMs",
    group: "server",
    kind: "number",
    default: 600000,
    min: 60000,
    max: 3600000,
    step: 60000,
    unit: "ms",
    effect: "next-message",
    expert: true,
    label: zhTw("会话空闲超时", "會話閒置逾時", "Session idle timeout"),
  },
  {
    key: "awayReloadMs",
    group: "server",
    kind: "number",
    default: 30000,
    min: 5000,
    max: 300000,
    step: 5000,
    unit: "ms",
    effect: "next-message",
    expert: true,
    label: zhTw("回到页面重载阈值", "回到頁面重載閾值", "Reload-after-return delay"),
  },
];

const SPEC_BY_KEY = new Map(ADVANCED_SETTINGS.map((spec) => [spec.key, spec]));

export function advancedSettingSpec(key: string): AdvancedSettingSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

/** 全部默认值，键即参数名。 */
export function defaultAdvancedSettings(): AdvancedSettings {
  const values: AdvancedSettings = {};
  for (const spec of ADVANCED_SETTINGS) values[spec.key] = spec.default;
  return values;
}

/** 数字按范围与步长收拢：小于 min 取 min，大于 max 取 max，落在步长网格上。 */
function clampNumber(spec: AdvancedNumberSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  const bounded = Math.min(spec.max, Math.max(spec.min, value));
  const steps = Math.round((bounded - spec.min) / spec.step);
  const snapped = spec.min + steps * spec.step;
  // 0.82 这类浮点步长，乘除后会拖出 0.8300000000000001：按步长的小数位收一下。
  const decimals = (String(spec.step).split(".")[1] ?? "").length;
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(decimals));
}

/**
 * 读到的一个值能否用在这个参数上。不认识的值一律当"没设置"，落回默认，
 * 免得一个手改坏的 JSON 让页面渲染出越界数字或未知选项。
 */
function coerceValue(spec: AdvancedSettingSpec, value: unknown): AdvancedSettingValue {
  if (spec.kind === "switch") {
    if (typeof value === "boolean") return value;
    // 手写 JSON 时 true/"true"/1 都会出现，认得出来就认。
    if (value === "true" || value === 1) return true;
    if (value === "false" || value === 0) return false;
    return spec.default;
  }
  if (spec.kind === "number") {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return clampNumber(spec, numeric);
  }
  const text = typeof value === "string" ? value : String(value ?? "");
  return spec.options.some((option) => option.value === text) ? text : spec.default;
}

/** 把磁盘上（或请求体里）的一份原始对象补成完整参数表。 */
export function normalizeAdvancedSettings(raw: unknown): AdvancedSettings {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const values: AdvancedSettings = {};
  for (const spec of ADVANCED_SETTINGS) values[spec.key] = coerceValue(spec, source[spec.key]);
  return values;
}

/** 只留下与默认值不同的键：配置文件里不必抄一遍默认值。 */
export function differencesFromDefaults(values: AdvancedSettings): AdvancedSettings {
  const defaults = defaultAdvancedSettings();
  const changed: AdvancedSettings = {};
  for (const spec of ADVANCED_SETTINGS) {
    if (values[spec.key] !== defaults[spec.key]) changed[spec.key] = values[spec.key];
  }
  return changed;
}

/** 父开关关掉时子项整行隐藏（不是置灰）。 */
export function isAdvancedSettingVisible(spec: AdvancedSettingSpec, values: AdvancedSettings): boolean {
  if (!spec.gate) return true;
  return values[spec.gate] !== false;
}
