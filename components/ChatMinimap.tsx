"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo, type RefObject } from "react";
import { isMessageGroupAnchor } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, CustomMessage, MinimapTurnDescriptor, TextContent, UserMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import styles from "./ChatMinimap.module.css";

interface Props {
  messages: AgentMessage[];
  /** The reply being streamed, read when the turns are measured: it never re-renders the minimap. */
  getStreamingMessage: () => Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  /** Pages the clicked turn in (or reveals it when loaded but hidden), then
   *  the next measurement scrolls to it. */
  onRevealTurn: (turnNumber: number) => void;
  /** Turns shown on earlier pages, so numbering stays continuous across loaded history. */
  turnsBefore?: number;
  /** Whole-branch turn index, oldest first: turns before the loaded window
   *  list from it and page their messages in on click. */
  turnIndex?: MinimapTurnDescriptor[];
}

const MINIMAP_WIDTH = 36;
// Turns sit in one tight rail: a wide cap left the dashes stranded at the top of
// an otherwise empty column.
const MAX_NODE_GAP = 12;
// Below this pitch the 3px dashes would touch, so turns fold into buckets first.
const MIN_SLOT_PITCH = 7;
const MINIMAP_PADDING = 12;
// A tall viewport must not multiply the dashes: past this many slots the rail
// folds turns into buckets regardless of height, so a long session stays at a
// readable handful of nodes instead of one dash per turn.
export const MAX_VISIBLE_SLOTS = 18;
// The chat pane hides the rail below this width — with the file panel open the
// centered message column would otherwise run underneath it (mobile hides the
// rail unconditionally already).
export const MINIMAP_MIN_PANE_WIDTH = 680;
// The message column reserves this right strip while the rail shows:
// rail width + its right offset + breathing gap.
export const MINIMAP_RAIL_STRIP = MINIMAP_WIDTH + 14 + 8;
const PREVIEW_SHOW_DELAY = 200;
const PREVIEW_HIDE_DELAY = 250;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

interface TurnInfo {
  userMessage: UserMessage | CustomMessage;
  scrollTop: number | null;
  /** Tool calls issued anywhere in this turn's assistant replies. */
  toolCount: number;
  /** Tokens and cost the whole turn's assistant replies reported, when the model sent usage. */
  usageTokens: number | null;
  usageCost: number | null;
 /** Set on index-listed turns whose messages are not loaded (or rendered) yet. */
  timestamp?: number;
}

interface NodeInfo {
  topRatio: number;
  targetTurn: TurnInfo;
  index: number;
}

function getUserPreview(message: UserMessage | CustomMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Tool calls in one assistant message. A reply can both answer and call
 *  tools, so this counts blocks rather than text-less messages. */
export function countToolCalls(message: AgentMessage | Partial<AgentMessage>): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.reduce(
    (total, block) => total + (block.type === "toolCall" ? 1 : 0),
    0,
  );
}

/** Compact token count for the preview card's meta line: 1234 → 1.2k. */
function formatTurnTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function createTurnNodes(turns: TurnInfo[], firstIndex = 0): NodeInfo[] {
  return turns.map((turn, index) => ({
    topRatio: 0,
    targetTurn: turn,
    index: firstIndex + index,
  }));
}

const EMPTY_TURN_INDEX: MinimapTurnDescriptor[] = [];

/** A short absolute time for an unloaded turn's preview card. */
function formatTurnTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface MinimapSlot {
  topRatio: number;
  /** The turn a click on this dash jumps to. */
  target: NodeInfo;
  /** Turn indexes this dash stands for; more than one once turns are folded. */
  indexes: number[];
}

interface SlotLayout {
  slots: MinimapSlot[];
  gap: number;
  fillsHeight: boolean;
}

