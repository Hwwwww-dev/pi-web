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
import { focusModalPanel, listenForPanelEscape } from "@/lib/stacked-dialog";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { ThemeIcon } from "./ThemeIcon";
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
  // A label/value row inside a Card (§7.3): 44px keeps the touch target.
  const optionRowClass = "flex min-h-11 w-full items-center justify-between gap-4 rounded-sm bg-muted px-2.5 text-xs text-foreground";

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
            {detail === "appearance" && (
              <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
                {THEME_OPTIONS.map((option) => {
                  const selected = preference === option.id;
                  return (
                    <label
                      key={option.id}
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
                      <ThemeIcon preference={option.id} />
                      <span className="settings-theme-option-label">{t(option.label)}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {detail === "chat" && (
              <div className="settings-chat-options">
                <div className="settings-chat-option settings-chat-switch-option">
                  <span>{t("settings.thinkingExpandedDefault")}</span>
                  <ConfigSwitch
                    checked={thinkingExpanded}
                    label={t("settings.thinkingExpandedDefault")}
                    onChange={(enabled) => {
                      setThinkingExpandedByDefault(enabled);
                      setThinkingExpanded(enabled);
                    }}
                  />
                </div>
                <div className="settings-chat-option settings-chat-range-option">
                  <div className="settings-chat-range-header">
                    <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
                    <output htmlFor="settings-chat-content-width">{chatContentWidth}px</output>
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      className="settings-chat-reset"
                      title={t("settings.resetChatContentWidth")}
                      aria-label={t("settings.resetChatContentWidth")}
                      disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                      onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
                    >
                      <RotateCcwIcon size={14} strokeWidth={1.8} />
                    </ConfigButton>
                  </div>
                  <input
                    id="settings-chat-content-width"
                    type="range"
                    min={CHAT_CONTENT_WIDTH_MIN}
                    max={CHAT_CONTENT_WIDTH_MAX}
                    step={10}
                    value={chatContentWidth}
                    onChange={(event) => setChatContentWidth(Number(event.target.value))}
                  />
                </div>
                <FontSettings />
                <div className="settings-chat-option settings-chat-range-option">
                  <div className="settings-chat-range-header">
                    <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
                    <output htmlFor="settings-chat-content-font-size">{fontSize}px</output>
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      className="settings-chat-reset"
                      title={t("settings.resetChatContentFontSize")}
                      aria-label={t("settings.resetChatContentFontSize")}
                      disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                      onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
                    >
                      <RotateCcwIcon size={14} strokeWidth={1.8} />
                    </ConfigButton>
                  </div>
                  <input
                    id="settings-chat-content-font-size"
                    type="range"
                    min={CHAT_CONTENT_FONT_SIZE_MIN}
                    max={CHAT_CONTENT_FONT_SIZE_MAX}
                    step={1}
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value))}
                  />
                </div>
                <div className="settings-chat-option settings-chat-switch-option">
                  <span>{t("settings.quoteSelection")}</span>
                  <ConfigSwitch
                    checked={quoteSelectionEnabled}
                    label={t("settings.quoteSelection")}
                    onChange={onQuoteSelectionChange}
                  />
                </div>
                <div className="settings-chat-option settings-chat-switch-option">
                  <span>{t("settings.completionSound")}</span>
                  <ConfigSwitch
                    checked={soundEnabled}
                    label={t("settings.completionSound")}
                    onChange={() => onSoundToggle()}
                  />
                </div>
                <div className="settings-chat-option settings-chat-switch-option" role="radiogroup" aria-label={t("settings.enterSendMode")}>
                  <span>{t("settings.enterSendMode")}</span>
                  <div className="settings-send-mode-options">
                    <label className="settings-send-mode-option">
                      <input
                        type="radio"
                        name="enter-send-mode"
                        value="enter"
                        checked={enterSendMode === "enter"}
                        onChange={() => setEnterSendMode("enter")}
                        className="sr-only"
                      />
                      <span className="settings-send-mode-label">{t("settings.enterSendModeEnter")}</span>
                    </label>
                    <label className="settings-send-mode-option">
                      <input
                        type="radio"
                        name="enter-send-mode"
                        value="ctrlEnter"
                        checked={enterSendMode === "ctrlEnter"}
                        onChange={() => setEnterSendMode("ctrlEnter")}
                        className="sr-only"
                      />
                      <span className="settings-send-mode-label">{t("settings.enterSendModeCtrlEnter")}</span>
                    </label>
                  </div>
                </div>
                <div className="settings-chat-option settings-chat-switch-option">
                  <span>{t("settings.cacheMissNotices")}</span>
                  <ConfigSwitch
                    checked={cacheMissNotices === true}
                    loading={(cacheMissNotices === null && !cacheMissNoticesError) || cacheMissNoticesSaving}
                    label={t("settings.cacheMissNotices")}
                    describedBy="settings-cache-miss-notices-description"
                    onChange={(enabled) => void toggleCacheMissNotices(enabled)}
                  />
                </div>
              </div>
            )}

            {/* The keep-alive group is a section of its own (§7.3): description, two numeric rows. */}
            {detail === "chat" && (
              <ConfigCard description={t("settings.keepAliveDescription")}>
                <div className="flex flex-col gap-2">
                  <div className={optionRowClass}>
                    <label htmlFor="settings-keepalive-max-sessions">{t("settings.keepAliveMaxSessions")}</label>
                    <input
                      id="settings-keepalive-max-sessions"
                      type="number"
                      min={KEEP_ALIVE_CONFIG_LIMITS.maxSessions.min}
                      max={KEEP_ALIVE_CONFIG_LIMITS.maxSessions.max}
                      value={keepAliveConfig.maxSessions}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) onKeepAliveConfigChange({ ...keepAliveConfig, maxSessions: value });
                      }}
                    />
                  </div>
                  <div className={optionRowClass}>
                    <label htmlFor="settings-keepalive-idle-timeout">{t("settings.keepAliveIdleTimeout")}</label>
                    <input
                      id="settings-keepalive-idle-timeout"
                      type="number"
                      min={KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.min}
                      max={KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.max}
                      value={keepAliveConfig.idleTimeoutMinutes}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) onKeepAliveConfigChange({ ...keepAliveConfig, idleTimeoutMinutes: value });
                      }}
                    />
                  </div>
                </div>
              </ConfigCard>
            )}

            {detail === "sidebar" && (
              <div
                className="settings-chat-option settings-chat-switch-option"
                role="radiogroup"
                aria-label={t("settings.filesPlacement")}
                aria-describedby="settings-files-placement-description"
              >
                <span>{t("settings.filesPlacement")}</span>
                <div className="settings-send-mode-options">
                  <label className="settings-send-mode-option">
                    <input
                      type="radio"
                      name="files-placement"
                      value="below"
                      checked={filesPlacement === "below"}
                      onChange={() => setFilesPlacement("below")}
                      className="sr-only"
                    />
                    <span className="settings-send-mode-label">{t("settings.filesPlacementBelow")}</span>
                  </label>
                  <label className="settings-send-mode-option">
                    <input
                      type="radio"
                      name="files-placement"
                      value="tab"
                      checked={filesPlacement === "tab"}
                      onChange={() => setFilesPlacement("tab")}
                      className="sr-only"
                    />
                    <span className="settings-send-mode-label">{t("settings.filesPlacementTab")}</span>
                  </label>
                </div>
              </div>
            )}

            {detail === "shell" && shellSettings && (
              <ConfigCard
                description={t("settings.shellToolDescription")}
                footer={shellError ? <p role="alert" className="m-0 text-xs text-destructive">{shellError}</p> : undefined}
              >
                <div className={optionRowClass}>
                  <span>{t("settings.usePowerShell")}</span>
                  <ConfigSwitch
                    checked={shellSettings.powerShellEnabled}
                    loading={shellSaving}
                    label={t("settings.usePowerShell")}
                    onChange={(enabled) => void togglePowerShell(enabled)}
                  />
                </div>
              </ConfigCard>
            )}

            {detail === "push" && (
              <ConfigCard
                description={t("settings.pushPermissionDescription")}
                footer={pushStatus ? (
                  <p role="status" className={cn("m-0 text-xs", pushStatus.kind === "ok" ? "text-primary" : "text-destructive")}>
                    {pushStatus.message}
                  </p>
                ) : undefined}
              >
                <div className={optionRowClass}>
                  <span>{t("settings.pushPermission")}</span>
                  <ConfigButton
                    variant="secondary"
                    size="small"
                    disabled={pushRegistering}
                    onClick={() => void registerPush()}
                  >
                    {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
                  </ConfigButton>
                </div>
              </ConfigCard>
            )}

            {detail === "language" && (
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
            )}
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

  // Bubble phase, unless something nearer handled the key. The trust dialog,
  // which opens above Settings, takes Escape in the capture phase and stops it,
  // so one Escape closes that dialog and leaves Settings open.
  useEffect(() => listenForPanelEscape(document, onClose), [onClose]);

  // Focus moves into Settings as it opens and back to what had it once it closes. Left
  // on the chat composer (a bare /mcp opens Settings from there), Escape would reach the
  // composer first and stop a running agent, which also kept Settings open. A layout
  // effect, so the opener is read before a section focuses its own search box.
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => focusModalPanel(document, dialogRef.current, {
    restoreTextEntry: !window.matchMedia?.("(pointer: coarse)").matches,
  }), []);

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

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id || phone.level === "home"}
      data-phone-level={isPhone ? phone.level : undefined}
      className="settings-section-host"
    >
      {content}
    </div>
  ) : null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      tabIndex={-1}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="settings-dialog-backdrop"
    >
      <div className="settings-dialog-surface">
        <div ref={headerRef} className="settings-dialog-header">
          {isPhone && phone.level !== "home" && (() => {
            const backName = phone.level === "detail" ? sectionLabel : t("settings.title");
            return (
              <button
                type="button"
                className="settings-phone-back flex h-11 max-w-full shrink-0 items-center gap-0.5 bg-transparent pr-1.5 pl-0.5 text-[15px] text-primary"
                onClick={goUpPhoneLevel}
                aria-label={t("settings.backTo", { name: backName })}
              >
                <ChevronLeftIcon size={20} />
                <span className="truncate">{backName}</span>
              </button>
            );
          })()}
          {/* A phone names the level it shows: Settings, the section, the detail's row. */}
          <strong className="settings-dialog-title">
            {!isPhone || phone.level === "home"
              ? t("settings.title")
              : phone.level === "section" ? sectionLabel : detailTitle}
          </strong>
          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
        </div>

        <div className="settings-dialog-body">
          {/* §7.3: a desktop picks the section from a fixed rail on the left; a phone
              hides it (the home level lists the sections) and its header navigates. */}
          <nav aria-label={t("settings.title")} className="settings-section-rail">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "settings-section-rail-item flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    "disabled:cursor-default disabled:opacity-40",
                    selected
                      ? "bg-accent font-medium text-foreground"
                      : "bg-transparent text-muted-foreground enabled:hover:bg-secondary",
                  )}
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} size={16} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <main ref={mainRef} className="settings-dialog-main">
            {isPhone && phone.level === "home" && (
              <nav aria-label={t("settings.title")} className="settings-phone-home flex flex-1 flex-col overflow-y-auto pb-2">
                {sections.map((item) => {
                  const disabled = item.requiresProject && !cwd;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="settings-phone-home-item flex min-h-[52px] w-full items-center gap-3.5 border-b border-border bg-transparent pl-4.5 pr-4 text-left text-[15px] text-foreground active:bg-secondary disabled:cursor-default disabled:text-dim"
                      disabled={disabled}
                      aria-describedby={disabled ? `settings-phone-home-${item.id}-note` : undefined}
                      onClick={() => openSectionFromHome(item.id)}
                    >
                      <SettingsSectionIcon section={item.id} size={20} />
                      <span className="settings-phone-home-label flex min-w-0 flex-1 flex-col gap-0.5">
                        <span>{item.label}</span>
                        {disabled && (
                          <span id={`settings-phone-home-${item.id}-note`} className="settings-phone-home-note text-xs text-dim">
                            {t("settings.projectRequired")}
                          </span>
                        )}
                      </span>
                      <ChevronRightIcon size={16} className="settings-phone-home-chevron shrink-0 text-dim" />
                    </button>
                  );
                })}
              </nav>
            )}
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
          </main>
        </div>
      </div>
    </div>
  );
}
