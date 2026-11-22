"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDown, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import type { CheckpointView } from "@/lib/turn-view";

/**
 * 压缩在对话里留下的那条线（Checkpoint = 官方 Marker 的 separator 变体）。
 *
 * 它是段落分隔，不是一条活动行：压缩前的内容在上、压缩后在下，中间这一行说明
 * 「这里压过一次」。官方 Checkpoint 的 Restore 按钮这里不挂——pi 的压缩是写进
 * JSONL 的历史事实，没有可回滚的状态。
 *
 * 点一下开 Popover 看这次的摘要正文（压缩工具参数里的 `summary`），带复制。
 */
export function CheckpointRow({ view }: { view: CheckpointView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = view.state === "running"
    ? t("checkpoint.compacting")
    : view.state === "error"
      ? t("checkpoint.failed", { detail: view.detail ?? "" })
      : view.before && view.after
        ? t("checkpoint.done", { before: view.before, after: view.after })
        : view.before
          ? t("checkpoint.doneFrom", { tokens: view.before })
          : t("checkpoint.doneNoTokens");

  const line = (
    <>
      <MarkerIcon>
        {view.state === "running"
          ? <LoaderIcon className="animate-spin" strokeWidth={2} />
          : view.state === "error"
            ? <TriangleAlertIcon strokeWidth={2} />
            : <CheckIcon strokeWidth={2} />}
      </MarkerIcon>
      <MarkerContent className="truncate">{text}</MarkerContent>
      {view.summary && (
        <ChevronsUpDown className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      )}
    </>
  );

  const onCopy = async () => {
    if (!view.summary) return;
    const ok = await copyText(view.summary);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!view.summary) {
    return <Marker variant="separator">{line}</Marker>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Marker
          variant="separator"
          className="cursor-pointer rounded-sm transition-colors hover:text-foreground data-[state=open]:text-foreground"
          data-state={open ? "open" : "closed"}
        >
          {line}
        </Marker>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[min(34rem,calc(100vw-3rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{text}</span>
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? t("checkpoint.copied") : t("checkpoint.copy")}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
          {view.summary}
        </pre>
      </PopoverContent>
    </Popover>
  );
}
