"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuIcon,
  LayersIcon,
  LogOutIcon,
  PuzzleIcon,
  RotateCcwIcon,
  ServerIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { useEnterSendMode, setEnterSendMode } from "@/hooks/useEnterSendMode";
import { useFilesPlacement, setFilesPlacement } from "@/hooks/useFilesPlacement";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ProjectTrustStatus, ToolSettingsResponse } from "@/lib/api-types";
import { KEEP_ALIVE_CONFIG_LIMITS, type ChatKeepAliveConfig } from "@/lib/chat-keepalive";
import {
  setLastSettingsSection,
  settingsSectionRequiresProject,
  type SettingsSection,
} from "@/lib/settings-navigation";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { McpConfig } from "./McpConfig";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailHeader,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigSwitch,
  ConfigDetailNavigationContext,
  type ConfigDetailNavigation,
} from "./SettingsUi";
import { FontSettings } from "./FontSettings";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  keepAliveConfig: ChatKeepAliveConfig;
  onKeepAliveConfigChange: (config: ChatKeepAliveConfig) => void;
  initialSection: SettingsSection;
  /** A phone opens on the list of sections instead of `initialSection` (the plain Settings button). */
  openAtHome?: boolean;
  onClose: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  /** The page's trust status for `cwd`; Settings › MCP reloads when it changes, as after trusting. */
  projectTrust?: ProjectTrustStatus | null;
  /** Opens the page's trust dialog for `cwd`, above Settings; Settings › MCP's trust notice offers it. */
  onOpenTrustDialog?: () => void;
  /** Settings › MCP added a project server, which changed `cwd`'s trust (and may have trusted a fresh folder). */
  onProjectTrustChanged?: (cwd: string, status: ProjectTrustStatus) => void;
}

const SECTION_ICONS = {
  general: SlidersHorizontalIcon,
  models: CpuIcon,
  skills: LayersIcon,
  agents: BotIcon,
  plugins: PuzzleIcon,
  mcp: ServerIcon,
} as const;

/** A section's glyph (lucide, §6); `strokeWidth` 1.8 keeps the hand-drawn icons' line weight. */
export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const Icon = SECTION_ICONS[section];
  return <Icon size={size} strokeWidth={strokeWidth} className="settings-section-icon shrink-0" />;
}

type GeneralDetail = "appearance" | "chat" | "sidebar" | "shell" | "push" | "language";

