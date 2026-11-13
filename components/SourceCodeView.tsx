"use client";

import { useMemo } from "react";
import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { FILE_CODE_STYLE, lineNumberGutter } from "./DiffView";

/** Above this line count the plain line grid renders instead of the tokenized
 * tree: one SyntaxHighlighter render must stay bounded, and a grid this plain
 * is cheap enough to keep for the whole file — there is no deferred swap to
 * the highlighter later. */
export const SOURCE_HIGHLIGHT_MAX_LINES = 3_000;

/** The same cap in characters, for files that are few lines of very long
 * lines (minified bundles): tokenizing 256 KB of one-liner is the same
 * multi-frame stall the line cap exists to prevent. */
export const SOURCE_HIGHLIGHT_MAX_CHARS = 64_000;

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

function SourceCodeRenderer({ rows, stylesheet, useInlineStyles, wrapLines }: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;

    return (
      <span
        className="file-source-line flex min-w-full"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          useInlineStyles,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className={`file-source-line-content min-w-0 flex-auto ${wrapLines ? "wrap-anywhere whitespace-pre-wrap" : "whitespace-pre"}`}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

/**
 * The one source renderer shared by the file viewer and the git commit diff, so
 * both show the same monospace grid, line numbers and wrap behavior.
 */
export function SourceCodeView({ content, language, wrapLines }: {
  content: string;
  language: string;
  wrapLines: boolean;
}) {
  const { isDark } = useTheme();
  const sourceLines = useMemo(() => content.split("\n"), [content]);
  const useLightweightSource = sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES
    || content.length > SOURCE_HIGHLIGHT_MAX_CHARS;
  // react-syntax-highlighter rebuilds every token element on each render, which
  // costs hundreds of milliseconds on large files. Cache the rendered trees so
  // unrelated re-renders (panel open/close, selection changes) reuse them as-is.
  const highlightedSource = useMemo(
    () => (
      <SyntaxHighlighter
        className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
        language={language === "text" ? "plaintext" : language}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        // react-syntax-highlighter configures its elements through inline-style
        // props (lineNumberStyle/customStyle/codeTagProps) — that API stays.
        lineNumberStyle={lineNumberGutter(sourceLines.length, true)}
        customStyle={{
          margin: 0,
          padding: 0,
          border: 0,
          background: "var(--background)",
          ...FILE_CODE_STYLE,
          width: wrapLines ? "100%" : "max-content",
          minWidth: "100%",
          minHeight: "100%",
          overflow: "visible",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            overflowWrap: wrapLines ? "anywhere" : "normal",
          },
        }}
        renderer={(rendererProps) => (
          <SourceCodeRenderer {...rendererProps} wrapLines={wrapLines} />
        )}
        wrapLongLines={wrapLines}
      >
        {content}
      </SyntaxHighlighter>
    ),
    [content, isDark, language, wrapLines],
  );
  const lightweightSourceLines = useMemo(
    () => useLightweightSource ? sourceLines.map((line, lineIndex) => (
      <span
        className="file-source-line flex min-w-full"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
      >
        {/* The gutter style is the shared DiffView constant (FileViewer's test
            reads it off this element as a literal style). */}
        <span aria-hidden="true" style={lineNumberGutter(sourceLines.length)}>
          {lineIndex + 1}
        </span>
        <span
          className={`file-source-line-content min-w-0 flex-auto ${wrapLines ? "wrap-anywhere whitespace-pre-wrap" : "whitespace-pre"}`}
        >
          {line}
        </span>
      </span>
    )) : null,
    [sourceLines, useLightweightSource, wrapLines],
  );

  if (useLightweightSource) {
    return (
      // FILE_CODE_STYLE is the shared code typography (DiffView constant);
      // the sizing wraps it as plain utilities.
      <div
        className="file-source-view is-lightweight min-h-full min-w-full bg-background"
        style={FILE_CODE_STYLE}
      >
        {lightweightSourceLines}
      </div>
    );
  }
  return highlightedSource;
}
