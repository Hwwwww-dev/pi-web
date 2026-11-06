"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import { Check as CheckIcon, ChevronDown, Cpu, Eye, EyeOff, Plus, Search, X as XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
import { ContextWindowError, normalizeContextWindowOverrides, withContextWindowOverride } from "@/lib/model-context";
import { checkProviderEntries, ProviderEntryError, type ProviderEntryProblem } from "@/lib/model-provider-check";
import { checkImageMaxBytes, DEFAULT_IMAGE_MAX_BYTES, formatImageBytes, ImageMaxBytesError, imageMaxBytes, parseImageMaxBytes, withImageMaxBytes } from "@/lib/model-image-limits";
import type { ModelContextSettings } from "./ModelContextWindow";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  hasModelCostDraftValue,
  modelCostToDraft,
  modelSidebarLabel,
  parseCompleteModelCost,
  providerMatchesSearch,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  setCompatFlag,
  trackAddedModels,
  collectModelRenames,
  deleteProviderEntry,
  renameProviderEntry,
  updateHeaderRow,
  type HeaderRow,
  type ModelCostDraft,
  type ModelCostKey,
} from "./models-config-helpers";
import {
  ConfigButton,
  ConfigCard,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarGroupLabel,
  ConfigSidebarText,
  ConfigSplitView,
  useConfigDetailNavigation,
} from "./SettingsUi";
import {
  EnabledModelsBanner,
  EnabledModelsProviderSwitch,
  EnabledModelsProviderSwitchNote,
  EnabledModelsSection,
  useEnabledModels,
  type EnabledModelsController,
} from "./EnabledModelsSection";
import { providerBadgeLabel } from "./enabled-models-helpers";
import { OAuthPastePanel } from "./OAuthPastePanel";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageSummary } from "./ProviderUsageSummary";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
}

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  inputLimits?: Record<string, unknown>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

function readRememberedSelection(): Selection | null {
  const raw = getLastSettingsSelection("models");
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const selection = value as Record<string, unknown>;
    if (selection.type === "provider" && typeof selection.name === "string") {
      return { type: "provider", name: selection.name };
    }
    if (selection.type === "model"
      && typeof selection.providerName === "string"
      && typeof selection.index === "number"
      && Number.isInteger(selection.index)
      && selection.index >= 0) {
      return { type: "model", providerName: selection.providerName, index: selection.index };
    }
    if ((selection.type === "oauth" || selection.type === "apikey")
      && typeof selection.providerId === "string") {
      return { type: selection.type, providerId: selection.providerId };
    }
  } catch {
    // Ignore malformed browser state.
  }
  return null;
}

function customSelectionExists(config: ModelsJson, selection: Selection): boolean {
  if (selection.type === "provider") return Boolean(config.providers?.[selection.name]);
  if (selection.type !== "model") return true;
  return Boolean(config.providers?.[selection.providerName]?.models?.[selection.index]);
}

/**
 * An entry holding only model overrides belongs to its managed provider. An
 * empty `modelOverrides` overrides nothing and pi refuses it, so that entry
 * stays a listed custom provider Save can select to be deleted (#1353).
 */
function isOverridesOnly(entry: ProviderEntry): boolean {
  return Object.keys(entry).length === 1 && Object.keys(entry.modelOverrides ?? {}).length > 0;
}

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

const PROVIDER_ENTRY_MESSAGES: Record<ProviderEntryProblem, string> = {
  empty: "models.providerIncomplete",
  baseUrl: "models.providerNeedsBaseUrl",
};

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <ConfigField label={label}>{children}</ConfigField>;
}

const inputClass =
  "h-8 w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    className={cn(inputClass, mono && "font-mono")} />;
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div className={cn("relative w-full", className)}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(inputClass, "pr-[34px]", mono && "font-mono")}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
         aria-label={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
         title={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        className="absolute right-[5px] top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-dim"
      >
        {visible ? <Eye size={15} strokeWidth={1.8} /> : <EyeOff size={15} strokeWidth={1.8} />}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder, invalid }: { value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    aria-invalid={invalid || undefined} className={cn(inputClass, invalid && "border-destructive")} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, value ? "text-foreground" : "text-dim")}>
       {!required && <option value="">— {t("i18n.default")} / none —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="size-[13px] cursor-pointer accent-primary" />
      {label}
    </label>
  );
}

// ── Provider detail ───────────────────────────────────────────────────────────

