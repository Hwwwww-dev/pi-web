import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { DebugPanelView } = await jiti.import("./DebugPanel.tsx");
const { EMPTY_DEBUG_SERVER_READING } = await jiti.import("./debug-panel-state.ts");
const { focusIfLost } = await jiti.import("@/lib/stacked-dialog.ts");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("@/lib/i18n/messages/zh-CN.ts");
const { interpolateMessage } = await jiti.import("@/lib/i18n/format.ts");
const panelSource = await readFile(new URL("./DebugPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const h = React.createElement;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const t = (key, params) => {
  assert.equal(typeof enLocale.messages[key], "string", `missing translation ${key}`);
  return interpolateMessage(enLocale.messages[key], params);
};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Every aria-label, in order. */
function ariaLabels(html) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
}

/** Every title attribute, in order. */
function titles(html) {
  return [...html.matchAll(/ title="([^"]*)"/g)].map((match) => match[1]);
}

/** What a sighted reader sees: the text between tags, the stylesheet left out. */
function visibleText(html) {
  // A tag's attributes may hold a decoded ">" (utility classes do); a tag ends at its own ">".
  return html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ").replace(/\s+/g, " ").trim();
}

/** One of the panel's three sections: its heading's hook to the next heading. */
function section(html, key) {
  const at = html.indexOf(`data-debug-section="${key}"`);
  assert.notEqual(at, -1, key);
  const from = html.lastIndexOf("<h3", at);
  const next = html.indexOf("<h3", at);
  return html.slice(from, next === -1 ? html.length : next);
}

const pageSection = (html) => section(html, "page");
const serverSection = (html) => section(html, "server");
const sessionsSection = (html) => section(html, "sessions");

/** The server's totals above its table: everything before the pages' rows. */
function serverHead(html) {
  const server = serverSection(html);
  return server.slice(0, server.indexOf('<div data-slot="table-container"'));
}

/** The pages holding the server's streams, one table row each. */
function pageRows(html) {
  const server = serverSection(html);
  const starts = [...server.matchAll(/<tr data-slot="table-row"/g)].map((match) => match.index);
  return starts.map((at, index) => server.slice(at, starts[index + 1] ?? server.length));
}

/** The server's sessions: one Item per row, the chat's details in its ItemFooter. */
function sessionRows(html) {
  const list = sessionsSection(html);
  const starts = [...list.matchAll(/<div data-slot="item"/g)].map((match) => match.index);
  return starts.map((at, index) => list.slice(at, starts[index + 1] ?? list.length));
}

/** The row whose title (or whose drawn name) names the session. */
function rowOf(html, name) {
  const rows = sessionRows(html);
  const row = rows.find((entry) => entry.includes(` title="${name}`)) ?? rows.find((entry) => visibleText(entry).includes(name));
  assert.ok(row, name);
  return row;
}

/** The badges of a chunk, as their opening tags: their variant is what they are. */
function badgeTags(chunk) {
  return [...chunk.matchAll(/<span [^>]*data-slot="badge"[^>]*>/g)].map((match) => match[0]);
}

/** A Progress' aria-valuenow attributes, in order. */
function progressValues(chunk) {
  return [...chunk.matchAll(/<div [^>]*data-slot="progress"[^>]*>/g)]
    .map((match) => Number(/aria-valuenow="(\d+)"/.exec(match[0])?.[1] ?? Number.NaN));
}

// The browser's clock is far from the server's: only the time since the answer counts.
const LOCAL = 50_000;
const SERVER = 9_000_000;

function client(extra = {}) {
  return {
    pageId: "page-mine-123",
    sessionId: "s1",
    selectedSessionId: "s1",
    mounted: true,
    wantsStream: true,
    connection: {
      sessionId: "s1",
      state: "connected",
      readyState: 1,
      openedAt: LOCAL - 5 * MINUTE,
      connectedAt: LOCAL - 5 * MINUTE + 200,
      lastSeenAt: LOCAL - 3 * SECOND,
      lastHeartbeatAt: LOCAL - 3 * SECOND,
      events: 12,
      opens: 1,
      retries: 0,
      retryDueAt: null,
      watchdogArmed: true,
      staleAfterMs: 45 * SECOND,
      lastError: null,
      lastClose: null,
    },
    released: { active: false, count: 0, lastAt: null },
    reattached: { count: 0, lastAt: null, lastReason: null },
    hiddenReleaseDueAt: null,
    hiddenGraceMs: 60 * SECOND,
    graceDueAt: null,
    run: { agentRunning: false, bashRunning: false, compacting: false, dialogs: 0 },
    lease: {
      renewIntervalMs: 15 * SECOND,
      renewStartedAt: LOCAL - 20 * SECOND,
      inFlightSince: null,
      requests: 2,
      unanswered: 0,
      errors: 0,
      last: { at: LOCAL - 5 * SECOND, durationMs: 18, outcome: "reply", httpStatus: 200, reply: { running: false, awaitingInput: false, subagentsActive: false } },
    },
    ...extra,
  };
}

function page(extra = {}) {
  return {
    at: LOCAL,
    client: client(),
    clientFailed: false,
    sources: [
      { id: 1, kind: "agent", label: "s1", state: "open", createdAt: LOCAL - 5 * MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - 5 * MINUTE, lastErrorAt: null },
      { id: 2, kind: "file-watch", label: "/work/app/a.ts", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: LOCAL - MINUTE, lastErrorAt: null },
    ],
    visibility: { state: "visible", trackingSince: LOCAL - 10 * MINUTE, lastHiddenAt: LOCAL - 2 * MINUTE, lastVisibleAt: LOCAL - MINUTE, hiddenCount: 1 },
    protocol: "http/1.1",
    runningPoll: { count: 40, failures: 1, last: { at: LOCAL - SECOND, durationMs: 12, outcome: "ok", httpStatus: 200 } },
    pollInFlightSince: null,
    ...extra,
  };
}

function summary(sessionId, extra = {}) {
  return {
    sessionId, state: "alive", running: false, awaitingInput: false, subagent: false,
    eventStreams: 0, providers: 0, nextIdleCheckAt: null, forcedByStop: false, starts: 1, ...extra,
  };
}

