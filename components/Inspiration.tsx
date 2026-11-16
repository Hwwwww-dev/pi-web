"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ImagePlusIcon, LightbulbIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/i18n/format";
import { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } from "@/lib/image-attachments";
import type { InspirationItem } from "@/lib/inspirations";
import type { Locale } from "@/lib/i18n/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * 💡灵感的核心界面（pi-web 独有），与容器无关——今天挂在 dialog 里，明天也
 * 可以挂进任何面板；这里没有 dialog 假设，壳（关闭钮、圆角、遮罩）由容器负责。
 * 三个视图：列表（灵感/历史/已删除 三个 Tab）、新建页、编辑页。新建与编辑都
 * 自动保存（输入停顿后落盘，返回或卸载前冲刷），没有保存按钮。列表行按 Tab
 * 给出 实现/编辑/完成/删除、重新挂入/删除、恢复/彻底删除。「实现」把文本与
 * 图片交给 onImplement（通常是输入框），绝不自动发送。
 */

type TabValue = "active" | "done" | "deleted";

interface PendingImage {
  file: File;
  previewUrl: string;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
/** 列表缩略图最多展示几张，其余并入计数。 */
const MAX_ROW_THUMBNAILS = 4;

function imageUrl(imageId: string): string {
  return `/api/inspirations/images/${imageId}`;
}

export function Inspiration({ sessionId, onImplement, onClose, className }: {
  /** 会话隔离：无会话时不挂入口，此值恒有。 */
  sessionId: string;
  /** 文本与图片回到输入框（不自动发送）；由持有 composer 接口的一方接线。 */
  onImplement: (text: string, images: File[]) => void;
  /** 实现成功后容器如何退场（如关闭弹窗）；不传则只做核心内部的导航。 */
  onClose?: () => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<InspirationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [view, setView] = useState<{ kind: "list" } | { kind: "editor"; itemId: string | null }>({ kind: "list" });

  // 编辑器状态（新建与编辑共用一页）。已存文本 ref 用来判断 PATCH 是否需要发。
  const [editorText, setEditorText] = useState("");
  const [editorImages, setEditorImages] = useState<string[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const editorItemIdRef = useRef<string | null>(null);
  const savedTextRef = useRef("");
  const editorTextRef = useRef("");
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const saveTimerRef = useRef(0);
  const savingRef = useRef(false);
  const resaveRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  editorTextRef.current = editorText;
  pendingImagesRef.current = pendingImages;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspirations/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items: InspirationItem[] };
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  // 挂载即取数：核心由容器按需挂载（弹窗关闭即卸载），不存在「打开」以外的时机。
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── 自动保存 ─────────────────────────────────────────────────────────
  const saveNow = useCallback(async () => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;
    if (savingRef.current) {
      resaveRef.current = true;
      return;
    }
    const text = editorTextRef.current;
    const pending = pendingImagesRef.current;
    // 全空的编辑器不落任何东西：离开即丢弃。
    if (!text && pending.length === 0 && editorItemIdRef.current === null) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      let itemId = editorItemIdRef.current;
      if (!itemId) {
        const res = await fetch(`/api/inspirations/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        itemId = ((await res.json()) as { item: InspirationItem }).item.id;
        editorItemIdRef.current = itemId;
      } else if (text !== savedTextRef.current) {
        const res = await fetch(`/api/inspirations/${sessionId}/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      savedTextRef.current = text;
      // 图片逐张上传（先文件落盘，后挂到条目上）；失败的那张留在待传列。
      while (pendingImagesRef.current.length > 0) {
        const pendingImage = pendingImagesRef.current[0];
        const form = new FormData();
        form.set("itemId", itemId);
        form.set("file", pendingImage.file);
        const res = await fetch(`/api/inspirations/${sessionId}/images`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { imageId } = await res.json() as { imageId: string };
        setPendingImages((prev) => prev.slice(1));
        setEditorImages((prev) => [...prev, imageId]);
        URL.revokeObjectURL(pendingImage.previewUrl);
      }
      setSaveState("saved");
      void refresh();
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      savingRef.current = false;
      if (resaveRef.current) {
        resaveRef.current = false;
        void saveNow();
      }
    }
  }, [sessionId, refresh]);

  const scheduleSave = useCallback(() => {
    setSaveState("idle");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveNow(), AUTOSAVE_DEBOUNCE_MS);
  }, [saveNow]);

  /** 返回列表前冲刷：定时器与在途保存都不丢内容。 */
  const flushEditor = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;
    void saveNow();
  }, [saveNow]);

