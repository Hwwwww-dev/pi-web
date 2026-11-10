"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import renderSyntaxNode from "react-syntax-highlighter/dist/esm/create-element";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { CheckIcon, CopyIcon, Maximize, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CodeBlock as CodeBlockFrame,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { copyText } from "@/lib/clipboard";
import { takeHighlightBudget, waitForHighlight } from "@/lib/highlight-queue";
import { prismLanguagesLoaded } from "@/lib/prism-languages";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

export function downloadSvgFile(xml: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadMermaidSvg(svg: SVGSVGElement): void {
  // Mermaid's HTML serialization can leave void tags such as <br> unclosed.
  downloadSvgFile(new XMLSerializer().serializeToString(svg), "mermaid-diagram.svg");
}

type RenderState =
  | { key: string; status: "loading" }
  | { key: string; status: "error" }
  | { key: string; status: "ready"; svg: string };

export function MermaidBlock({ code, isStreaming, defaultPreview = false }: MermaidBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(defaultPreview);
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;
  const previewVisible = showPreview && !isStreaming;

  useEffect(() => {
    if (!previewVisible) return;

    let cancelled = false;
    setRenderState({ key: currentKey, status: "loading" });

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setRenderState({ key: currentKey, status: "ready", svg: result.svg });
      }
    };

    render().catch(() => {
      if (!cancelled) setRenderState({ key: currentKey, status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, previewVisible]);

  const previewButton = useMemo(() => (
    <PreviewToggleButton
      isStreaming={isStreaming}
      previewVisible={previewVisible}
      onToggle={() => setShowPreview((v) => !v)}
      title={previewVisible ? t("i18n.showMermaidSource") : t("i18n.previewMermaid")}
    />
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body = renderState?.key === currentKey && renderState.status === "error" ? (
      <div className="mermaid-block mermaid-block-error p-3 overflow-x-auto bg-[color-mix(in_srgb,var(--background)_92%,var(--sidebar))] text-muted-foreground font-mono text-xs">{t("i18n.invalidMermaid")}</div>
    ) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
      <div className="mermaid-block mermaid-block-loading p-3 overflow-x-auto bg-[color-mix(in_srgb,var(--background)_92%,var(--sidebar))] min-h-[120px]" aria-label={t("i18n.renderingMermaid")} />
    ) : (
      <>
        {!zoomOpen && (
          <Button
            ref={previewRef}
            type="button"
            variant="ghost"
            className="block h-auto max-h-[min(600px,60dvh)] w-full overflow-auto rounded-none border-0 text-left font-normal text-inherit cursor-zoom-in hover:opacity-85"
            title={t("i18n.openMermaidViewer")}
            aria-label={t("i18n.openMermaidViewer")}
            onClick={() => setZoomOpen(true)}
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        )}
        {zoomOpen && (
          <DiagramZoomDialog title={t("i18n.mermaidDiagram")} label={t("i18n.mermaidViewer")} onClose={() => setZoomOpen(false)}>
            <div dangerouslySetInnerHTML={{ __html: renderState.svg }} />
          </DiagramZoomDialog>
        )}
      </>
    );

  return (
    <PreviewFrame
      lang="mermaid"
      actions={
        <>
          {renderState?.key === currentKey && renderState.status === "ready" && (
            <SvgDownloadButton
              onClick={() => {
                const svg = previewRef.current?.querySelector("svg");
                if (svg) downloadMermaidSvg(svg);
              }}
            />
          )}
          {previewButton}
        </>
      }
    >
      {body}
    </PreviewFrame>
  );
}

// What a previewed fence (mermaid here, svg in components/SvgBlock.tsx) shares:
// the header with its toggle and download button, and the zoom viewer.

/** Header tool buttons: the ghost xs Button, active = accent. */
export function PreviewToggleButton({ isStreaming, previewVisible, onToggle, title }: {
  isStreaming?: boolean;
  previewVisible: boolean;
  onToggle: () => void;
  /** What a click shows: the source while the preview is visible, else the preview. */
  title: string;
}) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onToggle}
      disabled={isStreaming}
      title={isStreaming ? t("i18n.previewAfterStreaming") : title}
      aria-pressed={previewVisible}
      className={previewVisible ? "bg-accent text-foreground" : undefined}
    >
      {previewVisible ? t("i18n.source") : t("i18n.preview")}
    </Button>
  );
}

export function SvgDownloadButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      title={`${t("i18n.downloadFile")} (SVG)`}
      aria-label={`${t("i18n.downloadFile")} (SVG)`}
      onClick={onClick}
    >
      SVG
    </Button>
  );
}

