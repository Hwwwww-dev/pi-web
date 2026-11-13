# Pi Web - Development Notes

A browser UI for the pi coding agent. This checkout is a fork of `agegr/pi-web`
(`origin` is `Hwwwww-dev/pi-web`), and upstream releases are merged by hand. It
reads the same local configuration and session files as pi, so most of what
follows is about the wrapper, not a second implementation of the agent.

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit` · Lint: `npm run lint` · Tests: `npm test`

### Dev server troubleshooting

- First run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse a healthy Pi Web process. A second `next dev` on another port is no workaround: both contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph, not a broken server or source. Use the browser's explicit reload, then compare the server log and a direct HTTP/API request.
- Restart only when the failure reproduces from a fresh page and the server-side checks fail too: stop that exact dev process gracefully, move `.next` into a `mktemp -d` backup, restart with `npm run dev`.
- Never fall back to `next dev --webpack`: the dev graph can fail on `undici` imports such as `node:console`. Development uses Turbopack.
- `next dev` may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md`. It is tooling output: check `git status` and keep it out of unrelated commits.

### Upgrading pi

pi's packages up to 1.2.0 depend on each other with `^` ranges (1.3.0 pins them exactly), and the published pi-web's dependencies resolve afresh on install (no lockfile ships). Install every `@earendil-works/*` package the tree holds, the SDK's own dependencies included (`pi-codemode`, `pi-mcp`, `pi-telemetry`, …), with `npm install --save-exact`, so npm reuses those exact versions for the SDK's ranges. `lib/pi-packages.test.mjs` fails on any pi package that is not pinned that way; pi-web 0.12.0 pinned four, and installs after pi 1.2.0 paired pi-coding-agent 1.1.0 with pi-codemode 1.2.0.

## Hard rules

- **Never run `next build` in the main clone while developing.** It pollutes `.next/` and breaks `npm run dev`. The production bundle is built in the run worktree (see Fork workflow).
- **Restart the production server yourself, detached, after the reply.** Never run it in the foreground and never call `~/run-pi-web.sh` directly in the turn: the restart kills the process that may be hosting this very chat. Use `nohup bash -c 'sleep 3; bash ~/run-pi-web-restart.sh' >/dev/null 2>&1 &` (the 3s delay lets this reply reach the browser before the process dies; the script `setsid`s itself, restarts, probes `127.0.0.1:30141` up to 3 times, and logs to `~/.pi-web/logdir/pi-web-restart.log`). Schedule it last — write the answer first, then fire the restart, so a broken boot never costs the reply.
- **No RegExp lookbehind in client code** (`(?<=`, `(?<!`): SWC cannot downlevel it and Safari parses it only from 16.4. Emulate it with `replaceNotPrecededBy()` (`lib/markdown.ts`), or the runtime `new RegExp` inside `try` that `lib/gfm-autolink-email-loader.cjs` uses. Keep the `browserslist` Safari/iOS entries at 16.2: raising them re-breaks the client bundle on older devices.
- **`/api/files` is not a filesystem browser.** `isPathWithinRoots()` (`lib/path-security.ts`) is the one security boundary; never add a second check or a route that skips it.
- **Extensions written for the pi CLI must behave the same here.** Fix display problems in the web client; never add pi-web-only options or fields to `ctx.ui.*` options or `extension_ui_request`. pi's TUI is the reference for what an extension is asking for.
- **pi packages stay pinned exactly.** `lib/pi-packages.test.mjs` fails on any `@earendil-works/*` package not installed with `--save-exact` (see Upgrading pi).
- **CI runs on `main` and pull requests only** (`.github/workflows/ci.yml`). A push to `dev` is not checked, so run `npm test`, `node_modules/.bin/tsc --noEmit` and `npm run lint` yourself before building production.
- **iOS PWA 键盘机制是钉高，不是跟随。** 键盘期必须把 html/body/.app-shell 钉在全高水位（`--keyboard-full-height`，`hooks/useViewportHeight.ts` 写入），让文档比缩小后的视口多出键盘一截，iOS 才会原生滚动 scrollView 推走页头。绝不让高度跟随 dvh 缩（文档与视口等高，无处可滚，页头永远钉顶）；绝不给壳层加 transform/位移/过渡（iOS 按未变换位置算滚动量，滚到的下半截是空白）。改键盘机制必须真机复验（完全重开 PWA）；细节读 `docs/agents/client-platform.md`。