  const leaveEditor = useCallback(() => {
    flushEditor();
    setView({ kind: "list" });
    void refresh();
  }, [flushEditor, refresh]);

  // 容器卸载（弹窗关闭、面板移除）前冲刷一次；latest-ref 保证拿到最后的保存状态。
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    void saveNowRef.current();
  }, []);

  const openEditor = useCallback((item: InspirationItem | null) => {
    editorItemIdRef.current = item?.id ?? null;
    savedTextRef.current = item?.text ?? "";
    setEditorText(item?.text ?? "");
    setEditorImages(item?.imageIds ?? []);
    setPendingImages([]);
    setSaveState("idle");
    setError(null);
    setView({ kind: "editor", itemId: item?.id ?? null });
  }, []);

  // ── 图片：添加（点选/粘贴/拖拽）、移除（已存/待传） ────────────────────
  const addImageFiles = useCallback((files: File[]) => {
    const accepted: PendingImage[] = [];
    let overflow: number | null = null;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_ATTACHED_IMAGE_BYTES) continue;
      if (editorImages.length + pendingImagesRef.current.length + accepted.length >= MAX_ATTACHED_IMAGES) {
        overflow = MAX_ATTACHED_IMAGES;
        break;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (accepted.length > 0) {
      setPendingImages((prev) => [...prev, ...accepted]);
      scheduleSave();
    }
    setError(overflow === null ? null : t("inspiration.tooManyImages", { max: MAX_ATTACHED_IMAGES }));
  }, [editorImages.length, scheduleSave, t]);

  const removeSavedImage = useCallback(async (imageId: string) => {
    const itemId = editorItemIdRef.current;
    if (!itemId) return;
    try {
      const res = await fetch(`/api/inspirations/images/${imageId}?sessionId=${sessionId}&itemId=${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditorImages((prev) => prev.filter((entry) => entry !== imageId));
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, refresh]);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const [removed] = prev.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return [...prev];
    });
  }, []);

  // ── 列表行操作 ───────────────────────────────────────────────────────
  const runAction = useCallback(async (item: InspirationItem, action: "done" | "remount" | "delete" | "restore") => {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/inspirations/${sessionId}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
      setConfirmPurgeId(null);
    }
  }, [sessionId, refresh]);

  const purge = useCallback(async (item: InspirationItem) => {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/inspirations/${sessionId}/${item.id}?purge=1`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
      setConfirmPurgeId(null);
    }
  }, [sessionId, refresh]);

  /** 实现：图片取回为 File 连同文本交给输入框；不自动发送。 */
  const implement = useCallback(async (item: InspirationItem) => {
    setBusyId(item.id);
    try {
      const files = await Promise.all(item.imageIds.map(async (imageId) => {
        const res = await fetch(imageUrl(imageId));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        return new File([blob], imageId, { type: blob.type || "image/png" });
      }));
      onImplement(item.text, files);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, [onImplement, onClose]);

  const active = items?.filter((item) => !item.doneAt && !item.deletedAt) ?? [];
  const done = items?.filter((item) => item.doneAt && !item.deletedAt) ?? [];
  const deleted = items?.filter((item) => item.deletedAt) ?? [];
  const counts: Record<TabValue, number> = { active: active.length, done: done.length, deleted: deleted.length };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...event.target.files ?? []];
          event.target.value = "";
          addImageFiles(files);
        }}
      />
      {view.kind === "list" ? (
        <>
          {/* 标题与新建靠左成簇：右上角留给容器的关闭钮，互不重叠。 */}
          <div className="flex shrink-0 items-center gap-2 pl-4 pr-4 pt-4">
            <LightbulbIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base">{t("inspiration.title")}</h2>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="pointer-coarse:min-h-9"
              onClick={() => openEditor(null)}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              {t("inspiration.actionCreate")}
            </Button>
          </div>
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="mx-4 mt-3 shrink-0 self-start">
              <TabsTrigger value="active">{t("inspiration.tabActive")}<span className="tabular-nums text-muted-foreground/70">{counts.active}</span></TabsTrigger>
              <TabsTrigger value="done">{t("inspiration.tabDone")}<span className="tabular-nums text-muted-foreground/70">{counts.done}</span></TabsTrigger>
              <TabsTrigger value="deleted">{t("inspiration.tabDeleted")}<span className="tabular-nums text-muted-foreground/70">{counts.deleted}</span></TabsTrigger>
            </TabsList>
            {error && <div role="alert" className="shrink-0 px-4 pt-2 text-xs text-destructive wrap-anywhere">{error}</div>}
            <TabsContent value="active" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {active.length === 0 ? (
                <EmptyHint text={t("inspiration.emptyActive")} />
              ) : (
                <div className="flex flex-col gap-0.5">
                  {active.map((item) => (
                    <InspirationRow
                      key={item.id} item={item} busyId={busyId} locale={locale} t={t}
                      confirmPurgeId={confirmPurgeId} setConfirmPurgeId={setConfirmPurgeId}
                      onImplement={implement}
                      onEdit={() => openEditor(item)}
                      onAction={runAction}
                      onPurge={purge}
                      actions={["implement", "edit", "done", "delete"] as const}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="done" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {done.length === 0 ? (
                <EmptyHint text={t("inspiration.emptyDone")} />
              ) : (
                <div className="flex flex-col gap-0.5">
                  {done.map((item) => (
                    <InspirationRow
                      key={item.id} item={item} busyId={busyId} locale={locale} t={t}
                      confirmPurgeId={confirmPurgeId} setConfirmPurgeId={setConfirmPurgeId}
                      onImplement={implement}
                      onEdit={() => openEditor(item)}
                      onAction={runAction}
                      onPurge={purge}
                      actions={["remount", "delete"] as const}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="deleted" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {deleted.length === 0 ? (
                <EmptyHint text={t("inspiration.emptyDeleted")} />
              ) : (
                <div className="flex flex-col gap-0.5">
                  {deleted.map((item) => (
                    <InspirationRow
                      key={item.id} item={item} busyId={busyId} locale={locale} t={t}
                      confirmPurgeId={confirmPurgeId} setConfirmPurgeId={setConfirmPurgeId}
                      onImplement={implement}
                      onEdit={() => openEditor(item)}
                      onAction={runAction}
                      onPurge={purge}
                      actions={["restore", "purge"] as const}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <EditorPage
          creating={view.itemId === null}
          text={editorText} onTextChange={(text) => { setEditorText(text); scheduleSave(); }}
          savedImages={editorImages} pendingImages={pendingImages}
          saveState={saveState} error={error}
          onBack={leaveEditor}
          onAddImages={() => fileInputRef.current?.click()}
          onRemoveSaved={removeSavedImage}
          onRemovePending={removePendingImage}
          onPasteImages={addImageFiles}
          t={t}
        />
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">{text}</div>;
}

type InspirationT = (
  key:
    | "inspiration.timeCreated" | "inspiration.timeDone" | "inspiration.timeDeleted"
    | "inspiration.actionImplement" | "inspiration.actionEdit" | "inspiration.actionDone"
    | "inspiration.actionRemount" | "inspiration.actionDelete" | "inspiration.actionRestore"
    | "inspiration.actionPurge" | "inspiration.confirmPurge"
    | "inspiration.actionBack" | "inspiration.editorCreate" | "inspiration.editorEdit"
    | "inspiration.editorPlaceholder" | "inspiration.actionAddImage" | "inspiration.actionRemoveImage"
    | "inspiration.saveStateIdle" | "inspiration.saveStateSaving" | "inspiration.saveStateSaved" | "inspiration.saveStateError"
) => string;

function InspirationRow({ item, busyId, locale, t, confirmPurgeId, setConfirmPurgeId, onImplement, onEdit, onAction, onPurge, actions }: {
  item: InspirationItem;
  busyId: string | null;
  locale: Locale;
  t: InspirationT;
  confirmPurgeId: string | null;
  setConfirmPurgeId: (id: string | null) => void;
  onImplement: (item: InspirationItem) => void;
  onEdit: () => void;
  onAction: (item: InspirationItem, action: "done" | "remount" | "delete" | "restore") => void;
  onPurge: (item: InspirationItem) => void;
  actions: readonly ("implement" | "edit" | "done" | "remount" | "delete" | "restore" | "purge")[];
}) {
  const busy = busyId === item.id;
  const timeKey = item.deletedAt ? "inspiration.timeDeleted" : item.doneAt ? "inspiration.timeDone" : "inspiration.timeCreated";
  const time = item.deletedAt ?? item.doneAt ?? item.createdAt;
  const thumbnails = item.imageIds.slice(0, MAX_ROW_THUMBNAILS);
  const extraImages = item.imageIds.length - thumbnails.length;
  const actionClass = "pointer-coarse:min-h-9 h-7 px-2 text-xs font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground";
  return (
    <div className={cn("flex items-start gap-2 rounded-lg px-2 py-2 transition-colors pointer-coarse:min-h-9", busy ? "opacity-60" : "hover:bg-accent/40")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {item.text && <span className="line-clamp-2 text-[13px] whitespace-pre-wrap text-foreground" title={item.text}>{item.text}</span>}
        {item.imageIds.length > 0 && (
          <div className="flex items-center gap-1">
            {thumbnails.map((imageId) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={imageId} src={imageUrl(imageId)} alt="" loading="lazy" className="size-10 rounded-md border border-border object-cover" />
            ))}
            {extraImages > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">+{extraImages}</span>}
          </div>
        )}
        <span className="text-[11px] text-muted-foreground/70" title={time}>
          {t(timeKey)} {formatRelativeTime(time, locale)}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {actions.includes("implement") && (
          <Button type="button" variant="ghost" size="xs" className={cn(actionClass, "text-primary hover:text-primary")} disabled={busy} onClick={() => onImplement(item)}>
            {t("inspiration.actionImplement")}
          </Button>
        )}
        {actions.includes("edit") && (
          <Button type="button" variant="ghost" size="xs" className={actionClass} disabled={busy} onClick={onEdit}>
            <PencilIcon data-icon="inline-start" aria-hidden="true" />
            {t("inspiration.actionEdit")}
          </Button>
        )}
        {actions.includes("done") && (
          <Button type="button" variant="ghost" size="xs" className={actionClass} disabled={busy} onClick={() => onAction(item, "done")}>
            {t("inspiration.actionDone")}
          </Button>
        )}
        {actions.includes("remount") && (
          <Button type="button" variant="ghost" size="xs" className={actionClass} disabled={busy} onClick={() => onAction(item, "remount")}>
            {t("inspiration.actionRemount")}
          </Button>
        )}
        {actions.includes("restore") && (
          <Button type="button" variant="ghost" size="xs" className={actionClass} disabled={busy} onClick={() => onAction(item, "restore")}>
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            {t("inspiration.actionRestore")}
          </Button>
        )}
        {actions.includes("delete") && (
          <Button type="button" variant="ghost" size="xs" className={cn(actionClass, "hover:bg-destructive/10 hover:text-destructive")} disabled={busy} onClick={() => onAction(item, "delete")}>
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            {t("inspiration.actionDelete")}
          </Button>
        )}
        {actions.includes("purge") && (
          confirmPurgeId === item.id ? (
            <Button type="button" variant="ghost" size="xs" className={cn(actionClass, "text-destructive hover:bg-destructive/10")} disabled={busy} onClick={() => onPurge(item)}>
              {t("inspiration.confirmPurge")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="xs" className={cn(actionClass, "hover:bg-destructive/10 hover:text-destructive")} disabled={busy} onClick={() => setConfirmPurgeId(item.id)}>
              {t("inspiration.actionPurge")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function EditorPage({ creating, text, onTextChange, savedImages, pendingImages, saveState, error, onBack, onAddImages, onRemoveSaved, onRemovePending, onPasteImages, t }: {
  creating: boolean;
  text: string;
  onTextChange: (text: string) => void;
  savedImages: string[];
  pendingImages: PendingImage[];
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  onBack: () => void;
  onAddImages: () => void;
  onRemoveSaved: (imageId: string) => void;
  onRemovePending: (index: number) => void;
  onPasteImages: (files: File[]) => void;
  t: InspirationT;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onPasteImages([...event.dataTransfer.files]);
      }}
    >
      <div className="flex shrink-0 items-center gap-2 pl-2 pr-4 pt-3">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("inspiration.actionBack")} className="text-muted-foreground">
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <h2 className="text-base">{creating ? t("inspiration.editorCreate") : t("inspiration.editorEdit")}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        <textarea
          autoFocus
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length > 0) {
              event.preventDefault();
              onPasteImages(files);
            }
          }}
          placeholder={t("inspiration.editorPlaceholder")}
          className="min-h-40 w-full resize-none rounded-lg border border-border bg-transparent p-3 text-sm leading-[1.55] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="xs" className="pointer-coarse:min-h-9" onClick={onAddImages}>
            <ImagePlusIcon data-icon="inline-start" aria-hidden="true" />
            {t("inspiration.actionAddImage")}
          </Button>
          <span className="text-[11px] text-muted-foreground/70">
            {saveState === "saving" ? t("inspiration.saveStateSaving")
              : saveState === "error" ? t("inspiration.saveStateError")
                : saveState === "saved" ? t("inspiration.saveStateSaved")
                  : t("inspiration.saveStateIdle")}
          </span>
        </div>
        {(savedImages.length > 0 || pendingImages.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {savedImages.map((imageId) => (
              <div key={imageId} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(imageId)} alt="" className="size-16 rounded-md border border-border object-cover" />
                <Button
                  type="button" variant="ghost" size="icon-xs"
                  onClick={() => onRemoveSaved(imageId)}
                  title={t("inspiration.actionRemoveImage")}
                  aria-label={t("inspiration.actionRemoveImage")}
                  className="absolute -right-1 -top-1 size-4 rounded-full p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-2" strokeWidth={2.5} aria-hidden="true" />
                </Button>
              </div>
            ))}
            {pendingImages.map((image) => (
              <div key={image.previewUrl} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt="" className="size-16 rounded-md border border-border border-dashed object-cover opacity-80" />
                <Button
                  type="button" variant="ghost" size="icon-xs"
                  onClick={() => onRemovePending(pendingImages.indexOf(image))}
                  title={t("inspiration.actionRemoveImage")}
                  aria-label={t("inspiration.actionRemoveImage")}
                  className="absolute -right-1 -top-1 size-4 rounded-full p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-2" strokeWidth={2.5} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {error && <div role="alert" className="text-xs text-destructive wrap-anywhere">{error}</div>}
      </div>
    </div>
  );
}
