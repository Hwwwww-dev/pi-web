"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { refractor } from "refractor";
import renderSyntaxNode from "react-syntax-highlighter/dist/esm/create-element";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { takeHighlightBudget, waitForHighlight } from "@/lib/highlight-queue";
import { prismLanguagesLoaded } from "@/lib/prism-languages";

/**
 * Prism tokens for a code body that renders inside the caller's own <pre>
 * (a tool card's `CodeBlockContent`), so a card keeps its frame, wrapping and
 * typography and only gains colors.
 *
 * Same rules as CodeBlock's fences: the languages load once in a chunk of their
 * own (`lib/prism-languages.ts`), and a block past this task's highlight budget
 * stays plain monospace until an idle slice lets it take its language.
 */
export const HighlightedCode = memo(function HighlightedCode({ code, language }: {
  code: string;
  language?: string;
}) {
  const { isDark } = useTheme();
  const languagesReady = usePrismLanguages();
  const plain = !language || language === "text" || language === "plaintext";
  const [highlighted, setHighlighted] = useState(
    () => !plain && prismLanguagesLoaded() && takeHighlightBudget(code.length),
  );
  useEffect(() => {
    if (plain || highlighted || !languagesReady) return;
    return waitForHighlight(() => setHighlighted(true));
  }, [plain, highlighted, languagesReady]);

  const tokens = useMemo(() => {
    if (!highlighted || !language) return null;
    const stylesheet = isDark ? vscDarkPlus : vs;
    try {
      // refractor's core holds the grammars `refractor/all` registered, and
      // throws for one this build lacks: that body renders as plain text.
      // The body's tokens sit straight on the returned root; a `<code>` wrapper
      // is for the shape an older refractor returned.
      const root = refractor.highlight(code, language);
      const first = root.children[0];
      const body = first && first.type === "element" && first.tagName === "code" ? first.children : root.children;
      const children = body.filter((node) => node.type === "element" || node.type === "text");
      if (children.length === 0) return null;
      return children.map((node, index) =>
        renderSyntaxNode(
          // SAFETY: refractor emits hast, and create-element renders exactly that
          // tree at runtime; it only types `tagName` as a JSX component so its own
          // highlighter can swap tags ("pre"/"code").
          { node, stylesheet, useInlineStyles: true, key: `token-${index}` } as unknown as Parameters<typeof renderSyntaxNode>[0],
        ),
      );
    } catch {
      return null;
    }
  }, [code, highlighted, isDark, language]);

  return <span data-slot="highlighted-code">{tokens ?? code}</span>;
});
