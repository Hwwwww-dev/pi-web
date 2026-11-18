import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

/**
 * File extension → CodeMirror language, loaded on demand. Every entry is a
 * dynamic `import()` with a literal path, so a language's bytes only reach the
 * browser the first time a file of that kind is edited (the editor itself is
 * behind a `next/dynamic` boundary in FileViewer). A path with no entry here
 * edits as plain text — the mapping is deliberately independent of the files
 * route's EXT_TO_LANGUAGE, which serves Prism and knows far more grammars
 * than CodeMirror ships. Lezer packages win where both exist; the legacy
 * modes fill the gaps (shell, dockerfile, the C-likes without a package).
 */

type LezerModule = { extension: Extension };

function lezer(load: () => Promise<LezerModule>): Promise<Extension[]> {
  return load().then((m) => [m.extension]);
}

function legacy(load: () => Promise<{ parser: Parameters<typeof StreamLanguage.define>[0] }>): Promise<Extension[]> {
  return load().then((m) => [StreamLanguage.define(m.parser)]);
}

const LOADERS: Record<string, () => Promise<Extension[]>> = {
  js: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript() }))),
  mjs: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript() }))),
  cjs: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript() }))),
  jsx: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript({ jsx: true }) }))),
  ts: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript({ typescript: true }) }))),
  mts: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript({ typescript: true }) }))),
  cts: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript({ typescript: true }) }))),
  tsx: () => lezer(() => import("@codemirror/lang-javascript").then((m) => ({ extension: m.javascript({ typescript: true, jsx: true }) }))),
  json: () => lezer(() => import("@codemirror/lang-json").then((m) => ({ extension: m.json() }))),
  jsonl: () => lezer(() => import("@codemirror/lang-json").then((m) => ({ extension: m.json() }))),
  html: () => lezer(() => import("@codemirror/lang-html").then((m) => ({ extension: m.html() }))),
  htm: () => lezer(() => import("@codemirror/lang-html").then((m) => ({ extension: m.html() }))),
  vue: () => lezer(() => import("@codemirror/lang-html").then((m) => ({ extension: m.html() }))),
  svelte: () => lezer(() => import("@codemirror/lang-html").then((m) => ({ extension: m.html() }))),
  astro: () => lezer(() => import("@codemirror/lang-html").then((m) => ({ extension: m.html() }))),
  css: () => lezer(() => import("@codemirror/lang-css").then((m) => ({ extension: m.css() }))),
  scss: () => lezer(() => import("@codemirror/lang-sass").then((m) => ({ extension: m.sass({ indented: false }) }))),
  sass: () => lezer(() => import("@codemirror/lang-sass").then((m) => ({ extension: m.sass({ indented: true }) }))),
  less: () => lezer(() => import("@codemirror/lang-less").then((m) => ({ extension: m.less() }))),
  md: () => lezer(() => import("@codemirror/lang-markdown").then((m) => ({ extension: m.markdown() }))),
  markdown: () => lezer(() => import("@codemirror/lang-markdown").then((m) => ({ extension: m.markdown() }))),
  mdx: () => lezer(() => import("@codemirror/lang-markdown").then((m) => ({ extension: m.markdown() }))),
  py: () => lezer(() => import("@codemirror/lang-python").then((m) => ({ extension: m.python() }))),
  pyi: () => lezer(() => import("@codemirror/lang-python").then((m) => ({ extension: m.python() }))),
  go: () => lezer(() => import("@codemirror/lang-go").then((m) => ({ extension: m.go() }))),
  rs: () => lezer(() => import("@codemirror/lang-rust").then((m) => ({ extension: m.rust() }))),
  java: () => lezer(() => import("@codemirror/lang-java").then((m) => ({ extension: m.java() }))),
  c: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  h: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  cpp: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  cc: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  cxx: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  hpp: () => lezer(() => import("@codemirror/lang-cpp").then((m) => ({ extension: m.cpp() }))),
  php: () => lezer(() => import("@codemirror/lang-php").then((m) => ({ extension: m.php() }))),
  sql: () => lezer(() => import("@codemirror/lang-sql").then((m) => ({ extension: m.sql() }))),
  xml: () => lezer(() => import("@codemirror/lang-xml").then((m) => ({ extension: m.xml() }))),
  yaml: () => lezer(() => import("@codemirror/lang-yaml").then((m) => ({ extension: m.yaml() }))),
  yml: () => lezer(() => import("@codemirror/lang-yaml").then((m) => ({ extension: m.yaml() }))),
  sh: () => legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ parser: m.shell }))),
  bash: () => legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ parser: m.shell }))),
  zsh: () => legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ parser: m.shell }))),
  fish: () => legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ parser: m.shell }))),
  ps1: () => legacy(() => import("@codemirror/legacy-modes/mode/powershell").then((m) => ({ parser: m.powerShell }))),
  psm1: () => legacy(() => import("@codemirror/legacy-modes/mode/powershell").then((m) => ({ parser: m.powerShell }))),
  bat: () => legacy(() => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ parser: m.properties }))),
  cmd: () => legacy(() => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ parser: m.properties }))),
  ini: () => legacy(() => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ parser: m.properties }))),
  cfg: () => legacy(() => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ parser: m.properties }))),
  properties: () => legacy(() => import("@codemirror/legacy-modes/mode/properties").then((m) => ({ parser: m.properties }))),
  env: () => legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => ({ parser: m.shell }))),
  toml: () => legacy(() => import("@codemirror/legacy-modes/mode/toml").then((m) => ({ parser: m.toml }))),
  dockerfile: () => legacy(() => import("@codemirror/legacy-modes/mode/dockerfile").then((m) => ({ parser: m.dockerFile }))),
  diff: () => legacy(() => import("@codemirror/legacy-modes/mode/diff").then((m) => ({ parser: m.diff }))),
  patch: () => legacy(() => import("@codemirror/legacy-modes/mode/diff").then((m) => ({ parser: m.diff }))),
  lua: () => legacy(() => import("@codemirror/legacy-modes/mode/lua").then((m) => ({ parser: m.lua }))),
  rb: () => legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => ({ parser: m.ruby }))),
  swift: () => legacy(() => import("@codemirror/legacy-modes/mode/swift").then((m) => ({ parser: m.swift }))),
  kt: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.kotlin }))),
  kts: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.kotlin }))),
  cs: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.csharp }))),
  scala: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.scala }))),
  dart: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.dart }))),
  groovy: () => legacy(() => import("@codemirror/legacy-modes/mode/groovy").then((m) => ({ parser: m.groovy }))),
  gradle: () => legacy(() => import("@codemirror/legacy-modes/mode/groovy").then((m) => ({ parser: m.groovy }))),
  pl: () => legacy(() => import("@codemirror/legacy-modes/mode/perl").then((m) => ({ parser: m.perl }))),
  mm: () => legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => ({ parser: m.objectiveC }))),
  cmake: () => legacy(() => import("@codemirror/legacy-modes/mode/cmake").then((m) => ({ parser: m.cmake }))),
};

/** Whether editing a file of this extension gets highlighting. */
export function hasCmLanguage(ext: string): boolean {
  return ext.toLowerCase() in LOADERS;
}

/**
 * Load the language for `filePath`, or null when none matches (the editor
 * stays plain text, no error). Extension-less names known as files of their
 * own (`Dockerfile`, `.env` handled by its basename in FileEditor) map by
 * their full lowercase name first.
 */
export function loadCmLanguageForPath(filePath: string): Promise<Extension[]> | null {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const lower = base.toLowerCase();
  if (!lower.includes(".")) {
    const whole = LOADERS[lower];
    if (whole) return whole();
    // A Makefile has no legacy mode; it edits as plain text.
    return null;
  }
  if (lower.startsWith(".env")) {
    return LOADERS.env();
  }
  const ext = lower.split(".").pop()!;
  const load = LOADERS[ext];
  return load ? load() : null;
}
