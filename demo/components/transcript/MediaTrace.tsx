"use client";

import { memo } from "react";
import { ImagePreview } from "@/components/ImagePreview";

/**
 * Images, video and audio a tool produced (第 5.13 节). The 官方 patterns have
 * no media shape, so this is the底座组合: the existing preview for images, the
 * browser's own players for the other two — never the bytes as text.
 */
export const MediaTrace = memo(function MediaTrace({ images, video, audio }: {
  /** Data URLs from the tool's result. */
  images?: string[];
  video?: string;
  audio?: string;
}) {
  const hasImages = Boolean(images && images.length > 0);
  if (!hasImages && !video && !audio) return null;

  return (
    <div className="flex max-h-[var(--card-max-height)] flex-col gap-2 overflow-y-auto">
      {hasImages && (
        <div className="flex flex-wrap gap-2">
          {images?.map((src, index) => (
            <ImagePreview key={index} src={src} className="max-h-64">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="max-h-64 w-auto rounded-md object-contain" loading="lazy" />
            </ImagePreview>
          ))}
        </div>
      )}
      {video && <video controls playsInline src={video} className="max-h-64 max-w-full rounded-md" />}
      {audio && <audio controls src={audio} className="w-full" />}
    </div>
  );
});
