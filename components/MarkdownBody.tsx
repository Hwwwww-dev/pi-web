"use client";

import { createContext, Fragment, memo, useContext, useMemo, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { useRehypeKatexVersion } from "@/hooks/useRehypeKatexVersion";
import { copyText } from "@/lib/clipboard";
import { parseFileOpenOptions, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { isExternalMarkdownHref, jumpToMarkdownFragment, markdownAppUrlTransform, markdownDocumentRehypePlugins, markdownRehypePlugins, markdownRemarkPlugins, markdownTextLayoutRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { isAudioPath, isVideoPath } from "@/lib/file-types";
import { parseFenceBlock, splitMarkdownBlocks } from "@/lib/markdown-blocks";
import { ImagePreview } from "./ImagePreview";
import { getImageSize, rememberImageSize } from "@/lib/image-size-cache";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { SvgBlock } from "./SvgBlock";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  /** A document reader's own links: relative paths and `#headings` stay in the reader. */
  onNavigateLink?: (href: string) => void;
  /** Text the user typed: every line ending is a line break and raw HTML shows as text, as in pi's TUI. */
  keepLineBreaks?: boolean;
  /** An extension's custom message: keepLineBreaks, plus each paragraph line's indent, as in pi's TUI. */
  keepTextLayout?: boolean;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const mediaSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // `![](take.wav)` is how a model shows a sound or clip it made, and an <img>
  // cannot play it. The file API already streams both with range requests.
  const mediaPath = filePath ?? href?.split(/[?#]/, 1)[0] ?? "";
  const label = alt?.trim() ? alt : undefined;
  if (isAudioPath(mediaPath)) {
    return <audio controls preload="metadata" src={mediaSrc} aria-label={label} />;
  }
  if (isVideoPath(mediaPath)) {
    return <video controls playsInline preload="metadata" src={mediaSrc} aria-label={label} />;
  }
  // Dynamic local paths are served directly by the file API.
  // 尺寸缓存：重挂载（回合完成的消息重读）时按首次加载的自然尺寸预留
  // 盒子，避免图片重复跳动。{...props} 在后，作者手写的尺寸优先。
  const cachedSize = mediaSrc ? getImageSize(mediaSrc) : undefined;
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaSrc}
      alt={alt ?? ""}
      loading="lazy"
      width={cachedSize?.width}
      height={cachedSize?.height}
      onLoad={(event) => {
        event.currentTarget.dataset.loaded = "1";
        if (!mediaSrc) return;
        const el = event.currentTarget;
        rememberImageSize(mediaSrc, el.naturalWidth, el.naturalHeight);
      }}
      onError={(event) => { event.currentTarget.dataset.loaded = "1"; }}
      ref={(el) => { if (el?.complete) el.dataset.loaded = "1"; }}
      className="opacity-0 transition-opacity duration-200 data-[loaded=1]:opacity-100"
      {...props}
    />
  );
  if (!mediaSrc || insideLink) return image;
  return (
    <ImagePreview src={mediaSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

/**
 * A display formula with a Copy button for its LaTeX, as code fences have
 * (#1380). The button sits outside KaTeX's scroller, so it stays put while a
 * wide formula scrolls; it shows on hover where there is one (app/globals.css).
 */
function MathDisplay({ source, children }: { source: string; children: ReactNode }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(source).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="markdown-math-display">
      {children}
      {/* `markdown-math-copy` is the hover-reveal positioning hook (app/globals.css). */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={copy}
        className="markdown-math-copy"
      >
        {copied ? t("i18n.copied") : t("i18n.copy")}
      </Button>
    </div>
  );
}

interface MarkdownBlockProps {
  markdown: string;
  remarkPlugins: typeof markdownRemarkPlugins;
  urlTransform: typeof markdownUrlTransform;
  rehypePlugins: typeof markdownRehypePlugins;
  components: Components;
}

/** One parse; skipped while its text and renderers stay the same. */
const MarkdownBlock = memo(function MarkdownBlock({ markdown, remarkPlugins, urlTransform, rehypePlugins, components }: MarkdownBlockProps) {
  // KaTeX 就绪前公式按普通文本画出；这里订阅就绪事件重画一次换回 KaTeX。
  // 预检只圈可能含公式的块，纯文本块不被这次重画惊动。
  useRehypeKatexVersion(markdown.includes("$") || markdown.includes("\\(") || markdown.includes("```math"));
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
});

/** A fenced block: a diagram's block for mermaid and svg, else a code block. */
function renderFence(lang: string, code: string, isStreaming: boolean | undefined) {
  if (lang === "mermaid") return <MermaidBlock code={code} isStreaming={isStreaming} defaultPreview />;
  if (lang === "svg") return <SvgBlock code={code} isStreaming={isStreaming} />;
  return <CodeBlock code={code} lang={lang} isStreaming={isStreaming} />;
}

export const MarkdownBody = memo(function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onNavigateLink, keepLineBreaks, keepTextLayout }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // A streaming reply grows by a few characters per chunk; parsing all of it
  // each time made a long reply quadratic. Its finished blocks keep their
  // parse and only the last is parsed again. A finished message is one block.
  const blocks = useMemo(
    () => (isStreaming ? splitMarkdownBlocks(normalizedMarkdown) : [normalizedMarkdown]),
    [isStreaming, normalizedMarkdown],
  );
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) return renderFence(lang, raw.replace(/\n$/, ""), isStreaming);
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      if (onNavigateLink && href && !isExternalMarkdownHref(href)) {
        // No href: a middle-click or "Open in new tab" would load the path on the app's own URL.
        const navigate = () => onNavigateLink(href);
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a {...props} role="link" tabIndex={0} onClick={navigate} onKeyDown={(event) => { if (event.key === "Enter") navigate(); }}>
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }
      if (href?.startsWith("#")) {
        // An in-page link: never a second tab of Pi Web.
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} onClick={jumpToMarkdownFragment}>
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parseFileOpenOptions(href));
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    ol({ node, start, style, ...props }) {
      // An outside marker wider than the list's left padding is clipped by
      // .markdown-body's overflow-x, so the padding follows the largest number.
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const digits = String(Math.abs((start ?? 1) + Math.max(items, 1) - 1)).length;
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: Math.max(digits, 2) }} {...props} />;
    },
    div({ node, children, ...props }) {
      const source = node?.properties?.dataMathSource;
      if (typeof source === "string") return <MathDisplay source={source}>{children}</MathDisplay>;
      return <div {...props}>{children}</div>;
    },
    table({ children }) {
      // The frame draws the border; the scroller inside it fades its scrolled
      // edges, which on the bordered box would fade the border too.
      return (
        <div className="markdown-table-frame">
          <div className="markdown-table-wrap">
            <table>{children}</table>
          </div>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onNavigateLink]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => {
        // While streaming, a block that is only a code fence skips the markdown
        // parser: a long fence grows every chunk, and parsing all of it again
        // each time was most of a streamed reply's work.
        const fence = isStreaming ? parseFenceBlock(block) : null;
        if (fence) return <Fragment key={index}>{renderFence(fence.lang, fence.code, true)}</Fragment>;
        return (
        <MarkdownBlock
          key={index}
          markdown={block}
          remarkPlugins={keepTextLayout ? markdownTextLayoutRemarkPlugins : keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins}
          urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
          rehypePlugins={onNavigateLink ? markdownDocumentRehypePlugins : markdownRehypePlugins}
          components={components}
        />
        );
      })}
    </div>
  );
});