function GeneralSettings({ sessionId, onClose, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange, soundEnabled, onSoundToggle, keepAliveConfig, onKeepAliveConfigChange }: Pick<Props, "sessionId" | "onClose" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange" | "soundEnabled" | "onSoundToggle" | "keepAliveConfig" | "onKeepAliveConfigChange">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { width: chatContentWidth, setWidth: setChatContentWidth, fontSize, setFontSize } = useChatAppearance();
  const enterSendMode = useEnterSendMode();
  const filesPlacement = useFilesPlacement();
  const [shellSettings, setShellSettings] = useState<ToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [cacheMissNotices, setCacheMissNotices] = useState<boolean | null>(null);
  const [cacheMissNoticesSaving, setCacheMissNoticesSaving] = useState(false);
  const [cacheMissNoticesError, setCacheMissNoticesError] = useState<string | null>(null);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [detail, setDetail] = useState<GeneralDetail>("appearance");

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  // The Shell 工具 entry only exists on Windows; fall back if it disappears.
  useEffect(() => {
    if (detail === "shell" && shellSettings && !shellSettings.isWindows) setDetail("appearance");
  }, [detail, shellSettings]);

  const logOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/cache-miss-notices")
      .then(async (response) => {
        const data = await response.json() as { enabled?: boolean; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setCacheMissNotices(data.enabled === true);
      })
      .catch((cause) => {
        if (!cancelled) setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  // pi's showCacheMissNotices (#1265); the open chat is read again to show or drop them.
  const toggleCacheMissNotices = async (enabled: boolean) => {
    setCacheMissNoticesSaving(true);
    setCacheMissNoticesError(null);
    try {
      const response = await fetch("/api/cache-miss-notices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setCacheMissNotices(data.enabled === true);
      if (sessionId) onSessionReloaded();
    } catch (cause) {
      setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCacheMissNoticesSaving(false);
    }
  };

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  const generalDetails: { id: GeneralDetail; label: string }[] = [
    { id: "appearance", label: t("settings.appearance") },
    { id: "chat", label: t("settings.chat") },
    { id: "sidebar", label: t("settings.sidebar") },
    ...(shellSettings?.isWindows ? [{ id: "shell" as const, label: t("settings.shellTool") }] : []),
    { id: "push", label: t("settings.pushPermission") },
    { id: "language", label: t("common.language") },
  ];
  const activeDetailLabel = generalDetails.find((item) => item.id === detail)?.label ?? t("settings.appearance");
  // A form row's label: 13px, regular, per the draft's frow2 density.
  const rowLabelClass = "text-[13px] font-normal";

  // Sub-section content, shared by both shapes: a phone shows one at a time
  // behind its own list (the three-level stack); the desktop stacks them as
  // Cards in the scrolling body (§4.4).
  const themeGroup = (
    <RadioGroup
      value={preference}
      onValueChange={(value) => setThemePreference(value as ThemePreference)}
      aria-label={t("settings.appearance")}
      className="grid w-full grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2"
    >
      {THEME_OPTIONS.map((option) => {
        return (
          <label
            key={option.id}
            data-theme-option={option.id}
            className="relative inline-flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs leading-none text-foreground transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:ring-[1px] has-[[data-state=checked]]:ring-foreground has-[:focus-visible]:outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-accent/50"
          >
            {/* The Radix radio carries the group's semantics (roving focus,
                arrow keys); the palette card stays the visual. */}
            <RadioGroupItem value={option.id} className="sr-only" />
            {/* The palettes' own backgrounds, not tokens of the running theme. */}
            <span
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 rounded-full border border-border",
                option.id === "auto" && "bg-[linear-gradient(90deg,#ffffff_50%,#1a1a1a_50%)]",
                option.id === "light" && "bg-white",
                option.id === "dark" && "bg-[#1a1a1a]",
              )}
            />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t(option.label)}</span>
          </label>
        );
      })}
    </RadioGroup>
  );
  const chatOptions = (
    <div className="flex w-full flex-col gap-2.5">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel className={rowLabelClass}>{t("settings.thinkingExpandedDefault")}</FieldLabel>
        </FieldContent>
        <ConfigSwitch
          checked={thinkingExpanded}
          label={t("settings.thinkingExpandedDefault")}
          onChange={(enabled) => {
            setThinkingExpandedByDefault(enabled);
            setThinkingExpanded(enabled);
          }}
        />
      </Field>
      <Field>
        <div className="flex items-center gap-2">
          <FieldLabel className={rowLabelClass}>{t("settings.chatContentWidth")}</FieldLabel>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{chatContentWidth}px</span>
          <ConfigButton
            variant="ghost"
            size="small"
            className="size-7 p-0"
            title={t("settings.resetChatContentWidth")}
            aria-label={t("settings.resetChatContentWidth")}
            disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
            onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
          >
            <RotateCcwIcon size={14} strokeWidth={1.8} />
          </ConfigButton>
        </div>
        <Slider
          min={CHAT_CONTENT_WIDTH_MIN}
          max={CHAT_CONTENT_WIDTH_MAX}
          step={10}
          value={[chatContentWidth]}
          aria-label={t("settings.chatContentWidth")}
          onValueChange={(values) => setChatContentWidth(values[0])}
        />
      </Field>
      <FontSettings />
      <Field>
        <div className="flex items-center gap-2">
          <FieldLabel className={rowLabelClass}>{t("settings.chatContentFontSize")}</FieldLabel>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{fontSize}px</span>
          <ConfigButton
            variant="ghost"
            size="small"
            className="size-7 p-0"
            title={t("settings.resetChatContentFontSize")}
            aria-label={t("settings.resetChatContentFontSize")}
            disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
            onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
          >
            <RotateCcwIcon size={14} strokeWidth={1.8} />
          </ConfigButton>
        </div>
        <Slider
          min={CHAT_CONTENT_FONT_SIZE_MIN}
          max={CHAT_CONTENT_FONT_SIZE_MAX}
          step={1}
          value={[fontSize]}
          aria-label={t("settings.chatContentFontSize")}
          onValueChange={(values) => setFontSize(values[0])}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel className={rowLabelClass}>{t("settings.quoteSelection")}</FieldLabel>
        </FieldContent>
        <ConfigSwitch
          checked={quoteSelectionEnabled}
          label={t("settings.quoteSelection")}
          onChange={onQuoteSelectionChange}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel className={rowLabelClass}>{t("settings.completionSound")}</FieldLabel>
        </FieldContent>
        <ConfigSwitch
          checked={soundEnabled}
          label={t("settings.completionSound")}
          onChange={() => onSoundToggle()}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel className={rowLabelClass}>{t("settings.enterSendMode")}</FieldLabel>
        </FieldContent>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={enterSendMode}
          aria-label={t("settings.enterSendMode")}
          onValueChange={(value) => {
            if (value === "enter" || value === "ctrlEnter") setEnterSendMode(value);
          }}
        >
          <ToggleGroupItem value="enter" className="px-2.5 text-xs">{t("settings.enterSendModeEnter")}</ToggleGroupItem>
          <ToggleGroupItem value="ctrlEnter" className="px-2.5 text-xs">{t("settings.enterSendModeCtrlEnter")}</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel className={rowLabelClass}>{t("settings.cacheMissNotices")}</FieldLabel>
        </FieldContent>
        <ConfigSwitch
          checked={cacheMissNotices === true}
          loading={(cacheMissNotices === null && !cacheMissNoticesError) || cacheMissNoticesSaving}
          label={t("settings.cacheMissNotices")}
          describedBy="settings-cache-miss-notices-description"
          onChange={(enabled) => void toggleCacheMissNotices(enabled)}
        />
      </Field>
    </div>
  );
  // The keep-alive rows sit flat in the chat detail (its own sub-section).
  const keepAliveBlock = (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">{t("settings.keepAliveDescription")}</p>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="settings-keepalive-max-sessions" className={rowLabelClass}>{t("settings.keepAliveMaxSessions")}</FieldLabel>
        <Input
          id="settings-keepalive-max-sessions"
          type="number"
          min={KEEP_ALIVE_CONFIG_LIMITS.maxSessions.min}
          max={KEEP_ALIVE_CONFIG_LIMITS.maxSessions.max}
          value={keepAliveConfig.maxSessions}
          className="h-8 w-20 text-right text-[13px]"
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) onKeepAliveConfigChange({ ...keepAliveConfig, maxSessions: value });
          }}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="settings-keepalive-idle-timeout" className={rowLabelClass}>{t("settings.keepAliveIdleTimeout")}</FieldLabel>
        <Input
          id="settings-keepalive-idle-timeout"
          type="number"
          min={KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.min}
          max={KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.max}
          value={keepAliveConfig.idleTimeoutMinutes}
          className="h-8 w-20 text-right text-[13px]"
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) onKeepAliveConfigChange({ ...keepAliveConfig, idleTimeoutMinutes: value });
          }}
        />
      </Field>
    </div>
  );
  const sidebarContent = (
    <Field orientation="horizontal" aria-describedby="settings-files-placement-description">
      <FieldContent>
        <FieldLabel className={rowLabelClass}>{t("settings.filesPlacement")}</FieldLabel>
        <FieldDescription id="settings-files-placement-description" className="text-xs">
          {t("settings.filesPlacementDescription")}
        </FieldDescription>
      </FieldContent>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filesPlacement}
        aria-label={t("settings.filesPlacement")}
        onValueChange={(value) => {
          if (value === "below" || value === "tab") setFilesPlacement(value);
        }}
      >
        <ToggleGroupItem value="below" className="px-2.5 text-xs">{t("settings.filesPlacementBelow")}</ToggleGroupItem>
        <ToggleGroupItem value="tab" className="px-2.5 text-xs">{t("settings.filesPlacementTab")}</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  );
  const shellBlock = shellSettings ? (
    <>
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">{t("settings.shellToolDescription")}</p>
      <Field orientation="horizontal">
        <FieldLabel className={rowLabelClass}>{t("settings.usePowerShell")}</FieldLabel>
        <ConfigSwitch
          checked={shellSettings.powerShellEnabled}
          loading={shellSaving}
          label={t("settings.usePowerShell")}
          onChange={(enabled) => void togglePowerShell(enabled)}
        />
      </Field>
      {shellError && <p role="alert" className="m-0 text-xs text-destructive">{shellError}</p>}
    </>
  ) : null;
  const pushBlock = (
    <>
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">{t("settings.pushPermissionDescription")}</p>
      <Field orientation="horizontal">
        <FieldLabel className={rowLabelClass}>{t("settings.pushPermission")}</FieldLabel>
        <ConfigButton
          variant="secondary"
          size="small"
          disabled={pushRegistering}
          onClick={() => void registerPush()}
        >
          {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
        </ConfigButton>
      </Field>
      {pushStatus && (
        <p role="status" className={cn("m-0 text-xs", pushStatus.kind === "ok" ? "text-primary" : "text-destructive")}>
          {pushStatus.message}
        </p>
      )}
    </>
  );
  const languageGroup = (
    <div role="radiogroup" aria-label={t("common.language")} className="flex w-full flex-col gap-0.5">
      {supportedLocales.map((plugin) => {
        const selected = locale === plugin.id;
        return (
          <button
            key={plugin.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLocale(plugin.id as typeof locale)}
            className="group flex h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-foreground outline-none hover:bg-accent/50 focus-visible:bg-accent/50 aria-checked:bg-accent/50 aria-checked:font-medium"
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border",
                selected ? "border-primary" : "border-border",
              )}
            >
              {selected && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">{plugin.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{plugin.id}</span>
          </button>
        );
      })}
    </div>
  );
  // One shape on every size: a list beside the detail. A phone shows one pane
  // at a time (ConfigSplitView's data-pane) behind the header's Back button.
  return (
    <ConfigPanelShell embedded title={t("settings.general")} onClose={onClose}>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {generalDetails.map((item) => (
              <ConfigSidebarItem
                key={item.id}
                active={detail === item.id}
                onClick={() => setDetail(item.id)}
              >
                <ConfigSidebarText>{item.label}</ConfigSidebarText>
              </ConfigSidebarItem>
            ))}
          </ConfigSidebarList>
          {webAuthEnabled && (
            <ConfigListAction disabled={loggingOut} onClick={() => void logOut()}>
              <LogOutIcon size={14} strokeWidth={1.8} />
              {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
            </ConfigListAction>
          )}
          {webAuthEnabled && logoutError && (
            <p role="alert" className="mt-2 px-2 text-xs text-destructive">{logoutError}</p>
          )}
        </ConfigSidebar>
        <ConfigDetail>
          <ConfigDetailStack className="min-h-full">
            <ConfigDetailHeader>
              <ConfigDetailTitle>{activeDetailLabel}</ConfigDetailTitle>
            </ConfigDetailHeader>
            {detail === "appearance" && themeGroup}
            {detail === "chat" && chatOptions}
            {detail === "chat" && keepAliveBlock}
            {detail === "sidebar" && sidebarContent}
            {detail === "shell" && shellBlock}
            {detail === "push" && pushBlock}
            {detail === "language" && languageGroup}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
    </ConfigPanelShell>
  );
}

