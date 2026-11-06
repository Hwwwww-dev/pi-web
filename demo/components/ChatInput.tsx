"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, memo, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedSubmission, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { ExtensionStatusItem, TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { getMarkdownListContinuation } from "@/lib/markdown-list-continuation";
import { quoteSeparator } from "@/lib/quoted-selection";
import { isBareMcpCommand, isBuiltinMcpCommand } from "@/lib/mcp-command";
import { ImagePreview } from "./ImagePreview";
import { DismissButton } from "./DismissButton";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEnterSendMode } from "@/hooks/useEnterSendMode";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import type { ToolPreset } from "@/lib/tool-presets";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";
import { ExtensionStatusButton, PermissiveModeChip } from "./ExtensionStatus";
import { splitExtensionStatuses } from "@/lib/extension-status";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  FolderClosedIcon,
  HistoryIcon,
  ImageIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShrinkIcon,
  SquareIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export { filterModelOptions } from "./ModelSelector";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  /** Sends the draft to a new side chat instead of the running agent. */
  onSideChat?: (message: string) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  /** Text-only composer without the session controls or outer spacing. */
  compact?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: string[] }[];
  modelError?: string | null;
  /** The session's folder, when it no longer exists (moved or renamed): said instead of a model error (#1422). */
  missingCwd?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  /** Every available model, once loaded for the selector's "all" scope. */
  allModelList?: { id: string; name: string; provider: string }[] | null;
  /** Set only while `enabledModels` narrows the list: loads `allModelList`. */
  onLoadAllModels?: () => void;
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  /** The model new sessions start with, starred in the model selector. */
  defaultModel?: { provider: string; modelId: string } | null;
  /** Saves a model as the default for new sessions and selects it here. */
  onSetDefaultModel?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  onDismissCompactError?: () => void;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** New session has not committed a thinking level; the button still shows the resolved default. */
  isAutoThinkingSelection?: boolean;
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  /** `defaultThinkingLevel` saved in settings, starred in the reasoning menu. */
  savedDefaultThinkingLevel?: string | null;
  /** Saves a reasoning level as the default for new sessions and selects it here. */
  onSetDefaultThinkingLevel?: (level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedSubmissions?: QueuedSubmission[];
  inputHistory?: string[];
  /** Steer a pending message into the running turn, or take it back for editing. */
  onQueuedAction?: (id: string, action: "toggle" | "edit" | "moveUp" | "moveDown") => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  /** Extension status texts; the permissive flag renders as its own chip. */
  extensionStatuses?: ExtensionStatusItem[];
  /** Files picked with the attach button, handled like files dropped onto the chat. Without it the button takes images only. */
  onAttachFiles?: (files: File[]) => void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  /** Insert at the caret as a paragraph of its own: a blockquote must start a line. */
  insertQuote: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  /** Takes a pending message back into the composer, text and attachments. */
  prependQueuedMessage: (text: string, images: ChatDraftImage[]) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: ChatDraftImage[], targetDraftKey?: string) => void;
  focus: () => void;
}

// "configured" sends no override, so the session follows settings.json defaultTools.
const TOOL_PRESETS = ["configured", "chat-only", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  configured: "configured",
  "chat-only": "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8;

// Auto-grow a textarea to fit its content, capped at 120px (the visual draft's
// composer box). The `auto` reset expands the box to its full content height,
// which silently resets its internal scrollTop — restore where the user
// actually was instead of snapping to the bottom: a snap fights the browser's
// scroll-to-caret and bounces while editing text above the fold once the
// scrollbar appears.
function autoresizeTextarea(ta: HTMLTextAreaElement) {
  const keepScroll = ta.scrollTop;
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight + 2, 120)}px`;
  ta.scrollTop = keepScroll;
}

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

export function cycleListIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

// Plain replacement for when execCommand is unavailable or refuses: no undo
// entry, but the mention still lands and React's onChange still fires.
function setTextareaRange(textarea: HTMLTextAreaElement, start: number, end: number, text: string): void {
  textarea.setRangeText(text, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// Replace [start, end) with `text` as native edits so the textarea's own
// undo/redo history records them. With a collapsed caret inside the range the
// typed prefix is deleted and the tail forward-deleted, so undo returns to
// what the user had typed.
export function replaceTextareaRange(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  cursorOffset = text.length,
): void {
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  textarea.focus();

  if (selectionStart === selectionEnd && start <= selectionStart && end >= selectionEnd) {
    const finalLength = textarea.value.length - (end - start) + text.length;
    for (let edits = selectionStart - start; edits > 0 && textarea.selectionStart > start; edits--) {
      if (!document.execCommand("delete")) break;
    }
    if (document.execCommand("insertText", false, text)) {
      for (let edits = end - selectionEnd; edits > 0 && textarea.value.length > finalLength; edits--) {
        if (!document.execCommand("forwardDelete")) break;
      }
    } else {
      // Whatever prefix the deletes left is still in [start, caret); the tail is untouched.
      setTextareaRange(textarea, start, textarea.selectionStart + (end - selectionEnd), text);
    }
  } else {
    textarea.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) setTextareaRange(textarea, start, end, text);
  }

  if (cursorOffset !== text.length) {
    textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
  }
}

export function replaceLinksWithMarkdown(
  text: string,
  links: Iterable<{ label: string; href: string; occurrence: number }>,
): string | null {
  let result = "";
  let searchFrom = 0;
  let replaced = false;

  for (const { label, href, occurrence } of links) {
    if (!label || !href) continue;
    let index = 0;
    for (let match = 0; match <= occurrence; match++) {
      index = text.indexOf(label, match ? index + label.length : 0);
      if (index < 0) break;
    }
    if (index < searchFrom) continue;
    const escapedLabel = label.replace(/([\\[\]])/g, "\\$1");
    const escapedHref = href.replace(/([\\()])/g, "\\$1");
    result += `${text.slice(searchFrom, index)}[${escapedLabel}](${escapedHref})`;
    searchFrom = index + label.length;
    replaced = true;
  }

  return replaced ? result + text.slice(searchFrom) : null;
}

/**
 * The composer's auto-grow step: fit the text to 120 px (the visual draft's
 * composer box), then let a scrollbar appear only when the text is still
 * taller than the box.
 *
 * The height comes from the value, not from scrollHeight: a wrapped
 * placeholder counts toward scrollHeight too, so an empty box would grow to
 * its own hint's lines. Only typed text scrolls, so a placeholder that
 * overflows the box stays cut off instead of showing a scrollbar.
 */
export function autoGrowTextarea(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${ta.value ? Math.min(ta.scrollHeight + 2, 120) : ta.clientHeight}px`;
  ta.style.overflowY = ta.value && ta.scrollHeight > ta.clientHeight ? "auto" : "hidden";
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function subscribeUpwardMenuMaxHeight(
  menu: HTMLElement,
  onChange: (height: number) => void,
): () => void {
  let frameId: number | null = null;
  const update = () => {
    frameId = null;
    onChange(getUpwardMenuMaxHeight(
      menu.getBoundingClientRect().bottom,
      getVisibleTopBoundary(menu),
    ));
  };
  const scheduleUpdate = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  };

  update();
  const parent = menu.parentElement;
  const layoutContainer = parent?.parentElement;
  const anchorObserver = typeof ResizeObserver === "undefined" || !parent
    ? null
    : new ResizeObserver(scheduleUpdate);
  if (parent) anchorObserver?.observe(parent);
  if (layoutContainer) anchorObserver?.observe(layoutContainer);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, true);

  return () => {
    anchorObserver?.disconnect();
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("scroll", scheduleUpdate, true);
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type BuiltinSlashCommand = {
  name: string;
  description: string;
  source: "builtin";
  availableWhileStreaming?: boolean;
};

type SlashCommandPaletteItem = SlashCommandInfo | BuiltinSlashCommand;

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommand[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "auto-compact", description: "chat.commandAutoCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
  { name: "clone", description: "chat.commandClone", source: "builtin" },
  // A side chat forks the session while it runs (ADR 0007): the primary use
  // case is a side question during a long parent run, so it must be offered
  // mid-stream. The fork is file-level, never touching the running agent.
  { name: "side", description: "chat.commandSide", source: "builtin", availableWhileStreaming: true },
];

function getBuiltinSlashCommand(message: string): BuiltinSlashCommand | undefined {
  const match = message.trim().match(/^\/([^\s]+)(?:\s|$)/);
  if (!match) return undefined;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]);
}