function wrapper(extra = {}) {
  return {
    sessionId: "s1", state: "alive", stale: false, subagent: false, chatOnly: false,
    createdAt: SERVER - 6 * MINUTE, startedAt: SERVER - 6 * MINUTE, closingAt: null, extensions: "bound",
    run: { running: false, streaming: false, promptRunning: false, pendingPrompts: 0, bashRunning: false, compacting: false, retrying: false, queuedMessages: 0, waitingForMcp: false, runningTools: 0, mutatingCommands: 0, replacement: null },
    idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 8 * MINUTE + 30 * SECOND, lastResetAt: SERVER - 90 * SECOND, forcedByStop: false },
    awaitingInput: false, pendingUiRequests: 0, customUis: 0, eventListeners: 2,
    lastEvent: { type: "agent_end", at: SERVER - 90 * SECOND }, lastCommand: { type: "prompt", at: SERVER - 2 * MINUTE },
    ...extra,
  };
}

function reply() {
  return {
    now: SERVER,
    server: {
      startedAt: SERVER - 2 * 60 * MINUTE,
      idleTimeoutMs: 10 * MINUTE,
      heartbeatMs: 15 * SECOND,
      wrappers: { alive: 3, closing: 1, starting: 0 },
      eventStreams: { total: 3 },
      sseTotal: 5,
      pages: [
        { holder: "page-other-456", address: "192.168.1.20", client: "Safari · iOS", agent: 2, terminal: 1, fileWatch: 0 },
        { holder: "page-mine-123", address: "127.0.0.1", client: "Chrome · macOS", agent: 1, terminal: 0, fileWatch: 1 },
      ],
      fileWatches: 1,
      terminals: { count: 1, listeners: 1, detached: 0, exited: 0, nextCleanupAt: null },
    },
    sessions: [
      summary("other-session", { state: "closing" }),
      summary("notes-1", { awaitingInput: true, eventStreams: 1, nextIdleCheckAt: SERVER + 3 * MINUTE }),
      summary("s1", { eventStreams: 2, providers: 1, nextIdleCheckAt: SERVER + 8 * MINUTE + 30 * SECOND, starts: 2 }),
      summary("sub-xyz-789", { subagent: true, running: true, eventStreams: 1 }),
    ],
    session: {
      sessionId: "s1",
      wrapper: wrapper(),
      lifecycle: { starts: 2, firstStartedAt: SERVER - 30 * MINUTE, lastStartedAt: SERVER - 6 * MINUTE, lastClosedAt: SERVER - 7 * MINUTE },
      starting: false,
      providers: [{ name: "keepalive-ext", active: true, byFile: true }],
      eventStreams: [
        { holder: "page-other-456", address: "192.168.1.20", client: "Safari · iOS", openedAt: SERVER - 6 * MINUTE, connectedAt: SERVER - 6 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
        { holder: "page-mine-123", address: "127.0.0.1", client: "Chrome · macOS", openedAt: SERVER - 5 * MINUTE, connectedAt: SERVER - 5 * MINUTE, lastWriteAt: SERVER - 3 * SECOND, droppedEvents: 0, queuedBytes: 0 },
      ],
      subagents: { active: false, runs: [], notifications: [] },
      mcp: null,
    },
  };
}

function server(extra = {}) {
  // Received 10 s (on the browser's clock) before the page was read.
  return { ...EMPTY_DEBUG_SERVER_READING, sessionId: "s1", reply: reply(), receivedAt: LOCAL - 10 * SECOND, roundTripMs: 42, requests: 5, ...extra };
}

function withDetail(extra) {
  const answer = reply();
  answer.session = { ...answer.session, ...extra };
  return server({ reply: answer });
}

const catalog = [
  { id: "s1", name: "Current chat", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-01T00:00:00Z", messageCount: 2, firstMessage: "" },
  { id: "sub-xyz-789", name: "", path: "", cwd: "/work/app", projectRoot: "/work/app", created: "", modified: "2026-10-02T00:00:00Z", messageCount: 1, firstMessage: "explore the repo", relation: { kind: "subagent", parentSessionId: "s1", profile: "explore", description: "", status: "running" } },
  { id: "notes-1", name: "Weekly plan", path: "", cwd: "/work/notes", projectRoot: "/work/notes", created: "", modified: "2026-10-09T00:00:00Z", messageCount: 3, firstMessage: "" },
];

function render(props = {}) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(DebugPanelView, {
    page: page(),
    server: server(),
    selectedSessionId: "s1",
    sessions: catalog,
    copied: false,
    onCopy() {},
    t,
    ...props,
  }))));
}

test("a quiet page reads OK: no issue list, the meter's scale in its label, every section", () => {
  const html = render();
  assert.match(html, /<span data-slot="badge" data-variant="outline" class="[^"]*debug-panel-status[^"]*"[^>]*><svg[^>]*>.*?<\/svg><span class="debug-panel-status-text[^"]*">OK<\/span><\/span>/);
  assert.doesNotMatch(html, /<ul/, "no issues, no list");
  // The meter's name says what its slots count: the slots' own titles are not read inside an image.
  assert.ok(ariaLabels(html).includes("http/1.1 · six connections per origin, shared by all tabs · 2/6 · Agent 1 · File watch 1"), ariaLabels(html).join("\n"));
  for (const key of ["page", "server"]) {
    assert.ok(html.includes(`>${t(`debug.section.${key}`)}<`), key);
  }
  // The stream and the lease are measures of the page's field group: their names are on screen.
  assert.ok(visibleText(pageSection(html)).includes(t("debug.section.stream")));
  assert.ok(visibleText(pageSection(html)).includes(t("debug.section.lease")));
  // Constants are scales and tooltips, never rows: the sentence is not on screen.
  const text = visibleText(html);
  assert.doesNotMatch(text, /six connections|every 15s|timeout 10m|stale after/);
  // The measures are the official Field rows: a title, then the value.
  assert.match(pageSection(html), /<div role="group" data-slot="field" data-orientation="horizontal"[^>]*><div data-slot="field-label" class="[^"]*"/);
  assert.doesNotMatch(html, /debug-panel-footer/);
  assert.match(html, /<span class="debug-panel-heading[^"]*" title="Read-only: [^"]+">Debug<\/span>/);
  assert.match(html, /<button data-slot="button"[^>]*class="[^"]*debug-panel-copy[^"]*"[^>]*>Copy JSON<\/button>/);
  // No live region: a screen reader would read every change out.
  assert.doesNotMatch(html, /role="status"|aria-live/);
});

