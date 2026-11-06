"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDownIcon, CpuIcon, LoaderCircleIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SelectorRow } from "./SelectorRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { primaryUsagePercent, readProviderUsageSnapshot, writeProviderUsageSnapshot, type ProviderUsageSnapshot } from "./ProviderUsageSummary";

/** localStorage snapshots older than this are re-queried on open. */
const PROVIDER_USAGE_CACHE_TTL_MS = 5 * 60_000;

export interface ModelSelectorOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  /** Live sessions can reapply saved metadata by choosing their current model again. */
  onReselect?: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  placement?: "up" | "auto";
  /** The model new sessions start with; its row gets a filled star. */
  defaultValue?: { provider: string; modelId: string } | null;
  /** Shows a star on every row that saves it as the default. */
  onSetDefault?: (provider: string, modelId: string) => void;
  /** Every available model, once loaded; listed under "all". */
  allOptions?: ModelSelectorOption[] | null;
  /** Set only while `enabledModels` narrows `options`: shows pi's `/model` "scoped | all" row and loads `allOptions`. */
  onShowAll?: () => void;
  /** Extra settings section rendered above the scope row (e.g. thinking level). */
  headerSlot?: React.ReactNode;
  /** Extra class for the trigger's leading icon (e.g. a thinking-state tint). */
  iconClassName?: string;
  /** Appended to the trigger tooltip after the default text. */
  titleHint?: string;
}

