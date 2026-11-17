"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Inspiration } from "@/components/Inspiration";
import { useI18n } from "@/hooks/useI18n";
import type { InspirationFileRef } from "@/lib/inspiration-shared";
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
  /** 文本与附件回到输入框（不自动发送）；图片是字节，其余文件是仓库引用。 */
  onImplement: (text: string, images: File[], files: InspirationFileRef[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // 与设置弹窗同一壳：手机由 settings-card-safe 定几何（居中浮卡，
          // 独立安装态扣安全区），桌面是大卡片；滚动只在核心内部。
          "settings-card-safe z-(--z-modal) flex flex-col gap-0 overflow-hidden p-0",
          "h-[84vh] max-h-[calc(100dvh-16px)] w-[min(1080px,calc(100vw-16px))] max-w-none sm:max-w-none rounded-xl",
        )}
      >
        {/* Radix 要求 Content 内有 Title；核心自己的 h2 是可见标题，这里补无障碍位。 */}
        <DialogTitle className="sr-only">{t("inspiration.title")}</DialogTitle>
        <Inspiration sessionId={sessionId} onImplement={onImplement} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
