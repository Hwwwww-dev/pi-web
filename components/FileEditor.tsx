"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { loadCmLanguageForPath } from "@/lib/cm-language";

/**
 * The CodeMirror 6 editor behind FileViewer's edit mode. FileViewer imports
 * this component through `next/dynamic`, so CodeMirror and every language
 * package only load when a file is edited for the first time — never on page
 * load or while previewing. The editor itself is uncontrolled: the parent
 * reads the document through the handle (`getValue` / `reset`), the editor
 * only reports whether it differs from the value it was created with.
 */

export interface FileEditorHandle {
  /** The current document text (what a save writes back). */
  getValue: () => string;
  /** Swap the document for `value` (a reload or conflict recovery) and count it as unchanged. */
  reset: (value: string) => void;
  focus: () => void;
}

interface Props {
  filePath: string;
  initialValue: string;
  wrapLines: boolean;
  dark: boolean;
  /** Whether the document differs from the value the editor was created with. */
  onDirtyChange: (dirty: boolean) => void;
  /** Ctrl/Cmd+S inside the editor. */
  onSaveRequest: () => void;
}

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-panel, transparent)",
    color: "var(--color-muted-foreground)",
    border: "none",
    opacity: "0.85",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-accent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-accent)" },
});

export const FileEditor = forwardRef<FileEditorHandle, Props>(function FileEditor(
  { filePath, initialValue, wrapLines, dark, onDirtyChange, onSaveRequest },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const baselineRef = useRef(initialValue);
  const dirtyRef = useRef(false);
  const languageCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());

  // Latest callbacks without rebuilding the editor for a new closure.
  const dirtyCbRef = useRef(onDirtyChange);
  dirtyCbRef.current = onDirtyChange;
  const saveCbRef = useRef(onSaveRequest);
  saveCbRef.current = onSaveRequest;

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? "",
    reset: (value: string) => {
      const view = viewRef.current;
      if (!view) return;
      // The baseline moves before the dispatch: the update listener runs
      // synchronously and compares the new document against it.
      baselineRef.current = value;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      if (dirtyRef.current) {
        dirtyRef.current = false;
        dirtyCbRef.current(false);
      }
    },
    focus: () => viewRef.current?.focus(),
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const setDirty = (next: boolean) => {
      if (dirtyRef.current === next) return;
      dirtyRef.current = next;
      dirtyCbRef.current(next);
    };
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              saveCbRef.current();
              return true;
            },
          },
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          setDirty(update.state.doc.toString() !== baselineRef.current);
        }),
        languageCompartment.current.of([]),
        wrapCompartment.current.of(wrapLines ? [EditorView.lineWrapping] : []),
        themeCompartment.current.of(dark ? [oneDark] : []),
        baseTheme,
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    // Entering edit mode is an explicit act; the editor takes the keyboard.
    view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The editor is created once per mount (per file and viewer revision);
    // later prop changes go through the compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compartments change through dispatch, not a direct call: each helper
  // no-ops while the view is gone (mount/unmount races in StrictMode).
  const reconfigure = (compartment: Compartment, ...extensions: Extension[]) => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: compartment.reconfigure(extensions) });
  };

  useEffect(() => {
    let active = true;
    // A different file starts without a language, then loads its own: the
    // compartment is cleared first so the old grammar never colors the new
    // file while its package downloads.
    reconfigure(languageCompartment.current);
    const loaded = loadCmLanguageForPath(filePath);
    loaded
      ?.then((extensions) => {
        if (active) reconfigure(languageCompartment.current, ...extensions);
      })
      .catch(() => {
        // A language that fails to load edits as plain text, never an error.
      });
    return () => {
      active = false;
    };
  }, [filePath]);

  useEffect(() => {
    reconfigure(wrapCompartment.current, ...(wrapLines ? [EditorView.lineWrapping] : []));
  }, [wrapLines]);

  useEffect(() => {
    reconfigure(themeCompartment.current, ...(dark ? [oneDark] : []));
  }, [dark]);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
});