## Fork workflow (production)

Development happens in the main clone (`~/Projects/ai-project/pi-web`, branch `dev`): edit, commit, push to `origin`. Production runs from the worktree `~/Projects/ai-project/pi-web-run` (branch `run`, tracking `origin/dev`).

Upstream releases are merged by hand. Cut `backup/dev-pre-merge-<version>` from `dev` first, so the pre-merge state stays one branch away.

```bash
# 1. From the main clone: push dev, then sync the run worktree and build the production bundle
git push origin dev
bash ~/run-pi-web-build.sh   # cd pi-web-run; git fetch; git reset --hard origin/dev; npm ci; npm run build

# 2. Restart, detached — always the last action of the turn, after the answer is written.
#    Foreground is not allowed: the restart stops the server that may host this session.
#    The 3s delay lets the reply reach the browser before the process dies.
nohup bash -c 'sleep 3; bash ~/run-pi-web-restart.sh' >/dev/null 2>&1 &

# 3. Verify (the restart script already probes; re-check if you need to confirm)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:30141/   # expect 200
cat ~/.pi-web/logdir/pi-web.pid
tail -3 ~/.pi-web/logdir/pi-web-restart.log
```

- pid file: `~/.pi-web/logdir/pi-web.pid`; logs: `~/.pi-web/logdir/pi-web.log` (append-only, survives restarts); restart log: `~/.pi-web/logdir/pi-web-restart.log`.
- `~/run-pi-web.sh` is the launcher the restart script calls; it is not meant to be run ad hoc from a turn. Build freely; restart only through the detached `run-pi-web-restart.sh` path above.
- Never start production from the main clone: a `next start` there serves the wrong checkout.
- Keep the run worktree clean; the build script hard-resets it to `origin/dev`.
- If `npm ci` fails with spurious sync errors while another build is running, rerun it once both builds have stopped (concurrent installs corrupt the tree).
- iOS PWA verification: fully close and reopen the PWA first, or the old JS bundle stays cached.
- This fork publishes nothing: no npm package, no container image. `package.json` keeps the upstream name and version.

## Architecture

