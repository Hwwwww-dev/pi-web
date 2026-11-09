"use client";

import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import type { ButtonHTMLAttributes, ClipboardEvent, CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader } from "./ui/empty";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

type ConfigButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ConfigButtonSize = "small" | "default";

/** A settings button's variant on the stock Button: the names keep the panels' vocabulary. */
const CONFIG_BUTTON_VARIANTS = {
  primary: "default",
  secondary: "outline",
  // A settings destructive action is row-level: ghost red, not a solid wall
  // of red — the shadcn idiom for inline destructive actions.
  danger: "ghost",
  ghost: "ghost",
} as const;

interface ConfigPanelShellProps {
  embedded: boolean;
  title: string;
  subtitle?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  height?: string;
}

export function ConfigPanelShell({
  embedded,
  title,
  subtitle,
  closeLabel = "Close",
  onClose,
  children,
  width = 900,
  height = "78vh",
}: ConfigPanelShellProps) {
  const panelStyle = embedded
    ? undefined
    : ({
        "--config-panel-width": `${width}px`,
        "--config-panel-height": height,
      } as CSSProperties);

  return (
    <div
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={title}
      // A phone shows it full screen under the safe areas: the page's own
      // colour, no frame (the standalone fallback pads via env() insets).
      className={cn(
        "min-h-0 min-w-0",
        embedded
          ? "flex h-full w-full"
          : "fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 max-[640px]:bg-background max-[640px]:p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]",
      )}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
          embedded ? "h-full w-full" : cn(
            "h-[min(var(--config-panel-height),calc(100dvh-16px))] w-[min(var(--config-panel-width),calc(100vw-16px))] rounded-xl border border-border shadow-lg",
            "max-[640px]:h-full max-[640px]:max-h-full max-[640px]:w-full max-[640px]:max-w-full max-[640px]:rounded-none max-[640px]:border-0 max-[640px]:shadow-none",
          ),
        )}
        style={panelStyle}
      >
        {!embedded && (
          <div className="flex h-[50px] shrink-0 items-center gap-2.5 border-b pr-3 pl-4">
            <strong className="min-w-0 text-[15px]">{title}</strong>
            {subtitle && (
              <code className="min-w-0 overflow-hidden font-mono text-xs text-muted-foreground truncate" title={subtitle}>
                {subtitle}
              </code>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto max-[640px]:size-11"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * A phone shows a split view one pane at a time: the list, then the detail a
 * row opens (SettingsPanel keeps the level and a Back button). Without a
 * provider, as outside Settings, both panes stack as before.
 */
export interface ConfigDetailNavigation {
  detailOpen: boolean;
  openDetail: () => void;
  closeDetail: () => void;
  /** The active row's label, the phone's title over its detail. */
  reportDetailTitle: (title: string) => void;
}

export const ConfigDetailNavigationContext = createContext<ConfigDetailNavigation | null>(null);

/** Opens or closes the detail pane on a phone; no-ops elsewhere. */
export function useConfigDetailNavigation(): ConfigDetailNavigation {
  return useContext(ConfigDetailNavigationContext) ?? NO_DETAIL_NAVIGATION;
}

const NO_DETAIL_NAVIGATION: ConfigDetailNavigation = {
  detailOpen: false,
  openDetail: () => {},
  closeDetail: () => {},
  reportDetailTitle: () => {},
};

/**
 * An active row or add button names the open detail: its text, read after
 * each render, so a rename shows at once. A row's `.config-sidebar-text` is
 * its name without badges and counts.
 */
function useReportDetailTitle(active: boolean, ref: Ref<HTMLButtonElement> | undefined) {
  const { detailOpen, reportDetailTitle } = useConfigDetailNavigation();
  const nodeRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const node = nodeRef.current;
    // Settings keeps visited sections mounted, hidden: only the one on screen names its detail.
    if (!active || !detailOpen || !node || node.closest("[hidden]")) return;
    const text = (node.querySelector(".config-sidebar-text") ?? node).textContent?.trim();
    if (text) reportDetailTitle(text);
  });
  return (node: HTMLButtonElement | null) => {
    nodeRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
}

export function ConfigSplitView({ children, className }: { children: ReactNode; className?: string }) {
  const navigation = useContext(ConfigDetailNavigationContext);
  return (
    <div
      // `config-split-view` stays as the shell hook the MCP panel's tests read;
      // inside Settings it carries `data-pane`, which drives the phone panes.
      className={cn("config-split-view flex min-h-0 flex-1 flex-row overflow-hidden max-[640px]:flex-col", className)}
      data-pane={navigation ? (navigation.detailOpen ? "detail" : "list") : undefined}
    >
      {children}
    </div>
  );
}

export function ConfigSidebar({ children, className }: { children: ReactNode; className?: string }) {
  const navigation = useConfigDetailNavigation();
  // Inside Settings the split view shows one pane at a time on a phone: the
  // list fills the screen with rows for a finger, a row's detail replaces it.
  const pane = navigation === NO_DETAIL_NAVIGATION ? undefined : navigation.detailOpen ? "detail" : "list";
  return (
    <aside
      // `config-sidebar` stays as the phone pane layout hook (detail-navigation pins the attribute).
      className={cn(
        "config-sidebar flex w-full min-h-0 shrink-0 flex-col border-sidebar-border bg-sidebar md:w-[240px] md:border-r",
        pane
          ? cn(
              "max-[640px]:h-auto max-[640px]:flex-[1_1_auto] max-[640px]:border-b-0",
              pane === "detail" && "max-[640px]:hidden",
            )
          : "max-[640px]:h-[190px] max-[640px]:border-b max-[640px]:border-border max-[640px]:border-r-0",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>;
}

/** A sidebar group heading; `aside` sits at its right edge. */
export function ConfigSidebarGroupLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const navigation = useConfigDetailNavigation();
  return (
    // `config-sidebar-group-label` stays as the phone sizing hook (group-switch pins it).
    <div
      className={cn(
        "config-sidebar-group-label flex items-center gap-1.5 px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground",
        navigation !== NO_DETAIL_NAVIGATION && "max-[640px]:pt-2.5 max-[640px]:text-xs",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {aside}
    </div>
  );
}

/**
 * Switches every row of a sidebar group at once, for a group heading's
 * `aside`. Like the provider switch in the Models panel it is on only while
 * every row is, so a partial group reads as off beside its count and one click
 * completes it; on, a click switches the whole group off. `checked` replaces
 * that rule for a group holding rows no switch can turn on, which would
 * otherwise keep it off for good.
 */
export function ConfigSidebarGroupSwitch({
  enabled,
  total,
  checked,
  label,
  disabled = false,
  loading = false,
  describedBy,
  onChange,
}: {
  enabled: number;
  total: number;
  /** Whether the switch reads on; every row on (`enabled === total`) when absent. */
  checked?: boolean;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  /** The id of the visible text that says why the switch is disabled. */
  describedBy?: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="font-mono text-[11px] text-muted-foreground">{enabled}/{total}</span>
      <ConfigSwitch
        checked={checked ?? (total > 0 && enabled === total)}
        disabled={disabled}
        loading={loading}
        label={label}
        describedBy={describedBy}
        onChange={onChange}
      />
    </span>
  );
}

/** What the last group switch left undone, under that group's heading. */
export function ConfigSidebarGroupStatus({ error, note }: { error?: string | null; note?: string | null }) {
  if (!error && !note) return null;
  return (
    <div className="flex max-h-16 flex-col gap-0.5 overflow-y-auto px-2 pb-1 text-xs leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
      {note && <div role="status" className="text-muted-foreground">{note}</div>}
      {error && <div role="alert" className="text-destructive">{error}</div>}
    </div>
  );
}

/** A sidebar row; `ref` reaches its button (a prop since React 19), so a panel can move focus to it. */
/** A row's click opens its detail on a phone, unless the handler called `preventDefault()`. */
export function ConfigSidebarItem({
  active = false,
  className,
  children,
  onClick,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const navigation = useConfigDetailNavigation();
  const { openDetail } = navigation;
  const buttonRef = useReportDetailTitle(active, ref);
  return (
    <Button
      type="button"
      variant="ghost"
      {...props}
      ref={buttonRef}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) openDetail();
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        // `config-sidebar-item` stays as the phone row-height hook (McpConfig's tests read it).
        "config-sidebar-item h-9 w-full min-w-0 justify-start gap-2 px-2 text-left text-[13px] font-normal text-sidebar-foreground [&[aria-current='page']]:bg-sidebar-accent [&[aria-current='page']]:font-medium [&[aria-current='page']]:text-sidebar-accent-foreground",
        navigation !== NO_DETAIL_NAVIGATION && "max-[640px]:h-11 max-[640px]:min-h-11 max-[640px]:text-sm",
        className,
      )}
    >
      {children}
    </Button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={cn("block min-w-0 truncate text-[13px] leading-[1.35]", className)}
    />
  );
}

export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn("flex w-full min-w-0 flex-col gap-4", className)}
    />
  );
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn("flex min-h-8 min-w-0 flex-wrap items-center gap-4", className)}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn("flex min-w-0 flex-[1_1_160px] items-center gap-2", className)}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    // `config-detail-actions` stays as the hook the MCP panel's tests read.
    <div
      {...props}
      className={cn("config-detail-actions ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2", className)}
    />
  );
}

