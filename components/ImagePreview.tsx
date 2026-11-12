"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Every picture in the app opens the same official Dialog (design-language J):
 * the picture itself is the DialogTrigger (an official ghost Button), and the
 * larger view is an official DialogContent with no chrome of its own. Nothing
 * here draws a frame, a radius or a floating close surface over the image — the
 * Dialog owns the overlay, the scroll lock, Escape, focus and focus return.
 */
export function ImagePreview({ src, alt = "", children, className }: ImagePreviewProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn("block h-auto w-auto max-w-full cursor-zoom-in p-0 text-inherit hover:bg-transparent", className)}
          aria-label={triggerLabel}
          title={previewLabel}
        >
          {children}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-label={previewLabel}
        className="flex w-auto max-w-[calc(100%-2rem)] flex-col gap-2 border-0 bg-transparent p-0 shadow-none sm:max-w-[calc(100%-2rem)]"
      >
        <DialogTitle className="sr-only">{previewLabel}</DialogTitle>
        <DialogDescription className="sr-only">{alt.trim() || previewLabel}</DialogDescription>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="ms-auto"
            title={t("chat.close")}
            aria-label={t("chat.close")}
          >
            <XIcon />
          </Button>
        </DialogClose>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="block max-h-[calc(100dvh-8rem)] max-w-full object-contain" src={src} alt={alt} />
      </DialogContent>
    </Dialog>
  );
}
