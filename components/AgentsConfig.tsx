"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Badge } from "@/components/ui/badge";
import type { ProjectTrustStatus, SubagentProfilesResponse, SubagentSettingsResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import { PathLabel } from "./PathLabel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import type { SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigCard,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSaveTarget,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigSwitch,
} from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { projectTrustReloadKey } from "./settings-ui-helpers";

const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "Custom agent",
  description: "",
  systemPrompt: "",
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  loadSkills: false,
  loadExtensions: false,
  codemode: "off",
  mcp: "off",
  promptMode: "append",
  inheritContext: false,
  runInBackground: false,
  enabled: true,
};

/**
 * The shared control look as utilities; a disabled control falls to its
 * panel background and dim text. Height stays per control (34px fields, the
 * taller prompt textarea), so the base carries none.
 */
const controlClassName =
  "min-w-0 rounded-md border border-border bg-background px-[9px] text-xs text-foreground outline-none disabled:bg-card disabled:text-muted-foreground disabled:cursor-default";

function editableProfile(profile: SubagentProfile): EditableProfile {
  return {
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    ...(profile.extensionTools ? { extensionTools: [...profile.extensionTools] } : {}),
    loadSkills: profile.loadSkills,
    ...(profile.skills !== undefined ? { skills: [...profile.skills] } : {}),
    loadExtensions: profile.loadExtensions,
    codemode: profile.codemode ?? "off",
    mcp: profile.mcp ?? "off",
    ...(profile.extensions !== undefined ? { extensions: [...profile.extensions] } : {}),
    promptMode: profile.promptMode,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.maxTurns ? { maxTurns: profile.maxTurns } : {}),
    inheritContext: profile.inheritContext,
    runInBackground: profile.runInBackground,
    // Managed keys the form does not edit must survive the PUT round-trip.
    ...(profile.color ? { color: profile.color } : {}),
    ...(profile.isolation ? { isolation: profile.isolation } : {}),
    ...(profile.persistSession !== undefined ? { persistSession: profile.persistSession } : {}),
    enabled: profile.enabled,
  };
}

/**
 * The model a profile reference names. It may end in pi's `:<thinking level>` (`provider/model:high`),
 * which the runtime reads as the model plus its level; a listed id that contains a colon matches whole.
 */
