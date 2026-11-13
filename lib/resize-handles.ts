/** 分栏手柄：闲置不可见，命中区 12px，hover/focus 只在中段浮出一枚圆角小胶囊。 */
export const COLUMN_RESIZE_HANDLE_CLASS = [
  "relative w-px shrink-0 bg-transparent",
  "after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 after:content-['']",
  "before:absolute before:top-1/2 before:left-1/2 before:z-10 before:h-10 before:w-[3px]",
  "before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-border",
  "before:opacity-0 before:transition-opacity before:duration-150",
  "hover:before:opacity-100 focus-visible:before:opacity-100 focus-visible:outline-none",
].join(" ");

/** 侧栏内 会话 ↔ 文件 的横向手柄。 */
export const ROW_RESIZE_HANDLE_CLASS = [
  "relative h-px w-full shrink-0 bg-transparent",
  "after:absolute after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2 after:content-['']",
  "before:absolute before:top-1/2 before:left-1/2 before:z-10 before:h-[3px] before:w-10",
  "before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-border",
  "before:opacity-0 before:transition-opacity before:duration-150",
  "hover:before:opacity-100 focus-visible:before:opacity-100 focus-visible:outline-none",
].join(" ");
