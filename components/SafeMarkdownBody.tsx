"use client";

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";

/**
 * MarkdownBody with two guards: a message taller than the transcript's block
 * cap scrolls inside itself (every block in the chat list obeys the same cap),
 * and a huge message renders as a click-to-reveal <pre> instead of running the
 * markdown pipeline.
 */
const MAX_MARKDOWN_CHARS = 100_000;

export function SafeMarkdownBody({ children, className, ...props }: React.ComponentProps<typeof MarkdownBody>) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  const bounded = cn("max-h-[var(--card-max-height)] overflow-auto", className);

  if (children.length <= MAX_MARKDOWN_CHARS) {
    return (
      <div className={bounded}>
        <MarkdownBody {...props}>{children}</MarkdownBody>
      </div>
    );
  }
  if (!showRaw) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setShowRaw(true)}
        className="my-1 h-auto w-full justify-start px-2.5 py-[7px] text-left text-xs font-normal text-muted-foreground"
      >
        <TriangleAlertIcon aria-hidden className="mr-1.5 size-3.5 shrink-0" />
        {t("i18n.largeMessageReveal", { size: children.length >= 1_000_000 ? `${(children.length / 1_000_000).toFixed(1)} MB` : children.length >= 1_000 ? `${Math.round(children.length / 1_000)} KB` : `${children.length} B` })}
      </Button>
    );
  }
  return (
    <div className={cn(bounded, "text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.5]")}>
      <pre className="m-0 whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-muted-foreground">
        {children}
      </pre>
    </div>
  );
}