export function canRunBuiltinSlashCommandWhileStreaming(message: string): boolean {
  return getBuiltinSlashCommand(message)?.availableWhileStreaming === true;
}

/**
 * Whether a message sent while a run streams goes to the built-in handler
 * first: a built-in that may run then, or a bare `/mcp`, which opens
 * Settings › MCP when pi's built-in MCP extension owns it (useAgentSession)
 * and is otherwise sent as before.
 */
export function offersBuiltinSlashCommandWhileStreaming(message: string): boolean {
  return canRunBuiltinSlashCommandWhileStreaming(message) || isBareMcpCommand(message);
}

export function isExactSlashCommand(message: string, command: SlashCommandPaletteItem): boolean {
  return command.source === "builtin" && message.trim() === `/${command.name}`;
}

/**
 * Whether Enter on the highlighted palette entry submits the message rather
 * than completing it to "/name ": a built-in typed in full (while a run
 * streams, only one that may run then), or a bare `/mcp` on pi's built-in
 * `/mcp`, which opens Settings › MCP at once, as it does before the command
 * list has loaded. Every other extension command still takes a second Enter.
 */
export function submitsSlashCommandOnEnter(message: string, command: SlashCommandPaletteItem, isStreaming: boolean): boolean {
  if (command.source === "builtin") {
    return isExactSlashCommand(message, command) && (!isStreaming || command.availableWhileStreaming === true);
  }
  return isBuiltinMcpCommand(command) && isBareMcpCommand(message);
}

export const RUN_END_CLICK_GUARD_MS = 600;

/**
 * When a run ends, Compact (and the tools button) take the place Stop held in
 * the controls row, so the second click of a double click on Stop, or a click
 * aimed at Stop just as the run ends, lands on them. Such a pointer click is
 * ignored; a keyboard one (Enter/Space, `detail` 0) never is.
 */
export function isRunEndStrayClick(detail: number, msSinceRunEnd: number): boolean {
  return detail > 0 && msSinceRunEnd < RUN_END_CLICK_GUARD_MS;
}

export function canClearBuiltinCommandInput(message: string, imageCount: number, submittedMessage: string): boolean {
  return imageCount === 0 && message.trim() === submittedMessage;
}

/**
 * Whether the composer box stacks its draft above its buttons instead of sitting
 * them side by side. A phone has no room for the steer and follow-up buttons next
 * to the draft: in one row the two of them take more than half the width and the
 * placeholder is cut to "立即引导 / 排队后...". So while a run streams they move to
 * their own right-aligned row below the draft. Quote mode (`compact`) stacks for
 * its own reason: it is a short excerpt, not a full composer.
 */
export function stacksComposerLayout(compact: boolean, isMobile: boolean, isStreaming: boolean): boolean {
  return compact || (isMobile && isStreaming);
}

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

// pi's TUI matches a skill by its bare name (pi-tui's
// CombinedAutocompleteProvider), so `/copy` finds `skill:copy-text` by prefix;
// the full `skill:<name>` still matches a query that spells the prefix.
function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const bareName = command.source === "skill" && name.startsWith("skill:") ? name.slice("skill:".length) : name;
  if (bareName === query || name === query) return 0;
  if (bareName.startsWith(query) || name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

/**
 * The palette's matches for a lower-cased query. pi's TUI matches names only;
 * the palette searches descriptions too, but only when no name matches, so
 * `/copy` lists the built-in, not every skill whose description says "copy".
 */
export function filterSlashCommands(
  commands: SlashCommandPaletteItem[],
  query: string,
  t: (key: string) => string,
): SlashCommandPaletteItem[] {
  const ranked = commands.map((command) => ({ command, rank: slashMatchRank(command, query) }));
  const byName = ranked.filter(({ rank }) => rank < 3);
  const matches = byName.length > 0
    ? byName
    : ranked.filter(({ command }) => getSlashDescription(command, t).toLowerCase().includes(query));
  return matches
    .sort((a, b) => a.rank - b.rank
      || SLASH_SOURCE_ORDER[a.command.source] - SLASH_SOURCE_ORDER[b.command.source]
      || TEXT_COLLATOR.compare(a.command.name, b.command.name))
    .map(({ command }) => command);
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
  query = "",
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill" && !query
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

// Attached images go to pi as they are: pi resizes prompt images itself, following
// images.autoResize and the model's inputLimits.images.resize.
export function readImageFile(file: Blob, mimeType: string): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
      if (!data) {
        reject(new Error("Failed to read image"));
        return;
      }
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: draftImageDataUrl(image),
  };
}

export function draftImageDataUrl(image: ChatDraftImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    // SAFETY: an older pi release persisted image blocks with top-level
    // `data`/`mimeType` instead of `source`, so the flat shape is asserted and
    // then validated by the typeof checks below.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueueActionButton({ title, onClick, children }: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="size-5 rounded-full"
    >
      {children}
    </Button>
  );
}

