"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { Button } from "./ui/button";

/**
 * UI 调试面板：布局 / 视口 / 聊天滚动的实时数，只在面板打开时采样。
 *
 * 关闭即零成本：定时器在 `active` 为假时不存在，DOM 也全部靠选择器现取
 * （官方 scroller 给滚动容器挂了 `data-scrollable`，输入条是
 * `.chat-composer-dock`），所以不往 AppShell 或 ChatWindow 里接 ref，
 * 正常使用期不装任何监听。
 *
 * 2026-11-22 起因：「偶现贴真底」——滚到机械末端时最后一行被输入条盖住。
 * 官方 scroller 的内容末端 = `max(行 bottom) + content 的 padding-end`，而
 * `scrollToEnd()` 用 `scrollHeight - clientHeight`，两者都吃 Content 的垫底
 * （`--composer-dock-h`），所以「垫底是不是真的」这一项最要紧。
 */

type Row = { label: string; value: string };

const SAMPLE_INTERVAL_MS = 250;
/** 吸附带：`lib/advanced-settings.ts` 的 `scrollEdgeThreshold` 默认值。 */
const SNAP_ZONE = 16;

function px(value: number): string {
  return `${Math.round(value)}`;
}

/** 自定义属性会落在子树（如 Content 的 `pb` 吃宿主上的 `--composer-dock-h`），必须从该元素读。 */
function variable(name: string, from: Element | null = document.documentElement): string {
  const raw = from ? getComputedStyle(from).getPropertyValue(name).trim() : "";
  return raw || "—";
}

const CONTENT_SELECTOR = '[data-slot="message-scroller-content"]';

/**
 * 视口：官方 `data-slot` 首选。`[data-scrollable]` 同时挂在 root 和 viewport 上，
 * `querySelector` 拿到的是 root（不可滚），必须取最内层那个。
 */
function findViewport(): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
  if (direct) return direct;
  const list = Array.from(document.querySelectorAll<HTMLElement>("[data-scrollable]"));
  return list.filter((el) => el.parentElement?.hasAttribute("data-scrollable")).at(-1) ?? list.at(-1) ?? null;
}