function openExternalUrl(rawUrl: string | undefined): void {
  if (!rawUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  // OAuth endpoints are always https; refuse anything else (javascript:, data:, …).
  if (parsed.protocol !== "https:") return;
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}

function ProviderDetail({ name, editingName, provider, onChange, onEditingNameChange, onRename, onDelete, onAddModels, enabledModels, nameTaken }: {
  name: string; editingName: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onEditingNameChange: (n: string) => void;
  onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void; enabledModels: EnabledModelsController;
  nameTaken?: (name: string) => boolean;
}) {
  const { t } = useI18n();
  const trimmedName = editingName.trim();
  const renameConflict = trimmedName !== "" && trimmedName !== name && Boolean(nameTaken?.(trimmedName));
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  const switchNoteId = useId();
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <ConfigDetailTitle>{t("i18n.provider")}</ConfigDetailTitle>
          </ConfigDetailHeaderInfo>
          <ConfigDetailActions>
            <EnabledModelsProviderSwitch providerId={name} controller={enabledModels} noteId={switchNoteId} />
            <ConfigButton variant="danger" size="small" onClick={onDelete}>{t("i18n.delete")}</ConfigButton>
          </ConfigDetailActions>
        </ConfigDetailHeader>
        <EnabledModelsProviderSwitchNote providerId={name} controller={enabledModels} id={switchNoteId} />
      </div>

      <ConfigCard>
        <div className="flex flex-col gap-4">
          <Field label={t("i18n.providerName")}>
            <TextInput value={editingName} onChange={onEditingNameChange} placeholder="provider-name" mono />
            {renameConflict && (
              <span className="mt-1 block text-xs text-destructive">
                {t("modelsConfig.providerNameTaken")}
              </span>
            )}
            {editingName !== name && trimmedName && !renameConflict && (
              <button onClick={() => onRename(trimmedName)}
                className="mt-1 self-start rounded-sm border-0 bg-primary px-2.5 py-[3px] text-xs text-primary-foreground">
                 {t("i18n.rename")}
              </button>
            )}
          </Field>

          <Field label="Base URL">
            <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
              placeholder="https://api.example.com/v1" mono />
          </Field>

          <Field label="API Key">
            <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
              placeholder={t("models.apiKeyPlaceholder")} mono />
          </Field>

          <Field label="API">
            <Select value={provider.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
          </Field>

          <Field label="Headers">
            <HeaderListEditor
              headers={provider.headers}
              onChange={(headers) => set("headers", headers)}
            />
          </Field>
        </div>
      </ConfigCard>

      <ConfigCard
        actions={discoveryState.phase !== "success" ? (
          <ConfigButton size="small" onClick={handleDiscoverModels} disabled={discoveryState.phase === "loading"}>
            {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
          </ConfigButton>
        ) : undefined}
        footer={discoveryState.phase === "error" ? (
          <div role="alert" className="rounded-sm border border-destructive/30 px-2.5 py-[7px] text-xs leading-normal text-destructive">
            {discoveryState.message}
          </div>
        ) : undefined}
      >
        {discoveryState.phase === "success" && (
          <div className="flex flex-col gap-2.5">
            <input
              value={discoveryQuery}
              onChange={(event) => setDiscoveryQuery(event.target.value)}
              placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
              aria-label={t("models.discoveryFilter")}
              className={cn(inputClass, "min-w-0")}
            />

            <div className="max-h-[220px] overflow-y-auto rounded-sm border border-border bg-card">
              <label
                className={cn(
                  "sticky top-0 z-[1] flex min-h-8 items-center gap-2 border-b border-border bg-background px-2.5 py-[5px] text-[10px] font-semibold text-muted-foreground",
                  selectableShownIds.length ? "cursor-pointer" : "cursor-default",
                )}
              >
                <input
                  ref={selectShownRef}
                  type="checkbox"
                  checked={allShownSelected}
                  disabled={selectableShownIds.length === 0}
                  onChange={toggleShownModels}
                  className="size-[13px] shrink-0 accent-primary"
                />
                {t("models.discoverySelectShown")}
              </label>
              {shownDiscoveredModels.length === 0 ? (
                <div className="p-3 text-xs text-dim">{t("models.discoveryNoMatches")}</div>
              ) : shownDiscoveredModels.map((model, index) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const checked = selectedModelIds.includes(model.id);
                return (
                  <label
                    key={model.id}
                    className={cn(
                      "flex min-h-9 items-center gap-2 px-2.5 py-1.5",
                      index > 0 && "border-t border-border",
                      alreadyAdded ? "cursor-default opacity-65" : "cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked || alreadyAdded}
                      disabled={alreadyAdded}
                      onChange={() => toggleDiscoveredModel(model.id)}
                      className="size-[13px] shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{model.name ?? model.id}</span>
                      {model.name && <code className="block truncate font-mono text-[10px] text-dim">{model.id}</code>}
                    </span>
                    {alreadyAdded && <span className="text-[10px] text-dim">{t("models.discoveryAdded")}</span>}
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2.5">
              <span title={discoveryState.endpoint} className="min-w-0 truncate text-[10px] text-dim">
                {filteredDiscoveredModels.length > shownDiscoveredModels.length
                  ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                  : t("models.discoveryFetched", { count: discoveryState.models.length })}
              </span>
              <ConfigButton
                variant="primary"
                size="small"
                onClick={addSelectedModels}
                disabled={selectedCount === 0}
              >
                {selectedCount
                  ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                  : t("models.discoveryAddSelected")}
              </ConfigButton>
            </div>
          </div>
        )}
      </ConfigCard>

    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

// Per-level dot palette. off/max ride theme tokens; the middle steps keep a
// fixed chart palette (pi has no blue/violet/pink/orange tokens to map to).
const LEVEL_DOT_CLASS: Record<ThinkingLevel, string> = {
  off:     "bg-dim",
  minimal: "bg-[#6b7280]",
  low:     "bg-[#60a5fa]",
  medium:  "bg-[#a78bfa]",
  high:    "bg-[#f472b6]",
  xhigh:   "bg-[#fb923c]",
  max:     "bg-destructive",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  const btnClass = (state: "plain" | "active" | "off") =>
    cn(
      "cursor-pointer whitespace-nowrap border-0 px-2.5 py-1 text-[10px] transition-colors",
      state === "active"
        ? "bg-primary font-semibold text-primary-foreground"
        : state === "off"
          ? "bg-destructive font-semibold text-white"
          : "bg-card font-normal text-dim",
    );

  return (
    <div className="flex flex-col gap-0.5">
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";

        return (
          <div
            key={level}
            className="flex items-center gap-2 rounded-sm border border-transparent px-1 py-[5px]"
          >
            <div className="flex w-[68px] shrink-0 items-center gap-[5px]">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  LEVEL_DOT_CLASS[level],
                  state === "null" && "opacity-30",
                )}
              />
              <span className={cn(
                "font-mono text-xs",
                state === "null" ? "text-dim line-through" : "text-muted-foreground",
              )}>
                {level}
              </span>
            </div>

            <div className="flex shrink-0 overflow-hidden rounded-sm border border-border">
              <button
                onClick={() => setLevel(level, "omit")}
                className={btnClass(state === "omit" ? "active" : "plain")}
              >
                {t("i18n.default")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                className={cn(btnClass(state === "null" ? "off" : "plain"), "border-l border-border")}
              >
                {t("i18n.disabled")}
              </button>
            </div>

            <div className={cn(
              "flex overflow-hidden rounded-sm border transition-colors",
              state === "string" ? "border-primary" : "border-border",
            )}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                className={cn(btnClass(state === "string" ? "active" : "plain"), "shrink-0 border-r border-border")}
              >
                {t("i18n.custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                className={cn(
                  "w-[12ch] border-0 py-1 pl-[7px] pr-1.5 font-mono text-xs outline-none transition-colors",
                  state === "string" ? "bg-background text-foreground" : "bg-card text-dim",
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// Compat can be configured at the provider or model level; provider-composer
// merges them (model wins) at runtime. The UI reads the effective value so
// hand-edited models.json settings are reflected correctly, while toggles
// write to the model entry so a per-model override is explicit.
function effectiveCompat(provider: ProviderEntry, model: ModelEntry): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

// Editable key/value request-header list for a provider or model. Rows stay
// local so a blank draft is never persisted as an invalid HTTP header name.
function HeaderListEditor({ headers, onChange }: {
  headers: Record<string, string> | undefined;
  onChange: (h: Record<string, string> | undefined) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HeaderRow[]>(() => Object.entries(headers ?? {}).map(
    ([name, value], id) => ({ id, name, value }),
  ));
  const nextRowIdRef = useRef(rows.length);

  const applyRows = (next: HeaderRow[]): void => {
    setRows(next);
    onChange(serializeHeaderRows(next));
  };
  const setEntry = (id: number, changes: Partial<Pick<HeaderRow, "name" | "value">>): void => {
    applyRows(updateHeaderRow(rows, id, changes));
  };
  const removeEntry = (id: number): void => {
    applyRows(rows.filter((row) => row.id !== id));
  };
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex gap-1.5">
          <input value={row.name} onChange={(e) => setEntry(row.id, { name: e.target.value })}
            placeholder="Header-Name" className={cn(inputClass, "flex-1 font-mono")} />
          <input value={row.value} onChange={(e) => setEntry(row.id, { value: e.target.value })}
            placeholder="value" className={cn(inputClass, "flex-1 font-mono")} />
          <button onClick={() => removeEntry(row.id)}
            className="cursor-pointer rounded-sm border border-destructive/30 bg-transparent px-2.5 py-1 leading-none text-destructive">
            <XIcon size={12} strokeWidth={1.8} />
          </button>
        </div>
      ))}
      <button onClick={() => setRows((current) => [
        ...current,
        { id: nextRowIdRef.current++, name: "", value: "" },
      ])}
        className="inline-flex cursor-pointer items-center justify-center gap-1 self-start rounded-sm border border-border bg-transparent px-2.5 py-[5px] text-xs text-muted-foreground">
        <Plus size={12} strokeWidth={1.8} />
        {t("models.addHeader")}
      </button>
    </div>
  );
}

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let filledCostCount = 0;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        filledCostCount += 1;
      }
    }
    const completeCost = parseCompleteModelCost(modelCostToDraft(cost));
    if (filledCostCount > 0 && completeCost) {
      next.cost = { ...cost, ...completeCost };
      appliedCount += filledCostCount;
    }
  }
  return { model: next, appliedCount };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const { t } = useI18n();
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const testRequestIdRef = useRef(0);
  const effectiveBaseUrl = model.baseUrl ?? provider.baseUrl;
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const costTemplateRef = useRef(model.cost);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const setCost = (key: ModelCostKey, value: string) => {
    const nextDraft = { ...costDraftRef.current, [key]: value };
    const completeCost = parseCompleteModelCost(nextDraft);
    const nextModel = { ...model };
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    if (completeCost) {
      nextModel.cost = { ...(costTemplateRef.current ?? {}), ...completeCost };
      costTemplateRef.current = nextModel.cost;
    } else {
      delete nextModel.cost;
    }
    onChange(nextModel);
  };
  const toggleCostEditing = () => {
    if (costEditing) {
      setCostEditing(false);
      return;
    }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
     if (testState.phase === "testing") return t("i18n.testingModel");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
       return [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
     return [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    testRequestIdRef.current += 1;
    setTestState({ phase: "idle" });
    // An in-flight result belongs to the old draft, including after unmount.
    return () => { testRequestIdRef.current += 1; };
  }, [providerName, provider, model]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, effectiveBaseUrl, model.id]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    const requestId = ++testRequestIdRef.current;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (requestId !== testRequestIdRef.current) return;
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      if (requestId !== testRequestIdRef.current) return;
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (!query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (effectiveBaseUrl?.trim()) params.set("baseUrl", effectiveBaseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCostEditing(false);
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, model, onChange, effectiveBaseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;
  const catalogStatusClass = catalogState.phase === "error"
    ? "text-destructive"
    : catalogState.phase === "success" && catalogState.recommendation.price.status === "unreliable"
      ? "text-warning"
      : "text-dim";
  const costFields = [
    { key: "input", label: t("models.costInput") },
    { key: "output", label: t("models.costOutput") },
    { key: "cacheRead", label: t("models.costCacheRead") },
    { key: "cacheWrite", label: t("models.costCacheWrite") },
  ] as const;
  const formatCost = (key: ModelCostKey): string => {
    const value = model.cost?.[key];
    return value === undefined ? t("models.notProvided") : `$${String(value)}`;
  };
  const remainingCompatKeys = new Set(Object.keys(model.compat ?? {}));
  let compatibilityOverrideCount = 0;
  if (hasDeepseekCompat(model)) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("thinkingFormat");
    remainingCompatKeys.delete("requiresReasoningContentOnAssistantMessages");
  }
  if (Object.prototype.hasOwnProperty.call(model.compat ?? {}, "supportsDeveloperRole")) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("supportsDeveloperRole");
  }
  compatibilityOverrideCount += remainingCompatKeys.size;
  const imageLimit = imageMaxBytes(model);
  const parsedImageLimit = parseImageMaxBytes(imageLimit);
  const advancedSummaryParts = [
    model.baseUrl ? t("models.baseUrlOverride") : null,
    model.api ? `API: ${model.api}` : null,
    Object.keys(model.headers ?? {}).length
      ? t("models.headersSummary", { count: Object.keys(model.headers ?? {}).length })
      : null,
    compatibilityOverrideCount
      ? t("models.compatSummary", { count: compatibilityOverrideCount })
      : null,
    Object.keys(model.thinkingLevelMap ?? {}).length
      ? t("models.thinkingSummary", { count: Object.keys(model.thinkingLevelMap ?? {}).length })
      : null,
    parsedImageLimit !== undefined
      ? t("models.imageMaxBytesSummary", { size: formatImageBytes(parsedImageLimit) })
      : null,
  ].filter((part): part is string => Boolean(part));
  const advancedSummary = advancedSummaryParts.length
    ? advancedSummaryParts.join(" · ")
    : t("models.providerDefaults");

  return (
    <div className="flex flex-col gap-4">
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigDetailTitle>{t("i18n.model")}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          {testSummary && (
            <span
              title={testSummary}
              className={cn(
                "inline-flex h-7 max-w-[260px] items-center truncate rounded-sm border px-2 text-xs",
                testState.phase === "error"
                  ? "border-destructive/30 bg-destructive/10 text-foreground"
                  : testState.phase === "success"
                    ? "border-success/40 bg-success/10 text-foreground"
                    : "border-border bg-secondary text-foreground",
              )}
            >
              {testSummary}
            </span>
          )}
          <ConfigButton
            size="small"
            variant={testState.phase === "success" ? "primary" : "secondary"}
            onClick={testState.phase === "success" ? () => setTestState({ phase: "idle" }) : handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title={t("i18n.testConnection")}
            className={testState.phase === "success" ? "is-success" : undefined}
          >
            {testState.phase === "success" && (
              <CheckIcon size={11} strokeWidth={2.5} className="config-button-success-icon" />
            )}
             {testState.phase === "testing" ? t("i18n.checking") : testState.phase === "success" ? t("common.ok") : t("i18n.test")}
          </ConfigButton>
          <ConfigButton variant="danger" size="small" onClick={onDelete}>{t("i18n.remove")}</ConfigButton>
        </ConfigDetailActions>
      </ConfigDetailHeader>

      <ConfigCard
        actions={(
          <>
            <ConfigButton
              size="small"
              onClick={() => void handleCatalogFill()}
              disabled={!model.id.trim() || catalogState.phase === "loading"}
            >
              {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
            </ConfigButton>
            <a
              href="https://github.com/anomalyco/models.dev"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-dim no-underline"
            >
              {t("models.catalogSource")}
            </a>
          </>
        )}
        footer={catalogStatusText ? (
          <div
            aria-live="polite"
            className={cn("flex items-center justify-between gap-2 text-[10px]", catalogStatusClass)}
          >
            <span title={catalogStatusText} className="min-w-0 truncate">
              {catalogStatusText}
            </span>
            {catalogUndoRef.current && (
              <button
                onClick={undoCatalogFill}
                className="shrink-0 cursor-pointer border-0 bg-transparent px-0.5 text-[10px] text-primary"
              >
                {t("models.catalogUndo")}
              </button>
            )}
          </div>
        ) : undefined}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="ID *"><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
          <Field label="Name"><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("models.displayNamePlaceholder")} /></Field>
        </div>
      </ConfigCard>

      <ConfigCard title={t("models.capabilities")}>
        <div className="flex flex-wrap gap-5">
          <Check label={t("models.reasoning")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
          <Check label={t("models.imageInput")} checked={model.input?.includes("image") ?? false}
            onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
        </div>
      </ConfigCard>

      <ConfigCard
        title={t("models.modelSpecs")}
        actions={(
          <button
            type="button"
            onClick={toggleCostEditing}
            aria-expanded={costEditing}
            className="cursor-pointer border-0 bg-transparent px-1 py-0.5 text-[10px] text-primary"
          >
            {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
          </button>
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
            <Field label={t("models.contextWindow")}>
              <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
                onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
            </Field>
            <Field label={t("models.maxOutputTokens")}>
              <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
                onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
            </Field>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase text-dim">
              {t("models.costPerMillion")}
            </div>
            {costEditing ? (
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
                {costFields.map(({ key, label }) => (
                  <Field key={key} label={label}>
                    <NumInput value={costDraft[key]} onChange={(v) => setCost(key, v)} placeholder="0" />
                  </Field>
                ))}
                {hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
                  <div aria-live="polite" className="col-span-full text-[10px] text-warning">
                    {t("models.costAllRequired")}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(105px,1fr))] gap-x-4 gap-y-2">
                {costFields.map(({ key, label }) => {
                  const missing = model.cost?.[key] === undefined;
                  return (
                    <div key={key} className="min-w-0">
                      <div className="truncate text-[10px] text-dim">{label}</div>
                      <div className={cn("mt-[3px] font-mono text-xs tabular-nums", missing ? "text-dim" : "text-foreground")}>
                        {formatCost(key)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ConfigCard>

      <ConfigCard>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            aria-controls="model-advanced-settings"
            className="grid min-h-12 w-full cursor-pointer grid-cols-[minmax(0,1fr)_18px] items-center gap-2.5 border-0 bg-transparent py-2 text-left text-foreground"
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{t("models.advancedSettings")}</span>
              <span className="mt-[3px] block truncate text-[10px] text-dim">
                {advancedSummary}
              </span>
            </span>
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              className={cn("text-dim transition-transform", advancedOpen && "rotate-180")}
            />
          </button>

          {advancedOpen && (
            <div id="model-advanced-settings" className="flex flex-col gap-3.5 pb-4 pt-1">
              <Field label={t("models.baseUrlOverride")}>
                <TextInput value={model.baseUrl ?? ""} onChange={(v) => set("baseUrl", v.trim() || undefined)}
                  placeholder={provider.baseUrl ?? t("models.providerDefaults")} mono />
              </Field>

              <Field label={t("models.apiOverride")}>
                <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
              </Field>

              <Field label={t("models.headers")}>
                <HeaderListEditor
                  headers={model.headers}
                  onChange={(headers) => set("headers", headers)}
                />
                <span className="mt-0.5 text-[10px] text-dim">
                  {t("models.headersHelp")}
                </span>
              </Field>

              {(model.input?.includes("image") || imageLimit !== undefined) && (
                <Field label={t("models.imageMaxBytes")}>
                  <NumInput
                    value={imageLimit === undefined ? "" : String(imageLimit)}
                    onChange={(v) => onChange(withImageMaxBytes(model, v.trim() || undefined))}
                    placeholder={String(DEFAULT_IMAGE_MAX_BYTES)}
                    invalid={parsedImageLimit === undefined && imageLimit !== undefined}
                  />
                  <span className="mt-0.5 text-[10px] text-dim">
                    {parsedImageLimit !== undefined && `${formatImageBytes(parsedImageLimit)} · `}
                    {t("models.imageMaxBytesHelp", { size: formatImageBytes(DEFAULT_IMAGE_MAX_BYTES) })}
                  </span>
                  <code className="font-mono text-[10px] text-dim">
                    inputLimits.images.resize.maxBytes
                  </code>
                </Field>
              )}

              {model.reasoning && (
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold uppercase text-dim">{t("models.compatibility")}</div>
                  <Check
                    label={t("models.deepSeekThinkingCompat")}
                    checked={hasDeepseekCompat(model)}
                    onChange={(v) => onChange(setDeepseekCompat(model, v))}
                  />
                  <Check
                    label={t("models.developerRole")}
                    checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
                    onChange={(v) => onChange(setCompatBool(model, "supportsDeveloperRole", v))}
                  />
                  {(model.api ?? provider.api) === "anthropic-messages" && (
                    <div className="flex flex-col gap-[3px]">
                      <Check
                        label={t("models.adaptiveThinking")}
                        checked={effectiveCompat(provider, model)["forceAdaptiveThinking"] === true}
                        onChange={(v) => onChange(setCompatFlag(model, "forceAdaptiveThinking", v, provider.compat?.["forceAdaptiveThinking"] === true))}
                      />
                      <code className="pl-[19px] font-mono text-[10px] text-dim">
                        compat.forceAdaptiveThinking
                      </code>
                    </div>
                  )}
                  <div className="mt-1">
                    <div className="mb-2 flex items-center justify-between gap-2.5">
                      <div className="text-xs font-semibold uppercase text-dim">{t("models.thinkingLevelMap")}</div>
                      {model.thinkingLevelMap && (
                        <button
                          type="button"
                          onClick={() => set("thinkingLevelMap", undefined)}
                          className="cursor-pointer border-0 bg-transparent px-[5px] py-0.5 text-[10px] text-dim"
                        >
                          {t("models.clearAll")}
                        </button>
                      )}
                    </div>
                    <ThinkingLevelMapEditor
                      value={model.thinkingLevelMap}
                      onChange={(v) => set("thinkingLevelMap", v)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ConfigCard>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh, enabledModels, contextSettings }: {
  provider: OAuthProvider; onRefresh: () => void; enabledModels: EnabledModelsController;
  contextSettings: ModelContextSettings;
}) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        openExternalUrl(data.url);
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        openExternalUrl(data.verificationUri);
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: t("models.connectionLost") });
    };
  }, [provider.id, onRefresh, t]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: t("models.verifying") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("models.serverError", { status: res.status }) });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("i18n.networkError") });
    }
  }, [provider.id, t]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: t("i18n.continuing") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("models.serverError", { status: res.status }) });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("i18n.networkError") });
    }
  }, [provider.id, t]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div className={cn("flex flex-col", provider.loggedIn && loginState.phase === "idle" ? "gap-0" : "gap-4")}>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigDetailTitle>{t("i18n.subscription")}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-block size-[7px] rounded-full", provider.loggedIn ? "bg-success" : "bg-border")} />
            <span className={cn("text-xs", provider.loggedIn ? "text-success" : "text-dim")}>
               {provider.loggedIn ? t("i18n.connected") : t("i18n.notConnected")}
            </span>
          </div>
          {isWorking ? (
            <ConfigButton
              size="small"
              onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            >
              {t("i18n.cancel")}
            </ConfigButton>
          ) : (
            <>
              <ConfigButton
                variant="primary"
                size="small"
                onClick={handleLogin}
              >
                 {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
              </ConfigButton>
              {provider.loggedIn && (
                <ConfigButton
                  variant="danger"
                  size="small"
                  onClick={handleLogout}
                >
                   {t("i18n.disconnect")}
                </ConfigButton>
              )}
            </>
          )}
        </ConfigDetailActions>
      </ConfigDetailHeader>

      {/* Status */}
      {!(provider.loggedIn && loginState.phase === "idle") && (
        <ConfigCard>
          <div className="min-h-12">
            {loginState.phase === "idle" && (
              !provider.loggedIn && (
                <p className="m-0 text-xs leading-normal text-muted-foreground">
                  {t("models.oauthConnect", { provider: provider.name })}
                </p>
              )
            )}
            {loginState.phase === "connecting" && (
                <p className="m-0 text-xs text-muted-foreground">{t("i18n.openingBrowser")}</p>
            )}
            {loginState.phase === "select" && (
              <div className="flex flex-col gap-2.5">
                <p className="m-0 text-xs leading-normal text-muted-foreground">
                  {loginState.message}
                </p>
                <div className="flex flex-col gap-1.5">
                  {loginState.options.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => submitSelection(loginState.token, option.id)}
                      className="cursor-pointer rounded-sm border border-border bg-background px-2.5 py-1.5 text-left text-xs text-foreground"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(loginState.phase === "auth" || loginState.phase === "prompt") && (
              <OAuthPastePanel
                message={loginState.phase === "auth"
                  ? t("models.oauthPasteRedirect")
                  : loginState.message}
                hint={loginState.phase === "auth" ? (
                  <>
                    {t("models.oauthNoBrowser")}{" "}
                    <a href={loginState.url} target="_blank" rel="noopener noreferrer">
                      {t("models.oauthOpenLoginPage")}
                    </a>
                    {t("models.oauthOpenLoginPageEnd")}
                  </>
                ) : undefined}
                value={inputValue}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("models.oauthValuePlaceholder"))}
                submitLabel={t("i18n.submit")}
                inputRef={inputRef}
                onValueChange={setInputValue}
                onSubmit={() => void submitCode(loginState.token, inputValue)}
              />
            )}
            {loginState.phase === "device_code" && (
              <div className="flex flex-col gap-2.5">
                <p className="m-0 text-xs leading-normal text-muted-foreground">
                  {t("models.oauthDeviceCode")}
                </p>
                <div className="rounded-sm border border-border bg-background px-2.5 py-2 font-mono text-base font-bold text-foreground">
                  {loginState.userCode}
                </div>
                <p className="m-0 text-xs leading-normal text-dim">
                  <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" className="break-all text-primary">
                    {loginState.verificationUri}
                  </a>
                  {loginState.expiresInSeconds ? ` ${t("models.deviceCodeExpires", { minutes: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
                </p>
              </div>
            )}
            {loginState.phase === "progress" && (
              <p className="m-0 text-xs text-muted-foreground">{loginState.message}</p>
            )}
            {loginState.phase === "success" && (
                 <p className="m-0 text-xs text-success">{t("i18n.connectedSuccessfully")}</p>
            )}
            {loginState.phase === "error" && (
              <p className="m-0 text-xs text-destructive">{loginState.message}</p>
            )}
          </div>
        </ConfigCard>
      )}

      <ProviderUsageSummary providerId={provider.id} enabled={provider.loggedIn} />

      {provider.loggedIn && <EnabledModelsSection providerId={provider.id} controller={enabledModels} contextSettings={contextSettings} />}
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh, enabledModels, contextSettings }: {
  provider: ApiKeyProvider; onRefresh: () => void; enabledModels: EnabledModelsController;
  contextSettings: ModelContextSettings;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const { t } = useI18n();

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div className="flex flex-col gap-4">
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigDetailTitle>API Key</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-block size-[7px] rounded-full", provider.configured ? "bg-success" : "bg-border")} />
            <span className={cn("text-xs", provider.configured ? "text-success" : "text-dim")}>
               {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
            </span>
          </div>
          {provider.configured && (
            <ConfigButton
              variant="danger"
              size="small"
              onClick={handleRemove}
              disabled={removing}
            >
               {removing ? t("i18n.removing") : t("i18n.disconnect")}
            </ConfigButton>
          )}
        </ConfigDetailActions>
      </ConfigDetailHeader>

      <ConfigCard footer={error ? <p className="m-0 text-xs text-destructive">{error}</p> : undefined}>
        {!provider.configured && (
          <p className="m-0 pb-2 text-xs leading-normal text-muted-foreground">
            {provider.modelCount === 1
              ? t("models.apiKeyEnableOne", { provider: provider.displayName })
              : t("models.apiKeyEnable", { provider: provider.displayName, count: provider.modelCount })}
          </p>
        )}

        <div className="flex gap-1.5">
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? t("models.replaceApiKey") : "sk-…"}
            className="flex-1"
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border-0 px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50",
              savedOk
                ? "bg-success text-white"
                : apiKey.trim()
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-dim",
            )}
          >
            {savedOk && (
              <CheckIcon size={12} strokeWidth={2.5} />
            )}
             {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
      </ConfigCard>

      <ProviderUsageSummary providerId={provider.id} enabled={provider.configured} />

      {provider.configured && <EnabledModelsSection providerId={provider.id} controller={enabledModels} contextSettings={contextSettings} />}
    </div>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && providerMatchesSearch(q, p.id, p.name));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && providerMatchesSearch(q, p.id, p.displayName));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardClass =
    "flex w-full min-w-0 flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-accent/50";

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="flex max-h-[min(72vh,calc(100vh-32px))] w-[820px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_8px_32px_rgba(0,0,0,0.22)]">
        {/* Search */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Search size={13} strokeWidth={1.8} className="shrink-0 text-dim" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
             placeholder={t("i18n.searchProviders")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
          />
        </div>

        {/* Card grid */}
        <div className="flex-1 overflow-y-auto p-3.5">
          {totalCount === 0 ? (
            <div className="py-5 text-center text-xs text-dim">{t("i18n.noProviders")}</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-2">
              {showCustom && (
                 <div className="col-span-full text-[10px] font-semibold uppercase tracking-[0.07em] text-dim">{t("i18n.custom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  className={cardClass}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold leading-[1.3] text-foreground">OpenAI / Anthropic compatible</div>
                     <div className="mt-0.5 text-[10px] text-dim">{t("i18n.customEndpoint")}</div>
                  </div>
                  <span className="flex size-[26px] shrink-0 items-center justify-center rounded-sm border border-dashed border-border bg-secondary">
                    <Plus size={13} strokeWidth={1.8} className="text-dim" />
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                 <div className={cn("col-span-full text-[10px] font-semibold uppercase tracking-[0.07em] text-dim", showCustom && "pt-1.5")}>{t("i18n.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  className={cardClass}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold leading-[1.3] text-foreground">{p.name}</div>
                    <div className="mt-0.5 text-[10px] text-dim">OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div className={cn("col-span-full text-[10px] font-semibold uppercase tracking-[0.07em] text-dim", availableOAuth.length > 0 && "pt-1.5")}>API Key</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  className={cardClass}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold leading-[1.3] text-foreground">{p.displayName}</div>
                    <div className="mt-0.5 text-[10px] text-dim">{p.modelCount === 1 ? t("models.modelCountOne") : t("models.modelCount", { count: p.modelCount })}</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({ onClose, embedded = false, cwd = null }: {
  onClose: () => void; embedded?: boolean; cwd?: string | null;
}) {
  const { t } = useI18n();
  const { openDetail, closeDetail } = useConfigDetailNavigation();
  // `enabledModels` lives in pi's settings, not models.json, so these switches
  // apply immediately instead of waiting for this panel's Save button.
  const enabledModels = useEnabledModels(cwd);
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set when models.json could not be read. Saving stays disabled: the draft
  // would not contain the file's providers, and a save replaces the whole file.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(readRememberedSelection);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  /** Set once the provider lists have answered; until then an overrides-only entry may be a managed provider's. */
  const [authListed, setAuthListed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Provider ids as models.json has them on disk, and where renames moved them. */
  const savedProvidersRef = useRef<Set<string>>(new Set());
  const renamesRef = useRef<Map<string, string>>(new Map());
  /**
   * Per provider, the model id saved at each slot, or null for a model added
   * since. Mirroring the draft's array moves is what lets a save tell a rename
   * from an unrelated edit without guessing.
   */
  const savedModelIdsRef = useRef<Map<string, (string | null)[]>>(new Map());
  /**
   * The provider name field while it differs from the provider's id. Save
   * applies it like every other visible edit; Rename applies it right away.
   */
  const [providerNameDraft, setProviderNameDraft] = useState<{ provider: string; name: string } | null>(null);

  const refreshAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { oauthProviders?: OAuthProvider[]; apiKeyProviders?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.oauthProviders)) setOauthProviders(d.oauthProviders);
        if (Array.isArray(d.apiKeyProviders)) setApiKeyProviders(d.apiKeyProviders);
      })
      .catch(() => {})
      .finally(() => setAuthListed(true));
  }, []);

  useEffect(() => {
    fetch("/api/models-config")
      .then(async (r) => {
        const d = await r.json() as ModelsJson & { error?: string };
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        savedProvidersRef.current = new Set(Object.keys(normalized.providers ?? {}));
        savedModelIdsRef.current = savedModelIds(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        setSelection((current) => current && customSelectionExists(normalized, current)
          ? current
          : keys[0]
            ? { type: "provider", name: keys[0] }
            : null);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    refreshAuthProviders();
  }, [refreshAuthProviders]);

  useEffect(() => {
    if (selection) setLastSettingsSelection("models", JSON.stringify(selection));
  }, [selection]);

  // An overrides-only entry belongs to its managed provider, not a duplicate custom provider.
  useEffect(() => {
    if (selection?.type !== "provider") return;
    const entry = config.providers?.[selection.name];
    if (!entry || !isOverridesOnly(entry)) return;
    if (oauthProviders.some((provider) => provider.id === selection.name)) {
      setSelection({ type: "oauth", providerId: selection.name });
    } else if (apiKeyProviders.some((provider) => provider.id === selection.name)) {
      setSelection({ type: "apikey", providerId: selection.name });
    }
  }, [apiKeyProviders, config.providers, oauthProviders, selection]);

  const contextSettings = (providerId: string): ModelContextSettings => ({
    overrides: config.providers?.[providerId]?.modelOverrides,
    disabled: loading || saving || loadError !== null,
    onChange: (modelId, value) => {
      try {
        setConfig(withContextWindowOverride(config, providerId, modelId, value));
        setSavedOk(false);
        setSaveError(null);
      } catch (error) {
        setSaveError(String(error));
      }
    },
  });

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  /** Moves a provider in `draft`; returns the moved config, or null when the id is taken. */
  const applyProviderRename = useCallback((draft: ModelsJson, oldName: string, newName: string): ModelsJson | null => {
    // Same guard as addCustomProvider: a collision would silently overwrite the
    // target provider's draft and its savedModelIds slots on save.
    // Remember where each saved provider ended up, so the enabledModels entries
    // can follow it on save instead of pointing at an id that no longer exists.
    const next = renameProviderEntry(draft, {
      savedProviders: savedProvidersRef.current,
      renames: renamesRef.current,
      slots: savedModelIdsRef.current,
    }, oldName, newName);
    if (!next) return null;
    setConfig(next);
    setProviderNameDraft(null);
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
    return next;
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    if (applyProviderRename(config, oldName, newName)) setSaveError(null);
    else setSaveError(t("models.providerNameTaken", { name: newName }));
  }, [applyProviderRename, config, t]);

  const deleteProvider = useCallback((name: string) => {
    const next = deleteProviderEntry(config, {
      savedProviders: savedProvidersRef.current,
      renames: renamesRef.current,
      slots: savedModelIdsRef.current,
    }, name);
    const remaining = Object.keys(next.providers ?? {});
    setProviderNameDraft((prev) => prev?.provider === name ? null : prev);
    setConfig(next);
    setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
    // A phone goes back to the list the provider left, not to another provider's detail.
    closeDetail();
  }, [config, closeDetail]);

  const addModel = useCallback((providerName: string) => {
    trackAddedModels(savedModelIdsRef.current, providerName, 1);
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const known = new Set((prev.providers?.[providerName]?.models ?? []).map((model) => model.id));
      trackAddedModels(
        savedModelIdsRef.current,
        providerName,
        discovered.filter((model) => !known.has(model.id)).length,
      );
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        // Keeps the capabilities the upstream published (#856).
        models.push({ ...discoveredModel });
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    savedModelIdsRef.current.get(providerName)?.splice(index, 1);
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
    closeDetail();
  }, [closeDetail]);

  const handleSave = useCallback(async () => {
    if (loadError) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    // A provider name typed but not applied with Rename is still a visible
    // edit: move the provider before writing, like every other field.
    let draft = config;
    const pendingName = providerNameDraft?.name.trim();
    if (providerNameDraft && pendingName && config.providers?.[providerNameDraft.provider]) {
      const renamed = applyProviderRename(config, providerNameDraft.provider, pendingName);
      if (!renamed) {
        setSaveError(t("models.providerNameTaken", { name: pendingName }));
        setSaving(false);
        return;
      }
      draft = renamed;
    }
    try {
      draft = normalizeContextWindowOverrides(draft);
      checkProviderEntries(draft);
      checkImageMaxBytes(draft);
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        // models.json just changed under the switches: providers may have been
        // renamed, models added, deleted or renamed. Re-verify the stored
        // patterns against the new catalog and re-read.
        const renames = [...renamesRef.current].map(([from, to]) => ({ from, to }));
        const modelRenames = collectModelRenames(draft, savedModelIdsRef.current, renamesRef.current);
        savedProvidersRef.current = new Set(Object.keys(draft.providers ?? {}));
        savedModelIdsRef.current = savedModelIds(draft);
        renamesRef.current.clear();
        enabledModels.resync(renames, modelRenames);
      }
    } catch (e) {
      if (e instanceof ProviderEntryError) {
        setSaveError(t(PROVIDER_ENTRY_MESSAGES[e.problem], { provider: e.provider }));
        // pi would not load the entry: show it, to be filled in or deleted.
        setSelection({ type: "provider", name: e.provider });
      } else if (e instanceof ContextWindowError) setSaveError(t("models.contextInvalid", { model: e.model }));
      else setSaveError(e instanceof ImageMaxBytesError ? t("models.imageMaxBytesInvalid", { model: e.model }) : String(e));
    } finally {
      setSaving(false);
    }
  }, [applyProviderRename, config, enabledModels, loadError, providerNameDraft, t]);

  const providers = Object.entries(config.providers ?? {}).filter(([id, entry]) => {
    if (!isOverridesOnly(entry)) return true;
    const managed = oauthProviders.some((provider) => provider.id === id) || apiKeyProviders.some((provider) => provider.id === id);
    return authListed && !managed;
  });
  // `12/40` next to a provider makes a narrowed selector visible at a glance.
  const scopeBadge = (providerId: string) => {
    const label = providerBadgeLabel(enabledModels.view, providerId);
    return label ? <span className="models-sidebar-badge">{label}</span> : null;
  };
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} enabledModels={enabledModels} contextSettings={contextSettings(p.id)} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} enabledModels={enabledModels} contextSettings={contextSettings(p.id)} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      // Only an entry the list shows as custom: an overrides-only one waits for the provider lists.
      if (!provider || !providers.some(([id]) => id === selection.name)) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          editingName={providerNameDraft?.provider === selection.name ? providerNameDraft.name : selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onEditingNameChange={(n) => setProviderNameDraft(n === selection.name ? null : { provider: selection.name, name: n })}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
          enabledModels={enabledModels}
          nameTaken={(n) => Boolean(config.providers?.[n])}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
    <ConfigPanelShell embedded={embedded} title={t("common.models")} subtitle="~/.pi/agent/models.json" closeLabel={t("i18n.close")} onClose={onClose}>

        <EnabledModelsBanner controller={enabledModels} />

        {/* Body */}
        <ConfigSplitView>

          {/* Left: tree */}
          <ConfigSidebar>
            <ConfigSidebarList>
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && (
                <ConfigSidebarGroupLabel>{t("modelsConfig.groupSignedIn")}</ConfigSidebarGroupLabel>
              )}
              {/* Active OAuth subscriptions */}
              {activeOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <ConfigSidebarItem
                    key={p.id}
                    active={isSelected}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <ConfigSidebarText className="flex-1">{p.name}</ConfigSidebarText>
                    {scopeBadge(p.id)}
                  </ConfigSidebarItem>
                );
              })}

              {/* Active API key providers */}
              {activeApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <ConfigSidebarItem
                    key={p.id}
                    active={isSelected}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <ConfigSidebarText className="flex-1">{p.displayName}</ConfigSidebarText>
                    {scopeBadge(p.id)}
                  </ConfigSidebarItem>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div className="mx-2 my-1 border-t border-border" />
              )}

              {/* Custom providers */}
              {providers.length > 0 && (
                <ConfigSidebarGroupLabel>{t("modelsConfig.groupCustom")}</ConfigSidebarGroupLabel>
              )}
              {loading ? (
                 <div className="px-2 py-2.5 text-xs text-muted-foreground">{t("i18n.loading")}</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                return (
                  <div key={pName} className="mb-0.5">
                    {/* Provider row */}
                    <ConfigSidebarItem
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      active={isProviderSelected}
                    >
                      <Cpu size={11} strokeWidth={1.8} className="shrink-0 text-dim" />
                      <ConfigSidebarText className="flex-1">
                        {pName}
                      </ConfigSidebarText>
                      {scopeBadge(pName)}
                    </ConfigSidebarItem>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      return (
                        <ConfigSidebarItem
                          key={i}
                          active={isModelSelected}
                          className="models-sidebar-indented-item"
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                        >
                          <ConfigSidebarText className={cn("flex-1", m.id ? "text-muted-foreground" : "text-dim")}>
                             {modelSidebarLabel(m) || t("i18n.newModel")}
                          </ConfigSidebarText>
                          {/* Reasoning pin: no pi token for the indigo tint, kept literal. */}
                          {m.reasoning && (
                            <span className="shrink-0 rounded-[3px] bg-[rgba(99,102,241,0.12)] px-1 py-px text-[10px] text-[rgba(99,102,241,0.8)]">T</span>
                          )}
                        </ConfigSidebarItem>
                      );
                    })}

                    {/* Add model button */}
                    <ConfigSidebarItem
                      className="models-sidebar-indented-item models-sidebar-add-item"
                      onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                    >
                       <ConfigSidebarText>+ {t("i18n.model")}</ConfigSidebarText>
                    </ConfigSidebarItem>
                  </div>
                );
              })}
            </ConfigSidebarList>

            {/* Add provider */}
            {/* The picker chooses first; its choice opens the detail on a phone. */}
            <ConfigListAction onClick={(event) => { event.preventDefault(); setPickerOpen(true); }}>{t("i18n.addProvider")}</ConfigListAction>
          </ConfigSidebar>

          {/* Right: detail */}
          <ConfigDetail>
            <ConfigDetailStack className="is-fill">
              {loading ? null : detailContent ?? (
                <ConfigEmptyState>{t("i18n.selectProviderModel")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>

        {/* Footer */}
        <ConfigFooter status={(loadError || saveError) ? (
          <span className="text-destructive">
            {loadError ? t("models.configUnreadable", { error: loadError }) : saveError}
          </span>
        ) : t("models.applyHelp")}>
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.cancel")}</ConfigButton>}
          <ConfigButton
            variant="primary"
            onClick={handleSave}
            disabled={saving || savedOk || loadError !== null}
            className={savedOk ? "is-success" : undefined}
          >
            {savedOk && (
              <CheckIcon size={14} strokeWidth={2.5} className="config-button-success-icon" />
            )}
             <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
          </ConfigButton>
        </ConfigFooter>
    </ConfigPanelShell>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(id) => { setSelection({ type: "oauth", providerId: id }); openDetail(); }}
        onSelectApiKey={(id) => { setSelection({ type: "apikey", providerId: id }); openDetail(); }}
        onAddCustom={() => { addCustomProvider(); openDetail(); }}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
