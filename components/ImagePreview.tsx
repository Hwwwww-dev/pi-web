"use client";

import { useEffect, useState } from "react";
import { Lightbox } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Every picture in the app opens the same lightbox (yet-another-react-lightbox
 * + Zoom): the picture itself is the trigger (an official ghost Button), and
 * the viewer owns the overlay, scroll lock, Escape, focus return, double-tap /
 * pinch zoom and drag panning. Nothing here draws chrome over the image.
 */
export function ImagePreview({ src, alt = "", children, className }: ImagePreviewProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);

  // 空白处点击关闭：YARL 的 closeOnBackdropClick 只认“灯箱容器外”的背景点击，
  // 图片四周的黑边属于轮播区不算背景。portal 内、图片与控件（按钮/链接）之外
  // 的任何点击都视为空白。双击缩放不受影响：两次 click 都落在图片上，被排除。
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".yarl__portal")) return;
      if (target.closest("img, button, a, [role='button']")) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className={cn("block h-auto w-auto max-w-full cursor-zoom-in p-0 text-inherit hover:bg-transparent", className)}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        title={previewLabel}
      >
        {children}
      </Button>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src, alt }]}
        plugins={[Zoom]}
        zoom={{ scrollToZoom: true }}
        carousel={{ finite: true }}
        labels={{
          Close: t("chat.close"),
          "Zoom in": t("chat.imageViewZoomIn"),
          "Zoom out": t("chat.imageViewZoomOut"),
        }}
      />
    </>
  );
}
