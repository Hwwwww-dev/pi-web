import * as React from "react";

import { MessageScrollerItem } from "@/components/ui/message-scroller";
import {
  CHAT_COLUMN_INSET_CLASS,
  CHAT_MESSAGE_TEXT_CLASS,
} from "@/lib/chat-layout";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * 官方 scroller 的测量、锚点与可视性均基于 `messageId`。提供则为条目行；
   * 不提供则为流式回复、阶段提示等尚无条目身份的行，二者走同一通道。
   */
  messageId?: string;
  /** 将该行作为用户提问的锚点（回复较长时将其置顶）。 */
  scrollAnchor?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * 消息行的统一样式：宽度、水平留白、字号仅在此处拼接，条目行、流式回复
 * 与阶段提示均复用。行与行之间的纵向间距由滚动容器的 gap 提供。
 */
export function ChatRow({ messageId, scrollAnchor = false, className, children }: Props) {
  const rowClass = cn(
    CHAT_COLUMN_INSET_CLASS,
    CHAT_MESSAGE_TEXT_CLASS,
    "min-w-0",
    className,
  );

  if (messageId === undefined) {
    return <div className={rowClass}>{children}</div>;
  }

  return (
    <MessageScrollerItem
      messageId={messageId}
      scrollAnchor={scrollAnchor}
      className={cn("shrink-0", rowClass)}
    >
      {children}
    </MessageScrollerItem>
  );
}