```text
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** is read-only and creates no AgentSession.

- **Browsing** (read-only, no AgentSession): `GET /api/sessions` lists `~/.pi/agent/sessions/`; `GET /api/sessions/[id]` reads the `.jsonl` through SDK `SessionManager` helpers and `lib/session-reader.ts`, or an open wrapper's in-memory `SessionManager`. `GET /api/agent/running` snapshots the running ids.
- **Sending**: `POST /api/agent/[id]` → `startRpcSession()` (`lib/rpc-manager.ts`) creates the AgentSession in-process (`createAgentSessionFromServices()`); `session.send(cmd)` → `session.prompt()`.
- **Events**: `GET /api/agent/[id]/events` streams SSE `data: {...}` from `session.onEvent()`, fed by `session.subscribe()`.
- **Product scope**: a light web wrapper around pi, not an IDE or a platform of its own. Before adding a feature, check the out-of-scope list in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Extension compatibility (principle)**: extensions written for the pi CLI must behave the same here. Fix display problems in the web client; never add pi-web-only options or fields to the extension API (`ctx.ui.*` options, `extension_ui_request`). pi's TUI (`node_modules/@earendil-works/pi-tui`) is the reference for what an extension asking for something means.

## File Map

```text
app/            Next.js App Router: the page and the API routes under app/api/**
components/     React UI: AppShell, SessionSidebar/SessionTree, ChatWindow,
                MessageView with transcript/, FileExplorer/FileViewer,
                SettingsPanel and its panels, ui/ (shadcn, never edited by hand)
hooks/          Client state: useAgentSession (SSE, run state), sidebar, motion,
                keyboard, terminal, streaming selectors
lib/            Server and shared logic: rpc-manager (AgentSession wrappers),
                session reader/fork/delete/tree, session-ui-state, markdown,
                tool presets, MCP host and settings, models, worktrees,
                path-security (the file boundary), debug snapshots
public/         Static assets and PWA files
bin/            npm CLI entrypoint and launch option parsing
docs/agents/    Topic notes (below); docs/adr/ decisions; docs/specs/ past designs
e2e/            Playwright suites (npm run test:e2e)
```

Three API groups carry the app: `app/api/sessions/**` (read-only browsing of the JSONL files), `app/api/agent/**` (in-process AgentSession: state, commands, SSE) and `app/api/files/**` (the allow-listed file browser).

Every route and module, one line each: [docs/agents/file-map.md](docs/agents/file-map.md).

## Topic Notes

Design decisions and traps live in `docs/agents/`, one note per area. Read every note whose files a change touches before making it. Add new notes to the area's file, not here.

- [sessions.md](docs/agents/sessions.md): AgentSession lifecycle and shutdown, fork vs in-session branching, the sidebar's on-disk Fork, session file rewrites, toolCall normalization, a run's message keys across the file read, SSE reconnect and tool events, a tool card's flat arguments as rows, transcript system / usage / context-edit entries, running-state polling, custom-message collapsing, streamed chunks re-rendering only the reply, streaming markdown block by block, hand-written anchors in rendered Markdown landing after the sanitizer's id prefix, Windows drive-letter Markdown links becoming `file:///` before sanitizing, user messages' raw HTML shown as text, ```svg fences previewed only as an `<img>`, display math's Copy button, long thinking rendered in pieces, a finished turn's duration, history caches (tool-result images, subagent runs, session views) and deferred code highlighting with Prism languages loaded on demand, a patch shown in one column or two, the session sidebar (toolbar row and its brand, project groups, their order and display names, pins, archive, new-session project adoption, the files below the sessions or in a tab), the project/worktree bar above a fresh composer (the header: brand, then the bar) and what it carries across the remount, exported HTML, the extension status bar and its `command:` buttons, extension UI colors (pi's palette theme, the page's light/dark ANSI palette), cache and cost notices (`showCacheMissNotices`), the read-only Debug panel (connections, server state, sessions the server holds). Files: `lib/rpc-manager.ts`, `lib/session-reader.ts`, `lib/session-fork*.ts`, `lib/session-delete.ts`, `lib/normalize.ts`, `lib/message-keys.ts`, `lib/session-tree.ts`, `lib/session-ui-state*.ts`, `lib/sidebar-prefs.ts`, `lib/sidebar-actions.ts`, `lib/session-links.ts`, `lib/favicon-badge.ts`, `lib/new-session-context.ts`, `hooks/useAgentSession.ts`, `hooks/useSessionUiState.ts`, `hooks/useSidebarMotion.ts`, `hooks/useGroupDrag.ts`, `hooks/useFilesPlacement.ts`, `hooks/useResizablePanel.ts`, `app/api/agent/**`, `app/api/sessions/**`, `components/SessionSidebar.tsx`, `components/PiWebTitle.tsx`, `components/SessionTree.tsx`, `components/SidebarMenu.tsx`, `components/SidebarToast.tsx`, `components/SidebarIcons.tsx`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/WorktreeCreateForm.tsx`, `handleNewSession`, `handleSelectSession` and the bar's handlers in `components/AppShell.tsx`, `components/BranchNavigator.tsx`, `components/MessageView.tsx`, `lib/message-display.ts`, `lib/patch.ts`, `components/FileViewer.tsx`, `components/MarkdownBody.tsx`, `lib/markdown.ts`, `lib/markdown-blocks.ts`, `lib/streaming-message.ts`, `hooks/useStreamingSelector.ts`, `lib/turn-duration.ts`, `components/MermaidBlock.tsx`, `components/SvgBlock.tsx`, `lib/highlight-queue.ts`, `lib/prism-languages.ts`, `hooks/usePrismLanguages.ts`, `lib/session-view-cache.ts`, `components/CodemodeToolView.tsx`, `components/ExtensionStatusBar.tsx`, `components/ExtensionWidgets.tsx`, `lib/extension-ui-theme.ts`, `components/AnsiText.tsx`, `lib/transcript-notices*.ts`, `components/TranscriptNotices.tsx`, `app/api/cache-miss-notices/**`, `lib/tool-fields.ts`, `lib/debug-*.ts`, `lib/stream-client.ts`, `lib/page-stream-registry.ts`, `lib/page-debug.ts`, `lib/file-watch-registry.ts`, `components/DebugPanel.tsx`, `components/debug-panel-state.ts`.
- [tools.md](docs/agents/tools.md): tool presets and Chat only, exact system prompts, tool exposure, the codemode / tool-search / mcp built-ins, the read-only MCP policy, the Code mode and PowerShell `defaultTools` switches. Files: `lib/tool-presets.ts`, `lib/tool-preset-preference.ts`, `lib/chat-only.ts`, `lib/exact-system-prompt.ts`, `lib/builtin-extensions.ts`, `lib/mcp-read-only-policy.ts`, `lib/codemode-settings.ts`, `lib/powershell-settings.ts`, `lib/global-settings-file.ts`, `app/api/agent/new/route.ts`, `app/api/tools/settings/route.ts`, tool selection in `lib/rpc-manager.ts`.
- [mcp-runtime.md](docs/agents/mcp-runtime.md): the per-session MCP host (when servers register and connect, reported states, trust read on every sync, idle release); `/mcp` in the composer. Files: `lib/mcp-host.ts`, `lib/mcp-transport.ts`, `lib/mcp-status.ts`, `lib/mcp-command.ts`, `lib/mcp-config-key.ts`, MCP wiring in `lib/rpc-manager.ts` and `lib/builtin-extensions.ts`, `/mcp` handling in `hooks/useAgentSession.ts`.
- [mcp-settings.md](docs/agents/mcp-settings.md): Settings › MCP reads without running anything, masking, the trust dialog's server list, row states, notices, Code mode choice, trust from Settings, Escape stacking, every `mcp.json` write and undo. Files: `app/api/mcp/route.ts`, `app/api/project-trust/route.ts`, `lib/mcp-config-read.ts`, `lib/mcp-config-file.ts`, `lib/mcp-override.ts`, `lib/mcp-undo.ts`, `lib/mcp-secrets.ts`, `lib/mcp-server-display.ts`, `lib/mcp-json-error.ts`, `lib/project-trust.ts`, `lib/regular-file.ts`, `lib/stacked-dialog.ts`, `lib/settings-navigation.ts`, `components/McpConfig.tsx`, `components/mcp-config-helpers.ts`, `components/ProjectTrustDialog.tsx`, `components/SettingsPanel.tsx`.
- [mcp-test-sign-in.md](docs/agents/mcp-test-sign-in.md): Settings › MCP Test (route checks, bounded connection, `!command` queue, redaction, status store) and OAuth sign-in / sign-out. Files: `app/api/mcp/test/**`, `app/api/mcp/sign-in/**`, `lib/mcp-test.ts`, `lib/mcp-entry-request.ts`, `lib/mcp-status.ts`, `lib/mcp-sign-in.ts`, `lib/mcp-sign-out.ts`, `components/McpSignIn.tsx`, `components/mcp-sign-in-helpers.ts`, `components/OAuthPastePanel.tsx`.
- [mcp-add.md](docs/agents/mcp-add.md): Settings › MCP add (paste re-parsed on the server, host-variable confirmation, literal secrets kept global, fresh-folder trust, the add pane) and the paste importer's escaping and grammars. Files: `lib/mcp-add.ts`, `lib/mcp-import*.ts`, `lib/shell-words.ts`, fresh-folder trust in `lib/project-trust.ts`, `components/McpAddServer.tsx`, `components/mcp-add-helpers.ts`, the `add` action of `app/api/mcp/route.ts`.
- [models.md](docs/agents/models.md): default model and reasoning level, providers registered at session_start, mid-run reasoning changes, remote provider catalogs, `enabledModels` scoping and minimal edits, managed models' context-window overrides, provider auth listing and credentials, the extension-loaded runtime those routes share. Files: `app/api/models/**`, `app/api/models-config/**`, `app/api/auth/**`, `lib/model-runtime.ts`, `lib/default-preferences.ts`, `lib/model-scope.ts`, `lib/enabled-models*.ts`, `lib/model-context.ts`, `lib/model-image-limits.ts`, `lib/model-provider-check.ts`, `lib/model-catalog-refresh.ts`, `lib/deferred-provider-models.ts`, `lib/provider-listing*.ts`, `components/ModelsConfig.tsx`, `components/EnabledModelsSection.tsx`, `components/ModelContextWindow.tsx`, `components/ModelSelector.tsx`, `components/SelectorRow.tsx`.
- [files-and-access.md](docs/agents/files-and-access.md): worktrees and project grouping, the directory picker's typed path, the file access allow-list (the `/api/files` security boundary), file tree visibility and its open directories per folder, uploads and chat file drops, the sandboxed HTML preview's storage shim, the source view's languages by extension, the CSV/TSV table view, web password throttling. Files: `app/api/files/**`, `app/api/cwd/**`, `app/api/worktrees/**`, `app/api/file-index/**`, `app/api/web-auth/**`, `proxy.ts`, `lib/path-security.ts`, `lib/file-access.ts`, `lib/linked-directory.ts`, `lib/session-file-references*.ts`, `lib/file-tree-visibility.ts`, `lib/file-tree-expansion.ts`, `lib/file-upload-client.ts`, `lib/file-version.ts`, `lib/html-sandbox-polyfill.ts`, `lib/worktree.ts`, `lib/paths.ts`, `lib/auth-throttle.ts`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/FileExplorer.tsx`, `lib/delimited-table.ts`, `components/DelimitedTable.tsx`, the table branch of `components/FileViewer.tsx`, `hooks/useDragDrop.ts`, `components/DirectoryPicker.tsx`.
- [settings-ui.md](docs/agents/settings-ui.md): General's sidebar file-browser choice, Plugins and Skills routes, sidebar group switches, the shared `SettingsUi` blocks every settings panel and add pane uses. Files: `app/api/plugins/**`, `app/api/skills/**`, `lib/skills-service.ts`, `components/SettingsUi.tsx`, `components/settings-ui-helpers.ts`, `components/SkillsConfig.tsx`, `components/PluginsConfig.tsx`, `hooks/useFilesPlacement.ts`; also before adding a settings section or add pane.
- [side-sessions.md](docs/agents/side-sessions.md): side chats (ADR 0007): the Fork copy with a `pi-web:side` entry inside the bounded head read, the `side` relation kind and family fold, the parent's session minus tools (an allow-list of exactly its tools), the hidden boundary message and where each provider's request puts the tool change, `/side`, the tab shared with subagents, usage that skips inherited entries. Files: `lib/side-session.ts`, `lib/session-fork.ts`, `lib/session-family.ts`, `lib/session-delete.ts`, `lib/session-reader.ts`, side handling in `lib/rpc-manager.ts`, `app/api/sessions/[id]/fork/route.ts`, `app/api/sessions/stats/route.ts`, `components/SessionChatPanel.tsx`, `components/TabBar.tsx`, `components/AgentSessionPanel.tsx`, `components/ChatInput.tsx`, `hooks/useAgentSession.ts`, `lib/side-chat-client.ts`, side handling in `components/AppShell.tsx`.
- [subagents.md](docs/agents/subagents.md): the built-in subagent setting, profiles and their files, run status, completion notifications, the subagent tab. Files: `lib/subagent*.ts`, `app/api/subagents/**`, `components/AgentsConfig.tsx`, `components/SessionChatPanel.tsx`.
- [client-platform.md](docs/agents/client-platform.md): the global shortcuts (Ctrl+Alt+N on macOS's dead-key Option+N and Windows AltGr, Esc stacking), mobile software keyboard and viewport height, the terminal's shell (PowerShell first on Windows), the terminal's extra keys, its own dark/light theme and its font size following the chat's, completion sound, the launcher opening the browser only after the first page is served. Files: `hooks/useKeyboardShortcuts.ts`, `hooks/useViewportHeight.ts`, `hooks/useAudio.ts`, `terminalShell()` in `lib/terminal-manager.ts`, `components/TerminalExtraKeys.tsx`, `lib/terminal-extra-keys.ts`, `lib/terminal-theme.ts`, `hooks/useTerminalTheme.ts`, `terminalFontSize()` in `hooks/useChatAppearance.ts`, the keyboard-open CSS, `bin/browser-opener.js`, the browser opening in `bin/pi-web.js`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
