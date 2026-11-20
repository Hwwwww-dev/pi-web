export const CHAT_COLUMN_MAX_WIDTH = 700;

export const CHAT_COLUMN_CLASS =
  "mx-auto w-full min-w-0 max-w-[min(var(--chat-content-max-width,820px),700px)]";

export const CHAT_COLUMN_INSET_CLASS =
  "mx-auto w-full min-w-0 max-w-[min(var(--chat-content-max-width,820px),700px)] px-[var(--chat-column-padding)]";

export const CHAT_COMPOSER_INSET_CLASS =
  "mx-auto w-full min-w-0 max-w-[min(var(--chat-content-max-width,820px),700px)] px-[var(--chat-composer-inset)]";

/** 磨砂玻璃面：输入框卡片、速率胶囊与扩展状态/插件胶囊共用同一层。
 *  暗色下 outline 胶囊自带的 `dark:bg-input/30` 比这个 base 层更靠后，仍然生效。 */
export const CHAT_GLASS_CLASS = "bg-background/60 backdrop-blur-xl";

export const CHAT_PAGE_GUTTER_CLASS = "px-[var(--chat-column-padding)]";

export const CHAT_MESSAGE_TEXT_CLASS =
  "text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.65] max-sm:text-[length:calc(14px+var(--chat-font-size-offset,0px))]";
