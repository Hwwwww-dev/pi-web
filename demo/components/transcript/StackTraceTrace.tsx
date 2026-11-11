"use client";

import { memo } from "react";
import { CircleXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TraceRow } from "./TraceRow";

/**
 * A failure (官方 `pattern_stack-trace.md`): the first line is the error, the
 * rest are frames. `node_modules` frames stay muted so the reader's own code
 * stands out.
 */
export const StackTraceTrace = memo(function StackTraceTrace({ title, text, foldKey }: {
  /** "运行失败：npm test" — built by the caller from the tool's own title. */
  title: string;
  /** The whole error output: first line = error, the rest = frames. */
  text: string;
  foldKey: string;
}) {
  const [error, ...frames] = text.split("\n").map((line) => line.trim()).filter((line, index) => line !== "" || index === 0);

  return (
    <TraceRow
      icon={<CircleXIcon />}
      title={title}
      status="error"
      foldKey={foldKey}
      ariaLabel={title}
      content={(
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs">
          <p className="text-destructive">{error}</p>
          {frames.length > 0 && (
            <ol className="flex flex-col gap-1">
              {frames.map((frame, index) => (
                <li key={index} className={cn("min-w-0 wrap-anywhere", !frame.includes("node_modules") && "text-foreground")}>
                  {frame}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    />
  );
});
