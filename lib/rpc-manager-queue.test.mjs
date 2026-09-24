import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function makeInner(overrides = {}) {
  return {
    sessionId: "queue-test-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {},
    },
    sessionManager: { getCwd: () => process.cwd() },
    settingsManager: { setProjectTrusted: () => {}, getDefaultTools: () => undefined },
    agent: { state: {} },
    extensionRunner: {
      getRegisteredCommands: () => [],
      setUIContext: () => {},
      emit: async () => {},
    },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: () => () => {},
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    getActiveToolNames: () => ["read", "bash", "edit", "write"],
    getAllTools: () => [],
    setActiveToolsByName: () => {},
    pendingMessageCount: 0,
    dispose: () => {},
    reload: async () => {},
    ...overrides,
  };
}

test("get_state pairs queued attachments back to the text entries", async () => {
  const image = { type: "image", data: "QUJD", mimeType: "image/png" };
  const wrapper = new AgentSessionWrapper(makeInner({
    getSteeringMessages: () => ["steer text"],
    getFollowUpMessages: () => ["看这张图"],
    agent: {
      state: {},
      peekQueuedMessages: () => [
        { role: "user", content: [{ type: "text", text: "看这张图" }, image] },
        { role: "user", content: [{ type: "text", text: "steer text" }] },
      ],
    },
  }));
  try {
    const state = await wrapper.send({ type: "get_state" });
    assert.deepEqual(state.queuedMessages, { steering: ["steer text"], followUp: ["看这张图"] });
    assert.deepEqual(state.queuedEntries, [
      { text: "steer text", behavior: "steer", images: [] },
      { text: "看这张图", behavior: "followUp", images: [{ data: "QUJD", mimeType: "image/png" }] },
    ]);
  } finally {
    wrapper.destroy();
  }
});

test("get_state reports no queued entries while the queue is empty", async () => {
  const wrapper = new AgentSessionWrapper(makeInner());
  try {
    const state = await wrapper.send({ type: "get_state" });
    assert.deepEqual(state.queuedEntries, []);
  } finally {
    wrapper.destroy();
  }
});

test("queued entries whose attachments cannot be matched still report their text", async () => {
  // A mixed queue hides follow-up content from the peek while steering
  // entries exist; the entry keeps its text, only its images are missing.
  const wrapper = new AgentSessionWrapper(makeInner({
    getSteeringMessages: () => ["steer text"],
    getFollowUpMessages: () => ["hidden text"],
    agent: {
      state: {},
      peekQueuedMessages: () => [
        { role: "user", content: [{ type: "text", text: "steer text" }] },
      ],
    },
  }));
  try {
    const state = await wrapper.send({ type: "get_state" });
    assert.deepEqual(state.queuedEntries, [
      { text: "steer text", behavior: "steer", images: [] },
      { text: "hidden text", behavior: "followUp", images: [] },
    ]);
  } finally {
    wrapper.destroy();
  }
});
