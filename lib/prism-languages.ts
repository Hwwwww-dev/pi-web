import { refractor } from "refractor";

// PrismLight（react-syntax-highlighter 的 core-only 构建）与 HighlightedCode 共用
// refractor 核心单例（lib/core.js），语言块注册进同一实例。refractor 主包
// （lib/common.js）已静态携带常用语言；其余语言按 fence 名从映射表逐个拉
// `refractor/<lang>`（各自小块，拉过即注册），不再把 ~300 种语言的
// refractor/all（~500KB 单 chunk）在首个代码块一次拉全。映射表外的名字与
// 未知语言一样：不注册，按纯文本画。

type LanguageLoader = () => Promise<{ default: Parameters<typeof refractor.register>[0] }>;

const languageLoaders: Record<string, LanguageLoader> = {
  jsx: () => import("refractor/jsx"),
  tsx: () => import("refractor/tsx"),
  powershell: () => import("refractor/powershell"),
  docker: () => import("refractor/docker"),
  dockerfile: () => import("refractor/docker"),
  toml: () => import("refractor/toml"),
  graphql: () => import("refractor/graphql"),
  mermaid: () => import("refractor/mermaid"),
  dart: () => import("refractor/dart"),
  scala: () => import("refractor/scala"),
  haskell: () => import("refractor/haskell"),
  elixir: () => import("refractor/elixir"),
  erlang: () => import("refractor/erlang"),
  clojure: () => import("refractor/clojure"),
  groovy: () => import("refractor/groovy"),
  gradle: () => import("refractor/gradle"),
  fsharp: () => import("refractor/fsharp"),
  ocaml: () => import("refractor/ocaml"),
  latex: () => import("refractor/latex"),
  tex: () => import("refractor/latex"),
  vim: () => import("refractor/vim"),
  matlab: () => import("refractor/matlab"),
  cmake: () => import("refractor/cmake"),
  zig: () => import("refractor/zig"),
  nim: () => import("refractor/nim"),
  crystal: () => import("refractor/crystal"),
  solidity: () => import("refractor/solidity"),
  nginx: () => import("refractor/nginx"),
  protobuf: () => import("refractor/protobuf"),
  pascal: () => import("refractor/pascal"),
  fortran: () => import("refractor/fortran"),
  racket: () => import("refractor/racket"),
  scheme: () => import("refractor/scheme"),
  lisp: () => import("refractor/lisp"),
  hcl: () => import("refractor/hcl"),
  plsql: () => import("refractor/plsql"),
  abnf: () => import("refractor/abnf"),
  asciidoc: () => import("refractor/asciidoc"),
  rest: () => import("refractor/rest"),
  nix: () => import("refractor/nix"),
  handlebars: () => import("refractor/handlebars"),
  pug: () => import("refractor/pug"),
  mongodb: () => import("refractor/mongodb"),
};

const pendingLanguages = new Map<string, Promise<void>>();

/** 该语言（或别名）是否已注册进 PrismLight 渲染用的核心。 */
export function prismLanguagesLoaded(language: string | undefined): boolean {
  return language !== undefined && refractor.registered(language);
}

/**
 * 按需加载一种语言；已注册或映射表外的名字直接放行（后者保持未注册）。
 * 加载失败的块保持纯文本，下一个挂载的高亮器会重试。
 */
export function loadPrismLanguages(language: string): Promise<void> {
  if (refractor.registered(language)) return Promise.resolve();
  const loader = languageLoaders[language];
  if (!loader) return Promise.resolve();
  let pending = pendingLanguages.get(language);
  if (!pending) {
    pending = loader().then(
      (mod) => {
        pendingLanguages.delete(language);
        refractor.register(mod.default);
      },
      (error: unknown) => {
        pendingLanguages.delete(language);
        throw error;
      },
    );
    pendingLanguages.set(language, pending);
  }
  return pending;
}
