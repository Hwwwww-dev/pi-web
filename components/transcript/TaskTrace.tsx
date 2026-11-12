"use client";

import { memo, type ReactNode } from "react";
import { ListChecksIcon } from "lucide-react";import { Trace } from "@/components/ui/trace";
import { TraceRow } from "./TraceRow";
import type { ToolViewStatus } from "@/lib/tool-view";

/**
 * Consecutive calls of one category (官方 `pattern_task.md`): a counted line
 * whose content is the same rows the group holds — not a second kind of row.
 */
export const TaskTrace = memo(function TaskTrace({ title, description, status, foldKey, defaultOpen, children, trailing, icon, activeIcon }: {
  /** "8 终端", "3 文件" — built by the caller from `TOOL_CATEGORY_LABEL_KEYS`. */
  title: string;
  description?: string;
  status?: ToolViewStatus;
  /** The group's own memory key (`groupKey`). */
  foldKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
  trailing?: ReactNode;
  /** 组头的图标：同类聚合时用这一类自己的图标，混合或未知才用通用清单图标。 */
  icon?: ReactNode;
  activeIcon?: ReactNode;
}) {
  return (
    <TraceRow
      icon={icon ?? <ListChecksIcon className="size-3.5" />}
      activeIcon={activeIcon}
      title={title}
      description={description}
      status={status}
      foldKey={foldKey}
      defaultOpen={defaultOpen}
      trailing={trailing}
      ariaLabel={title}
      content={<Trace>{children}</Trace>}
    />
  );
});
