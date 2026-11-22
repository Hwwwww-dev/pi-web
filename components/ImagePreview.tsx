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
  /**
   * Every picture the trigger belongs to, in display order. The lightbox opens
   * on `index` and YARL's own carousel takes over from there: swipe, arrow keys
   * and the arrow buttons are part of the viewer, not ours to draw. Omitted for
   * a lone picture, which behaves exactly as before.
   */
  gallery?: readonly string[];
  /** Which gallery entry `src` is. Ignored without `gallery`. */
  index?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * Every picture in the app opens the same lightbox (yet-another-react-lightbox
 * + Zoom): the picture itself is the trigger (an official ghost Button), and
 * the viewer owns the overlay, scroll lock, Escape, focus return, double-tap /
 * pinch zoom and drag panning. Nothing here draws chrome over the image.
 */
export function ImagePreview({ src, alt = "", gallery, index = 0, children, className }: ImagePreviewProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);
  // 单图即长度 1 的图集：幻灯片列表与起始位置走同一条路径，不再分叉。
  const slides = gallery && gallery.length > 0 ? gallery.map((source) => ({ src: source })) : [{ src, alt }];
  const startIndex = gallery && gallery.length > 0 ? Math.min(Math.max(index, 0), slides.length - 1) : 0;

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
      {/* carousel.finite：单图不显示左右箭头（没有下一张），多图才翻页。 */}
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={startIndex}
        slides={slides}
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
