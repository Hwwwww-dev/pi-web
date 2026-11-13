# File Map

Every route and module of the app, as it stands in this fork. [AGENTS.md](../../AGENTS.md) keeps only the directory-level view and points here.

```text
app/api/
  sessions/route.ts                GET list all sessions
  sessions/[id]/route.ts           GET/PATCH/DELETE a session
  sessions/[id]/context/route.ts   GET ?leafId=&tail=&before= a page of a leaf's context (tail defaults to 50; before pages upward)
  sessions/[id]/turns/route.ts     GET ?leafId= the whole-branch turn index for the minimap (entry id, timestamp, preview per turn)
  sessions/[id]/export/route.ts    GET exported HTML
  sessions/[id]/fork/route.ts      POST copy the session's current branch into a new session, or { side: true } a side chat (never starts an AgentSession)
  sessions/delete/route.ts         POST { ids } delete sessions and their subagents (a project's Delete all sessions); running ones kept
  sessions/stats/route.ts          POST { ids } each session's tokens, cost, tool calls, active time (the agent switcher's rows)
  sessions/[id]/state/route.ts     GET live wrapper state while running
  sessions/ui-state/route.ts       GET/POST sidebar pins, archive, project order and names (set, restore, pin-project, add-projects, move-project, rename-project)
  sessions/[id]/auto-name/route.ts POST generate a session title
  sessions/search/route.ts         GET session search
  agent/new/route.ts               POST { cwd, type: prompt|ensure_session (start only), message?, toolNames?, provider?, modelId?, thinkingLevel? }
  agent/[id]/route.ts              GET state (?systemPrompt=0: without the prompt) | POST any command
  agent/[id]/events/route.ts       GET SSE stream
  agent/[id]/lease/route.ts        POST reset the selected session's idle timer (with or without its stream; never starts one); reply: running, awaitingInput, subagentsActive
  agent/running/route.ts           GET running + awaiting-input session ids, sidebar pins/archive revision
  agent/debug/route.ts             GET ?session= the Debug panel's read-only snapshot: wrappers, streams, subagents, MCP, terminals, file watches
  auth/api-key/[provider]/route.ts POST/DELETE stored provider API key
  auth/login/[provider]/route.ts   GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts  POST OAuth logout
  auth/providers/route.ts          GET OAuth and API-key provider lists
  cwd/validate/route.ts            POST validate/select a cwd
  cwd/browse/route.ts              GET browse any readable directory for the cwd picker | POST create child directory
  default-cwd/route.ts             POST create ~/pi-cwd/YYYYMMDD (local date)
  home/route.ts                    GET user home directory
  open-in-explorer/route.ts        GET availability | POST open a cwd in the OS file manager (loopback only)
  files/[...path]/route.ts         GET ?type=list|read|download|meta|preview|watch | POST ?type=upload|upload-check|allow-link
  file-index/route.ts              GET file list for @-mentions
  git/status/route.ts              GET changed files for a cwd
  git/diff/route.ts                GET diff of one changed file
  worktrees/route.ts               GET/POST/DELETE git worktrees
  terminal/route.ts                POST create a terminal session
  terminal/[id]/route.ts           GET { id, cwd } (404 once closed; stream at [id]/events) | POST input/resize | DELETE kill
  mcp/route.ts                     GET [?cwd=] Settings › MCP overview, files only | POST add/enable/disable/remove/undo/set-enabled/set-exposure/set-in-project/sign-out
  mcp/test/route.ts                POST { scope, name, cwd? } test one server once (entry read from its file)
  mcp/sign-in/route.ts             POST { scope, name, cwd? } start or join an OAuth sign-in
  mcp/sign-in/[flowId]/route.ts    GET flow state (polled) | POST { redirectUrl } | DELETE cancel
  project-trust/route.ts           GET trust status + project .pi/mcp.json servers (files only) | POST trust, rebuild the cwd's wrappers
  tools/settings/route.ts          GET/PUT defaultTools switches: PowerShell (Windows), Code mode automatic/always; codemode.mode, codemode.inlineBudget
  cache-miss-notices/route.ts      GET/PUT pi's global showCacheMissNotices (Settings › General)
  models/route.ts                  GET ?cwd= { models, modelList, defaultModel, … }
  models/enabled/route.ts          GET/PUT enabledModels switches
  models/default/route.ts          PUT default model / reasoning level for new sessions
  models/refresh/route.ts          POST fetch provider catalogs from pi.dev on demand
  models-config/route.ts           GET/PUT ~/.pi/agent/models.json
  models-config/catalog/route.ts   GET models.dev pricing presets
  models-config/discover/route.ts  POST fetch a configured provider's upstream model list
  models-config/test/route.ts      POST test a configured model/provider
  plugins/route.ts                 GET/POST package plugin management
  plugins/check/route.ts           POST check plugin package updates
  skills/route.ts                  GET/PATCH loaded skills, disable-model-invocation
  skills/content/route.ts          GET one loaded skill's bounded Markdown source, or ?document= a Markdown file in its folder
  skills/install/route.ts          POST install skills via npx skills add
  skills/search/route.ts           POST skills.sh search
  subagents/settings/route.ts      GET/PUT built-in subagent switch and maxConcurrent
  web-auth/route.ts                GET status | POST login | DELETE logout (browser password)
  provider-usage/query/route.ts    POST provider usage quotas
  push/config/route.ts             GET VAPID public key
  push/subscribe/route.ts          POST register a push subscription
  app-update/route.ts              GET current vs latest published pi-web version

lib/
  agent-client.ts           typed fetch helper for /api/agent commands
  missing-cwd.ts            client-safe `reason: "cwd-missing"` refusal of a folder that no longer exists: error class, body fields, parsing
  debug-types.ts            client-safe shapes of the Debug panel: GET /api/agent/debug and the page's own snapshot
  debug-snapshot.ts         buildDebugSnapshot(): the debug route's synchronous field reads, each source guarded
  stream-client.ts          an event stream's reported address and "Chrome · macOS" label, for the Debug panel's connected pages and SSE titles only
  page-stream-registry.ts   open terminal and file-watch streams with their page (`?holder=`) and client, for the Debug panel's connected pages
  page-debug.ts             client: the page's id (`?holder=` of its streams), EventSources, visibility history, protocol and running-poll record (Debug panel)
  file-watch-registry.ts    open ?type=watch streams, counted on globalThis for the Debug panel
  rpc-manager.ts            AgentSessionWrapper, registry, startRpcSession
  side-chat-client.ts       client: ask the fork route for a side chat, refusals as translated notices
  session-reader.ts         SessionManager wrappers, path cache, buildSessionContext adapter
  session-fork.ts           forkSessionBranch(): the sidebar's Fork, a leaf-branch copy on a fresh SessionManager named after its source, typed refusals; createSideSession(): the same copy as a side chat
  side-session.ts           a side chat's metadata entry, allowed tools, hidden boundary message, own entries for usage
  session-fork-name.ts      client-safe Fork naming: source title + " · " + 4 hex; splitting the suffix off for the row and toast
  session-delete.ts         deleteSessions(): session files with their subagents, re-parenting what stays, wrapper shutdown, pins/archive cleanup
  session-tree.ts           sidebar row model: pinned section, project groups and their order, archived predicate, virtual rows, drop targets
  session-ui-state.ts       pi-web-session-state.json (pins, archive, project order and names): lock, atomic write, revision, corrupt backup
  session-ui-state-shared.ts client-safe types and rules of that state: request parsing, apply, undo snapshot
  sidebar-prefs.ts          per-browser sidebar tab, group expand choices, archive folds, pinned-section collapse, files-section fold, changed files as list or tree, folders found outside git
  sidebar-actions.ts        session row menu entries, a project group's name entries and rename request, fork refusal messages, delete-all requests
  session-links.ts          same-instance links: a session's (?session=<id>), a fresh composer's (?cwd=<dir>); the plain-click rule the sidebar keeps in the page
  new-session-context.ts    client-safe: what the project/worktree pickers show (project, worktrees, project list), lag-safe contextForCwd, the directory a group's + and Open in new tab use
  normalize.ts              normalizeToolCalls(): file-format vs our toolCall field names
  message-keys.ts           client-safe React keys of chat messages: a run's messages keep theirs when the file is read again
  types.ts                  shared TypeScript types
  pi-types.ts               local structural types for pi SDK objects
  pi-sdk-internals.ts       loader for SDK modules the package does not export (MCP connection, config, OAuth)
  tool-presets.ts           PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts browser-persisted default preset for fresh sessions
  tool-fields.ts            a tool call's arguments as flat rows: all of them or no table
  builtin-extensions.ts     codemode / tool-search / mcp built-ins, sandbox self-test, -builtin: switches
  codemode-settings.ts      Code mode automatic/always (+codemode in global defaultTools), codemode.mode and inlineBudget; project overrides
  codemode-view.ts          display helpers for codemode cards
  global-settings-file.ts   locked read-modify-write of global settings.json (SettingsManager's lock)
  regular-file.ts           readRegularFileText(): non-blocking read of a regular file only, optional size cap
  default-preferences.ts    write defaultModel/defaultThinkingLevel; detect project shadowing
  deferred-provider-models.ts models of providers an extension registers only at session_start, re-added to listings
  enabled-models.ts         pure minimal-edit engine for the enabledModels pattern list
  enabled-models-runtime.ts SDK adapter for enabledModels: pattern resolution, provider kinds, settings IO
  model-context.ts          client-safe: managed models' contextWindow overrides in the models.json draft, the Save check
  model-image-limits.ts     client-safe: a custom model's inputLimits.images.resize.maxBytes in the draft, the Save check
  model-provider-check.ts   client-safe: Save refuses a models.json provider entry pi rejects on its own (Add provider's empty stub, oauth without a Base URL)
  subagent-settings.ts      read/write ~/.pi/agent/agents/settings.json
  file-access.ts            allowed file roots for /api/files and worktrees
  file-upload-client.ts     browser upload to /api/files ?type=upload, shared by the explorer and chat drops
  linked-directory.ts       directory links leading outside the allowed roots + the allow-link check
  file-paths.ts             client/server path encoding helpers
  file-version.ts           a watched file's size+mtime version: viewers skip reloading an unchanged file on reconnect
  html-sandbox-polyfill.ts  in-memory localStorage/sessionStorage shim injected into the sandboxed HTML preview's srcDoc
  delimited-table.ts        client-safe CSV/TSV parsing (RFC 4180, delimiter detection, file line per record) and table layout
  file-tree-visibility.ts   which entries the file tree lists (git check-ignore, name-list fallback)
  file-tree-expansion.ts    the file tree's open directories per cwd: page-memory LRU of 20 folders
  display-path.ts           display-only ~ / ./ path shortening for settings panels
  default-cwd.ts            dated ~/pi-cwd/YYYYMMDD path for "Use default directory"
  worktree.ts               project/worktree resolution and git worktree operations
  draft-store.ts            local draft persistence
  extension-ui-queue.ts     FIFO queues for extension dialogs and custom panels, by request id; isBlockingExtensionUiRequest() (which method a run waits on)
  extension-ui-theme.ts     the pi Theme extension panels, widgets and statuses get: pi's system theme for a terminal reporting no colors (ANSI palette), plain text until it loads
  favicon-badge.ts          the tab's favicon badge: awaiting and unread counts drawn over the stock icon
  session-stats-format.ts   client-safe compact counts, costs and active durations of the stats toolbar and agent switcher
  turn-duration.ts          getTurnDurationMs() / formatTurnDuration(): a finished turn's length from its anchor to its last response's end, on pi's timestamps
  transcript-notices.ts     client-safe: showCacheMissNotices notices on chat messages, TUI number formats, a fold's cache-miss sum
  transcript-notices-server.ts the notices derived from session entries (cache-stats port), live ones for message_end, the setting
  markdown.ts               shared markdown helpers
  markdown-blocks.ts        splitMarkdownBlocks(): where a streaming reply may be cut into blocks parsed apart
  highlight-queue.ts        code fences past a task's highlight budget get their colors in idle slices
  prism-languages.ts        loadPrismLanguages(): every Prism language in a chunk of its own, loaded when a highlighter first needs it
  gfm-autolink-email-loader.cjs  bundler loader: remark-gfm's email regex without a lookbehind literal
  node-cli.ts               locate bundled npm-cli.js / npx-cli.js to spawn npm/npx without a shell (Windows)
  npx.ts                    npx runner for skill install
  plugin-updates.ts         npm view update checks for /api/plugins/check
  jsonc.ts                  JSON with comments and trailing commas (models.json is read through it)
  shell-words.ts            split a pasted command line into words without a shell; refuses | && ; redirects $(…)
  key-serializer.ts         serializeByKey(): one globalThis promise chain per key
  stacked-dialog.ts         Escape and focus handling for Settings and dialogs stacked above it
  project-trust.ts          project trust status and decisions; fresh-folder trust-and-write
  mcp-host.ts               per-session MCP host: registers mcp.json servers before prompts, reports status
  mcp-transport.ts          MCP transport factory; stdio gets a sanitized env, never PI_WEB_PASSWORD
  mcp-command.ts            client-safe: who owns /mcp (built-in or another extension)
  mcp-read-only-policy.ts   read-only sessions block MCP tools without readOnlyHint (nested calls too)
  mcp-config-key.ts         canonicalJson() and mcpConfigKey(), the per-process HMAC statuses are keyed by
  mcp-config-values.ts      client-safe: the values pi resolves and the PI_WEB_PASSWORD rule
  mcp-config-read.ts        Settings › MCP reads of both mcp.json files; nothing resolved or run
  mcp-config-file.ts        the mcp.json writer: SDK editor's bytes, lock, atomic write, typed refusals
  mcp-override.ts           project overrides of global servers: the SDK's isOverride() and loader refusals
  mcp-json-error.ts         JSON.parse error messages that never quote the source
  mcp-undo.ts               removed mcp.json entries kept 60 s for undo; only a token reaches the browser
  mcp-status.ts             last known connection state per mcp.json entry (tests and sessions)
  mcp-test.ts               Settings › MCP Test: one bounded, masked SDK connection (sign-in reuses its steps)
  mcp-entry-request.ts      route checks before connecting one mcp.json entry (Test, sign-in); guards /api/mcp and /api/project-trust share
  mcp-sign-in.ts            Settings › MCP OAuth sign-in flows (as pi mcp login), polled by id
  mcp-sign-out.ts           OAuth store keys (name + URL); guard barring token writes by runs started before a sign-out
  mcp-secrets.ts            pure secret classification and masking for MCP config values
  mcp-add.ts                POST /api/mcp add's checks before it writes
  mcp-import.ts             pure paste importer (+ mcp-import-core/json/cli/links.ts)
  mcp-server-display.ts     client-safe display helpers for McpServerInfo (hidden-character escapes, labels)
  mcp-tool-display.ts       server/tool label of an mcp__ call from its result details, never the name

components/
  AppShell.tsx             layout, URL state, tab management
  SessionSidebar.tsx       toolbar row (Sessions | Files tabs, or the Pi Web brand with the files below them; new, search): tree, archive, menus, toast; files section (resizable, foldable; one header row with the file keys and changed-files count, the picker's row) or tab (picker boxes + file buttons), FileExplorer
  PiWebTitle.tsx           the sidebar's "Pi Web" brand (files below the sessions only): a click scrambles it into the versions
  SessionTree.tsx          virtualized rows of the session tree and the archive view
  SidebarMenu.tsx          sidebar popup menu (bottom sheet on phones), portaled to body: filter field, item secondary actions, the files tab's classic look
  ProjectWorktreePicker.tsx project and worktree boxes + menus: the files' (one row below the sessions, stacked in the tab) and the new-session bar's
  NewSessionContextBar.tsx the picker in its own row under the brand, right above the empty new-session composer; moves go through the sidebar
  WorktreeCreateForm.tsx   "New worktree…" form, a SidebarMenu body
  SidebarToast.tsx         sidebar one-line toast: archive Undo/View, failed saves
  SidebarIcons.tsx         sidebar stroke icons
  ChatWindow.tsx           chat composition + completion sound
  ChatInput.tsx            input bar + model/thinking/tools/compact controls
  MessageView.tsx          one message (user/assistant/toolCall/toolResult)
  CodemodeToolView.tsx     codemode card: the tool calls its script made
  BranchNavigator.tsx      in-session branch switcher
  ChatMinimap.tsx          scroll minimap beside the message list
  MarkdownBody.tsx         markdown renderer
  SvgBlock.tsx             a ```svg fence: preview only as an <img> data URL, source toggle, zoom, download (MermaidBlock's pieces)
  ModelsConfig.tsx         Settings › Models: models.json editor
  EnabledModelsSection.tsx model switches inside ModelsConfig (enabledModels)
  ModelContextWindow.tsx   a managed model row's context-window field (blank: no override)
  OAuthPastePanel.tsx      paste box for a sign-in's redirected address or code (Models, MCP)
  ProjectTrustDialog.tsx   trust confirmation listing the project's MCP servers
  AgentsConfig.tsx         built-in subagent toggle + agent profile editor
  SessionChatPanel.tsx     right-panel tab of a subagent or side chat: a ChatWindow for that session
  DebugPanel.tsx           Debug top panel (toolbar, left of the stats): page and server state, its own tick and poll, error boundary
  debug-panel-state.ts     pure helpers of DebugPanel: formatting, server clock, poller, issues, session grouping, poll samples
  PluginsConfig.tsx        Settings › Plugins: installed package plugins
  SkillsConfig.tsx         Settings › Skills: loaded, search, install
  McpConfig.tsx            Settings › MCP: servers, switches, exposure, remove/undo, Test, sign-in, Code mode, trust
  mcp-config-helpers.ts    pure helpers and requests for McpConfig
  McpSignIn.tsx            a server's Sign-in row in Settings › MCP
  mcp-sign-in-helpers.ts   pure helpers and requests for McpSignIn
  McpAddServer.tsx         Settings › MCP add pane: paste, preview, values, name, scope
  mcp-add-helpers.ts       pure helpers and the add request for McpAddServer
  FileExplorer.tsx         file tree in the sidebar
  FileIcons.tsx            file icon helpers
  FileViewer.tsx           file content in a tab
  DelimitedTable.tsx       a CSV/TSV file's Preview: virtualized table, gutter of file lines
  TabBar.tsx               file panel tab bar (file, terminal and subagent tabs)
  TranscriptNotices.tsx    a message's cache and cost notice lines, the fold header's cache-miss text

hooks/
  useAgentSession.ts       messages, streaming, SSE, fork/navigate, reconciliation; built-in slash commands (/session, bare /mcp)
  useStreamingSelector.ts  one value of the streaming store (lib/streaming-message.ts): a chunk re-renders only its subscribers
  useAudio.ts              completion sound + AudioContext unlock
  useDragDrop.ts           chat drop zone: dropped files, folders marked
  useFilesPlacement.ts     per-browser choice: the desktop sidebar's file browser below the sessions or in its own tab
  useGroupDrag.ts          dragging a sidebar project group: mouse threshold, touch/pen long-press, auto-scroll, drop
  useIsMobile.ts           responsive breakpoint
  usePageHidden.ts         HIDDEN_PAGE_GRACE_MS; true once the page has been hidden that long (file watches pause)
  useSessionUiState.ts     sidebar pins, archive, project order: optimistic writes in order, refetch on revision change
  useSidebarMotion.ts      the sidebar's fold and archive-view motion: phase, end fallback, reduced motion, what shows meanwhile
  useKeyboardShortcuts.ts  Esc stops the running agent unless a field or nearer handler took it; Ctrl+Alt+N
  useResizablePanel.ts     drag/keyboard panel size kept per key; persistClamp: false never saves a short window's clamp
  usePrismLanguages.ts     true once the Prism languages are loaded; starts the load for a highlighter
  useTheme.ts              theme state
  useTerminalTheme.ts      the terminal's own dark/light choice (localStorage), apart from the app theme
```
