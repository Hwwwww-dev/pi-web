"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Inspiration } from "@/components/Inspiration";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

/**
 * 💡灵感的 dialog 容器：手机全屏 sheet、桌面居中卡片。只负责壳——遮罩、关闭、
 * 形态；列表、编辑器与自动保存都在 Inspiration 核心里，核心随时可以挂到
 * 非 dialog 的地方（侧栏、面板）复用。
 */
export function InspirationDialog({ sessionId, open, onOpenChange, onImplement }: {
  /** 会话隔离：无会话时不挂入口按钮，此值恒有。 */
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 文本与图片回到输入框（不自动发送）；由持有 ChatInputHandle 的一方接线。 */
  onImplement: (text: string, images: File[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // 布局：一列，核心占满；滚动在核心内部，壳上没有第二处。
          "flex flex-col gap-0 overflow-hidden p-0",
          // 手机：全屏 sheet——直角贴边、以视口变量定高（键盘期随 dvh 缩）。
          // 直角与底色分两行写（设计门：涂底色的行不得带半径覆写）。
          "top-0 left-0 h-[var(--app-viewport-height,100dvh)] w-full max-w-full translate-x-0 translate-y-0 rounded-none border-0",
          // 桌面：居中卡片。
          "sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[min(85dvh,640px)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border",
          // 表面。
          "bg-background text-foreground shadow-lg",
        )}
      >
        {/* Radix 要求 Content 内有 Title；核心自己的 h2 是可见标题，这里补无障碍位。 */}
        <DialogTitle className="sr-only">{t("inspiration.title")}</DialogTitle>
        <Inspiration sessionId={sessionId} onImplement={onImplement} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