test("the meter names what it holds on h2 and with no protocol known, not a bare code and number", () => {
  const terminal = { id: 3, kind: "terminal", label: "/work/app", state: "open", createdAt: LOCAL - 30 * SECOND, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const h2 = render({ page: page({ protocol: "h2", sources: [...page().sources, terminal] }) });
  assert.ok(ariaLabels(h2).includes("This page · Agent 1 · File watch 1 · Terminal 1 · h2"), ariaLabels(h2).join("\n"));
  assert.match(h2, /<span data-slot="badge" data-variant="outline" class="[^"]*text-muted-foreground[^"]*"[^>]*>h2<\/span>/);
  // 2 of the six connections this page holds, as the official Progress; no bare scale either.
  assert.equal(progressValues(pageSection(render()))[0], 33);
  const unknown = render({ page: page({ protocol: null }) });
  assert.ok(ariaLabels(unknown).includes("This page · Agent 1 · File watch 1 · unknown"));
  const unknownMeter = pageSection(unknown).slice(0, pageSection(unknown).indexOf('role="img"'));
  assert.doesNotMatch(unknownMeter, /data-slot="progress"/, "no cap known, no bar");
  // "unknown" is spoken by the meter's label only — never drawn as a bare badge code.
  assert.doesNotMatch(unknown, /data-slot="badge"[^>]*>unknown<\/span>/);
});

test("a timeout: the verdict counts it and its sentence is written once", () => {
  const html = render({ server: server({ failure: { kind: "timeout", status: null, at: LOCAL - SECOND } }) });
  assert.match(html, /<span data-slot="badge" data-variant="outline" class="[^"]*debug-panel-status[^"]*text-warning[^"]*"[^>]*><svg[^>]*>.*?<\/svg><span class="debug-panel-status-text[^"]*">Issues: 1<\/span><\/span>/);
  // The tone's mark and the sentence: no mark for what it is about, the sentence names it.
  assert.match(html, /<div data-slot="alert" class="[^"]*border-warning\/30[^"]*"><svg[^>]*>(?:<path [^>]*><\/path>)+<\/svg><div data-slot="alert-description"/);
  const sentence = `${t("debug.poll.timeout")} · 1s ago`;
  assert.ok(html.includes(`>${sentence}</div>`));
  assert.equal(html.split(t("debug.poll.timeout")).length - 1, 1, "once, in the issues");
});

test("server countdowns run on the server's clock plus the time since its answer", () => {
  const html = render();
  const text = visibleText(html);
  // 8m 30s left when the server answered, 10 s ago: 8m 20s, whatever the browser's clock says. The
  // chat's row shows minutes like every row; its tooltip has the seconds and what moves them.
  const all = titles(html);
  assert.ok(all.includes(`Reap countdown 8m 20s · timeout 10m 00s · reset 1m 40s ago · ${t("debug.server.idleHint")}`), all.join("\n"));
  assert.ok(all.includes("started 2× · last 6m 10s ago · closed 7m 10s ago"), "the chat's ↻ says when");
  assert.ok(text.includes("Uptime 2h 00m"));
  assert.ok(text.includes("↻2"));
  // The browser's own times run on its own clock: next renewal 10 s after the 30 s mark.
  assert.ok(all.includes("Next renewal in 10s · every 15s · 2 sent · 0 unanswered · 0 failed · this page page-min"));
  assert.ok(text.includes("Lease renews in 10s Last renewal answered · 18 ms · 5s ago"), text);
  // Both bars are the official Progress: the stream's toward its watchdog (5 s of 45 gone -> 7%),
  // the lease's toward its renewal (5 s of 15 gone -> 33%).
  const values = progressValues(pageSection(html));
  assert.ok(values.includes(33), values.join(","));
  assert.ok(values.includes(7), values.join(","));
  // Their times in whole seconds, never ms: an age rounds down, a countdown up. A round trip keeps its ms.
  const fresh = render({
    page: page({ client: client({
      connection: { ...client().connection, lastSeenAt: LOCAL - 400, lastHeartbeatAt: LOCAL - 400 },
      lease: { ...client().lease, renewStartedAt: LOCAL - 29_700, last: { ...client().lease.last, at: LOCAL - 300 } },
    }) }),
  });
  assert.match(pageSection(fresh), /<span class="[^"]*text-xs[^"]*tabular-nums[^"]*" title="[^"]*">data 0s ago<\/span>/);
  assert.match(pageSection(fresh), /<span class="[^"]*text-xs[^"]*tabular-nums[^"]*" title="[^"]*">renews in 1s<\/span>/);
  assert.ok(visibleText(pageSection(fresh)).includes("Last renewal answered · 18 ms · 0s ago"));
});

test("one boxed word per stream and provider, all outline; the holders' tone says whose they are", () => {
  const html = render();
  const list = sessionsSection(html);
  const current = rowOf(html, "this chat");
  // The chat's badges sit in its row of the list, where every other session's are.
  assert.doesNotMatch(current.slice(current.indexOf('data-slot="item-footer"')), /data-slot="badge"/, "none in the details under it");
  const labels = ariaLabels(current);
  assert.ok(labels.includes("SSE: 2 (this page 1, other page 1)"), labels.join("\n"));
  assert.ok(!labels.some((label) => label.startsWith("Lease")), "the server keeps no leases to show");
  assert.ok(labels.includes("Liveness providers: 1"));
  // Every state is the official outline Badge: no filled variant anywhere in the list.
  assert.doesNotMatch(list, /data-slot="badge" data-variant="(?:default|secondary|destructive)"/);
  assert.match(current, /<div data-slot="item" data-variant="muted"[^>]*data-current="true"/);
  // This page's stream carries the accent tone; the other page's stays muted. No run label is drawn:
  // the run's name is its aria-label, and each badge's title names the page behind it.
  assert.match(current, /title="SSE: 2 [^"]*" role="img" aria-label="SSE: 2 [^"]*"><span data-slot="badge" data-variant="outline" class="[^"]*text-primary[^"]*" title="this page page-min · Chrome · macOS · 127.0.0.1 · connected 5m 10s ago · last write 13s ago">SSE<\/span><span data-slot="badge" data-variant="outline" class="[^"]*text-muted-foreground[^"]*" title="other page page-oth · Safari · iOS · 192.168.1.20 · connected 6m 10s ago · last write 13s ago">SSE<\/span><\/span>/);
  assert.doesNotMatch(current, />Lease</);
  // A provider's badge is its name, capped at a Badge's width.
  assert.match(current, /<span data-slot="badge" data-variant="outline" class="[^"]*max-w-24 truncate[^"]*" title="keepalive-ext · active · by file">keepalive-ext<\/span>/);

  // The pages holding the server's streams, one table row each, this page first on the selected
  // state: marks, browser and system, address, page, count; the server's total above the table.
  const rows = pageRows(html).map((row) => visibleText(row));
  assert.deepEqual(rows, [
    "Chrome · macOS 127.0.0.1 this page 2",
    "Safari · iOS 192.168.1.20 page-oth 3",
  ]);
  assert.equal(pageRows(html).filter((row) => row.includes('data-state="selected"')).length, 1, "one current page");
  // Every SSE kind counts, each a connection of the browser's pool; the title says which.
  assert.equal(pageRows(html).join("").match(/<svg /g)?.length, 4, "two marks each, hidden from screen readers");
  assert.ok(titles(pageSection(html)).includes("other page page-oth · Safari · iOS · 192.168.1.20 · SSE 3 · Agent 2 · Terminal 1"), titles(pageSection(html)).join("\n"));
  assert.ok(titles(pageSection(html)).includes("this page page-min · Chrome · macOS · 127.0.0.1 · SSE 2 · Agent 1 · File watch 1"));
  // A page opened without a page id or a known browser still gets its row.
  const bare = reply();
  bare.server.sseTotal = 1;
  bare.server.pages = [{ holder: null, address: null, client: null, agent: 1, terminal: 0, fileWatch: 0 }];
  const bareRow = pageRows(render({ server: server({ reply: bare }) }))[0];
  assert.match(bareRow, /unknown browser/);
  assert.match(bareRow, />—</);
  assert.match(bareRow, /no page id/);
  const strip = serverHead(html);
  assert.doesNotMatch(strip, />SSE</, "the head no longer lists streams");
  assert.equal(visibleText(pageSection(html)).split("2/6").length - 1, 1, "the Progress' share, once");
  assert.match(strip, /aria-label="File watches: 1"><span data-slot="badge" data-variant="outline" class="[^"]*"[^>]*title="File watches: 1">File<\/span><\/span>/);
  assert.match(strip, /aria-label="Terminals: 1 [^"]*"><span data-slot="badge" data-variant="outline" class="[^"]*"[^>]*title="Terminals: 1 [^"]*">Term<\/span><\/span>/);
  assert.ok(titles(strip).some((title) => title.startsWith("Timers: idle 10m 00s · heartbeat 15s\n3 alive · 1 closing · 0 starting")));
});

test("a starting stream is dashed amber, one dropping events amber; past the cap the rest is a count", () => {
  const stream = (holder, at, extra = {}) => ({ holder, openedAt: at, connectedAt: at, lastWriteAt: null, droppedEvents: 0, queuedBytes: 0, ...extra });
  const eventStreams = [
    stream("page-mine-123", SERVER - 5 * MINUTE, { connectedAt: null }),
    stream("page-other-456", SERVER - 6 * MINUTE, { droppedEvents: 2 }),
    ...[5, 4, 3, 2, 1, 0].map((index) => stream(`page-x-${index}`, SERVER - index * SECOND)),
  ];
  const current = rowOf(render({ server: withDetail({ eventStreams }) }), "this chat");
  const from = current.indexOf('title="SSE: 8 (this page 1, other page 7)"');
  assert.notEqual(from, -1);
  const run = current.slice(current.lastIndexOf("<span", from), current.indexOf("</span></span>", from));
  assert.equal(run.match(/>SSE<\/span>/g).length, 3, "three badges, a row's cap");
  assert.match(run, />\+5<\/span>$/);
  // This page's own still starting: amber and dashed; another page's that dropped events: amber, solid.
  assert.match(run, /<span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*border-dashed[^"]*" title="this page page-min · starting the session">SSE<\/span>/);
  assert.match(run, /<span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*" title="other page page-oth · connected 6m 10s ago · 2 dropped">SSE<\/span>/);
  assert.equal(run.match(/data-variant="outline"/g).length, 3, "every stream badge is outlined");
});

test("a session row: up to three SSE and one Provider badge, then counts", () => {
  const answer = reply();
  answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, eventStreams: 5, providers: 2 } : entry));
  const grace = { id: 3, kind: "agent", label: "notes-1", state: "open", createdAt: LOCAL - MINUTE, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null };
  const row = rowOf(render({ page: page({ sources: [...page().sources, grace] }), server: server({ reply: answer }) }), "notes-1");
  // The row's badges, in order: the streams' run (this page's tone first, then the rest), then the
  // providers'; past each cap a "+n" count.
  const shape = [...row.matchAll(/<span class="[^"]*" title="(?<run>(?:\d+ event streams|\d+ liveness providers))" role="img"[^>]*>|<span data-slot="badge" data-variant="(?<variant>\w+)" class="(?<classes>[^"]*)" title="[^"]*">(?<word>[^<]*)<\/span>|<span class="text-xs tabular-nums text-muted-foreground">\+(?<more>\d+)<\/span>/g)]
    .map((match) => match.groups.run !== undefined
      ? `run ${match.groups.run}`
      : match.groups.more !== undefined
        ? `+${match.groups.more}`
        : `badge ${match.groups.variant} ${match.groups.word}${match.groups.classes.includes("text-primary") ? " mine" : ""}`);
  assert.deepEqual(shape, [
    "run 5 event streams",
    "badge outline SSE mine",
    "badge outline SSE",
    "badge outline SSE",
    "+2",
    "run 2 liveness providers",
    "badge outline Provider",
    "+1",
  ]);
});

test("the meter's slots say what holds them: SSE, File, Term; a connecting one dashed amber", () => {
  const extra = (id, kind, label, createdAt, state = "open") => ({ id, kind, label, state, createdAt, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null });
  const [chat, watch] = page().sources;
  const sources = [chat, extra(3, "agent", "notes-1", LOCAL - 4 * MINUTE), watch, extra(4, "terminal", "/work/app", LOCAL - 30 * SECOND, "connecting")];
  const html = render({ page: page({ sources }) });
  const tile = pageSection(html);
  const meter = tile.slice(tile.indexOf('role="img" aria-label="http/1.1'));
  const slots = badgeTags(meter).map((tag) => {
    const word = meter.slice(meter.indexOf(tag) + tag.length).match(/^([^<]*)</)[1];
    return `${word}${tag.includes("border-dashed") ? " dashed" : ""}${tag.includes("text-primary") ? " mine" : ""}`;
  });
  assert.deepEqual(slots, ["SSE mine", "SSE", "File", "Term dashed"]);
  assert.match(meter, /<span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*border-dashed[^"]*" title="Terminal · app · connecting · opened 1× · 0 errors · 30s ago">Term<\/span>/);
  // Four of the six connections the page holds: the official Progress, not a row of self-drawn bars.
  assert.equal(progressValues(tile)[0], 67);
  // The words follow the language; "SSE" stays as it is.
  const zh = (key, params) => interpolateMessage(zhCNLocale.messages[key], params);
  const zhHtml = render({ page: page({ sources }), t: zh });
  const zhMeter = pageSection(zhHtml);
  assert.deepEqual(badgeTags(zhMeter).map((tag) => {
    const at = zhMeter.indexOf(tag) + tag.length;
    return zhMeter.slice(at).match(/^([^<]*)</)[1];
  }), ["SSE", "SSE", "文件", "终端"]);
});

test("sessions on the server: grouped by project, the chat's first and not repeated, subagents under their root", () => {
  const html = render();
  const text = visibleText(sessionsSection(html));
  // "# app", the chat, its subagent, "# notes", the notes session, then the session the list lacks.
  assert.ok(text.indexOf("app") < text.indexOf("Current chat"), text);
  assert.ok(text.indexOf("Current chat") < text.indexOf("explore the repo"), text);
  assert.ok(text.indexOf("explore the repo") < text.indexOf("notes"), text);
  assert.ok(text.indexOf("notes") < text.indexOf("Weekly plan"), text);
  assert.ok(text.indexOf("Weekly plan") < text.indexOf("Not in the session list"), text);
  assert.ok(text.indexOf("Not in the session list") < text.indexOf("other-se"), text);
  // The chat's row: its status mark, its badges with their holders, its details in its own footer.
  const current = rowOf(html, "this chat");
  assert.match(current, /title="this chat · s1 · alive · 2 event streams · 1 liveness providers · reap countdown 8m · started 2×">/);
  assert.match(current, /<span class="[^"]*" role="img" aria-label="alive"/);
  assert.match(current, /aria-label="SSE: 2 \(this page 1, other page 1\)"/);
  assert.match(current, /<div data-slot="item-footer"[^>]*><div class="flex min-w-0 flex-col gap-1.5"><div class="[^"]*"><span class="font-mono tabular-nums">s1<\/span>/);
  assert.match(rowOf(html, "notes-1"), /<span class="session-tree-awaiting" role="img" aria-label="awaiting input" title="awaiting input"><\/span>/, "the sidebar's awaiting dot");
  // 3 min left when the server answered, 10 s ago.
  assert.match(rowOf(html, "notes-1"), /<span class="min-w-9 text-right">2m 50s<\/span>/, "to the second");
  // A running session is the spinner in the status slot, not a chip.
  assert.match(rowOf(html, "explore the repo"), /role="img" aria-label="running"/);
  // A closing one carries the state's dashed mark, and the state word beside it.
  assert.match(rowOf(html, "other-se"), /role="img" aria-label="closing"/);
});

test("a chat that moved on waits for its own answer; a hidden page pauses", () => {
  // The chat moved to s2: the answer about s1 still on screen is not s2's.
  const moved = render({ page: page({ client: client({ sessionId: "s2" }) }), selectedSessionId: "s2" });
  const list = sessionsSection(moved);
  assert.match(list, /^<h3[^>]*>Session<\/h3><div class="flex min-w-0 flex-col gap-3"><div data-slot="empty"/, "the wait is an Empty state, not a styled div");
  assert.ok(list.includes(`<div data-slot="empty-title" class="tracking-tight text-xs font-normal text-muted-foreground">${t("debug.poll.waiting")}</div>`));
  assert.doesNotMatch(list, /data-slot="item-footer"/);

  const hidden = render({ page: page({ visibility: { ...page().visibility, state: "hidden" } }) });
  assert.match(hidden, /<span data-slot="badge" data-variant="outline" class="[^"]*debug-panel-status[^"]*"[^>]*><svg[^>]*>.*?<\/svg><span class="debug-panel-status-text[^"]*">Paused while the page is hidden<\/span><\/span>/);

  // Nor does a hidden page read or render each second; it reads again as it comes back.
  const tick = panelSource.slice(panelSource.indexOf("const tick = window.setInterval("), panelSource.indexOf("}, DEBUG_TICK_MS);"));
  assert.match(tick, /^const tick = window\.setInterval\(\(\) => \{\s*\/\/[^\n]*\n\s*if \(document\.visibilityState !== "visible"\) return;\s*read\(\);/);
  const back = panelSource.slice(panelSource.indexOf("const onVisibilityChange = () => {"), panelSource.indexOf("document.addEventListener(\"visibilitychange\", onVisibilityChange)"));
  assert.match(back, /if \(document\.visibilityState !== "visible"\) return;\s*read\(\);\s*poller\.poll\(\);/);
});

test("server states, run statuses and close reasons read as words, not codes", () => {
  const html = render({
    page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: "set_tools", at: LOCAL - 4 * SECOND } } }) }),
    server: withDetail({
      subagents: {
        active: true,
        runs: [
          { sessionId: "sub-queued-1", parentSessionId: "s1", status: "queued", profile: "general", background: true, resumed: false, dispatchedAt: SERVER - 2 * SECOND, abortRequested: false, mcpWaiting: false },
          { sessionId: "sub-newer-2", parentSessionId: "s1", status: "paused", profile: null, background: false, resumed: false, dispatchedAt: null, abortRequested: true, mcpWaiting: false },
        ],
        notifications: [{ sessionId: "sub-queued-1", parentSessionId: "s1", since: SERVER - SECOND }],
      },
      mcp: {
        active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 0,
        servers: [
          { name: "github", scope: "global", state: "needs-auth", hasError: false, released: false },
          { name: "later", scope: "project", state: "warming", hasError: false, released: false },
        ],
      },
    }),
  });
  const stateTitle = titles(html).find((title) => title.startsWith("readyState 1"));
  assert.ok(stateTitle?.split("\n").includes("Last close tools changed · 4s ago"), stateTitle);
  assert.ok(stateTitle.split("\n").includes("Page wants it yes"));
  assert.ok(stateTitle.split("\n").includes("hidden 1× · last hidden 2m 00s ago"));
  const text = visibleText(html);
  assert.ok(text.includes("general Queued · background · 12s ago"), text);
  // A value newer than the panel's maps reads as it came.
  assert.ok(text.includes("sub-newe paused abort requested"));
  assert.ok(text.includes("notifying s1 · 11s ago"));
  assert.ok(text.includes("a run is unsettled"));
  assert.ok(titles(html).includes("github (global) · Needs sign-in"));
  assert.ok(titles(html).includes("later (project) · warming"));

  const noReason = render({ page: page({ client: client({ connection: { ...client().connection, lastClose: { reason: null, at: LOCAL - SECOND } } }) }) });
  assert.ok(titles(noReason).some((title) => title.split("\n").includes("Last close — · 1s ago")));
});

