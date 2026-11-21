import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const COMPACTING_REFUSAL =
  "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.";

const nextTurn = async () => {
  // The flush goes through the prompt admission chain, one submission after another.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * A compacting SDK session that refuses prompts the way `AgentSession.prompt()`
 * does, with the queue, event and prompt surfaces the wrapper touches. `promptImpl`
 * is swapped per phase of a test: refusal while compacting, a recorder for the flush.
 */
function makeInner(manager, promptImpl) {
  const listeners = new Set();
  const inner = {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: true,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    pendingMessageCount: 0,
    model: undefined,
    systemPrompt: "",
    agent: { state: {} },
    extensionRunner: {},
    steering: [],
    followUp: [],
    prompt: (message, options) => promptImpl(message, options),
    getSteeringMessages: () => [...inner.steering],
    getFollowUpMessages: () => [...inner.followUp],
    clearQueue: () => {
      const steering = inner.steering;
      const followUp = inner.followUp;
      inner.steering = [];
      inner.followUp = [];
      return { steering: [...steering], followUp: [...followUp] };
    },
    getContextUsage: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {},
  };
  inner.emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };
  return inner;
}

/** The SDK's refusal during compaction; a registered extension command still runs. */
function refuseDuringCompaction(registeredCommand) {
  return (message, options) => {
    if (message.startsWith("/") && message.slice(1).split(" ")[0] === registeredCommand) {
      options?.preflightResult?.("handled");
      return Promise.resolve();
    }
    return Promise.reject(new Error(COMPACTING_REFUSAL));
  };
}

/** The flush's side: record the call, answer the disposition, resolve (or refuse). */
function recordDeliveries(calls, { fail = false, dispositions = [] } = {}) {
  return (message, options) => {
    const disposition = dispositions[calls.length] ?? (calls.length === 0 ? "started" : "queued");
    calls.push({
      message,
      streamingBehavior: options?.streamingBehavior,
      images: options?.images,
      source: options?.source,
      disposition,
    });
    // A refusal (no model, no API key) rejects before preflight, as the SDK's does.
    if (fail) return Promise.reject(new Error("Model not found: p/m"));
    options?.preflightResult?.(disposition);
    return Promise.resolve();
  };
}

async function makeSessionDir(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  return { root, sessionDir };
}

test("prompts sent while compaction runs park and flush FIFO at compaction end", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-queue-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  // Both submissions are accepted and acked as queued (the composer clears and
  // shows a queue row; the message is not a sent one until the flush delivers it).
  assert.deepEqual(await wrapper.send({ type: "prompt", message: "first" }), { queued: true });
  assert.deepEqual(await wrapper.send({ type: "prompt", message: "second", streamingBehavior: "steer" }), { queued: true });

  let state = await wrapper.send({ type: "get_state" });
  // A plain parked prompt is a steer row (the TUI parks Enter as steer), in arrival order.
  assert.deepEqual(state.queuedMessages, { steering: ["first", "second"], followUp: [] });
  assert.equal(state.isCompacting, true);
  // Parked prompts keep their admission outstanding: the wrapper is not idle.
  assert.equal(state.isPromptRunning, true);
  assert.equal(wrapper.isRunning(), true);
  assert.ok(events.some((event) => event.type === "queue_update"
    && event.steering?.join() === "first,second" && event.followUp?.length === 0));

  // An extension command typed during compaction runs instead of parking, and
  // is not acked as queued: it is a handled command, not a queued message.
  assert.deepEqual(await wrapper.send({ type: "prompt", message: "/mcp now" }), null);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: ["first", "second"], followUp: [] });

  // Only the delivery that started a run completes its client's prompt (the
  // extension command above already emitted its own prompt_done).
  const promptDoneBefore = events.filter((event) => event.type === "prompt_done").length;
  const deliveries = [];
  inner.prompt = recordDeliveries(deliveries);
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();

  // FIFO, each with a streamingBehavior so the SDK decides start-or-join: the
  // plain parked prompt goes out as a steer of whatever run is left.
  assert.deepEqual(deliveries.map(({ message, streamingBehavior, source }) => ({ message, streamingBehavior, source })), [
    { message: "first", streamingBehavior: "steer", source: "rpc" },
    { message: "second", streamingBehavior: "steer", source: "rpc" },
  ]);
  // Only the delivery that started a run completes its client's prompt.
  assert.equal(
    events.filter((event) => event.type === "prompt_done").length - promptDoneBefore,
    1,
  );

  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
  assert.equal(state.isPromptRunning, false);
  assert.ok(events.some((event) => event.type === "queue_update"
    && event.steering?.length === 0 && event.followUp?.length === 0));
});