export function layoutSlots(allNodes: NodeInfo[], minimapHeight: number): SlotLayout {
  if (allNodes.length === 0) {
    return { slots: [], gap: MAX_NODE_GAP, fillsHeight: false };
  }

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.max(0, height - MINIMAP_PADDING * 2);
  const maxSlots = Math.min(MAX_VISIBLE_SLOTS, Math.max(1, Math.floor(usableHeight / MIN_SLOT_PITCH)));

  // Long sessions fold turns into buckets: one dash per bucket keeps the rail
  // readable instead of collapsing into a solid line once the 3px dashes meet.
  // The cap bounds the count only — the geometry stays the same tight, centered
  // block short sessions get; a tall rail must not stretch the gaps apart.
  if (allNodes.length > maxSlots && maxSlots > 1) {
    const spread = usableHeight / (maxSlots - 1);
    const gap = Math.min(MAX_NODE_GAP, spread);
    const top = MINIMAP_PADDING + Math.max(0, (usableHeight - gap * (maxSlots - 1)) / 2);
    const slots = Array.from({ length: maxSlots }, (_, slotIndex) => {
      const from = Math.floor((slotIndex * allNodes.length) / maxSlots);
      const to = Math.floor(((slotIndex + 1) * allNodes.length) / maxSlots);
      return {
        topRatio: (top + slotIndex * gap) / height,
        target: allNodes[from + Math.floor((to - from - 1) / 2)],
        indexes: allNodes.slice(from, to).map((node) => node.index),
      };
    });
    return { slots, gap, fillsHeight: spread <= MAX_NODE_GAP };
  }

  if (allNodes.length === 1) {
    return {
      slots: [{ topRatio: 0.5, target: allNodes[0], indexes: [allNodes[0].index] }],
      gap: MAX_NODE_GAP,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  // A short session keeps one tight block instead of spreading across the rail.
  const top = MINIMAP_PADDING + Math.max(0, (usableHeight - gap * (allNodes.length - 1)) / 2);
  return {
    slots: allNodes.map((node, index) => ({
      topRatio: (top + index * gap) / height,
      target: node,
      indexes: [node.index],
    })),
    gap,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  };
}

export const ChatMinimap = memo(function ChatMinimap({
  messages,
  getStreamingMessage,
  scrollContainer,
  messageRefs,
  onRevealTurn,
  turnsBefore = 0,
  turnIndex = EMPTY_TURN_INDEX,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const slotLayoutRef = useRef<SlotLayout>({
    slots: [],
    gap: MAX_NODE_GAP,
    fillsHeight: false,
  });
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const previewItemRefs = useRef(new Map<number, HTMLDivElement>());
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<{
    nodeIndex: number;
  } | null>(null);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const slotLayout = useMemo(
    () => layoutSlots(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { slots: positionedSlots, gap: slotGap } = slotLayout;
  slotLayoutRef.current = slotLayout;
  const activeSlot =
    positionedSlots.find((slot) => activeIndex !== null && slot.indexes.includes(activeIndex))
    ?? null;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.targetTurn.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.targetTurn.scrollTop ?? 0) - focusTop)
        < Math.abs((bestNode.targetTurn.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    const currentNodes = allNodesRef.current;
    setVisible(scrollable > 20);
    syncActiveNode(scrollEl, currentNodes);
  }, [scrollContainer, syncActiveNode]);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      // Turns listed from the whole-branch index sit ahead of the loaded
      // window; their messages are not rendered, so they have no scroll
      // position until their page is fetched and their anchor measures.
      const headCount = Math.min(turnIndex.length, Math.max(0, turnsBefore));
      const headNodes = createTurnNodes(
        turnIndex.slice(0, headCount).map((descriptor) => ({
          userMessage: { role: "user", content: descriptor.preview } as UserMessage,
          scrollTop: null,
          toolCount: 0,
          usageTokens: null,
          usageCost: null,
          timestamp: descriptor.timestamp,
        })),
      );
      const measuredTurns: TurnInfo[] = [];
      let refIndex = 0;
      let currentTurn: TurnInfo | null = null;

      const streamingMessage = getStreamingMessage();
      const allMessages: (AgentMessage | Partial<AgentMessage>)[] = streamingMessage
        ? [...messagesRef.current, streamingMessage]
        : messagesRef.current;
      for (const message of allMessages) {
        const isAnchor = isMessageGroupAnchor(message);
        if (!isAnchor && message.role !== "assistant") continue;
        if (isAnchor) {
          const element = refs?.[refIndex];
          refIndex++;
          currentTurn = null;
          const elementRect = element?.getBoundingClientRect();
          currentTurn = {
            userMessage: message as UserMessage | CustomMessage,
            scrollTop: elementRect
              ? elementRect.top - containerRect.top + scrollEl.scrollTop
              : null,
            toolCount: 0,
            usageTokens: null,
            usageCost: null,
          };
          measuredTurns.push(currentTurn);
          continue;
        }
        // Assistant messages consume a ref slot even though only the anchor
        // element is read — refIndex must stay aligned with attachVisibleRef.
        refIndex++;

        if (!currentTurn) continue;
        currentTurn.toolCount += countToolCalls(message);
        const usage = (message as AssistantMessage).usage;
        if (usage) {
          const tokens = (usage.input ?? 0) + (usage.output ?? 0)
            + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
          if (tokens > 0) currentTurn.usageTokens = (currentTurn.usageTokens ?? 0) + tokens;
          const cost = usage.cost?.total;
          if (typeof cost === "number") currentTurn.usageCost = (currentTurn.usageCost ?? 0) + cost;
        }
      }

      // Numbering comes from the whole-branch index once it is known (the JSX
      // renders node.index + 1 directly); without it (not fetched yet), the
      // earlier-page count keeps numbers continuous.
      const nextNodes = [
        ...headNodes,
        ...createTurnNodes(measuredTurns, headCount),
      ];
      setMinimapHeight(minimapEl.clientHeight);
      allNodesRef.current = nextNodes;
      setAllNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);

      const pendingNavigation = pendingNavigationRef.current;
      const pendingNode = pendingNavigation
        ? nextNodes.find((node) => node.index === pendingNavigation.nodeIndex)
        : null;
      if (pendingNavigation && pendingNode) {
        const targetTop = pendingNode.targetTurn.scrollTop;
        if (targetTop === null) return;
        pendingNavigationRef.current = null;
        lockActiveNode(pendingNode.index);
        const targetOffset = scrollEl.clientHeight * 0.3;
        scrollEl.scrollTo({ top: Math.max(0, targetTop - targetOffset), behavior: "smooth" });
      }
    }, 150);
  }, [getStreamingMessage, lockActiveNode, messageRefs, scrollContainer, syncActiveNode, turnIndex, turnsBefore]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);
    if (node.targetTurn.scrollTop === null) {
      // The next measurement completes the navigation once the turn's anchor
      // has rendered (revealTurn pages hidden or unloaded history in).
      pendingNavigationRef.current = { nodeIndex: node.index };
      onRevealTurn(node.index);
      return;
    }
    const targetTop = Math.max(
      0,
      node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3,
    );
    scrollEl.scrollTo({ top: targetTop, behavior });
  }, [lockActiveNode, onRevealTurn, scrollContainer]);

  const findNearestSlot = useCallback((ratio: number): MinimapSlot | null => {
    const { slots, gap, fillsHeight } = slotLayoutRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    if (slots.length === 0 || height <= 0) return null;

    const pointerY = Math.max(0, Math.min(height, ratio * height));
    const firstSlotY = slots[0].topRatio * height;
    const rawIndex = gap > 0 ? Math.round((pointerY - firstSlotY) / gap) : 0;
    const slotIndex = Math.max(0, Math.min(slots.length - 1, rawIndex));
    const slot = slots[slotIndex];

    if (!fillsHeight) {
      const slotY = slot.topRatio * height;
      const hitRadius = Math.max(10, gap / 2);
      if (Math.abs(pointerY - slotY) > hitRadius) return null;
    }
    return slot;
  }, []);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const cancelPreviewShow = useCallback(() => {
    if (!previewShowTimerRef.current) return;
    clearTimeout(previewShowTimerRef.current);
    previewShowTimerRef.current = null;
  }, []);

  const showPreview = useCallback(() => {
    cancelPreviewHide();
    if (previewShowTimerRef.current) return;
    previewShowTimerRef.current = setTimeout(() => {
      previewShowTimerRef.current = null;
      setMinimapHovered(true);
    }, PREVIEW_SHOW_DELAY);
  }, [cancelPreviewHide]);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewShow();
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setMinimapHovered(false);
      setMouseYRatio(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide, cancelPreviewShow]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    showPreview();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setMouseYRatio(pointerRatio);
    const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const slot = findNearestSlot(ratio);
      if (slot) {
        scrollToNode(slot.target, behavior);
      }
    };

    jumpToPointer(event.clientY, "smooth");
    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpToPointer(moveEvent.clientY, "auto");
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [findNearestSlot, scrollToNode, showPreview, visible]);

  // The overlay covers the chat's right edge, so wheel events over it would be
  // swallowed; forward them so scrolling keeps working under the trigger zone.
  // The preview card scrolls itself, and forwarding its wheel events on top of
  // that scrolled the chat at the same time.
  const handleZoneWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (previewBoxRef.current?.contains(event.target as Node)) return;
    const container = scrollContainer.current;
    if (container) container.scrollTop += event.deltaY;
  }, [scrollContainer]);

  const nearestSlot = mouseYRatio === null ? null : findNearestSlot(mouseYRatio);
  const nearestNodeIndex = nearestSlot?.target.index ?? null;

  useEffect(() => {
    if (!minimapHovered || nearestNodeIndex === null) return;
    const previewBox = previewBoxRef.current;
    const previewItem = previewItemRefs.current.get(nearestNodeIndex);
    if (!previewBox || !previewItem) return;
    const targetTop = previewItem.offsetTop
      - (previewBox.clientHeight - previewItem.offsetHeight) / 2;
    previewBox.scrollTop = Math.max(0, targetTop);
  }, [allNodes, minimapHovered, nearestNodeIndex]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseLeave={schedulePreviewHide}
      onWheel={handleZoneWheel}
      onMouseMove={(event) => {
        // The card belongs to a node: hovering empty rail keeps it hidden, and
        // events inside the card (which can sit anywhere vertically) must not
        // hide the card the pointer is already on.
        if (previewBoxRef.current?.contains(event.target as Node)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        setMouseYRatio(ratio);
        if (findNearestSlot(ratio)) showPreview();
        else if (!draggingRef.current) schedulePreviewHide();
      }}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        // Inside the chat pane's right edge, clear of its scrollbar — flush
        // right: 0 sat on top of the scrollbar and read as "outside" the pane.
        right: 14,
        width: MINIMAP_WIDTH,
        zIndex: 25,
        cursor: "pointer",
        userSelect: "none",
        overflow: "visible",
      }}
    >
      {positionedSlots.map((slot) => {
        const isNearest = minimapHovered && nearestSlot === slot;
        const isActive = activeSlot === slot;
        // The dashes are the minimap when nothing is hovered: without them the
        // trigger zone is invisible, so there is nothing to aim for.
        const width = isNearest ? 18 : minimapHovered || isActive ? 12 : 8;
        const background = isActive
          ? "var(--accent)"
          : isNearest
            ? "color-mix(in srgb, var(--accent) 55%, transparent)"
            : minimapHovered
              ? "color-mix(in srgb, var(--text-muted) 38%, transparent)"
              : "color-mix(in srgb, var(--text-muted) 24%, transparent)";

        return (
          <div
            key={slot.indexes[0]}
            data-minimap-node-index={slot.indexes[0]}
            data-minimap-node-span={slot.indexes.length > 1 ? slot.indexes.length : undefined}
            data-minimap-node-active={isActive ? "" : undefined}
            style={{
              position: "absolute",
              top: `${slot.topRatio * 100}%`,
              transform: "translateY(-50%)",
              left: 0,
              right: 0,
              height: Math.max(1, slotGap),
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 9,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width,
                height: 3,
                borderRadius: 999,
                background,
                transition: "width 0.12s ease, background 0.12s ease",
              }}
            />
          </div>
        );
      })}

      {minimapHovered && nearestSlot !== null && allNodes.length > 0 && (
        <div
          ref={previewBoxRef}
          className={styles.preview}
          data-minimap-preview-box=""
          onMouseEnter={showPreview}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
        >
          {allNodes.map((node) => {
            const isLocated = nearestNodeIndex === node.index;
            const turn = node.targetTurn;
            const metaParts: string[] = [];
            if (turn.scrollTop === null) {
              // Unloaded turn: identify it by time and offer the jump.
              if (turn.timestamp) metaParts.push(formatTurnTime(turn.timestamp));
              metaParts.push(t("chatMinimap.notLoaded"));
            } else {
              if (turn.toolCount > 0) {
                metaParts.push(t("chatMinimap.toolCalls", { count: turn.toolCount }));
              }
              if (turn.usageTokens !== null) {
                metaParts.push(t("chatMinimap.turnTokens", { tokens: formatTurnTokens(turn.usageTokens) }));
              }
              if (turn.usageCost !== null && turn.usageCost > 0) {
                metaParts.push(`$${turn.usageCost.toFixed(4)}`);
              }
            }
            return (
              <div
                key={node.index}
                ref={(element) => {
                  if (element) previewItemRefs.current.set(node.index, element);
                  else previewItemRefs.current.delete(node.index);
                }}
                className={styles.turn}
                data-minimap-preview-index={node.index}
                data-located={isLocated ? "true" : undefined}
                data-unloaded={turn.scrollTop === null ? "" : undefined}
              >
                <span className={styles.number} aria-hidden="true">
                  {String(node.index + 1 + (turnIndex.length > 0 ? 0 : turnsBefore)).padStart(2, "0")}
                </span>
                <div className={styles.content}>
                  <button
                    type="button"
                    className={styles.user}
                    data-minimap-preview-user={node.index}
                    onClick={() => {
                      scrollToNode(node, "smooth");
                    }}
                  >
                      <span className={styles.userText}>
                      {getUserPreview(node.targetTurn.userMessage)}
                    </span>
                  </button>

                  {metaParts.length > 0 && (
                    <div className={styles.meta}>{metaParts.join(" · ")}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