test("an MCP server's state is never the dot's hue alone: words after the name, in the badge's name", () => {
  const servers = [
    { name: "github", scope: "global", state: "connected", hasError: false, released: false },
    { name: "linear", scope: "project", state: "needs-auth", hasError: false, released: false },
    { name: "fs", scope: "global", state: "connected", hasError: false, released: true },
    { name: "sentry", scope: "global", state: "failed", hasError: true, released: false },
    { name: "jira", scope: "global", state: "connected", hasError: true, released: false },
  ];
  const html = render({
    server: withDetail({ mcp: { active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 1, servers } }),
  });
  const detail = rowOf(html, "this chat");
  const pill = (name) => {
    const at = detail.indexOf(`>${name}</span>`);
    assert.notEqual(at, -1, name);
    const from = detail.lastIndexOf('<span data-slot="badge"', at);
    assert.notEqual(from, -1, name);
    return detail.slice(from, at + name.length + 8);
  };
  for (const name of ["github", "linear", "fs", "sentry", "jira"]) {
    assert.match(pill(name), /^<span data-slot="badge" data-variant="outline"/, name);
  }
  // The state word rides the official outline badge; the tones only tint it.
  assert.match(detail, /<span data-slot="badge" data-variant="outline" class="[^"]*text-success[^"]*" role="img" aria-label="github \(global\) · Connected" title="github \(global\) · Connected">/);
  assert.match(detail, /aria-label="linear \(project\) · Needs sign-in"[^>]*><svg[^>]*>.*?<\/svg><span>linear<\/span><span class="font-normal text-muted-foreground">· Needs sign-in<\/span><\/span>/);
  // Let go while idle: dim, and the name itself dimmed.
  assert.match(detail, /aria-label="fs \(global\) · Connected · released"[^>]*>.*?<span class="text-muted-foreground">fs<\/span><\/span>/);
  assert.match(detail, /aria-label="sentry \(global\) · Did not connect · error"[^>]*>.*?<span>sentry<\/span><span class="font-normal text-muted-foreground">· Did not connect<\/span><\/span>/);
  // Red beside a green dot of the same shape: the error is written out too.
  assert.match(detail, /aria-label="jira \(global\) · Connected · error"[^>]*>.*?<span>jira<\/span><span class="font-normal text-muted-foreground">· error<\/span><\/span>/);
  const text = visibleText(detail);
  assert.ok(text.includes("linear · Needs sign-in") && text.includes("sentry · Did not connect"), text);
});