const MODEL_FILTER_THRESHOLD = 8;

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId} ${option.provider}/${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

export function ModelSelector({
  options,
  value,
  onChange,
  onReselect,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "up",
  defaultValue,
  onSetDefault,
  allOptions,
  onShowAll,
  headerSlot,
  iconClassName,
  titleHint,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  // pi's /model starts on the scope; Tab on the filter or a tap switches.
  const [showAll, setShowAll] = useState(false);
  const locked = disabled || busy;
  const listed = showAll ? allOptions : options;
  // Options arrive in pi's /model order (orderSelectorModels()); never re-sort
  // them, or a models.json provider loses the order its file gives (#783).
  const filteredOptions = filterModelOptions(listed ?? [], filter);
  const showFilter = Boolean(onShowAll) || options.length > MODEL_FILTER_THRESHOLD;
  const isListed = (list: ModelSelectorOption[] | null | undefined, ref: { provider: string; modelId: string }) => (
    list?.find((option) => option.modelId === ref.modelId && option.provider === ref.provider)
  );
  const switchScope = () => {
    if (!showAll) onShowAll?.();
    setShowAll(!showAll);
  };
  const modelsByProvider: { provider: string; options: ModelSelectorOption[] }[] = [];

  for (const option of filteredOptions) {
    const group = modelsByProvider.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else modelsByProvider.push({ provider: option.provider, options: [option] });
  }

  const currentName = selectedLabel ?? (value
    ? (isListed(options, value) ?? isListed(allOptions, value))?.name ?? value.modelId
    : emptyLabel ?? (options.length > 0 ? t("chat.selectModel") : t("chat.noModels")));
  const triggerTitle = (busy
    ? t("chat.switchingModel")
    : locked
      ? currentName
      : options.length > 0 || onClear
        ? t("chat.changeModel")
        : t("chat.noAvailableModels")) + (titleHint ? ` · ${titleHint}` : "");

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        rootRef.current && !rootRef.current.contains(event.target as Node)
        && panelRef.current && !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // While the picker is open, a phone keyboard shrinks the app height
  // (useViewportHeight writes the root's style, sometimes with no viewport
  // event) and moves the trigger; follow it instead of the rect from the tap.
  useEffect(() => {
    if (!open) return;
    const remeasure = () => {
      const rect = rootRef.current?.querySelector("button")?.getBoundingClientRect();
      // A new object even for an unmoved trigger: the panel also reads the
      // visual viewport, which may have changed alone.
      if (rect?.height) setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
    };
    const viewport = window.visualViewport;
    const rootObserver = new MutationObserver(remeasure);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-keyboard-open"] });
    window.addEventListener("resize", remeasure);
    viewport?.addEventListener("resize", remeasure);
    viewport?.addEventListener("scroll", remeasure);
    return () => {
      rootObserver.disconnect();
      window.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("scroll", remeasure);
    };
  }, [open]);

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

  // Provider usage badges: the selector shows each provider's headline quota
  // percent from the same localStorage snapshots the Settings panel writes,
  // re-querying stale ones (bounded, sequential) through the usage route.
  const [usagePercent, setUsagePercent] = useState<Record<string, number>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const now = Date.now();
    const providers = [...new Set(optionsRef.current.map((option) => option.provider))].filter(isProviderUsageId);
    const seed: Record<string, number> = {};
    const stale: string[] = [];
    for (const provider of providers) {
      const snapshot = readProviderUsageSnapshot(provider);
      if (snapshot?.report && now - snapshot.report.capturedAt < PROVIDER_USAGE_CACHE_TTL_MS) {
        const percent = primaryUsagePercent(snapshot.report);
        if (percent !== null) seed[provider] = percent;
      } else {
        stale.push(provider);
      }
    }
    // Cache snapshots render for every provider; only the network refresh stays capped.
    const refresh = stale.slice(0, 8);
    setUsagePercent(seed);
    void (async () => {
      for (const provider of refresh) {
        try {
          const response = await fetch("/api/provider-usage/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId: provider }),
          });
          const result = await response.json() as ProviderUsageSnapshot;
          if (cancelled || result.status !== "ready" || !result.report) continue;
          writeProviderUsageSnapshot(provider, result);
          const percent = primaryUsagePercent(result.report);
          if (percent !== null) setUsagePercent((prev) => ({ ...prev, [provider]: percent }));
        } catch {
          // The badge is best-effort; a failed quota query just leaves it off.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const choose = (option: ModelSelectorOption) => {
    const active = option.modelId === value?.modelId && option.provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(option.provider, option.modelId);
    else onReselect?.(option.provider, option.modelId);
  };

  const saveDefault = (option: ModelSelectorOption) => {
    setOpen(false);
    setFilter("");
    onSetDefault?.(option.provider, option.modelId);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "model-selector relative min-w-0",
        variant === "field" ? "w-full" : "max-md:flex-[1_1_auto]",
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setFilter("");
        setOpen(false);
      }}
    >
      {variant === "toolbar" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-busy={busy || undefined}
          disabled={locked}
          title={triggerTitle}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
            setOpen((current) => {
              if (current) setFilter("");
              else setShowAll(false);
              return !current;
            });
          }}
          className="max-w-[260px] gap-1.5 overflow-hidden px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground max-md:max-w-full disabled:pointer-events-auto disabled:cursor-not-allowed"
        >
          {busy
            ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" strokeWidth={2.4} aria-hidden="true" />
            : <CpuIcon className={cn("size-4 shrink-0", iconClassName)} strokeWidth={1.8} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{currentName}</span>
        </Button>
      ) : (
        <button
          type="button"
          className={cn(
            "flex h-[34px] w-full min-w-0 items-center gap-[7px] overflow-hidden rounded-md border border-border px-[9px] text-left text-xs transition-colors",
            locked ? "cursor-default bg-card text-muted-foreground" : "cursor-pointer bg-background text-foreground hover:bg-secondary",
          )}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-busy={busy || undefined}
          disabled={locked}
          title={triggerTitle}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
            setOpen((current) => {
              if (current) setFilter("");
              else setShowAll(false);
              return !current;
            });
          }}
        >
          {busy
            ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" strokeWidth={2.4} aria-hidden="true" />
            : <CpuIcon className={cn("size-4 shrink-0", iconClassName)} strokeWidth={1.8} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{currentName}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {open && anchorRect && (() => {
        // Fixed coordinates belong to the layout viewport, which a phone
        // keyboard does not shrink: measure from the visible part's top and
        // hang an upward panel from `top` rather than from `bottom`.
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        // A trigger the keyboard covers (a Settings field) still gets a
        // panel ending above the keyboard.
        const aboveEnd = Math.min(anchorRect.top - 6, viewportTop + viewportHeight - 8);
        const spaceAbove = aboveEnd - viewportTop - 8;
        const spaceBelow = viewportTop + viewportHeight - anchorRect.bottom - 6 - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6));
        const verticalPosition: CSSProperties = openAbove
          ? { top: aboveEnd, transform: "translateY(-100%)" }
          : { top: anchorRect.bottom + 6 };
        const horizontalPosition: CSSProperties = isMobile
          ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
          : { left: anchorRect.left, width: "max-content", minWidth: anchorRect.width, maxWidth: Math.max(anchorRect.width, viewportWidth - anchorRect.left - 8) };

        return (
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[500] flex flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            style={{
              ...verticalPosition,
              ...horizontalPosition,
              maxHeight,
            }}
          >
            {headerSlot && (
              <div className="shrink-0 border-b px-1.5 pb-1.5 pt-1">{headerSlot}</div>
            )}
            {onShowAll && (
              <div className="flex items-center gap-1 px-2 pb-0 pt-1.5 text-xs">
                {[false, true].map((all) => (
                  <button
                    key={String(all)}
                    type="button"
                    aria-pressed={showAll === all}
                    onClick={() => { if (showAll !== all) switchScope(); }}
                    className={cn(
                      "cursor-pointer rounded-sm border px-[7px] py-0.5 text-xs transition-colors",
                      showAll === all
                        ? "border-border bg-secondary text-foreground"
                        : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(all ? "chat.modelScopeAll" : "chat.modelScopeScoped")}
                  </button>
                ))}
                {!isMobile && <span className="ml-auto font-mono text-[10px] text-muted-foreground">Tab</span>}
              </div>
            )}
            {showFilter && (
              <div className="shrink-0 border-b p-2">
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (!onShowAll || event.key !== "Tab") return;
                    event.preventDefault();
                    switchScope();
                  }}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  // On phones, focusing the filter opens the on-screen keyboard,
                  // which shrinks the viewport and pushes the list off-screen
                  // before the user has decided to filter. Tap to filter instead.
                  autoFocus={!isMobile}
                  autoComplete="off"
                  spellCheck={false}
                  className="box-border w-full min-w-0 rounded-sm border border-border bg-background px-2 py-[5px] font-mono text-xs text-foreground outline-none max-md:min-w-0"
                />
              </div>
            )}
            <div className="min-h-0 overflow-y-auto">
              {onClear && !filter.trim() && (
                <SelectorRow active={!value} gutter={Boolean(onSetDefault)} onSelect={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }}>
                  <OptionLabel label={emptyLabel ?? t("i18n.default")} />
                </SelectorRow>
              )}
              {modelsByProvider.length === 0 ? (
                <div className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {!listed ? t("agents.modelsLoading") : filter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
                </div>
              ) : modelsByProvider.map((group, index) => (
                <div key={group.provider}>
                  {(modelsByProvider.length > 1 || usagePercent[group.provider] !== undefined) && (
                    <div className={cn("flex items-baseline justify-between gap-2 px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase text-muted-foreground", (index > 0 || onClear) && "border-t border-border")}>
                      {modelsByProvider.length > 1 && <span className="min-w-0 truncate">{group.provider}</span>}
                      {usagePercent[group.provider] !== undefined && (
                        <span
                          title={t("providerUsage.usage")}
                          className={cn(
                            "shrink-0 font-medium normal-case tracking-normal",
                            usagePercent[group.provider] > 90 ? "text-destructive" : usagePercent[group.provider] > 70 ? "text-warning" : "text-muted-foreground",
                          )}
                        >
                          {usagePercent[group.provider]}%
                        </span>
                      )}
                    </div>
                  )}
                  {group.options.map((option) => {
                    return (
                      <SelectorRow
                        key={`${option.provider}:${option.modelId}`}
                        active={option.modelId === value?.modelId && option.provider === value?.provider}
                        onSelect={() => choose(option)}
                        // The default is saved only from the scope: PUT /api/models/default refuses others.
                        star={onSetDefault && (!showAll || isListed(options, option)) ? {
                          isDefault: option.modelId === defaultValue?.modelId && option.provider === defaultValue?.provider,
                          saveLabel: t("chat.saveDefaultModel"),
                          defaultLabel: t("chat.defaultModel"),
                          onSave: () => saveDefault(option),
                        } : undefined}
                      >
                        <OptionLabel label={option.name} />
                      </SelectorRow>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function OptionLabel({ label }: { label: string }) {
  return <span title={label} className="min-w-0 truncate">{label}</span>;
}
