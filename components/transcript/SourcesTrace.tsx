"use client";

import { memo, type ReactNode } from "react";
import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useI18n } from "@/hooks/useI18n";
import type { ToolViewSource } from "@/lib/tool-view";
import type { StepUsage } from "@/lib/turn-view";
import { TraceRow } from "./TraceRow";

/** A URL's host, or the URL itself when it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * What a web search read (官方 `pattern_sources.md`): one line per source, the
 * whole row a link, the arrow saying it leaves the app.
 */
export const SourcesTrace = memo(function SourcesTrace({ sources, foldKey, trailing, below, activityTool, stepUsage }: {
  sources: ToolViewSource[];
  foldKey: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
  /** The issuing request's usage: the expanded card's first line (TraceRow draws it). */
  stepUsage?: StepUsage;
  trailing?: ReactNode;
  below?: ReactNode;
}) {
  const { t } = useI18n();
  const title = t("chat.trace.sources", { count: sources.length });

  return (
    <TraceRow
      icon={<GlobeIcon />}
      title={title}
      foldKey={foldKey}
      trailing={trailing}
      below={below}
      activityTool={activityTool}
      stepUsage={stepUsage}
      ariaLabel={title}
      content={(
        <div className="max-h-[var(--card-max-height)] overflow-y-auto overscroll-contain">
          <Trace>
            {sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <TraceLine>
                  <TraceIcon><GlobeIcon /></TraceIcon>
                  <TraceTitle className="text-ellipsis">{source.title || hostOf(source.url)}</TraceTitle>
                  <TraceIcon><ArrowUpRightIcon /></TraceIcon>
                </TraceLine>
              </a>
            ))}
          </Trace>
        </div>
      )}
    />
  );
});