function profileModelBase(reference: string, isListed: (reference: string) => boolean): string {
  if (isListed(reference)) return reference;
  const colon = reference.lastIndexOf(":");
  const level = reference.slice(colon + 1);
  return colon > 0 && level && (THINKING_OPTIONS as readonly string[]).includes(level) ? reference.slice(0, colon) : reference;
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

/**
 * A built-in has no file to edit, so its fields stay read-only, but its switch is
 * live: the server records the name in `agents/settings.json` instead of writing a
 * copy of the profile to disk.
 */
function isTogglableScope(scope: SubagentScope): boolean {
  return isWritableScope(scope) || scope === "builtin";
}

function displayProfilePath(profile: SubagentProfile, cwd: string): string | null {
  if (!profile.filePath) return null;
  return profile.scope === "project" || profile.scope === "workspace"
    ? displayPathWithin(profile.filePath, cwd)
    : shortenPath(profile.filePath);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <ConfigField label={label}>{children}</ConfigField>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={disabled
      ? "flex cursor-default items-center gap-[7px] text-xs text-muted-foreground"
      : "flex cursor-pointer items-center gap-[7px] text-xs text-muted-foreground"}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function AgentsConfig({
  cwd,
  sessionId = null,
  onClose,
  onReloaded,
  embedded = false,
  trust,
}: {
  cwd: string;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the model list again. */
  trust?: ProjectTrustStatus | null;
}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("agents", cwd));
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [mode, setMode] = useState<EditorMode>("view");
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtInEnabled, setBuiltInEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );
  const modelSelectorOptions = useMemo(() => modelOptions.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
  })), [modelOptions]);

  const loadProfiles = useCallback(async (preferredKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as Partial<SubagentProfilesResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const next = data.profiles ?? [];
      setProfiles(next);
      const rememberedKey = preferredKey ?? getLastSettingsSelection("agents", cwd);
      const chosen = next.find((profile) => profileKey(profile) === rememberedKey)
        ?? next.find((profile) => profile.scope === "project")
        ?? next.find((profile) => profile.scope === "global")
        ?? next[0]
        ?? null;
      setSelectedKey(chosen ? profileKey(chosen) : null);
      if (chosen) {
        setDraft(editableProfile(chosen));
        setMode(isWritableScope(chosen.scope) ? "edit" : "view");
        if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/subagents/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
        if (!response.ok || data.error || typeof data.enabled !== "boolean") {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setBuiltInEnabled(data.enabled);
        if (typeof data.maxConcurrent === "number") setMaxConcurrent(data.maxConcurrent);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setSettingsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedKey) setLastSettingsSelection("agents", selectedKey, cwd);
  }, [cwd, selectedKey]);

  // The model list follows the folder's trust: GET /api/models leaves out an
  // untrusted project's extensions, which can register providers. Trust can
  // change while this section stays mounted (hidden) in Settings, by trusting
  // from Settings › MCP; a new decision loads the list again in place, keeping
  // any profile draft.
  const trustKey = projectTrustReloadKey(trust);
  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cwd, trustKey]);

  const selectProfile = (profile: SubagentProfile) => {
    setSelectedKey(profileKey(profile));
    setDraft(editableProfile(profile));
    setMode(isWritableScope(profile.scope) ? "edit" : "view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const beginCreate = () => {
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setDraft({ ...EMPTY_PROFILE, name, displayName: name });
    setMode("create");
    setTargetScope("global");
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected) return;
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: selected.displayName }),
    });
    setMode("create");
    setTargetScope(isWritableScope(selected.scope) ? selected.scope : "global");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !isWritableScope(selected.scope)) return;
    setDeleteConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const disabled = !editing || saving || toggling;
  const displayedScope = creating ? targetScope : selected?.scope;
  const displayedPath = creating
    ? targetScope === "global"
      ? `~/.pi/agent/agents/${draft.name || "..."}.md`
      : `./.pi/agents/${draft.name || "..."}.md`
    : selected
      ? displayProfilePath(selected, cwd) ?? t("agents.builtinPath")
      : "";
  const fullPath = creating ? displayedPath : selected?.filePath ?? displayedPath;
  const isListedModel = (reference: string) => modelOptions.some((model) => `${model.provider}/${model.id}` === reference);
  const draftModelBase = draft.model && profileModelBase(draft.model, isListedModel);
  const selectedModelAvailable = !draftModelBase || isListedModel(draftModelBase);
  const selectedModel = (() => {
    if (!draftModelBase) return null;
    const separator = draftModelBase.indexOf("/");
    return separator < 0
      ? { provider: "", modelId: draftModelBase }
      : { provider: draftModelBase.slice(0, separator), modelId: draftModelBase.slice(separator + 1) };
  })();
  const switchDisabled = creating
    ? disabled
    : !selected || !isTogglableScope(selected.scope) || saving || toggling;
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  // As `buildSubagentPromptPlan()` decides: no tools, skills or extensions.
  const chatOnlyDraft = draft.tools.length === 0 && !draft.loadSkills && !draft.loadExtensions;

  const toggleEnabled = async (enabled: boolean) => {
    if (creating) {
      update("enabled", enabled);
      return;
    }
    if (!selected || !isTogglableScope(selected.scope)) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name, enabled }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      const saved = data.profile;
      setProfiles((current) => current.map((profile) => profileKey(profile) === profileKey(saved) ? saved : profile));
      setDraft((current) => ({ ...current, enabled: saved.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setToggling(false);
    }
  };

  const toggleBuiltInSubagents = async (enabled: boolean) => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.enabled !== "boolean") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setBuiltInEnabled(data.enabled);
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateMaxConcurrent = async (value: number) => {
    setMaxConcurrent(value);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: value }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.maxConcurrent !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
      setMaxConcurrent(data.maxConcurrent);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    setSettingsError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloaded?.();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
      {/* The built-in switch group as a card (§7.3); the class stays the hook
          the phone-level hide rule targets. */}
      <ConfigCard
        className="agents-feature-setting mx-4 mt-4"
        title={t("agents.builtInTitle")}
        description={t("agents.builtInDescription")}
        actions={
          <>
            {reloadNeeded && sessionId && (
              <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
                {reloading ? t("agents.reloading") : t("agents.reloadSession")}
              </ConfigButton>
            )}
            <label className="agents-concurrency-control" title={t("agents.maxConcurrentDescription")}>
              <span>{t("agents.maxConcurrent")}</span>
              <input
                aria-label={t("agents.maxConcurrent")}
                type="number"
                min={1}
                max={32}
                value={maxConcurrent}
                disabled={settingsLoading || settingsSaving}
                onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                onBlur={() => void updateMaxConcurrent(maxConcurrent)}
              />
            </label>
            <ConfigSwitch
              checked={builtInEnabled}
              disabled={settingsLoading || reloading}
              loading={settingsSaving}
              label={t("agents.builtInTitle")}
              onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
            />
          </>
        }
        footer={reloadNeeded ? (
          <span role="status" className="agents-feature-reload-notice">{t("agents.reloadRequired")}</span>
        ) : undefined}
      />
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
              {loading ? (
                <div className="p-2.5 text-xs text-muted-foreground">{t("agents.loading")}</div>
              ) : (["project", "global", "workspace", "builtin"] as const).map((scope) => {
                const scopedProfiles = profiles.filter((profile) => profile.scope === scope);
                if (scopedProfiles.length === 0) return null;
                return (
                  <div key={scope} className="flex flex-col gap-1 pb-1.5">
                    <ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>
                    {scopedProfiles.map((profile) => {
                      const overridden = isSubagentProfileOverridden(profile, profiles);
                      return (
                        <ConfigSidebarItem
                          key={profileKey(profile)}
                          active={selectedKey === profileKey(profile) && !creating}
                          onClick={() => selectProfile(profile)}
                        >
                          <ConfigSidebarText className={`flex-1${profile.enabled ? "" : " text-muted-foreground"}`}>{profile.displayName}</ConfigSidebarText>
                          {!profile.enabled && (
                            <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground">
                              {t("agents.codemode.off")}
                            </Badge>
                          )}
                          {overridden && <span className="agents-overridden-label">{t("agents.overridden")}</span>}
                        </ConfigSidebarItem>
                      );
                    })}
                  </div>
                );
              })}
          </ConfigSidebarList>
          <ConfigListAction
                active={creating}
                onClick={beginCreate}
              >
                {t("agents.new")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
              {!selected && !creating ? (
                <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState>
              ) : (
                <ConfigDetailStack>
                  <ConfigDetailHeader>
                    <ConfigDetailHeaderInfo>
                      {/* A new profile chooses its scope where a saved one shows it. */}
                      {creating ? (
                        <ConfigSaveTarget
                          value={targetScope}
                          label={t("config.saveTo")}
                          options={(["global", "project"] as const).map((scope) => ({
                            value: scope,
                            label: t(`agents.scope.${scope}`),
                            disabled: saving,
                          }))}
                          path={displayedPath}
                          onChange={setTargetScope}
                        />
                      ) : (
                        <>
                          {displayedScope && (
                            <ConfigScopeTag scope={displayedScope}>{t(`agents.scope.${displayedScope}`)}</ConfigScopeTag>
                          )}
                          <PathLabel className="config-detail-path" text={displayedPath} title={fullPath} />
                        </>
                      )}
                    </ConfigDetailHeaderInfo>
                    <ConfigDetailActions>
                      {selected && (mode === "view" || mode === "edit") && <ConfigButton size="small" onClick={beginDuplicate} disabled={saving || toggling}>{t("agents.duplicate")}</ConfigButton>}
                      {selected && isWritableScope(selected.scope) && mode === "edit" && <ConfigButton variant="danger" size="small" onClick={() => setDeleteConfirmOpen(true)} disabled={saving || toggling}>{t("agents.delete")}</ConfigButton>}
                      <ConfigSwitch checked={draft.enabled} disabled={switchDisabled} label={draft.enabled ? t("agents.disable") : t("agents.enable")} onChange={(checked) => void toggleEnabled(checked)} />
                    </ConfigDetailActions>
                  </ConfigDetailHeader>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label={t("agents.name")}>
                      {creating ? (
                        <input aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} className={`${controlClassName} h-[34px] w-full`} />
                      ) : (
                        <code className="flex min-h-[34px] items-center overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground">
                          {draft.name}
                        </code>
                      )}
                    </Field>
                    <Field label={t("agents.displayName")}>
                      <input aria-label={t("agents.displayName")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} className={`${controlClassName} h-[34px] w-full`} />
                    </Field>
                  </div>
                  <Field label={t("agents.description")}>
                    <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} className={`${controlClassName} h-[34px] w-full`} />
                  </Field>
                  <Field label={t("agents.prompt")}>
                    <textarea className={`${controlClassName} agents-system-prompt h-[195px] min-h-[195px] max-h-[60vh] w-full py-[9px] overflow-auto leading-normal resize-y disabled:resize-none`} aria-label={t("agents.prompt")} value={draft.systemPrompt} disabled={disabled} onChange={(event) => update("systemPrompt", event.target.value)} />
                  </Field>

                  <Field label={t("agents.tools")}>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {TOOL_OPTIONS.map((tool) => (
                        <Toggle key={tool} label={tool} disabled={disabled} checked={draft.tools.includes(tool)} onChange={(checked) => update("tools", checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool))} />
                      ))}
                    </div>
                  </Field>

                  <Field label={t("agents.resources")}>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <Toggle label={t("agents.loadSkills")} disabled={disabled} checked={draft.loadSkills} onChange={(checked) => update("loadSkills", checked)} />
                      <Toggle label={t("agents.loadExtensions")} disabled={disabled} checked={draft.loadExtensions} onChange={(checked) => update("loadExtensions", checked)} />
                      {/* A chat-only child cannot start with MCP on; the switch still turns it off. */}
                      <Toggle label={t("agents.mcp")} disabled={disabled || (chatOnlyDraft && draft.mcp !== "on")} checked={draft.mcp === "on"} onChange={(checked) => update("mcp", checked ? "on" : "off")} />
                    </div>
                    {/* `skills:` and `extensions:` lists are edited in the profile file; show what they load. */}
                    {draft.loadSkills && draft.skills !== undefined && (
                      <span className="[overflow-wrap:anywhere] text-xs leading-[1.4] text-muted-foreground">
                        {draft.skills.length > 0
                          ? t("agents.skillsOnly", { skills: draft.skills.join(", ") })
                          : t("agents.skillsNone")}
                      </span>
                    )}
                    {draft.loadExtensions && draft.extensions !== undefined && (
                      <span className="[overflow-wrap:anywhere] text-xs leading-[1.4] text-muted-foreground">
                        {draft.extensions.length > 0
                          ? t("agents.extensionsOnly", { extensions: draft.extensions.join(", ") })
                          : t("agents.extensionsNone")}
                      </span>
                    )}
                    {!disabled && chatOnlyDraft ? (
                      <span className="text-xs leading-[1.4] text-muted-foreground">
                        {t("agents.mcpChatOnly")}
                      </span>
                    ) : draft.mcp === "on" && (
                      <span className="text-xs leading-[1.4] text-muted-foreground">
                        {t("agents.mcpHint")}
                      </span>
                    )}
                  </Field>

                  <Field label={t("agents.codemode")}>
                    <div className="flex flex-col gap-1.5">
                      <select
                        aria-label={t("agents.codemode")}
                        value={draft.codemode ?? "off"}
                        disabled={disabled}
                        onChange={(event) => update("codemode", event.target.value as EditableProfile["codemode"])}
                        className={`${controlClassName} h-[34px] w-auto min-w-[180px] self-start`}
                      >
                        <option value="inherit">{t("agents.codemode.inherit")}</option>
                        <option value="on">{t("agents.codemode.on")}</option>
                        <option value="off">{t("agents.codemode.off")}</option>
                      </select>
                      <span className="text-xs leading-[1.4] text-muted-foreground">
                        {t("agents.codemodeHint")}
                      </span>
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(120px,0.75fr)_minmax(100px,0.5fr)]">
                    <Field label={t("agents.model")}>
                      <div className="flex flex-col gap-1">
                        <ModelSelector
                          options={modelSelectorOptions}
                          value={selectedModel}
                          onChange={(provider, modelId) => update("model", `${provider}/${modelId}`)}
                          onClear={() => update("model", undefined)}
                          emptyLabel={modelsLoading ? t("agents.modelsLoading") : t("agents.inherit")}
                          selectedLabel={draft.model && !selectedModelAvailable
                            ? t("agents.modelUnavailable", { model: draft.model })
                            : draft.model !== draftModelBase ? draft.model : undefined}
                          disabled={disabled || modelsLoading || (modelOptions.length === 0 && !draft.model)}
                          ariaLabel={t("agents.model")}
                          variant="field"
                          placement="auto"
                        />
                        {modelsError && <span className="text-[10px] text-destructive">{modelsError}</span>}
                      </div>
                    </Field>
                    <Field label={t("agents.thinking")}>
                      <select aria-label={t("agents.thinking")} value={draft.thinking ?? ""} disabled={disabled} onChange={(event) => update("thinking", (event.target.value || undefined) as EditableProfile["thinking"])} className={`${controlClassName} h-[34px] w-full`}>
                        {THINKING_OPTIONS.map((value) => <option key={value || "default"} value={value}>{value || t("agents.inherit")}</option>)}
                      </select>
                    </Field>
                    <Field label={t("agents.maxTurns")}>
                      <input aria-label={t("agents.maxTurns")} type="number" min={1} value={draft.maxTurns ?? ""} disabled={disabled} onChange={(event) => update("maxTurns", event.target.value ? Number(event.target.value) : undefined)} className={`${controlClassName} h-[34px] w-full`} />
                    </Field>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                    <Toggle label={t("agents.inheritContext")} disabled={disabled} checked={draft.inheritContext} onChange={(checked) => update("inheritContext", checked)} />
                    <Toggle label={t("agents.background")} disabled={disabled} checked={draft.runInBackground} onChange={(checked) => update("runInBackground", checked)} />
                  </div>
                </ConfigDetailStack>
              )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      <ConfigFooter status={(settingsError || error) && <span role="alert" className="text-destructive">{settingsError || error}</span>}>
        {editing && (
          <ConfigButton
            variant="primary"
            onClick={() => void save()}
            disabled={saving || savedOk || toggling || !draft.name.trim()}
            className={savedOk ? "is-success" : undefined}
          >
            {savedOk && (
              <CheckIcon size={14} strokeWidth={3} className="config-button-success-icon" />
            )}
            <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
          </ConfigButton>
        )}
      </ConfigFooter>
      {deleteConfirmOpen && selected && (
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("agents.deleteConfirm", { name: selected.displayName })}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("i18n.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void remove()}>{t("agents.delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </ConfigPanelShell>
  );
}