test("the run's chips show only what is true: no chip row while idle, amber for what waits", () => {
  const withRun = (run) => {
    const answer = reply();
    answer.session.wrapper = { ...answer.session.wrapper, run: { ...answer.session.wrapper.run, ...run } };
    answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "s1" ? { ...entry, running: run.running ?? entry.running } : entry));
    return render({ server: server({ reply: answer }) });
  };
  assert.doesNotMatch(rowOf(render(), "this chat"), /data-slot="badge"[^>]*>streaming</);
  const busy = rowOf(withRun({ running: true, streaming: true, promptRunning: true, pendingPrompts: 1, retrying: true }), "this chat");
  assert.match(busy, /<span data-slot="badge" data-variant="outline" class="[^"]*">streaming<\/span><span data-slot="badge" data-variant="outline" class="[^"]*">prompt<\/span><span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*">1 more prompts in flight<\/span><span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*">retrying<\/span>/);
  assert.match(busy, /role="img" aria-label="running"/, "running is the status slot, not a chip");
});

/** The chat's wrapper closing after Stop, its row's summary saying so too. */
function closingAfterStop() {
  const answer = reply();
  answer.session = {
    ...answer.session,
    wrapper: wrapper({
      state: "closing",
      closingAt: SERVER - 3 * SECOND,
      idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 40 * SECOND, lastResetAt: null, forcedByStop: true },
    }),
  };
  answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "s1"
    ? { ...entry, state: "closing", forcedByStop: true, nextIdleCheckAt: SERVER + 40 * SECOND }
    : entry));
  return server({ reply: answer });
}