function QueuedMessageRow({
  item,
  onAction,
  canMoveUp,
  canMoveDown,
}: {
  item: QueuedSubmission;
  onAction?: (id: string, action: "toggle" | "edit" | "moveUp" | "moveDown") => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { t } = useI18n();
  const isSteer = item.behavior === "steer";
  const behaviorLabel = isSteer ? t("chat.queueBehaviorSteer") : t("chat.queueBehaviorFollowUp");
  const behaviorChipClass = cn(
    "shrink-0 whitespace-nowrap px-[7px] py-px text-[10.5px] font-semibold leading-[1.4]",
    !isSteer && "bg-muted text-muted-foreground",
  );
  return (
    <div
      title={item.text}
      className={cn(
        "flex min-w-0 max-w-full items-center gap-2 self-start rounded-full py-[5px] pl-1.5 pr-2 text-[12.5px]",
        isSteer
          ? "border border-primary/45 bg-background text-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {item.images.length > 0 && (
        <span className="flex shrink-0 gap-[3px]">
          {item.images.map((image, index) => {
            const src = draftImageDataUrl(image);
            return (
              <ImagePreview key={`${item.id}-image-${index}`} src={src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="block size-[22px] rounded-full border border-border/60 object-cover"
                />
              </ImagePreview>
            );
          })}
        </span>
      )}
      {onAction ? (
        <Badge variant={isSteer ? "default" : "ghost"} className={behaviorChipClass} asChild>
          <Button
            type="button"
            variant="ghost"
            title={t("chat.queueBehaviorHint")}
            onClick={() => onAction(item.id, "toggle")}
            className={cn(
              "h-auto cursor-pointer rounded-full transition-opacity hover:opacity-80",
              isSteer ? "hover:bg-primary hover:text-primary-foreground" : "hover:bg-muted hover:text-muted-foreground",
            )}
          >
            {behaviorLabel}
          </Button>
        </Badge>
      ) : (
        <Badge variant={isSteer ? "default" : "ghost"} className={behaviorChipClass}>{behaviorLabel}</Badge>
      )}
      <span className="min-w-0 truncate">{item.text}</span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {onAction && canMoveUp && (
          <QueueActionButton title={t("chat.moveQueuedUp")} onClick={() => onAction(item.id, "moveUp")}>
            <ChevronUpIcon strokeWidth={2} aria-hidden="true" />
          </QueueActionButton>
        )}
        {onAction && canMoveDown && (
          <QueueActionButton title={t("chat.moveQueuedDown")} onClick={() => onAction(item.id, "moveDown")}>
            <ChevronDownIcon strokeWidth={2} aria-hidden="true" />
          </QueueActionButton>
        )}
        {onAction && (
          <QueueActionButton title={t("chat.editQueuedTitle")} onClick={() => onAction(item.id, "edit")}>
            <PencilIcon strokeWidth={2} aria-hidden="true" />
          </QueueActionButton>
        )}
      </span>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body, onClose }: { tone: "error" | "warning"; title: string; body: string; onClose?: () => void }) {
  const { t } = useI18n();
  return (
    <Alert
      role="alert"
      variant={tone === "error" ? "destructive" : "warning"}
      className={cn(
        "max-h-[120px] items-start gap-x-2 overflow-y-auto rounded-md px-2.5 py-1.5 text-xs leading-[1.45]",
        tone === "error" && "border-destructive/30 bg-destructive/[0.07]",
      )}
    >
      <TriangleAlertIcon />
      <AlertTitle className="min-h-0 font-semibold">{title}</AlertTitle>
      <AlertDescription className="whitespace-pre-wrap text-xs wrap-anywhere">{body}</AlertDescription>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t("sidebar.dismiss")}
          className="absolute top-1 right-1 size-5 text-current opacity-70 hover:opacity-100 hover:bg-transparent"
        >
          <XIcon className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
        </Button>
      )}
    </Alert>
  );
}

/** The session's folder no longer exists: nothing was sent, and no model was asked (#1422). */
export function MissingCwdBanner({ cwd }: { cwd?: string | null }) {
  const { t } = useI18n();
  if (!cwd) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.cwdMissingTitle")} body={t("chat.cwdMissingBody", { cwd })} />;
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.modelError")} body={error} />;
}

/** True when the selected model is known to accept image input (#584). Unknown modality info never blocks the user. */
export function modelSupportsImageInput(
  model: { provider: string; modelId: string } | null | undefined,
  modelList: { id: string; name: string; provider: string; input?: string[] }[] | undefined
): boolean {
  if (!model) return true;
  const entry = modelList?.find((m) => m.provider === model.provider && m.id === model.modelId);
  if (!entry || !entry.input) return true;
  return entry.input.includes("image");
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={warnings.length > 1 ? t("chat.modelScopeWarnings") : t("chat.modelScopeWarning")}
      body={warnings.join("\n")}
    />
  );
}

