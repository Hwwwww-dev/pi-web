"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ChevronUpIcon, FolderIcon, HardDriveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface BrowseResponse {
  path?: string;
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  drives?: DirectoryEntry[];
  error?: string;
}

interface CreateDirectoryResponse {
  success?: boolean;
  path?: string;
  error?: string;
}

const panelSurfaceClass = "overflow-hidden rounded-lg border border-border bg-background shadow-[0_8px_32px_rgba(0,0,0,0.18)]";

// 焦点环由未分层 CSS 的 .directory-picker-path:focus-visible 提供（border + box-shadow）；
// 此处不叠加 focus-visible:ring，避免出现双环与失效的 utility。
const textInputClass = "h-9 rounded-md border border-border bg-card px-2.5 font-mono text-xs text-foreground outline-none shadow-none";

const actionButtonClass = "rounded-md px-4 py-1.5 text-sm";

const primaryActionClass = cn(
  actionButtonClass,
  "border-0 bg-primary font-semibold text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-50",
);

const secondaryActionClass = cn(
  actionButtonClass,
  "border border-border bg-transparent text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-50",
);

const emptyNoticeClass = "p-2 text-xs text-muted-foreground";

const entryButtonClass = "flex w-full cursor-pointer items-center gap-[7px] rounded-sm border-0 bg-transparent px-2 text-left font-mono text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function createDirectory(parentPath: string, name: string): Promise<string> {
  const response = await fetch("/api/cwd/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: parentPath, name }),
  });
  const data = await response.json() as CreateDirectoryResponse;
  if (!response.ok || data.error || !data.path) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data.path;
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error }: Props) {
  const { t } = useI18n();
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [directoryName, setDirectoryName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const createBackdropPressRef = useRef(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);

  // Resolves to the listed folder's path, or null when it could not be listed.
  const navigateTo = useCallback(async (directory?: string): Promise<string | null> => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath);
      setDirectories(data.directories ?? []);
      setDrives(data.drives ?? null);
      return nextPath;
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void navigateTo(initialPath || undefined);
  }, [initialPath, navigateTo]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Select and Go are disabled while they check, which drops focus to the page,
  // where Escape stops the running agent instead of closing the picker. A
  // refusal puts focus back in the field, to retype or dismiss.
  useEffect(() => {
    if (loadError || error) pathInputRef.current?.focus();
  }, [loadError, error]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setDirectoryName("");
    setCreateError(null);
  };

  // Open the new directory rather than selecting it, so "Select this folder" stays the
  // picker's only commit point and nested folders can be created the same way.
  const handleCreateDirectory = async () => {
    const name = directoryName.trim();
    if (!currentPath || !name || creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const createdPath = await createDirectory(currentPath, name);
      setCreateOpen(false);
      setDirectoryName("");
      await navigateTo(createdPath);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  // A typed path that is not the listed folder needs no Go first: Select browses
  // it, as Go does, and selects the browse route's realpath, so one folder is
  // one cwd however it was typed (case, a link, `..`, a trailing slash), like
  // pi's process.cwd(). A path that cannot be listed shows Go's error here.
  // "New directory" still waits for the list, which is where it creates.
  const typedPath = pathInput.trim();
  const hasUncommittedPath = typedPath !== currentPath;
  const canSelect = Boolean(typedPath) && !busy && !loading;
  const canCreate = Boolean(currentPath) && !hasUncommittedPath && !busy && !loading;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  const handleSelect = async () => {
    const path = hasUncommittedPath ? await navigateTo(typedPath) : currentPath;
    // Cancelled while it browsed: nothing is selected.
    if (path && mountedRef.current) onSelect(path);
  };

  return (
    // The official Dialog carries the overlay, Escape, focus trap and the
    // press-started-on-backdrop guard; busy holds it open via the two
    // preventDefault hooks.
    <Dialog
      open
      onOpenChange={(next) => { if (!next && !busy) onCancel(); }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        aria-label={t("directoryPicker.selectDirectory")}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
        className={cn(
          "directory-picker-panel relative flex h-[min(620px,calc(100dvh-16px))] max-h-[calc(100dvh-16px)] w-[520px] max-w-[calc(100vw-16px)] sm:max-w-[calc(100vw-16px)] flex-col gap-0 overflow-hidden p-0",
          panelSurfaceClass,
        )}
      >
        <DialogTitle className="sr-only">{t("directoryPicker.selectDirectory")}</DialogTitle>
        <div className="flex shrink-0 items-center justify-between px-[18px] py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-foreground">{t("directoryPicker.selectDirectory")}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="default"
            onClick={onCancel}
            disabled={busy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            className="h-auto font-normal rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-xl leading-none text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-50"
          >
            ×
          </Button>
        </div>

        <form onSubmit={handlePathSubmit} className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
          <Button
            className="dark:bg-secondary directory-picker-back flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary p-0 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-50"
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void navigateTo(parentDirectory ?? undefined)}
            disabled={loading || !canNavigateUp}
            title={t("directoryPicker.goToParent")}
            aria-label={t("directoryPicker.goToParent")}
          >
            <ChevronUpIcon size={16} strokeWidth={1.8} className="size-4" />
          </Button>
          <label htmlFor="directory-path" className="sr-only">
            {t("directoryPicker.directoryPath")}
          </label>
          <Input
            ref={pathInputRef}
            className={cn("directory-picker-path min-w-0 flex-1", textInputClass)}
            id="directory-path"
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
          />
          <Button
            className="font-normal dark:bg-secondary directory-picker-action h-9 min-w-[58px] rounded-md border border-border bg-secondary px-3 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-50"
            type="submit"
            variant="outline"
            size="default"
            disabled={loading || !pathInput.trim()}
            title={t("directoryPicker.goToDirectory")}
          >
            {t("directoryPicker.go")}
          </Button>
        </form>

        <div className="directory-picker-list min-h-0 flex-1 overflow-auto px-2.5 py-2">
          {loading ? (
            <div className={emptyNoticeClass}>{t("directoryPicker.loadingDirectories")}</div>
          ) : drives !== null ? (
            <>
              {drives.length > 0 ? (
                drives.map((drive) => (
                  <Button
                    key={drive.path}
                    className={cn("h-auto justify-start font-normal", "directory-picker-entry min-h-[34px] py-1.5", entryButtonClass)}
                    type="button"
                    variant="ghost"
                    size="default"
                    onClick={() => void navigateTo(drive.path)}
                    title={drive.path}
                  >
                    <HardDriveIcon size={14} strokeWidth={1.8} className="size-3.5" />
                    <span>{drive.name}</span>
                  </Button>
                ))
              ) : (
                <div className={emptyNoticeClass}>{t("directoryPicker.noDrives")}</div>
              )}
            </>
          ) : directories.length > 0 ? (
            directories.map((entry) => (
              <Button
                key={entry.path}
                className={cn("h-auto justify-start font-normal", "directory-picker-entry min-h-[30px] py-[5px]", entryButtonClass)}
                type="button"
                variant="ghost"
                size="default"
                onClick={() => void navigateTo(entry.path)}
                title={entry.path}
              >
                <FolderIcon size={14} strokeWidth={1.8} className="size-3.5" />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
              </Button>
            ))
          ) : (
            <div className={emptyNoticeClass}>{t("directoryPicker.noSubdirectories")}</div>
          )}
          {(loadError || error) && <div className={cn(emptyNoticeClass, "text-destructive")}>{loadError ?? error}</div>}
        </div>

        <div className="directory-picker-footer flex shrink-0 items-center justify-end gap-2.5 px-[18px] py-2.5">
          <Button
            className={cn("h-auto font-normal dark:bg-transparent", "directory-picker-action mr-auto", secondaryActionClass)}
            type="button"
            variant="outline"
            size="default"
            onClick={() => {
              setCreateOpen(true);
              setCreateError(null);
            }}
            disabled={!canCreate}
          >
            {t("directoryPicker.newDirectory")}
          </Button>
          <Button className={cn("h-auto font-normal dark:bg-transparent", "directory-picker-action", secondaryActionClass)} type="button" variant="outline" size="default" onClick={onCancel} disabled={busy}>{t("i18n.cancel")}</Button>
          <Button
            className={cn("h-auto", "directory-picker-action", primaryActionClass)}
            type="button"
            variant="default"
            size="default"
            onClick={() => void handleSelect()}
            disabled={!canSelect}
            title={hasUncommittedPath && typedPath ? t("directoryPicker.selectTypedPath", { path: typedPath }) : t("directoryPicker.selectCurrentDirectory")}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </Button>
        </div>

        {createOpen && (
          <div
            className="absolute inset-0 z-[1] flex items-center justify-center bg-black/35 p-3"
            onPointerDown={(event) => {
              createBackdropPressRef.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
              const pressedBackdrop = createBackdropPressRef.current;
              createBackdropPressRef.current = false;
              if (pressedBackdrop && event.target === event.currentTarget) closeCreateDialog();
            }}
            onPointerCancel={() => {
              createBackdropPressRef.current = false;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") closeCreateDialog();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label={t("directoryPicker.createDirectory")}
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDirectory();
              }}
              className={cn("w-[400px] max-w-full", panelSurfaceClass)}
            >
              <div className="px-[18px] py-3 text-base font-bold text-foreground">
                {t("directoryPicker.createDirectory")}
              </div>
              <div className="px-[18px] py-3">
                <label htmlFor="new-directory-name" className="mb-1.5 block text-xs text-muted-foreground">
                  {t("directoryPicker.directoryName")}
                </label>
                <Input
                  id="new-directory-name"
                  value={directoryName}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("directoryPicker.directoryNamePlaceholder")}
                  onChange={(event) => {
                    setDirectoryName(event.target.value);
                    setCreateError(null);
                  }}
                  disabled={creating}
                  className={cn("directory-picker-path w-full box-border", textInputClass)}
                />
                {createError && <div className="mt-[7px] text-xs leading-[1.35] text-destructive">{createError}</div>}
                <div className="mt-2.5 flex gap-1.5">
                  <Button
                    className={cn("h-auto", "directory-picker-action flex-1", primaryActionClass)}
                    type="submit"
                    variant="default"
                    size="default"
                    disabled={creating || !directoryName.trim()}
                  >
                    {creating ? t("directoryPicker.creating") : t("directoryPicker.create")}
                  </Button>
                  <Button
                    className={cn("h-auto font-normal dark:bg-transparent", "directory-picker-action flex-1", secondaryActionClass)}
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={closeCreateDialog}
                    disabled={creating}
                  >
                    {t("i18n.cancel")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