test("notable states show in place and leave the verdict at OK", () => {
  const html = render({
    page: page({ client: client({ released: { active: true, count: 1, lastAt: LOCAL - MINUTE }, graceDueAt: LOCAL + 24 * SECOND }) }),
    server: closingAfterStop(),
  });
  assert.match(html, /<span class="debug-panel-status-text[^"]*">OK<\/span>/);
  assert.doesNotMatch(html, /<ul/);
  const row = rowOf(html, "this chat");
  assert.match(row, /role="img" aria-label="closing"/);
  assert.match(row, /<span data-slot="badge" data-variant="outline" class="[^"]*text-warning[^"]*">closing 13s ago<\/span>/);
  // Closing after Stop: the stop square, then the time alone, amber; the tooltip says why.
  assert.match(row, /<span class="[^"]*text-warning[^"]*" title="Reap countdown 30s · timeout 10m 00s · Stopped: [^"]*">[^]*?<svg[^>]*aria-label="closes in 30s \(after Stop\)"[^>]*>.*?<\/svg><span class="min-w-9 text-right">30s<\/span>/);
  const pageHtml = pageSection(html);
  assert.match(pageHtml, /<span data-slot="badge" data-variant="outline" class="[^"]*text-primary[^"]*">released while hidden<\/span><span data-slot="badge" data-variant="outline" class="[^"]*text-primary[^"]*">Grace before close in 24s<\/span>/);
});