// A phone shows Settings one level at a time: the sections, a section (its list), a row's detail.
type PhoneLevel = "home" | "section" | "detail";

const PHONE_PARENT_LEVEL: Record<PhoneLevel, PhoneLevel> = { home: "home", section: "home", detail: "section" };
const PHONE_LEVEL_DEPTH: Record<PhoneLevel, number> = { home: 0, section: 1, detail: 2 };
const PHONE_LEVEL_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * A phone's level change slides the new level in: from the right going in,
 * from the left (a shorter way, fading up) going back, as a navigation stack
 * does. The header's Back and title fade in with it. Only the new level moves
 * (the old one is gone at once), so the main area clips it; nothing moves
 * under prefers-reduced-motion.
 */
function animatePhoneLevelChange(main: HTMLElement | null, header: HTMLElement | null, from: PhoneLevel, to: PhoneLevel) {
  if (!main || typeof main.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const forward = PHONE_LEVEL_DEPTH[to] > PHONE_LEVEL_DEPTH[from];
  main.animate(forward
    ? [
      { transform: "translateX(100%)", boxShadow: "-12px 0 24px rgba(0, 0, 0, 0.12)" },
      { transform: "translateX(0)", boxShadow: "-12px 0 24px rgba(0, 0, 0, 0)" },
    ]
    : [{ transform: "translateX(-30%)", opacity: 0.4 }, { transform: "translateX(0)", opacity: 1 }], {
    duration: 280,
    easing: PHONE_LEVEL_EASING,
  });
  header?.querySelectorAll<HTMLElement>(".settings-phone-back, .settings-dialog-title").forEach((element) => {
    element.animate([
      { opacity: 0, transform: `translateX(${forward ? 16 : -16}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ], { duration: 220, easing: PHONE_LEVEL_EASING });
  });
}

/**
 * The phone's level, with an entry in the browser history for each level
 * entered, so the system Back gesture goes up one level instead of leaving the
 * page. The entry copies the current history state (Next's router reads it)
 * and keeps the URL. Closing Settings drops the entries it added.
 */
function usePhoneSettingsLevel(isPhone: boolean, openAtHome: boolean) {
  const [level, setLevel] = useState<PhoneLevel>(openAtHome ? "home" : "section");
  // A desktop shows a section, so a window narrowed to a phone's width stays
  // on it instead of falling back to the level the panel opened at.
  if (!isPhone && level !== "section") setLevel("section");
  const levelRef = useRef(level);
  levelRef.current = level;
  const pushedRef = useRef(0);

  useEffect(() => {
    if (!isPhone) return;
    const onPopState = () => {
      if (pushedRef.current === 0) return;
      pushedRef.current -= 1;
      setLevel((current) => PHONE_PARENT_LEVEL[current]);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isPhone]);

  const enter = useCallback((next: PhoneLevel) => {
    if (!isPhone) return;
    window.history.pushState(window.history.state, "");
    pushedRef.current += 1;
    setLevel(next);
  }, [isPhone]);

  const goUp = useCallback(() => {
    // An entry this panel added: popstate goes up, as the system Back does.
    if (pushedRef.current > 0) window.history.back();
    else setLevel((current) => PHONE_PARENT_LEVEL[current]);
  }, []);

  const dropHistory = useCallback(() => {
    const pushed = pushedRef.current;
    pushedRef.current = 0;
    if (pushed > 0) window.history.go(-pushed);
  }, []);

  return { level, levelRef, enter, goUp, dropHistory };
}

export function SettingsPanel({
  cwd,
  sessionId,
  initialSection,
  openAtHome = false,
  onClose: closeSettings,
  onSessionReloaded,
  quoteSelectionEnabled,
  onQuoteSelectionChange,
  soundEnabled,
  onSoundToggle,
  keepAliveConfig,
  onKeepAliveConfigChange,
  projectTrust,
  onOpenTrustDialog,
  onProjectTrustChanged,
}: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  // Which sections need a project is decided once, in lib/settings-navigation.ts.
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = ([
    { id: "general", label: t("settings.general") },
    { id: "models", label: t("common.models") },
    { id: "skills", label: t("common.skills") },
    { id: "agents", label: t("common.agents") },
    { id: "plugins", label: t("common.plugins") },
    { id: "mcp", label: t("settings.mcp") },
  ] as const).map((item) => ({ ...item, requiresProject: settingsSectionRequiresProject(item.id) }));
  const sectionRequiresProject = settingsSectionRequiresProject(section);
  const isPhone = useIsMobile();
  const phone = usePhoneSettingsLevel(isPhone, openAtHome);
  const { dropHistory, enter: enterPhoneLevel, goUp: goUpPhoneLevel, levelRef: phoneLevelRef } = phone;
  const headerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const shownPhoneLevelRef = useRef(phone.level);
  // Before paint, so the new level never shows in place first.
  useLayoutEffect(() => {
    const from = shownPhoneLevelRef.current;
    shownPhoneLevelRef.current = phone.level;
    if (isPhone && from !== phone.level) animatePhoneLevelChange(mainRef.current, headerRef.current, from, phone.level);
  }, [isPhone, phone.level]);
  const onClose = useCallback(() => {
    dropHistory();
    closeSettings();
  }, [closeSettings, dropHistory]);
  const sectionLabel = sections.find((item) => item.id === section)?.label ?? t("settings.title");
  // Named by the detail's active row (ConfigSidebarItem); none until one reports.
  const [detailTitle, setDetailTitle] = useState<string | null>(null);
  const detailNavigation = useMemo<ConfigDetailNavigation>(() => ({
    detailOpen: phone.level === "detail",
    openDetail: () => {
      if (phoneLevelRef.current !== "section") return;
      setDetailTitle(null);
      enterPhoneLevel("detail");
    },
    closeDetail: () => {
      if (phoneLevelRef.current === "detail") goUpPhoneLevel();
    },
    reportDetailTitle: setDetailTitle,
  }), [enterPhoneLevel, goUpPhoneLevel, phone.level, phoneLevelRef]);

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    if (cwd || !sectionRequiresProject) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, sectionRequiresProject]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const openSectionFromHome = (nextSection: SettingsSection) => {
    activateSection(nextSection);
    enterPhoneLevel("section");
  };

  // The phone shows sections one level at a time; only a mounted one renders.
  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id || phone.level === "home"}
      data-phone-level={isPhone ? phone.level : undefined}
      // A section's settings above its list (Models' enabledModels, Sub-agents'
      // switch) belong to the list level, not to each row's detail.
      className="min-h-0 min-w-0 w-full flex-1 max-[640px]:data-[phone-level=detail]:[&_.enabled-models-banner]:hidden max-[640px]:data-[phone-level=detail]:[&_.agents-feature-setting]:hidden"
    >
      {content}
    </div>
  ) : null;

  // Both shapes mount the same sections: the desktop shows the active tab's,
  // a phone shows them one level at a time (its list, then a row's detail).
  const hostedSections = (
    <ConfigDetailNavigationContext.Provider value={detailNavigation}>
      {sectionHost("general", <GeneralSettings sessionId={sessionId} onClose={onClose} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} keepAliveConfig={keepAliveConfig} onKeepAliveConfigChange={onKeepAliveConfigChange} />)}
      {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
      {/* Visited sections stay mounted, so the ones whose answer depends on trust take the page's
          status and load again in place when trusting from Settings › MCP changes it. */}
      {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} trust={projectTrust} onClose={onClose} />)}
      {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} />)}
      {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} />)}
      {/* No project needed: the global mcp.json is listed alone, and a project adds its group. */}
      {sectionHost("mcp", <McpConfig embedded key={cwd ?? ""} cwd={cwd} trust={projectTrust} onTrustProject={onOpenTrustDialog} onProjectTrustChanged={onProjectTrustChanged} onClose={onClose} />)}
    </ConfigDetailNavigationContext.Provider>
  );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className={cn(
          // The overlay and surface sit above every in-page overlay (file panel,
          // minimap, widgets); the trust dialog mounts after and stacks above.
          "settings-phone-safe z-[1000] flex flex-col gap-0 overflow-hidden p-0",
          "h-[84vh] max-h-[calc(100dvh-16px)] w-[min(1080px,calc(100vw-16px))] max-w-none sm:max-w-none rounded-xl",
          "max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
        )}
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>

        <Tabs
          value={section}
          onValueChange={(value) => activateSection(value as SettingsSection)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          {/* §3.5: one top bar on every size — the title, a phone's Back, the
              desktop's horizontal section tabs; the built-in close sits at its
              right edge. */}
          <div ref={headerRef} className="flex min-h-[50px] shrink-0 items-center gap-1 border-b pr-[52px] pl-[18px] max-sm:pl-2">
            {isPhone && phone.level !== "home" && (() => {
              const backName = phone.level === "detail" ? sectionLabel : t("settings.title");
              return (
                <Button
                  type="button"
                  variant="ghost"
                  className="settings-phone-back h-11 max-w-full shrink-0 justify-start gap-0.5 px-1.5 text-[15px] text-primary"
                  onClick={goUpPhoneLevel}
                  aria-label={t("settings.backTo", { name: backName })}
                >
                  <ChevronLeftIcon size={20} />
                  <span className="truncate">{backName}</span>
                </Button>
              );
            })()}
            {/* A phone names the level it shows: Settings, the section, the detail's row. */}
            <strong className="settings-dialog-title shrink-0 text-[15px] font-semibold whitespace-nowrap max-[640px]:truncate max-[640px]:text-center">
              {!isPhone || phone.level === "home"
                ? t("settings.title")
                : phone.level === "section" ? sectionLabel : detailTitle}
            </strong>
            {!isPhone && (
              <TabsList
                variant="line"
                className="ml-4 shrink-0 self-center justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {sections.map((item) => {
                  const disabled = item.requiresProject && !cwd;
                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      disabled={disabled}
                      title={disabled ? t("settings.projectRequired") : item.label}
                      className="flex-none gap-1.5 rounded-none px-3 py-0 text-[12.5px] font-normal data-[state=active]:font-semibold"
                    >
                      <SettingsSectionIcon section={item.id} size={15} />
                      <span className="truncate">{item.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            )}
          </div>

          <main ref={mainRef} className="relative flex min-h-0 flex-1 overflow-hidden max-sm:flex-col">
            {/* A phone's home level lists the sections; its section and detail
                levels show the section itself. */}
            {isPhone && phone.level === "home" && (
              <nav aria-label={t("settings.title")} className="flex flex-1 flex-col overflow-y-auto pb-2">
                {sections.map((item) => {
                  const disabled = item.requiresProject && !cwd;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant="ghost"
                      className="flex min-h-[52px] w-full items-center justify-start gap-3.5 rounded-none border-b px-4 text-left text-[15px] font-normal text-foreground disabled:text-muted-foreground"
                      disabled={disabled}
                      aria-describedby={disabled ? `settings-phone-home-${item.id}-note` : undefined}
                      onClick={() => openSectionFromHome(item.id)}
                    >
                      <span className="text-muted-foreground"><SettingsSectionIcon section={item.id} size={20} /></span>
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span>{item.label}</span>
                        {disabled && (
                          <span id={`settings-phone-home-${item.id}-note`} className="text-xs font-normal text-muted-foreground">
                            {t("settings.projectRequired")}
                          </span>
                        )}
                      </span>
                      <ChevronRightIcon size={16} className="shrink-0 text-muted-foreground" />
                    </Button>
                  );
                })}
              </nav>
            )}
            {hostedSections}
          </main>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
