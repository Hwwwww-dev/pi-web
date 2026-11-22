"use client";

import { memo } from "react";
import { ImagePreview } from "@/components/ImagePreview";
import { Attachment, AttachmentGroup, AttachmentMedia } from "@/components/ui/attachment";
import { useAdvancedSettingValue } from "@/hooks/useAdvancedSettings";

/**
 * Images, video and audio a tool produced (第 4 节媒体行): the official
 * Attachment — a vertical media tile for pictures, a full-width tile for the
 * browser's own players. Never the bytes as text.
 */
export const MediaTrace = memo(function MediaTrace({ images, video, audio }: {
  /** Data URLs from the tool's result. */
  images?: string[];
  video?: string;
  audio?: string;
}) {
  const hasImages = Boolean(images && images.length > 0);
  // 附件横向条开关（Settings › 高级参数）：关掉后图片改为一列竖排，仍可见可点。
  const strip = useAdvancedSettingValue<boolean>("showAttachmentStrip") !== false;
  if (!hasImages && !video && !audio) return null;

  return (
    <div className="flex max-h-[var(--card-max-height)] flex-col gap-2 overflow-y-auto">
      {hasImages && (
        <AttachmentGroup className={strip ? "flex-wrap overflow-visible" : "flex-col overflow-visible"}>
          {images?.map((src, index) => (
            <Attachment key={index} orientation="vertical" size="sm" className="max-w-full">
              <AttachmentMedia variant="image">
                {/* The preview trigger sits between the tile and the picture, so
                    the tile's own image sizing (*:[img]) no longer reaches it:
                    the thumbnail carries the same square cover itself. */}
                <ImagePreview src={src} className="w-full" gallery={images} index={index}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                </ImagePreview>
              </AttachmentMedia>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      {video && (
        <Attachment size="sm" className="w-full max-w-md">
          <AttachmentMedia className="aspect-auto h-auto w-full bg-transparent">
            <video controls playsInline src={video} className="max-h-64 w-full rounded-md" />
          </AttachmentMedia>
        </Attachment>
      )}
      {audio && (
        <Attachment size="sm" className="w-full max-w-md">
          <AttachmentMedia className="aspect-auto h-auto w-full bg-transparent">
            <audio controls src={audio} className="w-full" />
          </AttachmentMedia>
        </Attachment>
      )}
    </div>
  );
});