export function ConfigDetailTitle({ children, className }: { children: ReactNode; className?: string }) {
  // `config-detail-title` stays as the hook the MCP panel's tests read.
  return <div className={cn("config-detail-title text-[15px] leading-[1.35] font-semibold", className)}>{children}</div>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-xs leading-[1.35] font-medium text-muted-foreground">{children}</div>;
}

/**
 * A settings group as a Card (§4.4/§7.3): a titled section with an optional
 * description, its controls, and a footer for state (save target, trust
 * notice). Density stays tighter than the stock Card: settings panels are
 * dense surfaces (header 13.5px title, body a 10px-gap column).
 */
export function ConfigCard({
  title,
  description,
  actions,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Controls shown on the title row (a group's switches, an add button). */
  actions?: ReactNode;
  /** State line under the content (ConfigSaveTarget, ConfigTrustNotice). */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const hasHeader = title !== undefined || actions !== undefined || description !== undefined;
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-none", className)}>
      {hasHeader && (
        <CardHeader className="flex flex-row items-start justify-between gap-3 px-[16px] pt-[14px] pb-[4px]">
          <div className="min-w-0">
            {title !== undefined && <CardTitle className="text-[13.5px] leading-snug font-semibold">{title}</CardTitle>}
            {description !== undefined && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      {children !== undefined && <CardContent className="flex flex-col gap-2.5 px-4 pt-3.5 pb-3.5">{children}</CardContent>}
      {footer !== undefined && (
        <CardFooter className="justify-start px-4 pt-1 pb-3.5">{footer}</CardFooter>
      )}
    </Card>
  );
}

export function ConfigField({ label, children, style, ref }: { label: ReactNode; children: ReactNode; style?: CSSProperties; ref?: Ref<HTMLDivElement> }) {
  return (
    <Field ref={ref} style={style} className="min-w-0 gap-1.5">
      <FieldLabel className="text-[13px] font-medium text-muted-foreground">{label}</FieldLabel>
      {children}
    </Field>
  );
}

/**
 * A detail pane's two-column label/value grid. Each row is a
 * `ConfigDetailGridRow`; values wrap anywhere so a long path never widens the
 * pane. The `config-detail-grid*` names stay as the hooks the MCP panel's
 * tests read.
 */
export function ConfigDetailGrid({ children }: { children: ReactNode }) {
  return <div className="config-detail-grid grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px] leading-[1.5]">{children}</div>;
}

export function ConfigDetailGridRow({
  label,
  tone = "muted",
  mono = false,
  className,
  style,
  children,
}: {
  label: ReactNode;
  /** `plain` leaves the color to the value's own children or `style`. */
  tone?: "plain" | "muted" | "dim" | "error";
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <>
      <div className="config-detail-grid-label text-muted-foreground">{label}</div>
      <div
        className={cn(
          "config-detail-grid-value",
          tone === "plain" ? null : `is-${tone}`,
          mono ? "is-mono" : null,
          "min-w-0 [overflow-wrap:anywhere]",
          (tone === "muted" || tone === "dim") && "text-muted-foreground",
          tone === "error" && "text-destructive",
          mono && "font-mono",
          className,
        )}
        style={style}
      >
        {children}
      </div>
    </>
  );
}

/** Where a row lives (`global`, `project`, …); a project scope is tinted. */
export function ConfigScopeTag({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "shrink-0 rounded-[3px] px-1.5 py-px text-[10px] font-normal",
        // The project tint has no pi token, kept literal (as .config-scope-tag was).
        scope === "project" && "bg-[rgba(99,102,241,0.12)] text-[rgba(99,102,241,0.8)]",
      )}
    >
      {children}
    </Badge>
  );
}

export interface ConfigScopeOption<S extends string> {
  value: S;
  label: string;
  disabled?: boolean;
}

/**
 * Chooses the scope something is written to. Why an option is unavailable is
 * shown as text under the control, never only as a tooltip, which a touch
 * screen cannot show. `children` share the switch's line (the submit button,
 * where the result goes), so the reason sits under that whole line instead of
 * pulling them out of line with the switch.
 */
export function ConfigScopeSwitch<S extends string>({
  value,
  options,
  label,
  disabledReason,
  size = "default",
  onChange,
  children,
}: {
  value: S;
  options: readonly ConfigScopeOption<S>[];
  /** Names the group for assistive technology. */
  label: string;
  /** Shown while any option is disabled. */
  disabledReason?: string | null;
  size?: "default" | "small";
  onChange: (value: S) => void;
  children?: ReactNode;
}) {
  const reasonId = useId();
  const reason = disabledReason && options.some((option) => option.disabled) ? disabledReason : null;
  return (
    // The `config-scope-switch-*` names stay as the hooks the blocks tests read.
    <div className="config-scope-switch-field flex min-w-0 flex-col gap-1">
      <div className="config-scope-switch-row flex min-w-0 flex-wrap items-center gap-2.5">
        {/* Radix hands back "" when the active option is clicked again; keep the value. */}
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={value}
          aria-label={label}
          className={size === "small" ? "text-xs" : undefined}
          onValueChange={(next) => {
            if (next) onChange(next as S);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-describedby={option.disabled && reason ? reasonId : undefined}
              disabled={option.disabled}
              className={cn(
                size === "small"
                  ? "h-auto px-2.5 py-0.5 font-normal text-muted-foreground data-[state=on]:font-semibold data-[state=on]:text-foreground"
                  : "h-[30px] w-[76px] font-normal text-muted-foreground data-[state=on]:font-medium",
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {children}
      </div>
      {reason && (
        <span id={reasonId} className="config-scope-switch-reason max-w-80 text-xs leading-[1.4] text-muted-foreground">
          {reason}
        </span>
      )}
    </div>
  );
}

/**
 * A path that may wrap between folders: a break opportunity after each
 * separator, so a narrow pane breaks `~/.pi/agent/agents/` before the file
 * name instead of inside it. A split, not a lookbehind, which Safari 16.2
 * cannot parse.
 */
function pathWithBreaks(path: string): ReactNode[] {
  return path.split(/([\\/])/).map((part, index) => (
    part === "/" || part === "\\" ? <Fragment key={index}>{part}<wbr /></Fragment> : part
  ));
}

/**
 * Where an add or create pane saves: the scope switch and the path that
 * choice writes to, first under the pane's title. A detail pane shows its
 * scope tag and path in that place, so every settings section reads and
 * chooses a scope in the same spot. Why an option is unavailable is visible
 * text under the line; `children` follow it (a Trust button, what saving
 * there means).
 */
export function ConfigSaveTarget<S extends string>({
  value,
  options,
  label,
  path,
  disabledReason,
  onChange,
  children,
}: {
  value: S;
  options: readonly ConfigScopeOption<S>[];
  /** Names the group for assistive technology. */
  label: string;
  /** Where the chosen scope writes, shortened for display; a string wraps between folders. */
  path: ReactNode;
  disabledReason?: string | null;
  onChange: (value: S) => void;
  children?: ReactNode;
}) {
  return (
    // `config-save-target(-path)` stay as the hooks the blocks tests read.
    <div className="config-save-target flex min-w-0 flex-[1_1_auto] flex-col gap-1.5">
      <ConfigScopeSwitch
        value={value}
        options={options}
        label={label}
        disabledReason={disabledReason}
        size="small"
        onChange={onChange}
      >
        <span className="config-save-target-path min-w-0 flex-[1_1_14em] font-mono text-xs leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">
          {typeof path === "string" ? pathWithBreaks(path) : path}
        </span>
      </ConfigScopeSwitch>
      {children}
    </div>
  );
}

/**
 * Whether a key in a multiline add box submits it: Cmd/Ctrl+Enter, never a
 * plain Enter (a line break) and never while an input method composes, whose
 * Enter picks a candidate.
 */
export function addSourceKeySubmits(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return false;
  // Safari reports a composing Enter as keyCode 229 without isComposing.
  return event.nativeEvent?.isComposing !== true && event.keyCode !== 229;
}

/** A catalog an add pane installs from: its address, its label, and an optional icon before the label. */
export interface ConfigAddSourceCatalog {
  href: string;
  label: string;
  icon?: ReactNode;
}

/**
 * The top of every add pane: its title, the catalogs it installs from as
 * links at the right of the title, and where the result is saved (a
 * `ConfigSaveTarget`) under both.
 */
export function ConfigAddSourceHeading({
  title,
  catalogs,
  target,
}: {
  title: string;
  catalogs: readonly ConfigAddSourceCatalog[];
  target: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConfigDetailTitle>{title}</ConfigDetailTitle>
        {/* `config-add-source-catalog(s)` stay as the hooks the blocks tests read. */}
        <span className="config-add-source-catalogs flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {catalogs.map((catalog) => (
            <a
              key={catalog.href}
              href={catalog.href}
              target="_blank"
              rel="noopener noreferrer"
              className="config-add-source-catalog inline-flex items-center gap-1.5 text-xs text-primary no-underline whitespace-nowrap [&>svg]:shrink-0"
            >
              {catalog.icon}
              {catalog.label}
            </a>
          ))}
        </span>
      </div>
      {target}
    </div>
  );
}

/** An example the add form offers: its text, or its text beside what it is (a format, a client). */
export type ConfigAddSourceExample = string | { label: string; value: string };

/**
 * The add form of a list-detail panel: its heading (`ConfigAddSourceHeading`:
 * the title, the catalog links, where the result is saved), one source box, the
 * caller's controls (at least the submit button) as `children`, and examples
 * that fill the box. Enter submits while `canSubmit` holds; `normalizeValue` rewrites a
 * paste or the box on blur, e.g. to drop a pasted `pi install` prefix.
 *
 * `multiline` makes the box a textarea for pasting a whole config: Enter
 * inserts a line break and Cmd/Ctrl+Enter submits (never while an input method
 * composes), the paste-box rule. The box takes focus on mount except on a
 * coarse pointer, where a phone keyboard would cover what the panel says; the
 * single-line box keeps taking it everywhere.
 */
export function ConfigAddSourcePanel({
  title,
  catalogs,
  target,
  inputLabel,
  inputId,
  placeholder,
  value,
  canSubmit,
  normalizeValue,
  onValueChange,
  onSubmit,
  examplesLabel,
  examples,
  error,
  multiline = false,
  children,
}: {
  title: string;
  catalogs: readonly ConfigAddSourceCatalog[];
  /** Where the result is saved: a `ConfigSaveTarget`. */
  target: ReactNode;
  inputLabel: string;
  inputId?: string;
  placeholder: string;
  value: string;
  canSubmit: boolean;
  normalizeValue?: (value: string) => string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  examplesLabel: string;
  examples: readonly ConfigAddSourceExample[];
  error?: string | null;
  /** A textarea instead of one line: Enter adds a line, Cmd/Ctrl+Enter submits. */
  multiline?: boolean;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!multiline) {
      inputRef.current?.focus();
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
    textareaRef.current?.focus();
  }, [multiline]);

  const onPaste = (event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!normalizeValue) return;
    const pasted = event.clipboardData.getData("text");
    const normalized = normalizeValue(pasted);
    if (normalized === pasted) return;
    event.preventDefault();
    onValueChange(normalized);
  };

  return (
    <ConfigDetailStack className="min-h-full">
      <ConfigAddSourceHeading
        title={title}
        catalogs={catalogs}
        target={target}
      />

      <ConfigField label={inputLabel}>
        {multiline ? (
          <Textarea
            id={inputId}
            ref={textareaRef}
            value={value}
            aria-label={inputLabel}
            className="max-h-[40vh] min-h-24 resize-y whitespace-pre font-mono text-xs"
            placeholder={placeholder}
            rows={5}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => onValueChange(event.target.value)}
            onPaste={onPaste}
            onBlur={(event) => {
              if (normalizeValue) onValueChange(normalizeValue(event.currentTarget.value));
            }}
            onKeyDown={(event) => {
              if (!addSourceKeySubmits(event)) return;
              event.preventDefault();
              if (canSubmit) onSubmit();
            }}
          />
        ) : (
          <Input
            id={inputId}
            ref={inputRef}
            value={value}
            aria-label={inputLabel}
            className="font-mono text-xs"
            placeholder={placeholder}
            onChange={(event) => onValueChange(event.target.value)}
            onPaste={onPaste}
            onBlur={(event) => {
              if (normalizeValue) onValueChange(normalizeValue(event.currentTarget.value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) onSubmit();
            }}
          />
        )}
      </ConfigField>

      {children}

      {examples.length > 0 && (
        // `config-add-source-examples*` stay as the hooks the blocks tests read.
        <div className="config-add-source-examples flex flex-col gap-2">
          <div className="config-add-source-examples-label text-xs font-medium text-muted-foreground">{examplesLabel}</div>
          <div className="flex flex-col gap-1.5">
            {examples.map((example) => typeof example === "string" ? (
              <Button
                key={example}
                type="button"
                variant="outline"
                className="config-add-source-example h-auto min-h-[30px] w-full justify-start px-2.5 py-1.5 text-left font-mono text-xs font-normal whitespace-normal"
                onClick={() => onValueChange(example)}
              >
                {example}
              </Button>
            ) : (
              <Button
                key={example.value}
                type="button"
                variant="outline"
                className="config-add-source-example has-label grid h-auto min-h-[30px] w-full grid-cols-[minmax(0,15em)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-left font-normal max-[640px]:grid-cols-1"
                onClick={() => onValueChange(example.value)}
              >
                <span className="config-add-source-example-label text-xs text-muted-foreground">{example.label}</span>
                <span className="config-add-source-example-value font-mono text-xs">{example.value}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="config-add-source-error text-xs text-destructive whitespace-pre-wrap">
          {error}
        </div>
      )}
    </ConfigDetailStack>
  );
}

/** A banner above a panel's split view; `action` sits at its right edge. `id` lets a control it explains point at it.
    The `config-notice*` names stay as the hooks the MCP panel's tests read. */
export function ConfigNotice({ id, action, children }: { id?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div
      id={id}
      role="status"
      className={cn(
        "config-notice border-b bg-sidebar px-4 py-2 text-xs text-muted-foreground",
        action && "has-action flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5",
      )}
    >
      {action ? <span className="config-notice-text min-w-0">{children}</span> : children}
      {action}
    </div>
  );
}

/**
 * Says why a panel's project resources are not loaded. The trust button
 * appears only when the caller can act on it, so the panel never offers a
 * button that does nothing.
 */
export function ConfigTrustNotice({
  id,
  message,
  trustLabel,
  trusting = false,
  onTrust,
}: {
  id?: string;
  message: string;
  trustLabel?: string;
  trusting?: boolean;
  onTrust?: () => void;
}) {
  return (
    <ConfigNotice
      id={id}
      action={onTrust && trustLabel ? (
        <ConfigButton size="small" onClick={onTrust} disabled={trusting}>
          {trustLabel}
        </ConfigButton>
      ) : undefined}
    >
      {message}
    </ConfigNotice>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return (
    <Empty className="min-h-40">
      <EmptyHeader>
        <EmptyDescription className="text-xs">{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ConfigDetail({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  const navigation = useConfigDetailNavigation();
  const pane = navigation === NO_DETAIL_NAVIGATION ? undefined : navigation.detailOpen ? "detail" : "list";
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-y-auto p-6 text-[13px] leading-[1.55]",
        "max-[640px]:p-4",
        // Inside Settings a phone shows one pane at a time: the list hides its detail.
        pane === "list" && "max-[640px]:hidden",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="flex min-h-[52px] shrink-0 items-center gap-2 border-t px-3.5 py-2">
      <div className="min-w-0 flex-1 overflow-hidden text-xs text-muted-foreground">{status}</div>
      <div className="flex shrink-0 items-center justify-end gap-2 [&_[data-slot=button][data-size=sm]]:min-w-24">
        {children}
      </div>
    </footer>
  );
}

/**
 * A footer's one-line status. With `details` the summary opens a visible
 * list, so diagnostics are readable on a touch screen instead of hiding in a
 * tooltip. The `config-footer-status*` names stay as the hooks the MCP
 * panel's tests read.
 */
export function ConfigFooterStatus({
  summary,
  tone = "default",
  details,
}: {
  summary: ReactNode;
  tone?: "default" | "warning" | "error";
  details?: readonly ReactNode[];
}) {
  const className = cn(
    "config-footer-status-summary",
    tone !== "default" && `is-${tone}`,
    tone === "warning" && "text-warning",
    tone === "error" && "text-destructive",
  );
  if (!details?.length) return <span className={className}>{summary}</span>;
  return (
    // The official Collapsible carries the details list the native <details>
    // used to; the config-footer-status* classes stay as the MCP tests' hooks.
    <Collapsible className="config-footer-status-details">
      <CollapsibleTrigger className={cn(className, "w-fit cursor-pointer text-left")}>{summary}</CollapsibleTrigger>
      {/* forceMount keeps the list in the static SSR markup (the native
          <details> always rendered it); closed hides it client-side. */}
      <CollapsibleContent forceMount className="data-[state=closed]:hidden">
        <ul className="config-footer-status-list mt-1 max-h-[8.5em] overflow-y-auto pr-0 pl-4 text-muted-foreground list-disc [overflow-wrap:anywhere] whitespace-pre-wrap">
          {details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A button; `ref` reaches it (a prop since React 19), so a panel can move focus to it. */
export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button
      type="button"
      variant={CONFIG_BUTTON_VARIANTS[variant]}
      size={size === "small" ? "xs" : "sm"}
      // The settings density: 28px for `small`, where the stock xs runs 24px.
      className={cn(
        size === "small" && "h-7 px-2.5",
        variant === "danger" &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function ConfigSwitch({
  checked,
  disabled = false,
  loading = false,
  size = "default",
  label,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  size?: "default" | "small";
  label: string;
  /** The id of visible text about the switch, such as why it is disabled; never only its tooltip. */
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled || loading}
      onCheckedChange={onChange}
      size={size === "small" ? "sm" : "default"}
      aria-busy={loading || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      title={label}
      className="shrink-0"
    />
  );
}

/** The list's add button; like a row, its click opens the detail on a phone unless prevented. */
export function ConfigListAction({ active = false, children, className, onClick, ref, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const navigation = useConfigDetailNavigation();
  const { openDetail } = navigation;
  const buttonRef = useReportDetailTitle(active, ref);
  return (
    <div className="shrink-0 px-2 pb-2">
      <Button
        type="button"
        variant="ghost"
        {...props}
        ref={buttonRef}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) openDetail();
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          // `config-list-action-button` stays as the phone row-height hook (McpAddServer's tests read it).
          "config-list-action-button h-9 w-full min-w-0 justify-start gap-1.5 px-2 text-left text-[13px] font-normal text-muted-foreground",
          navigation !== NO_DETAIL_NAVIGATION && "max-[640px]:h-11 max-[640px]:min-h-11 max-[640px]:text-sm",
          className,
        )}
      >
        <PlusIcon size={13} strokeWidth={2} className="shrink-0" />
        {children}
      </Button>
    </div>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      // State reads from the dot's presence and tone, never from colour alone: the row says it too.
      className={cn("size-1.5 shrink-0 rounded-full bg-muted-foreground", active === false && "opacity-45")}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
