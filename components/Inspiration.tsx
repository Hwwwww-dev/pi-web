"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, FileIcon, ImagePlusIcon, LightbulbIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/i18n/format";
import { MAX_ATTACHED_IMAGES } from "@/lib/image-attachments";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { uploadFiles, uploadRepoDirectory } from "@/lib/file-upload-client";
import { MAX_INSPIRATION_FILE_BYTES, type Inspiration, type InspirationFileRef } from "@/lib/inspiration-shared";
import type { Locale } from "@/lib/i18n/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * 💡灵感的核心界面（pi-web 独有），与容器无关——今天挂在 dialog 里，明天也
 * 可以挂进任何面板；这里没有 dialog 假设，壳（关闭钮、圆角、遮罩）由容器负责。
 * 三个视图：列表（灵感/历史/已删除 三个 Tab）、新建页、编辑页。新建与编辑都
 * 自动保存（输入停顿后落盘，返回或卸载前冲刷），没有保存按钮。附件收图片与
 * 任意文件（≤10MB），点选、粘贴、拖拽三条路都进。列表行按 Tab 给出 实现/
 * 编辑/完成/删除、重新挂入/删除、恢复/彻底删除。「实现」把文本与附件交给
 * onImplement（通常是输入框），绝不自动发送。
 */

type TabValue = "active" | "done" | "deleted";

/** 与服务端 serve 路由同一张 inline 白名单：只有它渲染缩略图，其余都是文件 chip。 */
const INLINE_IMAGE_PATTERN = /^image\/(png|jpeg|gif|webp)$/;

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
/** 列表缩略图最多展示几张，其余并入计数。 */
const MAX_ROW_THUMBNAILS = 4;