export function PreviewFrame({ lang, actions, children }: { lang: string; actions: ReactNode; children: ReactNode }) {
  return (
    <CodeBlockFrame className="w-full min-w-0 max-w-full">
      <CodeBlockHeader className="border-b px-2.5 py-1">
        <CodeBlockTitle className="font-mono text-xs font-medium text-muted-foreground">{lang}</CodeBlockTitle>
        <CodeBlockActions className="gap-1">{actions}</CodeBlockActions>
      </CodeBlockHeader>
      {children}
    </CodeBlockFrame>
  );
}

export function DiagramZoomDialog({ title, label, onClose, children }: {
  title: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="mermaid-zoom-dialog w-screen max-w-none h-dvh max-h-none m-0 border-0 bg-background p-0 text-foreground backdrop:bg-black/35"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mermaid-zoom-layout grid grid-rows-[auto_minmax(0,1fr)] h-full">
        <div className="mermaid-zoom-toolbar flex min-h-10 items-center gap-2.5 border-b border-border bg-sidebar px-2.5 py-[7px] max-[480px]:px-2">
          <span className="mermaid-zoom-title min-w-0 overflow-hidden font-mono text-xs font-semibold text-ellipsis whitespace-nowrap text-muted-foreground max-[480px]:text-[10px]">{title}</span>
          <div className="mermaid-zoom-actions ml-auto flex items-center gap-1.5">
            <div className="flex h-6 items-center overflow-hidden rounded-md border border-border bg-background">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-[22px] rounded-none"
                onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                title={t("i18n.zoomOut")}
                aria-label={t("i18n.zoomOut")}
              >
                <Minus strokeWidth={1.8} />
              </Button>
              <Separator orientation="vertical" className="h-[22px]" />
              <span className="min-w-12 text-center font-mono text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <Separator orientation="vertical" className="h-[22px]" />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-[22px] rounded-none"
                onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                title={t("i18n.zoomIn")}
                aria-label={t("i18n.zoomIn")}
              >
                <Plus strokeWidth={1.8} />
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setZoom(1)}
              title={t("i18n.fitToWidth")}
              aria-label={t("i18n.fitToWidth")}
            >
              <Maximize strokeWidth={1.8} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <X strokeWidth={1.8} />
            </Button>
          </div>
        </div>
        <div
          className="mermaid-zoom-viewport min-h-0 min-w-0 overflow-auto bg-background p-6 [-webkit-overflow-scrolling:touch] max-[480px]:p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {/* The zoom factor is a computed width, not a static presentation.
              mermaid 生成的 svg 的块级铺满规则留在 globals（.mermaid-zoom-canvas svg）。 */}
          <div className="mermaid-zoom-canvas mx-auto border border-border rounded-(--radius-sm) bg-sidebar p-3 transition-[width] duration-150 ease-[ease]" style={{ width: `${zoom * 100}%` }}>
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  isStreaming?: boolean;
}

// Prism's light theme uses backgroundColor, while its dark theme uses the
// background shorthand. Keep the pre background solely in customStyle so a
// theme switch cannot remove/update one and reset the other in React's diff.
const codeBlockDarkTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
  },
};
delete codeBlockDarkTheme['pre[class*="language-"]'].background;

type CodeLinesProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0];

/**
 * A fence's lines, each a row of its number and its text: long lines wrap, as
 * in pi's TUI, and a wrapped line goes on under its own text, never under the
 * number. The text keeps the row's own classes, which color the later lines of
 * a token that spans several (a block comment). While an extension dialog
 * measures its fences unwrapped (ChatWindow toggles body's
 * .extension-dialog-measuring), the text stops wrapping.
 */
