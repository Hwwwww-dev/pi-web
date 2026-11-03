"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * Lists the files a turn actually wrote, as buttons that open each one in the
 * preview pane. Entries come from the turn's successful `write`/`edit` tool
 * calls — the reply text is never scanned for paths.
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div aria-label={t("chat.filesWritten")} className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {files.map(({ filePath }) => {
        const name = getFileName(filePath);
        return (
          <button
            key={filePath}
            type="button"
            title={filePath}
            aria-label={t("chat.openWrittenFile", { name })}
            onClick={() => onOpenFile?.(filePath)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {getFileIcon(name, 12)}
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