/** 附件本体住在统一上传仓库;经文件 API 按扩展名出 MIME 直读。 */
function fileUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}?type=read`;
}

function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE_PATTERN.test(mime);
}

export function Inspiration({ sessionId, onImplement, onClose, className }: {
  /** 会话隔离：无会话时不挂入口，此值恒有。 */
  sessionId: string;
  /** 文本与附件回到输入框（不自动发送）；图片是字节，其余文件是仓库引用，由持有 composer 接口的一方编排。 */
  onImplement: (text: string, images: File[], files: InspirationFileRef[]) => void;
  /** 实现成功后容器如何退场（如关闭弹窗）；不传则只做核心内部的导航。 */
  onClose?: () => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Inspiration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [view, setView] = useState<{ kind: "list" } | { kind: "editor"; itemId: string | null }>({ kind: "list" });

  // 编辑器状态（新建与编辑共用一页）。已存文本 ref 用来判断 PATCH 是否需要发。
  const [editorText, setEditorText] = useState("");
  const [editorFiles, setEditorFiles] = useState<InspirationFileRef[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const editorItemIdRef = useRef<string | null>(null);
  const savedTextRef = useRef("");
  const editorTextRef = useRef("");
  const pendingFilesRef = useRef<PendingFile[]>([]);
  const saveTimerRef = useRef(0);
  const savingRef = useRef(false);
  const resaveRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  editorTextRef.current = editorText;
  pendingFilesRef.current = pendingFiles;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspirations/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items: Inspiration[] };
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
    const pending = pendingFilesRef.current;
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
        itemId = ((await res.json()) as { item: Inspiration }).item.id;
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
      // 附件逐个走统一上传接口落进灵感仓库（同名 skip：引用现有那份），成功后
      // PATCH 挂接引用；失败的那个留在待传列。
      const directory = uploadRepoDirectory("inspiration");
      while (pendingFilesRef.current.length > 0) {
        const pendingFile = pendingFilesRef.current[0];
        const { status, data } = await uploadFiles(directory, [pendingFile.file], "skip");
        if (status !== 200 && status !== 207) throw new Error(data.error ?? `HTTP ${status}`);
        if ((data.errors ?? []).length > 0) throw new Error(`${pendingFile.file.name}: ${data.errors?.[0].error}`);
        const attachRes = await fetch(`/api/inspirations/${sessionId}/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "attach",
            files: [{ name: pendingFile.file.name, mime: pendingFile.file.type || "application/octet-stream", path: `${directory}/${pendingFile.file.name}` }],
          }),
        });
        if (!attachRes.ok) throw new Error(`HTTP ${attachRes.status}`);
        setEditorFiles(((await attachRes.json()) as { item: Inspiration }).item.files);
        setPendingFiles((prev) => prev.slice(1));
        if (pendingFile.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
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

  const openEditor = useCallback((item: Inspiration | null) => {
    editorItemIdRef.current = item?.id ?? null;
    savedTextRef.current = item?.text ?? "";
    setEditorText(item?.text ?? "");
    setEditorFiles(item?.files ?? []);
    setPendingFiles([]);
    setSaveState("idle");
    setError(null);
    setView({ kind: "editor", itemId: item?.id ?? null });
  }, []);

  // ── 附件：添加（点选/粘贴/拖拽都走这里）、移除（已存/待传） ─────────────
  const addFiles = useCallback((files: File[]) => {
    const accepted: PendingFile[] = [];
    const oversized: string[] = [];
    let overflow: number | null = null;
    for (const file of files) {
      if (file.size > MAX_INSPIRATION_FILE_BYTES) {
        oversized.push(file.name || "file");
        continue;
      }
      if (editorFiles.length + pendingFilesRef.current.length + accepted.length >= MAX_ATTACHED_IMAGES) {
        overflow = MAX_ATTACHED_IMAGES;
        break;
      }
      accepted.push({ file, previewUrl: isInlineImage(file.type) ? URL.createObjectURL(file) : null });
    }
    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
      scheduleSave();
    }
    if (oversized.length > 0) {
      setError(t("inspiration.fileTooLarge", { names: oversized.join(", ") }));
    } else {
      setError(overflow === null ? null : t("inspiration.tooManyFiles", { max: MAX_ATTACHED_IMAGES }));
    }
  }, [editorFiles.length, scheduleSave, t]);

  const removeSavedFile = useCallback(async (filePath: string) => {
    const itemId = editorItemIdRef.current;
    if (!itemId) return;
    try {
      const res = await fetch(`/api/inspirations/${sessionId}/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detach", path: filePath }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditorFiles(((await res.json()) as { item: Inspiration }).item.files);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, refresh]);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const [removed] = prev.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return [...prev];
    });
  }, []);

  // ── 列表行操作 ───────────────────────────────────────────────────────
  const runAction = useCallback(async (item: Inspiration, action: "done" | "remount" | "delete" | "restore") => {
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

  const purge = useCallback(async (item: Inspiration) => {
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

  /** 实现：图片取回字节回 addImages，其余附件以仓库引用交由 composer 编排；都不自动发送。 */
  const implement = useCallback(async (item: Inspiration) => {
    setBusyId(item.id);
    try {
      const images = await Promise.all(item.files.filter((ref) => isInlineImage(ref.mime)).map(async (ref) => {
        const res = await fetch(fileUrl(ref.path));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new File([await res.blob()], ref.name, { type: ref.mime });
      }));
      onImplement(item.text, images, item.files.filter((ref) => !isInlineImage(ref.mime)));
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
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...event.target.files ?? []];
          event.target.value = "";
          addFiles(files);
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
              variant="ghost"
              size="icon-sm"
              aria-label={t("inspiration.actionCreate")}
              title={t("inspiration.actionCreate")}
              className="pointer-coarse:min-h-9 pointer-coarse:min-w-9 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => openEditor(null)}
            >
              <PlusIcon aria-hidden="true" />
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
          savedFiles={editorFiles} pendingFiles={pendingFiles}
          saveState={saveState} error={error}
          onBack={leaveEditor}
          onAddFiles={() => fileInputRef.current?.click()}
          onRemoveSaved={removeSavedFile}
          onRemovePending={removePendingFile}
          onPasteFiles={addFiles}
          t={t}
        />
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">{text}</div>;
}

/** 图片缩略图 / 文件 chip；列表行与编辑页共用。 */
function FileTile({ ref: fileRef, pending = false, onRemove, removeLabel, previewUrl }: {
  ref: InspirationFileRef;
  pending?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  previewUrl?: string | null;
}) {
  const src = previewUrl ?? (isInlineImage(fileRef.mime) && fileRef.path ? fileUrl(fileRef.path) : null);
  return (
    <div className="relative">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={cn("size-16 rounded-md border border-border object-cover", pending && "border-dashed opacity-80")} />
      ) : (
        <div className={cn("flex h-16 w-28 items-center gap-1.5 rounded-md border border-border px-2", pending && "border-dashed")}>
          <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={fileRef.name}>{fileRef.name}</span>
        </div>
      )}
      {onRemove && (
        <Button
          type="button" variant="ghost" size="icon-xs"
          onClick={onRemove}
          title={removeLabel}
          aria-label={removeLabel}
          className="absolute -right-1 -top-1 size-4 rounded-full p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-2" strokeWidth={2.5} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

type InspirationT = (
  key:
    | "inspiration.timeCreated" | "inspiration.timeDone" | "inspiration.timeDeleted"
    | "inspiration.actionImplement" | "inspiration.actionEdit" | "inspiration.actionDone"
    | "inspiration.actionRemount" | "inspiration.actionDelete" | "inspiration.actionRestore"
    | "inspiration.actionPurge" | "inspiration.confirmPurge"
    | "inspiration.actionBack" | "inspiration.editorCreate" | "inspiration.editorEdit"
    | "inspiration.editorPlaceholder" | "inspiration.actionAddFile" | "inspiration.actionRemoveFile"
    | "inspiration.saveStateSaving" | "inspiration.saveStateSaved" | "inspiration.saveStateError"
) => string;

function InspirationRow({ item, busyId, locale, t, confirmPurgeId, setConfirmPurgeId, onImplement, onEdit, onAction, onPurge, actions }: {
  item: Inspiration;
  busyId: string | null;
  locale: Locale;
  t: InspirationT;
  confirmPurgeId: string | null;
  setConfirmPurgeId: (id: string | null) => void;
  onImplement: (item: Inspiration) => void;
  onEdit: () => void;
  onAction: (item: Inspiration, action: "done" | "remount" | "delete" | "restore") => void;
  onPurge: (item: Inspiration) => void;
  actions: readonly ("implement" | "edit" | "done" | "remount" | "delete" | "restore" | "purge")[];
}) {
  const busy = busyId === item.id;
  const timeKey = item.deletedAt ? "inspiration.timeDeleted" : item.doneAt ? "inspiration.timeDone" : "inspiration.timeCreated";
  const time = item.deletedAt ?? item.doneAt ?? item.createdAt;
  const imageRefs = item.files.filter((ref) => isInlineImage(ref.mime));
  const otherCount = item.files.length - imageRefs.length;
  const thumbnails = imageRefs.slice(0, MAX_ROW_THUMBNAILS);
  const extraImages = imageRefs.length - thumbnails.length;
  const actionClass = "pointer-coarse:min-h-9 h-7 px-2 text-xs font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground";
  return (
    <div className={cn("flex items-start gap-2 rounded-lg px-2 py-2 transition-colors pointer-coarse:min-h-9", busy ? "opacity-60" : "hover:bg-accent/40")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {item.text && <span className="line-clamp-2 text-sm whitespace-pre-wrap text-foreground" title={item.text}>{item.text}</span>}
        {item.files.length > 0 && (
          <div className="flex items-center gap-1">
            {thumbnails.map((ref) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={ref.path} src={fileUrl(ref.path)} alt={ref.name} loading="lazy" className="size-10 rounded-md border border-border object-cover" />
            ))}
            {extraImages > 0 && <span className="text-xs tabular-nums text-muted-foreground">+{extraImages}</span>}
            {otherCount > 0 && (
              <span className="flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-xs tabular-nums text-muted-foreground" title={item.files.filter((ref) => !isInlineImage(ref.mime)).map((ref) => ref.name).join("\n")}>
                <FileIcon className="size-3" aria-hidden="true" />
                {otherCount}
              </span>
            )}
          </div>
        )}
        <span className="text-xs text-muted-foreground/70" title={time}>
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
            {t("inspiration.actionRestore")}
          </Button>
        )}
        {actions.includes("delete") && (
          <Button type="button" variant="ghost" size="xs" className={cn(actionClass, "hover:bg-destructive/10 hover:text-destructive")} disabled={busy} onClick={() => onAction(item, "delete")}>
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

function EditorPage({ creating, text, onTextChange, savedFiles, pendingFiles, saveState, error, onBack, onAddFiles, onRemoveSaved, onRemovePending, onPasteFiles, t }: {
  creating: boolean;
  text: string;
  onTextChange: (text: string) => void;
  savedFiles: InspirationFileRef[];
  pendingFiles: PendingFile[];
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  onBack: () => void;
  onAddFiles: () => void;
  onRemoveSaved: (fileId: string) => void;
  onRemovePending: (index: number) => void;
  onPasteFiles: (files: File[]) => void;
  t: InspirationT;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onPasteFiles([...event.dataTransfer.files]);
      }}
    >
      <div className="flex shrink-0 items-center gap-2 pl-2 pr-4 pt-3">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("inspiration.actionBack")} className="text-muted-foreground">
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <h2 className="text-base">{creating ? t("inspiration.editorCreate") : t("inspiration.editorEdit")}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        <Textarea
          autoFocus
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length > 0) {
              event.preventDefault();
              onPasteFiles(files);
            }
          }}
          placeholder={t("inspiration.editorPlaceholder")}
          className="min-h-40 resize-none rounded-lg border-border leading-[1.55]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="xs" className="pointer-coarse:min-h-9" onClick={onAddFiles}>
            <ImagePlusIcon data-icon="inline-start" aria-hidden="true" />
            {t("inspiration.actionAddFile")}
          </Button>
          {saveState !== "idle" && (
            <span className="text-xs text-muted-foreground/70">
              {saveState === "saving" ? t("inspiration.saveStateSaving")
                : saveState === "error" ? t("inspiration.saveStateError")
                  : t("inspiration.saveStateSaved")}
            </span>
          )}
        </div>
        {(savedFiles.length > 0 || pendingFiles.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {savedFiles.map((ref) => (
              <FileTile key={ref.path} ref={ref} onRemove={() => onRemoveSaved(ref.path)} removeLabel={t("inspiration.actionRemoveFile")} />
            ))}
            {pendingFiles.map((pending, index) => (
              <FileTile
                key={pending.file.name + index}
                ref={{ name: pending.file.name, mime: pending.file.type || "application/octet-stream", path: "" }}
                pending
                previewUrl={pending.previewUrl}
                onRemove={() => onRemovePending(index)}
                removeLabel={t("inspiration.actionRemoveFile")}
              />
            ))}
          </div>
        )}
        {error && <div role="alert" className="text-xs text-destructive wrap-anywhere">{error}</div>}
      </div>
    </div>
  );
}