/** 采样一次。全部是读操作，调用方负责只在面板打开时跑。 */
function collect(frames: number | null): Row[] {
  const html = document.documentElement;
  const viewport = window.visualViewport;
  const scroller = findViewport();
  const dock = document.querySelector<HTMLElement>(".chat-composer-dock");
  const rows: Row[] = [];

  rows.push({ label: "窗口", value: `${window.innerWidth} × ${window.innerHeight}  dpr ${window.devicePixelRatio}` });
  rows.push({
    label: "文档",
    value: `${html.clientWidth} × ${html.clientHeight}  滚动 ${px(html.scrollTop)}/${px(Math.max(0, html.scrollHeight - html.clientHeight))}`,
  });
  rows.push({
    label: "visualViewport",
    value: viewport ? `${px(viewport.width)} × ${px(viewport.height)}  偏移 ${px(viewport.offsetTop)}` : "—",
  });
  rows.push({
    label: "视口变量",
    value: `--app-viewport-height ${variable("--app-viewport-height")}  --keyboard-full-height ${variable("--keyboard-full-height")}`,
  });
  rows.push({ label: "键盘", value: html.dataset.keyboardOpen === undefined ? "关" : `开（${html.dataset.keyboardOpen}）` });
  rows.push({
    label: "输入方式",
    value: [
      window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
      window.matchMedia("(pointer: coarse)").matches ? "coarse" : "fine",
      window.matchMedia("(hover: hover)").matches ? "hover" : "no-hover",
    ].join("  "),
  });

  if (dock) {
    const card = dock.querySelector<HTMLElement>("[data-chat-input]") ?? dock.lastElementChild;
    rows.push({
      label: "输入条",
      value: `dock ${px(dock.offsetHeight)}  卡片 ${card instanceof HTMLElement ? px(card.getBoundingClientRect().height) : "—"}  --composer-dock-h ${variable("--composer-dock-h", dock)}`,
    });
  }

  if (scroller) {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const content = scroller.querySelector<HTMLElement>(CONTENT_SELECTOR) ?? (scroller.firstElementChild as HTMLElement | null);
    const padEnd = content ? Number.parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0;
    const scrollTop = scroller.scrollTop;
    // 末行：跳过官方追在 Content 末位的隐藏 spacer（`[data-message-scroller-spacer][hidden]`），
    // 以及任何零高度行——它们不是视觉末行，量出来的「差」会离谱（曾报 -778）。
    const children = Array.from(content?.children ?? []) as HTMLElement[];
    const last = children.filter((el) => !el.hasAttribute("hidden") && el.getBoundingClientRect().height > 0).at(-1) ?? null;
    const lastBottom = last ? last.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scrollTop : 0;
    rows.push({
      label: "滚动",
      value: `${px(scrollTop)} / ${px(max)}  差 ${px(max - scrollTop)}  client ${px(scroller.clientHeight)} scroll ${px(scroller.scrollHeight)}`,
    });
    rows.push({
      label: "内容垫底",
      value: `${px(padEnd)}  行 ${children.length}${last ? `  末行 ${px(last.getBoundingClientRect().height)}` : ""}  --composer-dock-h ${variable("--composer-dock-h", content ?? dock)}`,
    });
    if (last) rows.push({ label: "末行到视口底", value: `${px(lastBottom - scrollTop - scroller.clientHeight)}（贴底时应 ≈ -垫底）` });
    // 越界滚动：scrollTop 超过 max 时，屏幕底部那段垫底里会出现空白——就是「物理贴底」看到的空隙。
    const over = scrollTop - max;
    // 官方续 follow 的门槛 = Content 垫底 + 吸附带（`ChatWindow` 把垫底加进了 `scrollEdgeThreshold`）。
    const threshold = padEnd + SNAP_ZONE;
    rows.push({
      label: "官方 end",
      value: `${px(lastBottom + padEnd - scrollTop - scroller.clientHeight)}（>${px(threshold)} 才算没到底）  可滚 ${scroller.getAttribute("data-scrollable") ?? "—"}${scroller.hasAttribute("data-autoscrolling") ? "  跟随中" : ""}${Math.abs(over) >= 1 ? `  越界 ${px(over)}` : ""}`,
    });
  } else {
    rows.push({ label: "滚动", value: "未找到 message-scroller viewport（当前没有会话）" });
  }

  rows.push({
    label: "主题",
    value: `${html.classList.contains("dark") ? "dark" : "light"}  系统 ${window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"}  --background ${variable("--background")}`,
  });
  rows.push({
    label: "排版变量",
    value: `--chat-column-padding ${variable("--chat-column-padding")}  --chat-row-gap ${variable("--chat-row-gap")}`,
  });

  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  rows.push({
    label: "性能",
    value: `${frames === null ? "帧 —" : `${frames.toFixed(1)}ms/帧`}  ${memory ? `堆 ${(memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : "堆 —"}  核 ${navigator.hardwareConcurrency ?? "—"}`,
  });

  return rows;
}

export function UiDebugPanel({ active, onClose }: {
  /** 面板是否可见：只有为真时才采样，关闭即停止一切成本。 */
  active: boolean;
  onClose: (restoreFocus: boolean) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState(false);
  const framesRef = useRef<number | null>(null);

  // 帧时长只在打开时量 30 帧：连续 rAF 本身就是成本，量完就停。
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let count = 0;
    const start = performance.now();
    const tick = () => {
      if (cancelled) return;
      count += 1;
      if (count < 30) {
        requestAnimationFrame(tick);
        return;
      }
      framesRef.current = (performance.now() - start) / count;
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setRows(null);
      framesRef.current = null;
      setCopied(false);
      return;
    }
    const sample = () => setRows(collect(framesRef.current));
    sample();
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, onClose]);

  const copy = useCallback(() => {
    if (!rows) return;
    void copyText(rows.map((row) => `${row.label}: ${row.value}`).join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [rows]);

  return (
    <div className="flex max-h-[min(70vh,560px)] w-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="truncate text-sm font-medium leading-none">{t("uiDebug.title")}</div>
        {/* 两个按钮同高同字号、都不换行：文字按钮在不同语言下行高不同，曾把「关闭」推歪。 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 shrink-0 whitespace-nowrap px-2 text-xs leading-none" onClick={copy} disabled={!rows}>
            {copied ? t("debug.copied") : t("uiDebug.copy")}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => onClose(true)}
            aria-label={t("uiDebug.close")}
            title={t("uiDebug.close")}
          >
            <XIcon className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2">
        {rows ? (
          <dl className="flex flex-col gap-1.5 font-mono text-[11px] leading-[1.5]">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[5.5rem_1fr] items-baseline gap-2">
                <dt className="truncate text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words tabular-nums text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="py-2 text-xs italic text-muted-foreground">{t("uiDebug.idle")}</div>
        )}
      </div>
    </div>
  );
}