test("a session closing after Stop carries a stop square, not the amber alone", () => {
  const rowOfNotes = (forcedByStop) => {
    const answer = reply();
    answer.sessions = answer.sessions.map((entry) => (entry.sessionId === "notes-1" ? { ...entry, awaitingInput: false, running: true, forcedByStop } : entry));
    return rowOf(render({ server: server({ reply: answer }) }), "notes-1");
  };
  const forced = rowOfNotes(true);
  const normal = rowOfNotes(false);
  assert.match(forced, /<svg[^>]*aria-label="closes in 2m 50s \(after Stop\)"[^>]*>.*?<\/svg><span class="min-w-9 text-right">2m 50s<\/span>/);
  assert.doesNotMatch(normal, /after Stop/);
  // More than a class name apart: with every class dropped, the two rows still differ.
  const shape = (html) => html.replace(/ class="[^"]*"/g, "").replace(/ title="[^"]*"/g, "");
  assert.notEqual(shape(forced), shape(normal));
});

test("the sparklines draw the poll samples against the 5 s timeout", () => {
  const html = render({
    samples: {
      poll: [
        { ms: 41, tone: "dim", failed: false },
        { ms: 1000, tone: "dim", failed: false },
        { ms: 20, tone: "dim", failed: false },
        { ms: 5000, tone: "warning", failed: true },
      ],
      running: [],
    },
  });
  const labels = ariaLabels(html);
  assert.ok(labels.includes("3 answers · median 41 ms · max 1s"), labels.join("\n"));
  // The values line up at the right of their row, in ms in every language.
  assert.match(panelSource, /<div className="flex min-w-0 flex-1 flex-col items-end gap-1">/);
  assert.equal(zhCNLocale.messages["debug.duration.ms"], "{count} ms");
  assert.ok(labels.includes("40 polls · 1 failed · not yet"));
  // A faint baseline under the bars, the chart's full width: a few short answers are no dashed line.
  assert.match(html, /<svg width="120" height="15" viewBox="0 0 120 15" aria-hidden="true"><rect x="0" y="14" width="120" height="1" class="fill-border"><\/rect><rect class="text-muted-foreground"/);
  const pageHtml = pageSection(html);
  const empty = pageHtml.split('aria-label="40 polls')[1];
  assert.match(empty, /^[^>]*><svg[^>]*><rect x="0" y="14" width="120" height="1" class="fill-border"><\/rect><\/svg>/, "drawn before the first sample");
  // Newest on the right, standing on the baseline; 41 ms and 20 ms are 1px stubs, 1 s is 6px, a failure is a full bar.
  assert.match(html, /<rect class="text-muted-foreground" x="105" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="text-muted-foreground" x="109" y="8" width="3" height="6" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="text-muted-foreground" x="113" y="13" width="3" height="1" fill="currentColor"><\/rect>/);
  assert.match(html, /<rect class="text-warning" x="117" y="0" width="3" height="14" fill="currentColor"><\/rect>/);
  assert.match(html, /<span class="text-xs tabular-nums text-warning">—<\/span>/, "no round trip for a failure");
});

test("without a chat or with a reader that throws, the panel says so and still shows the server", () => {
  const failed = render({ page: page({ client: null, clientFailed: true }) });
  assert.ok(failed.includes(`>${t("debug.stream.readerFailed")}</div>`), "the reader's fault is an issue's sentence");
  assert.match(failed, /Issues: 1/);
  assert.ok(visibleText(failed).includes("Uptime 2h 00m"));
  const none = render({ page: page({ client: null }), selectedSessionId: null });
  assert.ok(visibleText(none).includes(t("debug.stream.noChat")));
  assert.ok(visibleText(none).includes(t("debug.server.noSession")));
  const before = render({ page: null });
  assert.match(before, /<span class="debug-panel-status-text[^"]*">Reading…<\/span>/);
  assert.doesNotMatch(before, /data-debug-section/, "no columns before the first reading");
});

