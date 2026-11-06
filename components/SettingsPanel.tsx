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
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
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
  ConfigCard,
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
  const isPhone = useIsMobile();
  // A form row's label: 13px, regular, per the draft's frow2 density.
  const rowLabelClass = "text-[13px] font-normal";

  // Sub-section content, shared by both shapes: a phone shows one at a time
  // behind its own list (the three-level stack); the desktop stacks them as
  // Cards in the scrolling body (§4.4).
  const themeGroup = (
    <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
      {THEME_OPTIONS.map((option) => {
        const selected = preference === option.id;
        return (
          <label
            key={option.id}
            data-theme-option={option.id}
            className="settings-theme-option"
          >
            <input
              type="radio"
              name="theme"
              value={option.id}
              checked={selected}
              onChange={() => setThemePreference(option.id)}
              className="sr-only"
            />
            <span className="settings-theme-swatch" aria-hidden="true" />
            <span className="settings-theme-option-label">{t(option.label)}</span>
          </label>
        );
      })}
    </div>
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
  // The keep-alive group is a card of its own (§7.3): description, two numeric rows.
  const keepAliveCard = (
    <ConfigCard title={t("settings.keepAlive")} description={t("settings.keepAliveDescription")}>
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
    </ConfigCard>
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
  const shellCard = shellSettings ? (
    <ConfigCard
      title={t("settings.shellTool")}
      description={t("settings.shellToolDescription")}
      footer={shellError ? <p role="alert" className="m-0 text-xs text-destructive">{shellError}</p> : undefined}
    >
      <Field orientation="horizontal">
        <FieldLabel className={rowLabelClass}>{t("settings.usePowerShell")}</FieldLabel>
        <ConfigSwitch
          checked={shellSettings.powerShellEnabled}
          loading={shellSaving}
          label={t("settings.usePowerShell")}
          onChange={(enabled) => void togglePowerShell(enabled)}
        />
      </Field>
    </ConfigCard>
  ) : null;
  const pushCard = (
    <ConfigCard
      title={t("settings.pushPermission")}
      description={t("settings.pushPermissionDescription")}
      footer={pushStatus ? (
        <p role="status" className={cn("m-0 text-xs", pushStatus.kind === "ok" ? "text-primary" : "text-destructive")}>
          {pushStatus.message}
        </p>
      ) : undefined}
    >
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
    </ConfigCard>
  );
  const languageGroup = (
    <div role="radiogroup" aria-label={t("common.language")} className="settings-language-options">
      {supportedLocales.map((plugin) => {
        const selected = locale === plugin.id;
        return (
          <button
            key={plugin.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLocale(plugin.id as typeof locale)}
            className="settings-language-option"
          >
            <span className="settings-language-radio">
              {selected && <span className="settings-language-radio-dot" />}
            </span>
            <span className="settings-language-label">{plugin.label}</span>
            <span className="settings-language-code">{plugin.id}</span>
          </button>
        );
      })}
    </div>
  );
  // The desktop body has no sub-navigation to hold the logout, so it closes the stack.
  const logOutBlock = webAuthEnabled ? (
    <>
      <div className="flex items-center justify-end">
        <ConfigButton
          variant="secondary"
          size="small"
          disabled={loggingOut}
          onClick={() => void logOut()}
        >
          <LogOutIcon size={14} strokeWidth={1.8} />
          {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
        </ConfigButton>
      </div>
      {logoutError && <p role="alert" className="m-0 text-xs text-destructive">{logoutError}</p>}
    </>
  ) : null;

  if (!isPhone) {
    return (
      <ConfigPanelShell embedded title={t("settings.general")} onClose={onClose}>
        <ConfigDetail>
          <ConfigDetailStack>
            <ConfigCard title={t("settings.appearance")}>{themeGroup}</ConfigCard>
            <ConfigCard title={t("settings.chat")}>{chatOptions}</ConfigCard>
            {keepAliveCard}
            <ConfigCard title={t("settings.sidebar")}>{sidebarContent}</ConfigCard>
            {shellCard}
            {pushCard}
            <ConfigCard title={t("common.language")}>{languageGroup}</ConfigCard>
            {logOutBlock}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigPanelShell>
    );
  }

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
          <ConfigDetailStack className="is-fill">
            <ConfigDetailHeader>
              <ConfigDetailTitle>{activeDetailLabel}</ConfigDetailTitle>
            </ConfigDetailHeader>
            {detail === "appearance" && themeGroup}
            {detail === "chat" && chatOptions}
            {detail === "chat" && keepAliveCard}
            {detail === "sidebar" && sidebarContent}
            {detail === "shell" && shellCard}
            {detail === "push" && pushCard}
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

  const sectionContent: Partial<Record<SettingsSection, ReactNode>> = {
    general: <GeneralSettings sessionId={sessionId} onClose={onClose} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} keepAliveConfig={keepAliveConfig} onKeepAliveConfigChange={onKeepAliveConfigChange} />,
    models: <ModelsConfig embedded cwd={cwd} onClose={onClose} />,
    // Visited sections stay mounted, so the ones whose answer depends on trust take the page's
    // status and load again in place when trusting from Settings › MCP changes it.
    skills: cwd ? <SkillsConfig embedded key={cwd} cwd={cwd} trust={projectTrust} onClose={onClose} /> : null,
    agents: cwd ? <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} /> : null,
    plugins: cwd ? <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} /> : null,
    // No project needed: the global mcp.json is listed alone, and a project adds its group.
    mcp: <McpConfig embedded key={cwd ?? ""} cwd={cwd} trust={projectTrust} onTrustProject={onOpenTrustDialog} onProjectTrustChanged={onProjectTrustChanged} onClose={onClose} />,
  };

  // The phone shows sections one level at a time; only a mounted one renders.
  const sectionHost = (id: SettingsSection) => mountedSections.has(id) && sectionContent[id] ? (
    <div
      key={id}
      hidden={section !== id || phone.level === "home"}
      className="settings-section-host"
    >
      {sectionContent[id]}
    </div>
  ) : null;

  const hostedSections = (
    <ConfigDetailNavigationContext.Provider value={detailNavigation}>
      {(["general", "models", "skills", "agents", "plugins", "mcp"] as const).map((id) => sectionHost(id))}
    </ConfigDetailNavigationContext.Provider>
  );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className={cn(
          // The overlay and surface sit above every in-page overlay (file panel,
          // minimap, widgets); the trust dialog mounts after and stacks above.
          "settings-phone-safe z-[1000] flex flex-col gap-0 overflow-hidden p-0",
          "h-[min(560px,100dvh)] w-[min(780px,calc(100vw-2rem))] max-w-none sm:max-w-none rounded-xl",
          "max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
        )}
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>

        {/* A phone's 50px header area: Back names where it returns, the title names
            the level shown; a desktop has no header (the rail carries the sections). */}
        {isPhone && (
          <div ref={headerRef} className="relative flex min-h-[50px] shrink-0 items-center border-b pr-[52px] pl-2">
            {phone.level !== "home" && (() => {
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
            <strong className="settings-dialog-title shrink-0 whitespace-nowrap text-[15px] text-foreground">
              {phone.level === "home"
                ? t("settings.title")
                : phone.level === "section" ? sectionLabel : detailTitle}
            </strong>
          </div>
        )}

        {/* Desktop: a vertical section rail (shadcn Tabs) beside the scrolling
            sections; a visited section stays mounted but hidden. */}
        {!isPhone && (
          <Tabs
            orientation="vertical"
            value={section}
            onValueChange={(value) => activateSection(value as SettingsSection)}
            className="flex min-h-0 flex-1 gap-0"
          >
            <div className="flex w-[188px] shrink-0 flex-col border-r">
              <div className="px-4 pt-4 pb-2 text-sm font-semibold">{t("settings.title")}</div>
              <TabsList variant="line" className="h-auto min-h-0 w-full flex-1 flex-col items-stretch gap-0.5 overflow-y-auto bg-transparent p-2">
                {sections.map((item) => {
                  const disabled = item.requiresProject && !cwd;
                  return (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      disabled={disabled}
                      title={disabled ? t("settings.projectRequired") : item.label}
                      className="h-9 w-full min-w-0 justify-start gap-2 px-2.5 text-[13px] font-normal data-[state=active]:bg-accent data-[state=active]:font-medium"
                    >
                      <SettingsSectionIcon section={item.id} size={15} />
                      <span className="truncate">{item.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
            <div className="settings-section-body min-h-0 min-w-0 flex-1 overflow-y-auto">
              {sections.map((item) => mountedSections.has(item.id) && sectionContent[item.id] ? (
                <TabsContent key={item.id} value={item.id} forceMount className="flex-1 data-[state=inactive]:hidden">
                  {sectionContent[item.id]}
                </TabsContent>
              ) : null)}
            </div>
          </Tabs>
        )}

        {/* Phone: one level at a time — home list, a section with its chip row,
            a row's detail (the Back button above). */}
        {isPhone && (
          <main ref={mainRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {phone.level === "home" && (
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
            {phone.level === "section" && (
              <nav aria-label={t("settings.title")} className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {sections.map((item) => {
                  const selected = section === item.id;
                  const disabled = item.requiresProject && !cwd;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant={selected ? "secondary" : "ghost"}
                      size="sm"
                      disabled={disabled}
                      title={disabled ? t("settings.projectRequired") : item.label}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => activateSection(item.id)}
                      className="h-8 shrink-0 gap-2 rounded-full px-3 text-[12.5px] font-normal"
                    >
                      <SettingsSectionIcon section={item.id} size={15} />
                      <span className="truncate">{item.label}</span>
                    </Button>
                  );
                })}
              </nav>
            )}
            {hostedSections}
          </main>
        )}
      </DialogContent>
    </Dialog>
  );
}
