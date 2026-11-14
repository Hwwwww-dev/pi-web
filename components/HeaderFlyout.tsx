"use client";

import type { ComponentProps } from "react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * 顶栏六张浮层（系统提示 / 工具定义 / 会话信息 / 调试 / 分支 / Agent 清单）的
 * 统一壳：同底色（bg-card）、同圆角、同描边、同阴影；宽度与层级是调用点的参数，
 * 不再共用一个撑满表头的定宽。avoidCollisions、collisionPadding、onOpenAutoFocus
 * 等 Radix 原位属性照常透传。
 */
export function HeaderFlyout({
  width,
  z = "z-[240]",
  className,
  children,
  ...props
}: ComponentProps<typeof PopoverContent> & {
  /** 宽度类，必给：如 `w-[560px] max-w-[calc(100vw-16px)]`、`w-max min-w-56`。 */
  width: string;
  /** 层级类；默认 z-[240]（低于引用工具栏的 260），Agent 清单给 z-[500]。 */
  z?: string;
}) {
  return (
    <PopoverContent
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card p-0 shadow-lg",
        width,
        z,
        className,
      )}
      {...props}
    >
      {children}
    </PopoverContent>
  );
}