test("recall returns parked prompts to the input and settles their admissions", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-recall-");
  const manager = SessionManager.create(root, sessionDir);
  const deliveries = [];
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  const events = [];
  wrapper.onEvent((event) => events.push(event));
  await wrapper.send({ type: "prompt", message: "first" });
  await wrapper.send({ type: "prompt", message: "second", streamingBehavior: "followUp" });

  inner.prompt = recordDeliveries(deliveries);
  const cleared = await wrapper.send({ type: "clear_queue" });
  assert.deepEqual(cleared, { steering: ["first"], followUp: ["second"] });
  // The plain prompt's client is released: nothing ran.
  assert.ok(events.some((event) => event.type === "prompt_done" && event.aborted === true));

  const state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
  assert.equal(state.isPromptRunning, false);
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();
  assert.deepEqual(deliveries, []);
});

test("clear_queue returns pi's own queue beside the parked prompts", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-clear-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  inner.steering = ["sdk-steer"];
  inner.followUp = ["sdk-follow-up"];
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "parked" });
  const cleared = await wrapper.send({ type: "clear_queue" });
  assert.deepEqual(cleared, { steering: ["sdk-steer", "parked"], followUp: ["sdk-follow-up"] });

  const state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
});

test("a failed flush puts the prompt back in the queue and reports the error", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-flushfail-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "doomed" });
  inner.prompt = recordDeliveries([], { fail: true });
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();

  const state = await wrapper.send({ type: "get_state" });
  // Back in the queue for Recall or the next compaction end, but no longer
  // admitted: the session can go idle.
  assert.deepEqual(state.queuedMessages, { steering: ["doomed"], followUp: [] });
  assert.equal(state.isPromptRunning, false);
  assert.equal(wrapper.isRunning(), false);
  assert.ok(events.some((event) => event.type === "prompt_error" && event.errorMessage === "Model not found: p/m"));
  // The plain prompt's client is released even though the delivery failed.
  assert.ok(events.some((event) => event.type === "prompt_done"));
});

test("parked prompts carry their images through the flush", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-images-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  const images = [{ type: "image", data: "aGk=", mimeType: "image/png" }];
  await wrapper.send({ type: "prompt", message: "look", images });
  const deliveries = [];
  inner.prompt = recordDeliveries(deliveries);
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].images, images);
  assert.equal(deliveries[0].disposition, "started");
});

test("Recall gives parked prompts' images back with their texts", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-recall-images-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "look", images: [{ type: "image", data: "aGk=", mimeType: "image/png" }] });
  assert.deepEqual(await wrapper.send({ type: "clear_queue" }), {
    steering: ["look"],
    followUp: [],
    images: [{ data: "aGk=", mimeType: "image/png" }],
  });
});

// 接受之后才失败的 prompt 只走 SSE：POST 已回 200，页面断线重连/隐藏页释放
// 的窗口里 prompt_error 无人接收就永久丢失，UI 停在「已发出、无回复、无报
// 错」（2026-11-21 审计）。修法：结果存入闩，新订阅者补收一次后清除。
test("a prompt that fails after acceptance replays once to the next subscriber", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-prompt-failure-replay-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, sessionDir);
  // 先过 preflight（"started"）再拒绝：POST 已经 200 的那条路径。
  const postAcceptRefusal = (message, options) => {
    options?.preflightResult?.("started");
    return Promise.reject(new Error("provider 401: unauthorized"));
  };
  const inner = makeInner(manager, postAcceptRefusal);
  const wrapper = new AgentSessionWrapper(inner);
  // finishPrompt 会 arm idle 定时器，不销毁会把测试进程钉住不退出。
  t.after(() => wrapper.destroy());

  const live = [];
  const offLive = wrapper.onEvent((event) => live.push(event));
  await wrapper.send({ type: "prompt", message: "do it" });
  await nextTurn();
  offLive();

  // 在场监听者照旧实时收到。
  assert.equal(live.some((event) => event.type === "prompt_error" && event.errorMessage === "provider 401: unauthorized"), true);
  assert.equal(live.some((event) => event.type === "prompt_done"), true);

  // 断线回来的新订阅者补收一次。
  const reconnected = [];
  const offReconnect = wrapper.onEvent((event) => reconnected.push(event));
  offReconnect();
  assert.equal(reconnected[0]?.type, "prompt_error");
  assert.equal(reconnected[1]?.type, "prompt_done");

  // 再订阅不再重复；新一轮 prompt 接受也作废闩。
  const again = [];
  const offAgain = wrapper.onEvent((event) => again.push(event));
  offAgain();
  assert.equal(again.some((event) => event.type === "prompt_error"), false);

  inner.prompt = (message, options) => {
    options?.preflightResult?.("started");
    return Promise.resolve();
  };
  await wrapper.send({ type: "prompt", message: "next one" });
  await nextTurn();
  const later = [];
  const offLater = wrapper.onEvent((event) => later.push(event));
  offLater();
  assert.equal(later.some((event) => event.type === "prompt_error"), false);
});
