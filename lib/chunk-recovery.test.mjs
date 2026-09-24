import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  CHUNK_RECOVERY_COOLDOWN_MS,
  CHUNK_RECOVERY_SCRIPT,
  CHUNK_RECOVERY_STORAGE_KEY,
  isChunkLoadFailure,
} from "./chunk-recovery.ts";

const CHUNK_FAILURES = [
  { name: "ChunkLoadError", message: "Loading chunk 8974 failed." },
  "Loading chunk app/page failed",
  { message: "Loading CSS chunk 12 failed." },
  new TypeError("Failed to fetch dynamically imported module: https://pi.example/_next/static/chunks/x.js"),
  "Importing a module script failed.",
  { message: "error loading dynamically imported module" },
];

const OTHER_ERRORS = [
  null,
  undefined,
  0,
  "",
  "plain string",
  new Error("Failed to fetch"),
  new TypeError("Cannot read properties of undefined (reading 'x')"),
  { name: "AbortError", message: "The operation was aborted." },
  { message: "Loading chunk" },
];

test("is installed from the document head so it survives a missing page bundle", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<head>[\s\S]*__html: CHUNK_RECOVERY_SCRIPT[\s\S]*<\/head>/);
});

test("classifies chunk load failures from error names and browser messages", () => {
  for (const failure of CHUNK_FAILURES) {
    assert.equal(isChunkLoadFailure(failure), true, String(failure));
  }
  for (const other of OTHER_ERRORS) {
    assert.equal(isChunkLoadFailure(other), false, String(other));
  }
});

function loadRecoveryScript() {
  const listeners = new Map();
  const stored = new Map();
  let now = 1_000_000;
  let reloads = 0;
  runInNewContext(CHUNK_RECOVERY_SCRIPT, {
    window: {
      addEventListener(type, handler) {
        listeners.set(type, [...(listeners.get(type) ?? []), handler]);
      },
      location: { reload: () => { reloads += 1; } },
    },
    sessionStorage: {
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => { stored.set(key, String(value)); },
    },
    Date: { now: () => now },
  });
  return {
    stored,
    get reloads() { return reloads; },
    setNow(value) { now = value; },
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

test("reloads the page when a chunk import rejects", () => {
  const page = loadRecoveryScript();
  page.dispatch("unhandledrejection", { reason: CHUNK_FAILURES[0] });
  assert.equal(page.reloads, 1);
  assert.equal(page.stored.get(CHUNK_RECOVERY_STORAGE_KEY), String(1_000_000));
});

test("reloads when a /_next/static script or stylesheet fails to load", () => {
  for (const target of [
    { tagName: "SCRIPT", src: "https://pi.example/_next/static/chunks/app/page-2240b4e3.js" },
    { tagName: "link", href: "https://pi.example/_next/static/css/app.css" },
  ]) {
    const page = loadRecoveryScript();
    page.dispatch("error", { target });
    assert.equal(page.reloads, 1, target.tagName);
  }
});

test("leaves unrelated errors, other assets, and the cooldown window alone", () => {
  const page = loadRecoveryScript();
  for (const other of OTHER_ERRORS) {
    page.dispatch("error", { error: other });
    page.dispatch("unhandledrejection", { reason: other });
  }
  page.dispatch("error", { target: { tagName: "IMG", src: "https://pi.example/icons/icon-192.png" } });
  assert.equal(page.reloads, 0);

  page.dispatch("unhandledrejection", { reason: CHUNK_FAILURES[1] });
  assert.equal(page.reloads, 1);
  page.setNow(1_000_000 + CHUNK_RECOVERY_COOLDOWN_MS - 1);
  page.dispatch("unhandledrejection", { reason: CHUNK_FAILURES[1] });
  assert.equal(page.reloads, 1, "second failure inside the cooldown must not reload again");

  page.setNow(1_000_000 + CHUNK_RECOVERY_COOLDOWN_MS);
  page.dispatch("unhandledrejection", { reason: CHUNK_FAILURES[1] });
  assert.equal(page.reloads, 2);
});

test("still reloads when sessionStorage is unavailable", () => {
  const listeners = new Map();
  let reloads = 0;
  runInNewContext(CHUNK_RECOVERY_SCRIPT, {
    window: {
      addEventListener(type, handler) { listeners.set(type, handler); },
      location: { reload: () => { reloads += 1; } },
    },
    sessionStorage: {
      getItem() { throw new Error("Blocked"); },
      setItem() { throw new Error("Blocked"); },
    },
    Date: { now: () => 1_000_000 },
  });
  listeners.get("unhandledrejection")({ reason: CHUNK_FAILURES[0] });
  assert.equal(reloads, 1);
});