function renderCodeLines({ rows, stylesheet, useInlineStyles }: CodeLinesProps) {
  return rows.map((row, index) => {
    const children = row.children ?? [];
    const number = children[0]?.properties?.className.includes("react-syntax-highlighter-line-number") ? children[0] : null;
    const text = {
      ...row,
      properties: {
        ...row.properties,
        className: [
          ...(row.properties?.className ?? []),
          "markdown-code-line-text",
          "min-w-0 flex-1 basis-0 whitespace-pre-wrap [overflow-wrap:anywhere] in-[.extension-dialog-measuring]:whitespace-pre",
        ],
      },
      children: number ? children.slice(1) : children,
    };
    return (
      <span key={index} className="markdown-code-line flex">
        {number && renderSyntaxNode({ node: number, stylesheet, useInlineStyles, key: "number" })}
        {renderSyntaxNode({ node: text, stylesheet, useInlineStyles, key: "text" })}
      </span>
    );
  });
}

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for mermaid blocks and for all non-mermaid code fences.
 *
 * Memoized: parent markdown re-renders (e.g. streaming updates elsewhere in
 * the message list) must not re-run Prism tokenization on unchanged code.
 * While the owning message is still streaming, the block renders as plain
 * monospace text — highlighting a growing block re-tokenizes all of it on
 * every chunk, which is the single most expensive part of streamed rendering.
 * A finished block past this task's highlight budget (lib/highlight-queue.ts),
 * or mounted before the Prism languages have loaded (lib/prism-languages.ts),
 * renders through the same highlighter as `text` (same lines, numbers and
 * box, no tokens) until an idle slice lets it take its language.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang, headerAction, isStreaming }: CodeBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  // Loading starts with the first block, streaming or not, so a streamed
  // reply usually finds the languages ready when it ends.
  const languagesReady = usePrismLanguages();
  const [highlighted, setHighlighted] = useState(
    () => !isStreaming && prismLanguagesLoaded() && takeHighlightBudget(code.length),
  );

  useEffect(() => {
    if (isStreaming || highlighted || !languagesReady) return;
    return waitForHighlight(() => setHighlighted(true));
  }, [isStreaming, highlighted, languagesReady]);

  const copy = () => {
    copyText(code).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <CodeBlockFrame className="w-full min-w-0 max-w-full">
      <CodeBlockHeader className="border-b px-2.5 py-1">
        <CodeBlockTitle className="font-mono text-xs font-medium text-muted-foreground">{lang || "text"}</CodeBlockTitle>
        <CodeBlockActions className="gap-1">
          {headerAction}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={copy}
            title={copied ? t("i18n.copied") : t("i18n.copy")}
            aria-label={copied ? t("i18n.copied") : t("i18n.copy")}
            className={copied ? "text-primary" : "text-muted-foreground"}
          >
            {copied ? <CheckIcon strokeWidth={1.8} /> : <CopyIcon strokeWidth={1.8} />}
          </Button>
        </CodeBlockActions>
      </CodeBlockHeader>
      {isStreaming ? (
        <CodeBlockContent
          wrap
          className="bg-[color-mix(in_srgb,var(--background)_92%,var(--sidebar))] px-[13px] py-[11px] text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] leading-[1.62]"
        >
          {code}
        </CodeBlockContent>
      ) : (
        <SyntaxHighlighter
          language={highlighted ? lang || "text" : "text"}
          style={isDark ? codeBlockDarkTheme : vs}
          showLineNumbers
          lineNumberStyle={{ color: "var(--muted-foreground)", fontStyle: "normal", flexShrink: 0 }}
          renderer={renderCodeLines}
          // Style object by API: the highlighter applies it as inline style on
          // the <pre> it renders, and its theme's own inline styles can only
          // be overridden in kind, so this cannot become a utility class.
          customStyle={{
            margin: 0,
            padding: "11px 13px",
            fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.62,
            fontWeight: "var(--font-mono-weight)",
            // The light `vs` theme puts its own 1px #ddd border on <pre>; the
            // ui CodeBlock frame is the only border.
            border: "none",
            borderRadius: 0,
            backgroundColor: "color-mix(in srgb, var(--background) 92%, var(--sidebar))",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)", fontWeight: "var(--font-mono-weight)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </CodeBlockFrame>
  );
});
