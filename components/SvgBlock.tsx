"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  DiagramZoomDialog,
  PreviewFrame,
  PreviewToggleButton,
  SvgDownloadButton,
  downloadSvgFile,
} from "./MermaidBlock";

const SVG_NS = "http://www.w3.org/2000/svg";

function parsedRoot(source: string, parser: DOMParser): Element | null {
  const doc = parser.parseFromString(source, "image/svg+xml");
  // A syntax error comes back as a <parsererror> element: the root in Firefox,
  // inside the partial document in Chrome and Safari.
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  return doc.documentElement;
}

/**
 * The fence's text as an SVG file, or null when it is not one: well-formed XML
 * with an <svg> root in the SVG namespace. An <svg> written into HTML needs no
 * xmlns, an SVG image does, so a root without one gets it.
 */
export function svgImageSource(code: string, parser: DOMParser): string | null {
  let source = code;
  let root = parsedRoot(source, parser);
  if (root?.localName === "svg" && root.namespaceURI === null && !root.hasAttribute("xmlns")) {
    source = code.replace(/<svg(?=[\s/>])/, `<svg xmlns="${SVG_NS}"`);
    root = parsedRoot(source, parser);
  }
  return root?.localName === "svg" && root.namespaceURI === SVG_NS ? source : null;
}

export function svgDataUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

/**
 * A ```svg fence, shown like a mermaid one. The picture is only ever an <img>:
 * the browser runs no script or event handler of an SVG image and loads
 * nothing it links to, so the fence's text never enters the page's DOM.
 */
export function SvgBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [unsizedUrl, setUnsizedUrl] = useState<string | null>(null);
  const previewVisible = showPreview && !isStreaming;
  // undefined: not parsed (a server render has no DOMParser).
  const source = useMemo(
    () => (previewVisible && typeof DOMParser !== "undefined" ? svgImageSource(code, new DOMParser()) : undefined),
    [code, previewVisible],
  );
  const url = useMemo(() => (source ? svgDataUrl(source) : null), [source]);

  const previewButton = useMemo(() => (
    <PreviewToggleButton
      isStreaming={isStreaming}
      previewVisible={previewVisible}
      onToggle={() => setShowPreview((v) => !v)}
      title={previewVisible ? t("i18n.showSvgSource") : t("i18n.previewSvg")}
    />
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang="svg" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const ready = url !== null && failedUrl !== url;
  // An SVG with neither a viewBox nor a width and height has no size of its own:
  // the `unsized` classes give it one when the load reports naturalWidth 0.
  const image = (baseClass: string, unsizedClass: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? undefined}
      alt={t("i18n.svgImage")}
      className={cn(baseClass, unsizedUrl === url && unsizedClass)}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) setUnsizedUrl(url);
      }}
      onError={() => setFailedUrl(url)}
    />
  );

  return (
    <PreviewFrame
      lang="svg"
      actions={
        <>
          {ready && source && <SvgDownloadButton onClick={() => downloadSvgFile(source, "image.svg")} />}
          {previewButton}
        </>
      }
    >
      {source === undefined ? (
        <div className="mermaid-block mermaid-block-loading" />
      ) : !ready ? (
        <div className="mermaid-block mermaid-block-error">{t("i18n.invalidSvg")}</div>
      ) : (
        <>
          {!zoomOpen && (
            <Button
              type="button"
              variant="ghost"
              className="block h-auto max-h-[min(600px,60dvh)] w-full overflow-auto rounded-none border-0 text-left font-normal text-inherit cursor-zoom-in hover:opacity-85"
              title={t("i18n.openSvgViewer")}
              aria-label={t("i18n.openSvgViewer")}
              onClick={() => setZoomOpen(true)}
            >
              {/* An SVG with only a viewBox has a ratio but no size, so it would
                  fill the column: capped like a diagram's height. */}
              {image("block h-auto w-auto max-w-full max-h-[min(360px,50dvh)]", "h-[240px] w-full")}
            </Button>
          )}
          {zoomOpen && (
            <DiagramZoomDialog title={t("i18n.svgImage")} label={t("i18n.svgViewer")} onClose={() => setZoomOpen(false)}>
              {image("block h-auto w-full", "aspect-[2/1]")}
            </DiagramZoomDialog>
          )}
        </>
      )}
    </PreviewFrame>
  );
}
