"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatUpdatedTime } from "@/lib/i18n/format";
import { isProviderUsageId } from "@/lib/provider-usage-ids";

type UsageBucket = {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: "percent" | "currency" | "count";
  currency?: string;
  windowMinutes?: number;
  resetsAt?: number;
  period?: string;
};

type UsageMetric = { id: string; label: string; value: number | string; unit?: string; currency?: string };
type UsageReport = { capturedAt: number; buckets: UsageBucket[]; metrics: UsageMetric[]; notes?: string[] };
type UsageResponse = { providerId: string; status: "ready" | "auth-unavailable" | "query-failed"; report?: UsageReport; message?: string };

const STORAGE_PREFIX = "pi-web:provider-usage:";

export type ProviderUsageSnapshot = UsageResponse;

/** Reads the shared localStorage snapshot the summary panel writes; null when absent or malformed. */
export function readProviderUsageSnapshot(providerId: string): ProviderUsageSnapshot | null {
  let cached: string | null;
  try {
    cached = localStorage.getItem(`${STORAGE_PREFIX}${providerId}`);
  } catch {
    return null; // Storage unavailable (private mode): treat as no snapshot.
  }
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as ProviderUsageSnapshot;
    if (parsed?.status === "ready" && parsed.report && Array.isArray(parsed.report.buckets) && Array.isArray(parsed.report.metrics)) return parsed;
  } catch {
    return null; // Corrupt snapshot: the next successful query overwrites it.
  }
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${providerId}`);
  } catch {
    return null; // Removal is cosmetic: the stale entry lingers but reads stay null.
  }
  return null;
}

export function writeProviderUsageSnapshot(providerId: string, snapshot: ProviderUsageSnapshot): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(snapshot));
  } catch {
    console.debug("provider usage snapshot not persisted", providerId); // Quota or private mode.
  }
}

/** The headline percent bucket's used value, or null when the report carries no percent usage. */
export function primaryUsagePercent(report: UsageReport): number | null {
  const bucket = report.buckets.find((entry) => entry.unit === "percent" && typeof entry.used === "number");
  return bucket ? Math.round(bucket.used as number) : null;
}

export function ProviderUsageSummary({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  if (!isProviderUsageId(providerId)) return null;
  return <ProviderUsageContent providerId={providerId} enabled={enabled} />;
}

function ProviderUsageContent({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const [snapshot, setSnapshot] = useState<UsageResponse | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshDone, setRefreshDone] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { locale, t } = useI18n();

  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setRefreshDone(false);
    setSnapshot(readProviderUsageSnapshot(providerId));
    setError(null);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [providerId]);

  const query = useCallback(async () => {
    setQuerying(true);
    setError(null);
    try {
      const response = await fetch("/api/provider-usage/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const result = await response.json() as UsageResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (result.status === "ready") {
        setSnapshot(result);
        writeProviderUsageSnapshot(providerId, result);
        setRefreshDone(true);
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 2000);
      } else {
        setError(result.message ?? t("providerUsage.queryFailed"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("providerUsage.queryFailed"));
    } finally {
      setQuerying(false);
    }
  }, [providerId, t]);

  const report = snapshot?.status === "ready" ? snapshot.report : undefined;
  return (
    <section className="flex flex-col gap-2.5 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm leading-[1.35] font-semibold text-foreground">{t("providerUsage.usage")}</span>
        <Button
          type="button"
          variant="ghost"
          onClick={query}
          disabled={!enabled || querying}
          title={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
          aria-label={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
          className={cn(
            "relative flex h-[30px] w-8 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none transition-colors duration-300",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "enabled:cursor-pointer disabled:pointer-events-none disabled:opacity-50",
            refreshDone ? "text-success" : "text-muted-foreground",
          )}
        >
          {refreshDone ? (
            <CheckIcon size={14} strokeWidth={2.5} className="size-3.5" aria-hidden="true" />
          ) : (
            <RotateCcwIcon size={14} strokeWidth={2} className={cn("size-3.5 motion-reduce:animate-none", querying && "animate-spin")} aria-hidden="true" />
          )}
        </Button>
        {report && (
          <span title={new Date(report.capturedAt).toLocaleString(locale)} className="text-xs whitespace-nowrap text-muted-foreground">
            {t("providerUsage.updated", { time: formatUpdatedTime(report.capturedAt, locale) })}
          </span>
        )}
      </div>

      {!report && !error && <span className="text-xs text-muted-foreground">{t("providerUsage.notQueried")}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
      {report && (
        <div className="grid w-[min(100%,420px)] max-w-full min-w-0 grid-cols-[180px_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-2 text-xs">
          {report.buckets.map((bucket) => (
            <div key={bucket.id} className="contents">
              <span className="overflow-hidden font-mono text-ellipsis whitespace-nowrap text-muted-foreground">{bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label}</span>
              <span className="overflow-hidden font-mono text-ellipsis whitespace-nowrap text-foreground">{formatBucket(bucket, t("providerUsage.available"))}</span>
            </div>
          ))}
          {report.metrics.map((metric) => (
            <div key={metric.id} className="contents">
              <span className="overflow-hidden font-mono text-ellipsis whitespace-nowrap text-muted-foreground">{metric.label}</span>
              <span className="overflow-hidden font-mono text-ellipsis whitespace-nowrap text-foreground">{formatMetric(metric)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatBucket(bucket: UsageBucket, availableLabel: string): string {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) {
    const reset = bucket.resetsAt ? ` / ${formatReset(bucket.resetsAt)}` : "";
    return `${Math.round(bucket.remaining)}%${reset}`;
  }
  if (bucket.unit === "currency") return `${bucket.currency === "CNY" ? "CNY " : "$"}${formatAmount(bucket.remaining ?? bucket.limit)}`;
  if (bucket.remaining !== undefined && bucket.limit !== undefined) return `${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`;
  return bucket.period ?? availableLabel;
}

function formatMetric(metric: UsageMetric): string {
  if (metric.unit === "currency") return `${metric.currency === "CNY" ? "CNY " : "$"}${metric.value}`;
  return String(metric.value);
}

function formatAmount(value: number | undefined): string {
  return value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatReset(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
