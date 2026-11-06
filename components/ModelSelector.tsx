"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CpuIcon, LoaderCircleIcon, StarIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  const [open, setOpen] = useState(false);
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

  const handleOpenChange = (next: boolean) => {
    if (next) setShowAll(false);
    else setFilter("");
    setOpen(next);
  };

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

  const trigger = variant === "toolbar" ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={locked}
      title={triggerTitle}
      className="max-w-[260px] gap-1.5 overflow-hidden px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground max-md:max-w-full disabled:pointer-events-auto disabled:cursor-not-allowed"
    >
      {busy
        ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" strokeWidth={2.4} aria-hidden="true" />
        : <CpuIcon className={cn("size-4 shrink-0", iconClassName)} strokeWidth={1.8} aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{currentName}</span>
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={locked}
      title={triggerTitle}
      className={cn(
        "h-[34px] w-full min-w-0 justify-between gap-[7px] overflow-hidden px-[9px] text-left text-xs font-normal",
        locked ? "bg-card text-muted-foreground" : "text-foreground hover:bg-secondary",
      )}
    >
      {busy
        ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" strokeWidth={2.4} aria-hidden="true" />
        : <CpuIcon className={cn("size-4 shrink-0", iconClassName)} strokeWidth={1.8} aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{currentName}</span>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
    </Button>
  );

  return (
    <div className={cn(
      "model-selector min-w-0",
      variant === "field" ? "w-full" : "max-md:flex-[1_1_auto]",
    )}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side={placement === "up" ? "top" : "bottom"}
          sideOffset={6}
          align="start"
          collisionPadding={8}
          aria-label={ariaLabel}
          className="flex max-h-(--radix-popover-content-available-height) w-max min-w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) flex-col overflow-hidden p-0 max-md:w-(--radix-popover-content-available-width)"
        >
          {headerSlot && (
            <div className="shrink-0 border-b px-1.5 pb-1.5 pt-1">{headerSlot}</div>
          )}
          {onShowAll && (
            <div className="flex items-center gap-1 px-2 pb-0 pt-1.5 text-xs">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={showAll ? "all" : "scoped"}
                onValueChange={(next) => { if (next && next !== (showAll ? "all" : "scoped")) switchScope(); }}
              >
                <ToggleGroupItem value="scoped" className="h-6 px-[7px] py-0.5 text-xs">
                  {t("chat.modelScopeScoped")}
                </ToggleGroupItem>
                <ToggleGroupItem value="all" className="h-6 px-[7px] py-0.5 text-xs">
                  {t("chat.modelScopeAll")}
                </ToggleGroupItem>
              </ToggleGroup>
              {!isMobile && <span className="ml-auto font-mono text-[10px] text-muted-foreground">Tab</span>}
            </div>
          )}
          <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {showFilter && (
              <CommandInput
                value={filter}
                onValueChange={setFilter}
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
                spellCheck={false}
              />
            )}
            <CommandList className="min-h-0 flex-1">
              {onClear && !filter.trim() && (
                <CommandItem
                  value="default"
                  onSelect={() => {
                    setOpen(false);
                    setFilter("");
                    onClear();
                  }}
                  className={cn(
                    "gap-2 whitespace-nowrap py-[7px] text-xs",
                    onSetDefault && "pr-9",
                    !value ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
                  )}
                >
                  {!value ? <CheckIcon className="size-2.5 shrink-0 text-primary" /> : <span className="size-2.5 shrink-0" />}
                  <span title={emptyLabel ?? t("i18n.default")} className="min-w-0 truncate">{emptyLabel ?? t("i18n.default")}</span>
                </CommandItem>
              )}
              {modelsByProvider.length === 0 && (
                <div className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {!listed ? t("agents.modelsLoading") : filter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
                </div>
              )}
              {modelsByProvider.map((group) => (
                <CommandGroup
                  key={group.provider}
                  heading={
                    <div className="flex w-full items-baseline justify-between gap-2">
                      {modelsByProvider.length > 1 && <span className="min-w-0 truncate">{group.provider}</span>}
                      {usagePercent[group.provider] !== undefined && (
                        <span
                          title={t("providerUsage.usage")}
                          className={cn(
                            "shrink-0 font-medium tracking-normal",
                            usagePercent[group.provider] > 90 ? "text-destructive" : usagePercent[group.provider] > 70 ? "text-warning" : "text-muted-foreground",
                          )}
                        >
                          {usagePercent[group.provider]}%
                        </span>
                      )}
                    </div>
                  }
                >
                  {group.options.map((option) => {
                    const active = option.modelId === value?.modelId && option.provider === value?.provider;
                    // The default is saved only from the scope: PUT /api/models/default refuses others.
                    const star = onSetDefault && (!showAll || isListed(options, option)) ? {
                      isDefault: option.modelId === defaultValue?.modelId && option.provider === defaultValue?.provider,
                    } : null;
                    return (
                      <CommandItem
                        key={`${option.provider}:${option.modelId}`}
                        value={`${option.provider}:${option.modelId}`}
                        onSelect={() => choose(option)}
                        className={cn(
                          "group/item gap-2 whitespace-nowrap py-[7px] text-xs",
                          onSetDefault && "pr-9",
                          active ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
                        )}
                      >
                        {active ? <CheckIcon className="size-2.5 shrink-0 text-primary" /> : <span className="size-2.5 shrink-0" />}
                        <span title={option.name} className="min-w-0 truncate">{option.name}</span>
                        {star?.isDefault && (
                          <span
                            role="img"
                            aria-label={t("chat.defaultModel")}
                            title={t("chat.defaultModel")}
                            className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground"
                          >
                            <StarIcon size={10} fill="currentColor" />
                          </span>
                        )}
                        {star && !star.isDefault && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            title={t("chat.saveDefaultModel")}
                            aria-label={t("chat.saveDefaultModel")}
                            onClick={(event) => {
                              event.stopPropagation();
                              saveDefault(option);
                            }}
                            className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 p-0 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100 focus-visible:opacity-100 hover:border-primary/35 hover:bg-accent hover:text-primary max-md:opacity-100"
                          >
                            <StarIcon className="size-3" />
                          </Button>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
