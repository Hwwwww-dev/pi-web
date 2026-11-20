import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumeExternalOpenRequest,
  installVscodeBridge,
  isVscodeBridgeActive,
  requestOpenInVscode,
} from "./vscode-bridge.ts";

/**
 * The bridge is the contract with the `pi-web-vsc` extension: the panel only
 * trusts messages carrying the token it printed into the iframe URL, and we only
 * trust messages that come back through `window.parent`. These tests pin both
 * directions down without a browser.
 */

const CHANNEL = "pi-web-vscode-bridge";
const TOKEN_VALUE = "tok123";
const TOKEN_KEY = "token";

class FakeElement {}
class FakeAnchor extends FakeElement {
  constructor(attributes) {
    super();
    this.attributes = attributes;
  }

  closest() {
    return this;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

function fakeGlobals(search = `?piwebBridge=${TOKEN_VALUE}`) {
  const sent = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const parent = { postMessage: (message) => sent.push(message) };
  const collect = (map) => (type, handler) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(handler);
  };
  const fire = (map, type, event) => {
    for (const handler of map.get(type) ?? []) handler(event);
  };

  globalThis.Element = FakeElement;
  globalThis.window = {
    location: { search },
    parent,
    addEventListener: collect(windowListeners),
    removeEventListener: () => {},
    getSelection: () => null,
    setTimeout: () => 0,
    open: () => null,
  };
  globalThis.document = {
    activeElement: null,
    addEventListener: collect(documentListeners),
    removeEventListener: () => {},
    execCommand: () => true,
  };
  // Node ships a getter-only `navigator`; redefine so the clipboard hook can be observed.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("refused in a cross-origin iframe");
        },
      },
    },
  });

  return {
    sent,
    parent,
    ready: () => fire(windowListeners, "message", {
      source: parent,
      data: { channel: CHANNEL, [TOKEN_KEY]: TOKEN_VALUE, type: "ready" },
    }),
    message: (data) => fire(windowListeners, "message", { source: parent, data }),
    click: (event) => fire(documentListeners, "click", event),
  };
}

test("stays inert without the token in the URL", () => {
  const globals = fakeGlobals("?session=abc");
  const cleanup = installVscodeBridge();

  assert.equal(globals.sent.length, 0);
  assert.equal(isVscodeBridgeActive(), false);
  assert.equal(consumeExternalOpenRequest(), false);
  requestOpenInVscode("/tmp/a.ts", 3);
  assert.equal(globals.sent.length, 0);
  cleanup();
});

test("activates only on a ready carrying our own token", () => {
  const globals = fakeGlobals();
  const cleanup = installVscodeBridge();

  assert.equal(globals.sent.length, 1);
  assert.deepEqual(globals.sent[0], { channel: CHANNEL, [TOKEN_KEY]: TOKEN_VALUE, type: "hello", version: 1 });

  globals.message({ channel: CHANNEL, [TOKEN_KEY]: "not-the-token", type: "ready" });
  assert.equal(isVscodeBridgeActive(), false);

  globals.ready();
  assert.equal(isVscodeBridgeActive(), true);

  cleanup();
  assert.equal(isVscodeBridgeActive(), false);
});

test("routes external links and editor jumps to the panel", () => {
  const globals = fakeGlobals();
  const cleanup = installVscodeBridge();
  globals.ready();

  const anchor = new FakeAnchor({ target: "_blank", href: "https://example.com/docs" });
  const click = {
    target: anchor,
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  globals.click(click);
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(
    { type: globals.sent.at(-1).type, url: globals.sent.at(-1).url },
    { type: "open-external", url: "https://example.com/docs" },
  );

  assert.equal(consumeExternalOpenRequest(), false);
  globals.click({ target: anchor, button: 0, altKey: true, defaultPrevented: true });
  assert.equal(consumeExternalOpenRequest(), true);
  assert.equal(consumeExternalOpenRequest(), false);

  requestOpenInVscode("/repo/src/app.ts", 42);
  const jump = globals.sent.at(-1);
  assert.deepEqual(
    { type: jump.type, path: jump.path, line: jump.line },
    { type: "open-file", path: "/repo/src/app.ts", line: 42 },
  );

  cleanup();
});