test("the panel keeps to the theme and to the official design language", () => {
  // No hand-drawn chrome: no stylesheet of its own, no inline layout, no arbitrary sizes.
  assert.doesNotMatch(panelSource, /DEBUG_PANEL_CSS|<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
  assert.doesNotMatch(panelSource, /text-\[\d/);
  assert.doesNotMatch(panelSource, /rounded-\[/);
  assert.doesNotMatch(panelSource, /shadow-\[/);
  assert.doesNotMatch(panelSource, /border-t|border-b/);
  assert.doesNotMatch(panelSource, /debug-bar|debug-spark|debug-slot|debug-row|debug-meter|debug-label|debug-value/);
  // No hardcoded hex anywhere in the panel; the tones ride the theme's tokens.
  const colors = new Set((panelSource.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((color) => color.toLowerCase()));
  assert.deepEqual([...colors].sort(), []);
  // Progress for every bar, Badge outline for every state, official containers for the lists.
  assert.match(panelSource, /<Progress\b/);
  assert.doesNotMatch(panelSource, /variant="default"|variant=\{item\.filled/);
  for (const component of ["Item", "ItemGroup", "Field", "FieldGroup", "FieldTitle", "Table", "Badge", "Progress", "Empty", "Alert"]) {
    assert.match(panelSource, new RegExp(`\\b${component}\\b`), component);
  }
  // One container: the drawer's own section; the three columns are sections, not cards.
  assert.doesNotMatch(panelSource, /<Card\b|<CardHeader|<CardContent|<CardTitle/);
  // The panel's width, not the window's, drives the columns.
  assert.match(panelSource, /className="@container /);
  assert.match(panelSource, /@2xl:grid-cols-2 @5xl:grid-cols-3/);
  assert.match(panelSource, /@2xl:row-span-2 @5xl:row-span-1/);
  assert.doesNotMatch(panelSource, /AbortSignal\.(any|timeout)|\(\?<[=!]/, "Safari 16.2");
  // Escape on document (before the window's Stop shortcut), and nothing that keeps a session alive.
  assert.match(panelSource, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.doesNotMatch(panelSource, /\/lease|\/events|EventSource|sendAgentCommand|method: "POST"/);
  // The sidebar shows nothing: the panel writes no labels anywhere.
  assert.doesNotMatch(panelSource, /debug-overlay-store|setDebugOverlay/);
});

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}

test("a tooltip holds the view still: the mouse on a titled element freezes what the panel shows", () => {
  const hold = between(panelSource, "const [held, setHeld] = useState<HeldView | null>(null);", "useEffect(() => {\n    disposedRef.current = false;");
  assert.match(hold, /if \(event\.pointerType !== "mouse"\) return;/, "touch shows no tooltips");
  assert.match(hold, /event\.target\.closest\("\[title\]"\)/);
  assert.match(hold, /setHeld\(target \? liveRef\.current : null\);/);
  assert.match(hold, /section\.addEventListener\("pointerleave", onPointerLeave\);/);
  assert.match(panelSource, /const shown = held \?\? \{ page, server, samples \};/);
});

test("the Debug menu item only toggles its panel, beside the theme item and the stats", () => {
  const item = between(shellSource, 'onSelect={() => toggleTopPanel("debug", mobile)}', "</DropdownMenuItem>");
  assert.doesNotMatch(item, /handleSystemInfoToggle|sendAgentCommand|fetch\(|setSessionKey|loadSession|systemInfoLoaderRef/);
  assert.match(item, /disabled=\{!showChat\}/);
  assert.match(item, /title=\{translate\("debug\.title"\)\}/);
  assert.match(item, /activeTopPanel === "debug" \? "text-primary" : "text-muted-foreground"/);
  assert.notEqual(enLocale.messages["debug.title"], enLocale.messages["session.title"], "e2e finds the stats button by its own name");

  // Desktop: the quiet stats lead, then the Agents pill and the toolbar
  // capsule, then the file toggle; Debug and the theme flip live in the ⋯ menu.
  assert.match(shellSource, /\{renderSessionStats\(false\)\}\s*<Separator orientation="vertical" className="mx-1 h-4 self-center" \/>\s*\{renderAgentsButton\(false\)\}\s*\{renderToolbarBGroup\(false\)\}\s*\{renderMainFileToggle\(false\)\}/);
  const stats = between(shellSource, "const renderSessionStats = (mobile: boolean) => {", "const renderMainFileToggle");
  // The stats group follows the trust warning's place; it never pushes itself right.
  assert.doesNotMatch(stats, /ml-auto/);
  assert.match(shellSource, /!mobile && !showChat && "ml-auto"/);
  // Phones: the chip leads the toolbar row, the file toggle closes it.
  assert.match(shellSource, /\{renderSessionStats\(true\)\}\s*\{renderAgentsButton\(true\)\}\s*\{renderToolbarBGroup\(true\)\}\s*\{renderMainFileToggle\(true\)\}/);
});

test("Escape with focus in the panel gives it back to the ⋯ control, after the panel left the page", () => {
  assert.match(panelSource, /<section\s+ref=\{sectionRef\}\s+className="debug-panel/);
  assert.match(panelSource, /createDebugPanelEscapeListener\(\s*document,\s*\(\) => sectionRef\.current,\s*\(restoreFocus\) => onCloseRef\.current\(restoreFocus\),\s*\)/);
  // The Debug toggle lives in the ⋯ menu; its trigger button is the persistent
  // restore target (a menu item unmounts with the menu).
  assert.match(shellSource, /<Button\s+ref=\{debugButtonRef\}/);
  const close = between(shellSource, "const closeDebugPanel = useCallback(", "}, []);");
  assert.match(close, /\(restoreFocus: boolean\) => \{\s*setActiveTopPanel\(\(panel\) => panel === "debug" \? null : panel\);\s*if \(restoreFocus\) requestAnimationFrame\(\(\) => focusIfLost\(document, debugButtonRef\.current\)\);/);
  assert.match(shellSource, /import \{ focusIfLost \} from "@\/lib\/stacked-dialog";/);
  assert.match(shellSource, /onClose=\{closeDebugPanel\}/);

  // What that frame does: focus that fell to the page goes to the button; focus put elsewhere stays.
  const focused = [];
  const debugButton = { focus: () => focused.push("debug") };
  const body = { name: "body" };
  assert.equal(focusIfLost({ activeElement: body, body }, debugButton), true);
  assert.equal(focusIfLost({ activeElement: { name: "composer" }, body }, debugButton), false);
  assert.equal(focusIfLost({ activeElement: body, body }, null), false, "no Debug button on screen (narrow phone, more closed)");
  assert.deepEqual(focused, ["debug"]);
});

test("the sidebar's running poll records its request alone, not the session-list reload after it", () => {
  const poll = between(sidebarSource, "const poll = async () => {", "const onVisibilityChange = () => {");
  const json = poll.indexOf("await res.json()");
  const answered = poll.indexOf("answeredAt = Date.now();");
  assert.ok(json !== -1 && answered > json, "after the answer is read");
  assert.ok(answered < poll.indexOf("if (stopped || controller !== current) return;"), "before a poll that lost the race returns");
  assert.ok(answered < poll.indexOf("await loadSessions();"), "before the reload");
  assert.match(poll, /\} finally \{[^]*?noteRunningPoll\(startedAt, outcome, httpStatus, answeredAt\);\s*\}/);
});

test("the ⋯ overflow is a Radix menu: its content scrolls itself, the old overlay is gone", () => {
  assert.match(shellSource, /<DropdownMenuContent\s+align="end"\s+id="mobile-toolbar-actions"/);
  assert.doesNotMatch(shellSource, /backdrop-blur-\[10px\]/);
  assert.doesNotMatch(shellSource, /\[scrollbar-width:none\]/);
});

test("AppShell keeps the chat's reader in a ref and the panel open across session switches", () => {
  const register = between(shellSource, "const handleDebugSnapshotReaderChange = useCallback(", "}, []);");
  assert.match(register, /debugSnapshotReaderRef\.current = reader;/);
  assert.doesNotMatch(register, /\bset[A-Z]\w*\(/, "registering renders nothing");
  assert.match(shellSource, /onDebugSnapshotReaderChange=\{handleDebugSnapshotReaderChange\}/);
  assert.match(shellSource, /<DebugPanelBoundary fallback=\{translate\("debug\.failed"\)\}>\s*<DebugPanel\s/);
  assert.match(shellSource, /useEffect\(\(\) => \{\s*startPageVisibilityTracking\(\);\s*\}, \[\]\);/, "the page's visibility is tracked once");
  for (const [name, next] of [["handleCwdChange", "handleSelectSession"], ["handleSelectSession", "handleNewSession"], ["handleNewSession", "hydrateSelectedSession"], ["handleSessionDeleted", "handleOpenFile"]]) {
    const body = between(shellSource, `const ${name} = useCallback`, `const ${next} = useCallback`);
    assert.match(body, /setActiveTopPanel\(\(panel\) => panel === "debug" \? panel : null\);/, name);
    assert.doesNotMatch(body, /setActiveTopPanel\(null\)/, name);
  }
});