// memo: the composer re-renders on every streamed chunk otherwise. Its props
// are hook state and stable useCallback handlers, so skipping equal-prop
// renders keeps the queue rows (and their image thumbnails) from re-rendering
// per chunk while streaming.
export const ChatInput = memo(forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onSideChat, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, missingCwd, modelScopeWarnings, allModelList, onLoadAllModels, onModelChange, modelSwitching,
  defaultModel, onSetDefaultModel,
  onCompact, onAbortCompaction, isCompacting, compactError, onDismissCompactError, compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, isAutoThinkingSelection = false, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  savedDefaultThinkingLevel, onSetDefaultThinkingLevel,
  retryInfo, queuedSubmissions, inputHistory = [], onQueuedAction,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  extensionStatuses,
  onAttachFiles,
  compact = false,
}: Props, ref) {
  const { t } = useI18n();
  const { fontSize } = useChatAppearance();
  const { ui: uiFontFamily, uiWeight } = useFontPreferences();
  const isMobile = useIsMobile();
  const enterSendMode = useEnterSendMode();
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atMenuMaxHeight, setAtMenuMaxHeight] = useState<number | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [imageWarningDismissed, setImageWarningDismissed] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [builtinCommandPending, setBuiltinCommandPending] = useState(false);
  const builtinCommandPendingRef = useRef(false);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atMenuRef = useRef<HTMLDivElement>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  // Tail of in-flight paste decodes: submissions await it so attachments ride
  // with the message instead of popping back into the cleared composer.
  const pendingImageTailRef = useRef<Promise<void>>(Promise.resolve());
  const [attachError, setAttachError] = useState<string | null>(null);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        autoresizeTextarea(ta);
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        autoresizeTextarea(ta);
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        autoresizeTextarea(ta);
      });
    },
    prependQueuedMessage(text: string, images: ChatDraftImage[]) {
      if (!text.trim() && images.length === 0) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Same restore rule as prependText, plus the attachments that were
      // queued with the message.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (images.length > 0) {
        setAttachedImages((prev) => {
          const restored = draftImagesToAttachedImages(images)
            .slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
          const next = restored.length > 0 ? [...restored, ...prev] : prev;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const input = textareaRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(combined.length, combined.length);
        autoresizeTextarea(input);
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(text: string, images?: ChatDraftImage[], targetDraftKey?: string) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        autoresizeTextarea(ta);
      });
    },
    // The caret goes after a draft that came back, so typing continues it.
    focus() {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      replaceTextareaRange(ta, start, end, sep + text);
      setAtQuery(null);
    },
    insertQuote(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + quoteSeparator(v) + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      replaceTextareaRange(ta, start, end, quoteSeparator(ta.value.slice(0, start)) + text);
      setAtQuery(null);
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback((files: File[]) => {
    if (compact) return;
    const imageTypeFiles = files.filter((f) => f.type.startsWith("image/"));
    const oversizeCount = imageTypeFiles.filter((f) => f.size > MAX_ATTACHED_IMAGE_BYTES).length;
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const withinLimitFiles = imageTypeFiles.filter((f) => f.size <= MAX_ATTACHED_IMAGE_BYTES);
    const cappedCount = withinLimitFiles.length - Math.min(withinLimitFiles.length, remaining);
    const imageFiles = withinLimitFiles.slice(0, remaining);
    const notices: string[] = [];
    if (oversizeCount) notices.push(t("chat.attachTooLarge", { count: oversizeCount }));
    if (cappedCount) notices.push(t("chat.attachLimit", { count: cappedCount, max: MAX_ATTACHED_IMAGES }));
    if (notices.length) setAttachError(notices.join(" "));
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    // Settle per file: one unreadable image must not swallow the batch.
    const run = pendingImageTailRef.current.then(async () => {
      try {
        const settled = await Promise.allSettled(
          imageFiles.map(async (file) => ({
            ...await readImageFile(file, file.type),
            previewUrl: URL.createObjectURL(file),
          })),
        );
        const newImages = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
        if (newImages.length) {
          setAttachedImages((prev) => {
            const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
            newImages.slice(accepted.length).forEach(revokeImagePreview);
            const next = [...prev, ...accepted];
            attachedImagesRef.current = next;
            return next;
          });
        }
        const failedCount = settled.filter((s) => s.status === "rejected").length;
        if (failedCount) setAttachError(t("chat.attachFailed", { count: failedCount }));
      } finally {
        pendingImageCountRef.current -= imageFiles.length;
      }
    });
    pendingImageTailRef.current = run.catch(() => {});
  }, [compact, t]);

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Clearing the value lets the same file be picked again.
    e.target.value = "";
    if (onAttachFiles) onAttachFiles(files);
    else processImageFiles(files);
  }, [onAttachFiles, processImageFiles]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachError(null);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    setValue(nextValue);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const keepScroll = ta.scrollTop;
    ta.style.height = "auto";
    if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    ta.scrollTop = keepScroll;
  }, []);

  useLayoutEffect(resizeTextarea, [value, fontSize, uiFontFamily, uiWeight, resizeTextarea]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let previousWidth = -1;
    const observer = new ResizeObserver(([entry]) => {
      // Height updates also notify the observer; only remeasure on width changes.
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      resizeTextarea();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Shift+Enter on desktop, Enter on mobile keyboards: every newline the
    // textarea inserts arrives here, while IME confirmations and sends do not.
    const continueList = (event: InputEvent) => {
      if (event.inputType !== "insertLineBreak" || event.isComposing) return;
      const edit = getMarkdownListContinuation(ta.value, ta.selectionStart, ta.selectionEnd);
      if (!edit) return;
      event.preventDefault();
      ta.setSelectionRange(edit.start, edit.end);
      // insertText keeps the edit on the native undo stack and fires the input
      // event that updates the controlled value.
      document.execCommand(edit.text ? "insertText" : "delete", false, edit.text);
    };
    ta.addEventListener("beforeinput", continueList);
    return () => ta.removeEventListener("beforeinput", continueList);
  }, []);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const runBuiltinCommand = useCallback(async (msg: string): Promise<boolean> => {
    if (attachedImages.length || !msg.startsWith("/") || !onBuiltinCommand) return false;
    if (builtinCommandPendingRef.current) return true;
    builtinCommandPendingRef.current = true;
    setBuiltinCommandPending(true);
    try {
      const result = await onBuiltinCommand(msg);
      if (!result.handled) return false;
      if (!result.error && canClearBuiltinCommandInput(valueRef.current, attachedImagesRef.current.length, msg)) clearInput();
      return true;
    } finally {
      builtinCommandPendingRef.current = false;
      setBuiltinCommandPending(false);
    }
  }, [attachedImages.length, clearInput, onBuiltinCommand]);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    onAudioUnlock?.();
    // A paste still decoding must ride along, not pop back into the cleared
    // composer after the message left.
    await pendingImageTailRef.current;
    const builtinAllowed = !isStreaming || offersBuiltinSlashCommandWhileStreaming(msg);
    if (builtinAllowed && await runBuiltinCommand(msg)) return;
    if (isStreaming) return;
    const images = attachedImagesRef.current.length ? attachedImagesRef.current : undefined;
    if (!msg && !images) return;
    clearInput();
    onSend(msg, images);
  }, [value, attachedImages, isStreaming, runBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = !compact && value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const builtinCommands = isStreaming
      ? BUILTIN_SLASH_COMMANDS.filter((command) => command.availableWhileStreaming)
      : BUILTIN_SLASH_COMMANDS;
    const commands = [...builtinCommands, ...(slashCommands ?? [])];
    return filterSlashCommands(commands, slashQuery, t);
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy, slashQuery ?? "");

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canSubmit = hasInputText || attachedImages.length > 0;
  // Warn when images are attached but the selected model is known not to accept
  // image input (#584), including a resolved default. Unknown models stay silent.
  const showImageUnsupportedWarning = (
    attachedImages.length > 0
    && !modelSupportsImageInput(model, modelList)
    && !imageWarningDismissed
  );
  useEffect(() => {
    if (attachedImages.length === 0) setImageWarningDismissed(false);
  }, [attachedImages.length]);

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? ta.value.length;
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): replace that old quote too, since the insertion has one.
    const replaceEnd = cursor + (atQuery.quoted && ta.value[cursor] === '"' ? 1 : 0);
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newPos = atQuery.start + insert.cursorOffset;
    replaceTextareaRange(ta, atQuery.start, replaceEnd, insert.text, insert.cursorOffset);
    // The native input event updates the controlled value. Re-derive using the
    // adjusted caret because quoted directories place it before the last quote.
    setAtQuery(extractAtQuery(ta.value.slice(0, newPos)));
  }, [atQuery]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      autoresizeTextarea(ta);
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      autoresizeTextarea(ta);
    });
  }, []);

  // While a turn runs the composer queues against the current run: a plain
  // send steers when a steer handler exists, Alt/Option+Enter always follows
  // up. pi delivers both when the turn ends.
  const sendToSideChat = useCallback(() => {
    const msg = value.trim();
    if (!msg || attachedImages.length || !onSideChat) return;
    clearInput();
    onSideChat(msg);
  }, [value, attachedImages, onSideChat, clearInput]);

  const queueFollowUp = useCallback(async (mode: "steer" | "followup" = "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    // pi's run queue carries texts only — an images-only submission is accepted
    // by the API but never queued (verified against pi 1.5.0), so it would
    // silently vanish. Keep the composer instead.
    if (!msg && attachedImages.length) return;
    onAudioUnlock?.();
    // A paste still decoding must ride along, not pop back into the cleared
    // composer after the message left.
    await pendingImageTailRef.current;
    const images = attachedImagesRef.current.length ? attachedImagesRef.current : undefined;
    const queue = () => {
      const streamingBehavior = mode === "steer" ? "steer" : "followUp";
      if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
        clearInput();
        onPromptWithStreamingBehavior(msg, streamingBehavior, images);
        return;
      }
      clearInput();
      if (mode === "steer" && onSteer) {
        onSteer(msg, images);
      } else if (onFollowUp) {
        onFollowUp(msg, images);
      }
    };
    if (!attachedImages.length && onBuiltinCommand && canRunBuiltinSlashCommandWhileStreaming(msg)) {
      void runBuiltinCommand(msg);
      return;
    }
    if (!attachedImages.length && onBuiltinCommand && isBareMcpCommand(msg)) {
      // Settings › MCP opens when pi's built-in MCP extension owns /mcp; another
      // extension's /mcp is queued as before. The composer is disabled meanwhile.
      void runBuiltinCommand(msg).then((handled) => {
        if (!handled) queue();
      }, () => queue());
      return;
    }
    queue();
  }, [value, attachedImages, onBuiltinCommand, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock, runBuiltinCommand]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const enterKey = e.key === "Enter" && !e.shiftKey;
      const sendShortcut = isMobile || enterSendMode === "ctrlEnter"
        ? enterKey && (e.ctrlKey || e.metaKey)
        : enterKey;
      // Popup menus and the IME guard take plain Enter in either send mode on a
      // desktop keyboard. Mobile keyboards insert a line break on Enter, so they
      // keep using the send shortcut there.
      const acceptShortcut = isMobile ? sendShortcut : enterKey;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (acceptShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || acceptShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        const selectedCommand = displayedSlashCommands[slashActiveIndex];
        if (e.key === "Tab" && selectedCommand) {
          e.preventDefault();
          applySlashCommand(selectedCommand);
          return;
        }
        if (acceptShortcut && selectedCommand) {
          e.preventDefault();
          if (sendShortcut && submitsSlashCommandOnEnter(value, selectedCommand, isStreaming)) {
            setSlashMenuOpen(false);
            void handleSend();
          } else {
            applySlashCommand(selectedCommand);
          }
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || acceptShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Queue against the current run. Dev semantics: plain and Alt+Enter
          // follow up. In Ctrl+Enter mode the send chord (Cmd/Ctrl+Enter)
          // steers instead — it is the mode's "send now" gesture. With no
          // follow-up handler there is nothing to queue behind, so it sends.
          const steer = enterSendMode === "ctrlEnter" && !e.altKey && onSteer;
          if (!steer && !onFollowUp) {
            handleSend();
          } else {
            queueFollowUp(steer ? "steer" : "followup");
          }
        } else {
          handleSend();
        }
      }
    },
    [isMobile, enterSendMode, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, queueFollowUp, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    autoresizeTextarea(ta);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!compact && imageItems.length) {
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      processImageFiles(files);
      return;
    }

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html || !text) return;
    const document = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(document.querySelectorAll("a[href]"), (link) => {
      const label = link.textContent ?? "";
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.setEndBefore(link);
      return {
        label,
        href: link.getAttribute("href")?.trim() ?? "",
        occurrence: label ? range.toString().split(label).length - 1 : 0,
      };
    });
    const markdown = replaceLinksWithMarkdown(text, links);
    if (markdown === null) return;

    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const nextValue = ta.value.slice(0, start) + markdown + ta.value.slice(ta.selectionEnd);
    e.preventDefault();
    valueRef.current = nextValue;
    setValue(nextValue);
    setHistoryMenuOpen(false);
    updateAtQuery(nextValue, start + markdown.length);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }, [compact, processImageFiles, updateAtQuery]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }
    const menu = slashMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [slashMenuOpen, slashQuery]);

  useLayoutEffect(() => {
    if (!atMenuOpen || atQuery === null) {
      setAtMenuMaxHeight(null);
      return;
    }
    const menu = atMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setAtMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [atMenuOpen, atQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelSelectorOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
    : null;
  const titleCaseLabel = (value: string) =>
    value
      .split(/[-_ ]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const resolvedThinkingLevel = thinkingLevel && thinkingLevel !== "auto" ? thinkingLevel : null;
  const thinkingDisplayLabel = (() => {
    const lvl = resolvedThinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return titleCaseLabel(lvl);
    return titleCaseLabel(thinkingLevelMap[lvl] ?? lvl);
  })();
  const rawToolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "configured"))?.[0] ?? "configured";
  const toolPresetLabel = rawToolPresetLabel === "chat-only" ? t("chat.chatOnly") : titleCaseLabel(rawToolPresetLabel);

  // Thinking selects inside the model popover now (pi's /model keeps reasoning
  // beside the model); the row shows no text pill. The model pill's CPU icon
  // carries the state instead — a pinned level lights up in primary, off dims,
  // auto stays muted — and the popover section below does the selecting.
  const thinkingPinned = !isAutoThinkingSelection && resolvedThinkingLevel != null;
  const thinkingIconTone = thinkingPinned ? "text-primary" : thinkingLevel === "off" ? "opacity-45" : undefined;
  const thinkingSection = onThinkingLevelChange && (
    <div role="radiogroup" aria-label={t("chat.changeReasoningLabel")} className="flex flex-col">
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("chat.thinkingSection")}</div>
      {THINKING_LEVELS.filter((lvl) => {
        if (!availableThinkingLevels) return true;
        if (lvl === "auto") return true;
        return availableThinkingLevels.includes(lvl);
      }).map((lvl) => {
        const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
        const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
        const displayLabel = titleCaseLabel((mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl);
        const showOriginal = mappedVal != null && mappedVal !== lvl;
        const selected = lvl === "auto" ? isAutoThinkingSelection : (!isAutoThinkingSelection && resolvedThinkingLevel === lvl);
        return (
          <Button
            key={lvl}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              if (lvl === "auto") {
                if (!isAutoThinkingSelection) onThinkingLevelChange("auto");
                return;
              }
              // Re-selecting the pinned level keeps the popover open, like the
              // old menu's no-op onSelect guard.
              if (!isAutoThinkingSelection && resolvedThinkingLevel === lvl) return;
              onThinkingLevelChange(lvl as typeof THINKING_LEVELS[number]);
            }}
            className={cn(
              "flex h-auto w-full cursor-pointer justify-start rounded-sm px-2 py-1 text-left text-xs font-normal",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <CheckIcon className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} strokeWidth={2.2} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {displayLabel}
              {showOriginal && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({lvl})</span>}
            </span>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">{desc}</span>
            {onSetDefaultThinkingLevel && lvl !== "auto" && (
              <span
                role={savedDefaultThinkingLevel === lvl ? "img" : "button"}
                aria-label={savedDefaultThinkingLevel === lvl ? t("chat.defaultThinking") : t("chat.saveDefaultThinking")}
                title={savedDefaultThinkingLevel === lvl ? t("chat.defaultThinking") : t("chat.saveDefaultThinking")}
                aria-hidden={savedDefaultThinkingLevel === lvl ? undefined : "true"}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetDefaultThinkingLevel(lvl);
                }}
                className={cn(
                  "pointer-events-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground",
                  savedDefaultThinkingLevel === lvl && "opacity-100",
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={savedDefaultThinkingLevel === lvl ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" className="size-3 shrink-0">
                  <polygon points="12 2.5 14.9 8.6 21.5 9.4 16.6 13.9 17.9 20.5 12 17.2 6.1 20.5 7.4 13.9 2.5 9.4 9.1 8.6" />
                </svg>
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );

  // The history menu keeps its own anchor positioning (it is a typing-driven
  // overlay, not a trigger menu), so it closes on outside click like the
  // Radix popovers above do.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // The run-end stray-click guard's pure helper (isRunEndStrayClick) stays
  // exported for its tests; the composer currently has no consumer wiring.

  const permissiveStatus = compact ? null : splitExtensionStatuses(extensionStatuses ?? []).permissive;

  // The composer's main button follows the input: a message waiting to be
  // sent is always the primary action — while a turn runs that queues a
  // follow-up, the same thing Enter does — and only an empty composer
  // leaves it as stop. Idle stays muted; anything sendable or running is
  // primary. It is a sibling of the pill row so it can never be squeezed out.
  const sendCluster = isStreaming && !canSubmit ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="default"
          size="icon"
          onClick={onAbort}
          aria-label={t("chat.stopAgent")}
          className="size-9 shrink-0 rounded-full"
        >
          {/* While the run streams the circle stops it, until the user types
              something to send. */}
          <SquareIcon data-icon className="size-3.5 fill-current" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("chat.stopAgent")}</TooltipContent>
    </Tooltip>
  ) : (
    <div className="flex shrink-0 items-center gap-1">
      {isStreaming && onSideChat && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={sendToSideChat}
              disabled={!value.trim() || attachedImages.length > 0}
              aria-label={t("chat.sideChat")}
              className="size-9 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <MessagesSquareIcon data-icon strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.sideChatHint")}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={isStreaming ? () => queueFollowUp() : handleSend}
            disabled={!canSubmit}
            aria-label={t("chat.send")}
            className={cn(
              "size-9 shrink-0 rounded-full",
              canSubmit || isStreaming
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground",
            )}
          >
            <ArrowUpIcon data-icon strokeWidth={2.2} aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("chat.send")}</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <fieldset
      disabled={builtinCommandPending}
      aria-busy={builtinCommandPending}
      className={cn(
        "m-0 border-0 bg-transparent p-0",
        compact
          ? "shrink-0"
          // Composer gutter and bottom inset from the visual draft (§4.3); the
          // horizontal padding matches the message column's (ChatWindow).
          : "chat-input-shell flex min-h-0 flex-col px-7 pb-3.5 pt-1.5 max-sm:px-2.5 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]",
        builtinCommandPending && "opacity-50 transition-opacity duration-150",
      )}
    >
      {/* Hidden file input. No `capture`: phones still offer the photo library and camera. */}
      {!compact && <input
        ref={fileInputRef}
        type="file"
        accept={onAttachFiles ? undefined : "image/*"}
        multiple
        className="hidden"
        onChange={handleFilePick}
      />}
      {/* Column width matches the message column's drafted 700px. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[700px] flex-col gap-2">
        <MissingCwdBanner cwd={missingCwd} />
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {showImageUnsupportedWarning && (() => {
          const entry = modelList?.find((m) => m.provider === model?.provider && m.id === model?.modelId);
          return (
            <ModelNoticeBanner
              tone="warning"
              title={t("chat.imageNotSupportedTitle")}
              body={t("chat.imageNotSupportedBody", { model: entry?.name || model?.modelId || "" })}
              onClose={() => setImageWarningDismissed(true)}
            />
          );
        })()}
        {/* Pending messages: pi delivers them on upcoming turns. The pills sit
            on the composer's axis, one inner step (13px) in from the card. */}
        {queuedSubmissions && queuedSubmissions.length > 0 && (
          <div className="flex flex-col gap-1.5 px-[13px] max-sm:px-[9px]">
            {/* Only the rows scroll: a long queue must not push the input and its buttons off screen (#1428). */}
            <div className="flex max-h-[min(180px,calc(var(--app-viewport-height,100dvh)*0.25))] flex-col items-stretch gap-1.5 overflow-y-auto overscroll-contain px-[3px] py-0.5">
              {queuedSubmissions.map((item, index) => (
                <QueuedMessageRow
                  key={item.id}
                  item={item}
                  onAction={onQueuedAction}
                  canMoveUp={queuedSubmissions.some((other, otherIndex) => otherIndex < index && other.behavior === item.behavior)}
                  canMoveDown={queuedSubmissions.some((other, otherIndex) => otherIndex > index && other.behavior === item.behavior)}
                />
              ))}
            </div>
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <Alert variant="warning" className="items-center gap-x-1.5 rounded-md px-2.5 py-1 text-xs leading-normal">
            <RotateCcwIcon className="size-3.5 translate-y-0 shrink-0" />
            <span className="col-start-2">
              {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}
              {retryInfo.errorMessage && <span className="ml-1 opacity-70">— {retryInfo.errorMessage}</span>}
            </span>
          </Alert>
        )}
        {compactResultText && (
          <Alert className="items-center gap-x-1.5 rounded-md border-success/25 bg-success/10 px-2.5 py-1 text-xs leading-normal text-success">
            <CheckIcon className="size-3.5 translate-y-0 shrink-0" />
            <span className="col-start-2">{compactResultText}</span>
          </Alert>
        )}
        {compactError && (
          <Alert variant="destructive" className="items-start rounded-md border-destructive/30 bg-destructive/[0.07] px-2.5 py-1 font-mono text-xs leading-normal">
            <AlertDescription className="col-start-2 row-start-1 min-w-0 whitespace-pre-wrap wrap-anywhere text-destructive/90">
              {compactError}
            </AlertDescription>
            {onDismissCompactError && <DismissButton onClick={onDismissCompactError} title={t("chat.dismissCompactError")} />}
          </Alert>
        )}
        {attachError && (
          <Alert variant="destructive" className="items-center rounded-md border-destructive/40 bg-destructive/[0.06] px-2 py-1 text-xs leading-normal">
            <span className="col-start-2 row-start-1 min-w-0 wrap-anywhere">{attachError}</span>
            <DismissButton onClick={() => setAttachError(null)} title={t("chat.dismiss")} />
          </Alert>
        )}
        {/* Main input */}
        <div className="relative min-w-0">
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 max-h-[min(44vh,360px)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            >
              <div
                title={t("chat.inputHistory")}
                className="flex h-[30px] items-center border-b px-2.5 text-muted-foreground"
              >
                <HistoryIcon size={14} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="max-h-[calc(min(44vh,360px)-31px)] overflow-y-auto p-1">
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <Button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      variant="ghost"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      className={cn(
                        "flex h-auto w-full items-start justify-start rounded-sm px-2 py-[7px] text-left text-[12.5px] leading-[1.45] font-normal whitespace-normal text-foreground transition-colors",
                        active && "bg-accent",
                      )}
                    >
                      <span className="shrink-0 pt-px font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="line-clamp-2 min-w-0 wrap-anywhere">
                        {item}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 flex max-h-[min(72.8vh,598px)] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
              // Clamped by the measured free space above the composer.
              style={{
                maxHeight: slashMenuMaxHeight === null
                  ? "min(72.8vh, 598px)"
                  : `min(72.8vh, 598px, ${slashMenuMaxHeight}px)`,
              }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2 text-xs text-muted-foreground">
                 <span>{slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: slashCommandCountLabel })}</span>
                 <span className="font-mono">{t("chat.tabEnter")}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div className="px-0.5 pb-1 pt-0.5 text-xs text-muted-foreground">
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} className="mb-3">
                      <div className="sticky -top-2.5 z-[1] flex items-center justify-between gap-2 bg-popover pb-1.5 pt-1 text-[10px] font-semibold uppercase text-muted-foreground">
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span className="font-mono font-medium">{group.items.length}</span>
                      </div>
                      <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const dormant = isDormantSkillCommand(command, skillDormancy);
                          return (
                            <Button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              variant="ghost"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              className={cn(
                                "flex h-auto min-h-[58px] w-full min-w-0 flex-col items-stretch justify-center gap-1 rounded-md border px-2.5 py-[9px] text-left font-normal whitespace-normal transition-colors",
                                active
                                  ? "border-ring bg-accent"
                                  : "border-border bg-card",
                              )}
                            >
                              <span className={cn("font-mono text-sm wrap-anywhere", dormant && "text-muted-foreground")}>
                                /{command.name}
                                {dormant && (
                                  <span className="ml-1.5 whitespace-nowrap rounded-sm border border-border px-1 text-[10px] text-muted-foreground">
                                    {t("chat.dormant")}
                                  </span>
                                )}
                              </span>
                               {command.description && (
                                <span className="line-clamp-2 text-xs leading-[1.35] text-muted-foreground">
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                            </Button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                ref={atMenuRef}
                className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 flex max-h-[min(48vh,400px)] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                // Clamped by the measured free space above the composer.
                style={{
                  maxHeight: atMenuMaxHeight === null
                    ? "min(48vh, 400px)"
                    : `min(48vh, 400px, ${atMenuMaxHeight}px)`,
                }}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2 text-xs text-muted-foreground">
                  <span>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                   <span className="font-mono">{t("chat.tabEnter")}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1">
                  {!indexLoading && atMatches.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                       {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <Button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          variant="ghost"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          className={cn(
                            "flex h-auto w-full justify-start rounded-sm px-2 py-1.5 text-left font-mono text-[12.5px] font-normal text-foreground transition-colors",
                            active && "bg-accent",
                          )}
                        >
                          <span className="flex shrink-0 items-center">
                            {entry.isDir
                              ? <FolderClosedIcon size={14} strokeWidth={1.8} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                              : <FileIcon size={14} strokeWidth={1.8} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 truncate">
                            {dirPrefix && <span className="text-muted-foreground">{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span className="text-muted-foreground">/</span>}
                          </span>
                        </Button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          {/* The drafted composer card: attachments, then the input, then one
              pill row with the send button physically pinned to its right.
              AI-element composer language: one large-radius card, borderless
              textarea with headroom, tools bottom-left, circular submit
              bottom-right, and a soft tinted focus ring (the border itself
              stays put while typing). */}
          <InputGroup
            className={cn(
              "chat-composer-row min-w-0 rounded-[24px] border-border bg-card shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-ring/40 has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/15",
              compact
                ? "flex-row items-center gap-1 rounded-[18px] p-1.5"
                : "flex-col items-stretch gap-0 p-2",
            )}
          >
          {attachedImages.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap px-0 pt-0">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative shrink-0">
                  <ImagePreview key={img.previewUrl} src={img.previewUrl}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt=""
                      className="block size-14 rounded-md border border-border object-cover"
                    />
                  </ImagePreview>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeImage(i)}
                    title={t("chat.dismiss")}
                    aria-label={t("chat.dismiss")}
                    className="absolute -right-1 -top-1 size-4 rounded-full border border-border bg-card p-0 text-muted-foreground"
                  >
                    <XIcon className="size-2" strokeWidth={2.5} aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {!compact && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => fileInputRef.current?.click()}
                  title={t("chat.attachFiles")}
                  aria-label={t("chat.attachFiles")}
                  className="h-[26px] rounded-full border-dashed px-2.5 text-xs text-muted-foreground"
                >
                  <PlusIcon data-icon="inline-start" strokeWidth={2} aria-hidden="true" />
                  {t("chat.attachFiles")}
                </Button>
              )}
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            ref={textareaRef}
            className={cn(
              "chat-input-textarea w-full min-w-0 px-2.5 py-2 text-foreground max-h-44 overflow-auto placeholder:text-muted-foreground",
              "text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.55]",
              compact ? "min-h-24" : "min-h-11",
            )}
            data-chat-composer=""
            aria-label={compact ? t("chat.askInSideChat") : undefined}
            value={value}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              setHistoryMenuOpen(false);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              isCompacting
                ? t("chat.compactingPlaceholder")
                : isStreaming && (onSteer || onFollowUp)
                ? t("chat.steerPlaceholder")
                : isStreaming ? t("chat.agentPlaceholder")
                : t("chat.messagePlaceholder")
            }
            rows={1}
          />

          {compact ? sendCluster : (
            <InputGroupAddon align="block-end" className="min-w-0 items-center gap-2 px-1 pb-0.5">
              {/* One pill row: the pills scroll horizontally instead of wrapping,
                  and the send button is a sibling so it can never be squeezed
                  out. chat-input-controls keeps the keyboard-open collapse. */}
              <div className="chat-input-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label={t("chat.attachFiles")}
                      className={cn(
                        "rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        attachedImages.length > 0 && "text-primary",
                      )}
                    >
                      <ImageIcon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("chat.attachFiles")}</TooltipContent>
                </Tooltip>
                {/* Model selector - visible always, disabled while the session or switch is busy.
                    flex-shrink 8: the model pill gives up width first; the other pills only truncate. */}
                {(modelOptions.length > 0 || model || modelError) && onModelChange && (
                  <div className="flex min-w-0 overflow-hidden [flex-shrink:8]">
                    <ModelSelector
                      options={modelOptions}
                      value={model}
                      onChange={onModelChange}
                      onReselect={onModelChange}
                      disabled={isStreaming}
                      busy={modelSwitching}
                      isAutoSelection={isAutoModelSelection}
                      defaultValue={defaultModel}
                      onSetDefault={onSetDefaultModel}
                      allOptions={allModelList?.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }))}
                      onShowAll={onLoadAllModels}
                      headerSlot={!isMobile && onThinkingLevelChange ? thinkingSection : undefined}
                      iconClassName={!isMobile && onThinkingLevelChange ? thinkingIconTone : undefined}
                      titleHint={!isMobile && onThinkingLevelChange ? thinkingDisplayLabel : undefined}
                    />
                  </div>
                )}
            {/* Tools + compact share one icon menu: the row keeps no text
                pills. The wrench tint says which preset is active (full
                bright, chat-only dim, others muted), and compacting flips the
                icon to a destructive stop. The menu's onSelect fires on a
                deliberate click, so the run-end stray-click guard the old
                direct button needed does not apply here. */}
            {!isMobile && ((onToolPresetChange && !isStreaming) || (onCompact && (!isStreaming || isCompacting))) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={isCompacting
                      ? t("chat.stopCompaction")
                      : onToolPresetChange && !isStreaming
                        ? t("chat.changeToolPreset") + `: ${toolPresetLabel}`
                        : t("chat.compactContext")}
                    aria-label={isCompacting
                      ? t("chat.stopCompaction")
                      : onToolPresetChange && !isStreaming
                        ? t("chat.changeToolPreset")
                        : t("chat.compactContext")}
                    className={cn(
                      "rounded-full",
                      isCompacting
                        ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                        : onToolPresetChange && !isStreaming && rawToolPresetLabel === "full"
                          ? "text-primary hover:bg-accent hover:text-accent-foreground"
                          : onToolPresetChange && !isStreaming && rawToolPresetLabel === "chat-only"
                            ? "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {isCompacting
                      ? <SquareIcon className="size-4 fill-current" aria-hidden="true" />
                      : <WrenchIcon strokeWidth={1.8} aria-hidden="true" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" sideOffset={6} className="min-w-[120px]">
                  {onToolPresetChange && !isStreaming && (
                    <DropdownMenuRadioGroup
                      value={toolPreset ?? "configured"}
                      onValueChange={(next) => {
                        const preset = TOOL_PRESET_MAP[next as ToolPresetLabel];
                        if ((toolPreset ?? "configured") !== preset) onToolPresetChange(preset);
                      }}
                    >
                      {TOOL_PRESETS.map((lvl) => {
                        let desc: string | null;
                        if (lvl === "configured") desc = t("chat.configuredTools");
                        else if (lvl === "chat-only") desc = null;
                        else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                        else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                        else desc = t("chat.allBuiltInTools");
                        return (
                          <DropdownMenuRadioItem key={lvl} value={lvl}>
                            <span className="flex-1 whitespace-nowrap">{lvl === "chat-only" ? t("chat.chatOnly") : titleCaseLabel(lvl)}</span>
                            {desc && <span className="whitespace-nowrap text-xs text-muted-foreground">{desc}</span>}
                          </DropdownMenuRadioItem>
                        );
                      })}
                    </DropdownMenuRadioGroup>
                  )}
                  {onCompact && (!isStreaming || isCompacting) && (
                    <>
                      {onToolPresetChange && !isStreaming && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onSelect={isCompacting ? onAbortCompaction : () => onCompact()}
                        className={cn("text-muted-foreground", isCompacting && "text-destructive")}
                      >
                        {isCompacting
                          ? <><SquareIcon className="size-4 fill-current" aria-hidden="true" />{t("chat.stopCompaction")}</>
                          : <><ShrinkIcon className="size-4" aria-hidden="true" />{t("chat.compactContext")}</>}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {onSoundToggle !== undefined && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onSoundToggle}
                    aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                    className={cn(
                      "rounded-full hover:bg-accent",
                      soundEnabled ? "text-muted-foreground hover:text-accent-foreground" : "text-muted-foreground/55 hover:text-accent-foreground",
                    )}
                  >
                    {soundEnabled
                      ? <Volume2Icon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />
                      : <VolumeXIcon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}</TooltipContent>
              </Tooltip>
            )}

            {isMobile && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("chat.moreControls")}
                    className="gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {t("chat.moreControls")}
                    <ChevronUpIcon data-icon="inline-end" className="shrink-0 opacity-60" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" sideOffset={6} className="max-w-[calc(100vw-16px)]">
                  {onThinkingLevelChange && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <span className="flex-1">{t("chat.changeReasoningLabel")}</span>
                        <span className="text-xs text-muted-foreground">{thinkingDisplayLabel}</span>
                      </DropdownMenuSubTrigger>
                     <DropdownMenuSubContent className="min-w-[180px]">
                        <DropdownMenuRadioGroup
                          value={isAutoThinkingSelection ? "auto" : (resolvedThinkingLevel ?? "")}
                          onValueChange={(next) => {
                            if (next === "auto") {
                              if (!isAutoThinkingSelection) onThinkingLevelChange("auto");
                              return;
                            }
                            onThinkingLevelChange(next as typeof THINKING_LEVELS[number]);
                          }}
                        >
                          {THINKING_LEVELS.filter((lvl) => {
                            if (!availableThinkingLevels) return true;
                            if (lvl === "auto") return true;
                            return availableThinkingLevels.includes(lvl);
                          }).map((lvl) => {
                            const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                            const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                            const displayLabel = titleCaseLabel((mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl);
                            const showOriginal = mappedVal != null && mappedVal !== lvl;
                            return (
                              <DropdownMenuRadioItem key={lvl} value={lvl}>
                                <span className="min-w-0 flex-1">
                                  {displayLabel}
                                  {showOriginal && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({lvl})</span>}
                                </span>
                                <span className="text-xs text-muted-foreground">{desc}</span>
                              </DropdownMenuRadioItem>
                            );
                          })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {!isStreaming && onToolPresetChange && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <span className="flex-1">{t("chat.changeToolPreset")}</span>
                        <span className="text-xs text-muted-foreground">{toolPresetLabel}</span>
                      </DropdownMenuSubTrigger>
                     <DropdownMenuSubContent className="min-w-[120px]">
                        <DropdownMenuRadioGroup
                          value={toolPreset ?? "configured"}
                          onValueChange={(next) => {
                            const preset = TOOL_PRESET_MAP[next as ToolPresetLabel];
                            if ((toolPreset ?? "configured") !== preset) onToolPresetChange(preset);
                          }}
                        >
                          {TOOL_PRESETS.map((lvl) => {
                            let desc: string | null;
                            if (lvl === "configured") desc = t("chat.configuredTools");
                            else if (lvl === "chat-only") desc = null;
                            else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                            else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                            else desc = t("chat.allBuiltInTools");
                            return (
                              <DropdownMenuRadioItem key={lvl} value={lvl}>
                                <span className="flex-1 whitespace-nowrap">{lvl === "chat-only" ? t("chat.chatOnly") : titleCaseLabel(lvl)}</span>
                                {desc && <span className="whitespace-nowrap text-xs text-muted-foreground">{desc}</span>}
                              </DropdownMenuRadioItem>
                            );
                          })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {(!isStreaming || isCompacting) && onCompact && (
                    <DropdownMenuItem
                      onSelect={isCompacting ? onAbortCompaction : () => onCompact()}
                      className={cn("text-muted-foreground", isCompacting && "text-destructive")}
                    >
                      {isCompacting ? (
                        <><SquareIcon className="size-4 fill-current" aria-hidden="true" />{t("chat.stopCompaction")}</>
                      ) : (
                        <><ShrinkIcon className="size-4" aria-hidden="true" />{t("chat.compact")}</>
                      )}
                    </DropdownMenuItem>
                  )}
                  {onSoundToggle !== undefined && (
                    <DropdownMenuItem
                      onSelect={onSoundToggle}
                      className="text-muted-foreground"
                    >
                      {soundEnabled
                        ? <><Volume2Icon className="size-4" aria-hidden="true" />{t("chat.disableSound")}</>
                        : <><VolumeXIcon className="size-4" aria-hidden="true" />{t("chat.enableSound")}</>}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

                <ExtensionStatusButton statuses={extensionStatuses ?? []} />
                {/* YOLO is a marker, not a control: it carries no box, and it closes
                    the row at the far right. */}
                {permissiveStatus && <PermissiveModeChip text={permissiveStatus} />}
              </div>

              {sendCluster}
            </InputGroupAddon>
          )}
          </InputGroup>
        </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className={cn("mt-1 px-1 text-xs", bashExcluded ? "text-muted-foreground" : "text-primary")}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}
      </div>
    </fieldset>
  );
}));
