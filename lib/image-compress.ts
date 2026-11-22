/**
 * Browser side of prompt-image compression.
 *
 * An attached image travels to the server and on to the provider as base64
 * inside the prompt, so shrinking it here cuts the request body, the SSE
 * payload and the bill. pi resizes prompt images again on its own side
 * (`images.autoResize` and the model's `inputLimits.images.resize`); this is
 * about what it receives, not about what it keeps.
 */

import { advancedValue } from "@/lib/advanced-values";

export interface ImageCompressOptions {
  /** Long-edge cap in pixels. Both sides scale by the same factor. */
  maxEdge: number;
  /** JPEG quality, 0–1. PNG ignores it. */
  quality: number;
  /** Files at or under this size ride untouched. */
  skipUnderBytes: number;
  /**
   * `auto` keeps PNG as PNG (transparency survives), everything else becomes
   * JPEG. `jpeg` flattens transparency onto white; `png` never re-encodes a
   * photo smaller; `webp` keeps alpha at a smaller size where the browser can
   * encode it, and falls back to the original when it cannot.
   */
  output: "auto" | "jpeg" | "png" | "webp";
}

/** Long edge 1568 px, q0.82, JPEG: the range vision models keep their tokens at. */export const DEFAULT_IMAGE_COMPRESS: ImageCompressOptions = {
  maxEdge: 1568,
  quality: 0.82,
  skipUnderBytes: 300 * 1024,
  output: "jpeg",
};

export interface CompressedImage {
  blob: Blob;
  mimeType: string;
  originalBytes: number;
  bytes: number;
  /** False when the original is kept: small, animated, vector, or already smaller. */
  compressed: boolean;
}

/** Re-encoding an animation keeps one frame; a vector loses its point. */
const PASSTHROUGH_MIME = new Set(["image/gif", "image/apng", "image/svg+xml"]);

/**
 * Above this the decode itself is the memory problem a canvas cannot absorb;
 * such a file rides untouched and the attach-size gate reports it.
 */
const MAX_DECODE_BYTES = 60 * 1024 * 1024;

function unchanged(file: Blob, mimeType: string): CompressedImage {
  return { blob: file, mimeType, originalBytes: file.size, bytes: file.size, compressed: false };
}

function targetMimeType(sourceType: string, output: ImageCompressOptions["output"]): string {
  if (output === "jpeg") return "image/jpeg";
  if (output === "png") return "image/png";
  if (output === "webp") return "image/webp";
  return sourceType === "image/png" ? "image/png" : "image/jpeg";
}

/**
 * 页面参数 → 压缩选项（Settings › 高级参数）。读的是存储里的当前值：改完下一张
 * 图就按新参数走，不需要重开页面。
 */
export function imageCompressOptions(): ImageCompressOptions {
  const format = advancedValue<string>("imageOutputFormat");
  return {
    maxEdge: advancedValue<number>("imageMaxEdge"),
    quality: advancedValue<number>("imageQuality"),
    skipUnderBytes: advancedValue<number>("imageSkipBelowKB") * 1024,
    output: format === "webp" ? "webp" : "jpeg",
  };
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Safari 15 has no options bag, and some EXIF setups refuse the bitmap
      // entirely: the <img> path below decodes both.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to decode image"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mimeType, quality));
}

/**
 * Shrinks one attached image.
 *
 * Never throws: an image the browser cannot decode, an encoder that ignores the
 * requested type, or a result bigger than the original all fall back to the
 * original bytes, so attaching a picture can only get cheaper, never fail.
 * @param file The picked or dropped image
 * @param options The knobs; `imageCompressOptions()` (the Advanced page) when omitted
 * @returns The bytes to attach and the size before/after
 */
export async function compressImage(
  file: Blob,
  options: ImageCompressOptions = DEFAULT_IMAGE_COMPRESS,
): Promise<CompressedImage> {
  const passthrough = unchanged(file, file.type || "image/jpeg");
  if (!file.type.startsWith("image/") || PASSTHROUGH_MIME.has(file.type)) return passthrough;
  if (file.size <= options.skipUnderBytes || file.size > MAX_DECODE_BYTES) return passthrough;

  const mimeType = targetMimeType(file.type, options.output);
  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch {
    return passthrough;
  }
  try {
    const longEdge = Math.max(decoded.width, decoded.height, 1);
    const scale = Math.min(1, options.maxEdge / longEdge);
    // Re-encoding a PNG at its own size usually grows it: the resize is the win.
    if (mimeType === "image/png" && scale === 1) return passthrough;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return passthrough;
    if (mimeType === "image/jpeg") {
      // JPEG has no alpha channel; without a backdrop the transparent pixels
      // come out black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await encodeCanvas(canvas, mimeType, options.quality);
    if (!blob || blob.type !== mimeType || blob.size >= file.size) return passthrough;
    return { blob, mimeType, originalBytes: file.size, bytes: blob.size, compressed: true };
  } finally {
    decoded.release();
  }
}
