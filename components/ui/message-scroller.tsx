"use client"

import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"
import { ArrowDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn("relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      // 长输出要拖得动，所以这里显示滚动条；稳定的 gutter 让居中的列在会话变长时不横跳。
      className={cn(
        "scrollbar-subtle size-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      // 官方配方把离屏行交给 `content-visibility:auto`，但它靠 `contain-intrinsic-size`
      // 估算未渲染行的高度：长会话里这些估值让内容末端算不准，贴底会漂一点。
      // 行窗口（visibleCount）已经限制了挂载数量，这里不再叠一层估算高度。
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        "absolute inset-x-0 bottom-4 mx-auto inline-flex size-8 items-center justify-center rounded-full border bg-background text-foreground shadow-xs transition-[translate,scale,opacity] duration-200 hover:bg-muted data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 rtl:rotate-180",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon className="size-3.5" />
          <span className="sr-only">{direction === "end" ? "Scroll to end" : "Scroll to start"}</span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
