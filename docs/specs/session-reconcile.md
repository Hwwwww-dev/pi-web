# 会话对齐（session reconcile）方案

> 2026-11-22 · 状态：待实施（未改代码、未构建）
> 目标：**任何一次发送的用户消息，都必须出现在列表里**，不靠刷新；视图落后时自动补回。

## 1. 现象

| 场景 | 表现 |
|---|---|
| 立即发送（先打断再发） | 消息发出后从列表消失，刷新（重载会话）才回来 |
| 大号用户消息（多图 base64） | 同上，且更频繁 |
| 引导 / 排队 | 偶发同上 |

服务端会话文件里**有**这条消息（刷新可见），所以不是没发出去，是**视图没拿到**。

## 2. 根因（代码事实）

1. **`hooks/useAgentSession.ts:2565`**
   ```ts
   // 自己 prompt 的迟到重放：持久副本已由整载带进列表，绝不再 append。
   if (own) return prev;
   ```
   投递的用户消息若命中 `promptOwnUserKeyRef`，被当作“迟到重放”**直接丢弃**。注释的前提是“列表里已经有持久副本”，但立即发送时这个前提不成立。

2. **立即发送的时序**：`components/ChatInput.tsx:1726-1734` 先 `onAbort()`，等 `isStreaming` 变 false 由 `components/ChatInput.tsx:1723` 的 effect 调 `handleSend()`。
   - `handleSend` 立刻 append 乐观气泡并记 `optimisticUserMessageKeyRef` / `promptOwnUserKeyRef`（`hooks/useAgentSession.ts:2793-2794`）。
   - 同刻，abort 让上一轮走 settle → `finishPromptWithoutStream`（`hooks/useAgentSession.ts:2051-2076`）→ `loadSession` **整窗替换** messages。这份快照里还没有刚落盘的 prompt → **气泡被覆盖**。
   - 随后投递到达，命中 (1) → 不再追加。**两处都失手，消息消失。**

3. **对齐原语只在窄路上用**：`lib/session-align.ts` 的 `probeSessionTail()` / `fetchSessionSince()` 只服务于 `unconfirmedSendRef`（传输失败/半失败），`hooks/useAgentSession.ts:2056-2064`；其余全靠整窗 `loadSession`。

4. **SSE 会丢事件**：`lib/agent-event-stream.ts:73-85` 允许丢 `*_delta` 与工具更新；积压超限（`BACKLOG_LIMIT`）直接关流让客户端重连。丢的虽然是“可重建”的增量，但客户端**没有任何缺号检测**，丢了就永远不知道。

## 3. 设计原则

- **判定只看 entryId 序列**，绝不比对消息体 —— 大消息不影响判定速度。
- **补差优先，整窗读兜底**：能不整窗读就不读。
- **跑中只补用户条目**：助手正文归 SSE，避免重复。
- **幂等**：所有合并按 entryId 去重，重复触发安全。
- 不动 minimap、不动 200ms/3 轮上翻取页、不动翻页/切会话的整窗读。

## 4. 机制

### 4.1 缺号检测（服务端）

`lib/agent-event-stream.ts`：
- 每个流内维护 `let rev = 0`。
- 每条发出去的 data 帧带上 `rev`（`clientEventSerialization` 产出后，在 `encode` 里补 `{ ...data, rev: ++rev }`；`rev` 只在该流内单调）。
- 首帧（`connected` 快照事件）带当前 `rev` 作为基线。
- 已有心跳（`lib/agent-event-stream.ts:417`）改成带信息：
  ```ts
  encode({ type: "heartbeat", rev: ++rev }, { droppable: true })
  ```
- 心跳间隔保持 `heartbeatMs()` 现值，不改。

客户端（`hooks/useAgentSession.ts` 事件入口）：
- 记 `lastRevRef`；收到事件时若 `rev !== lastRev + 1` 且 `rev > lastRev` → **判定缺号** → `reconcileSession(sid, "gap")`。
- 收到 `heartbeat` 只更新 `lastRev`（并作为连接存活信号）。
- 重连/首帧：以快照里的 `rev` 重置基线（不误判）。

### 4.2 三条补法

统一入口 `reconcileSession(sid, reason)`，`reason: "gap" | "sent" | "settle" | "resume"`。

**① 追加**（`gap` / `settle` / `sent` 的主路径）
```
since = entryIdsRef 的末条（"settle" 且存在 unconfirmedSendRef 时用它的 lastEntryIdAtSend）
?since=<since>&deferMedia=1&deferThinking=1      // 现有 fetchSessionSince
按 entryId 去重后追加
reason === "sent" 或（跑中）→ 只留 role === "user"
其余 → 全角色
```
现成实现：`appendSessionSince()`（`hooks/useAgentSession.ts:1849`），本次给它加 `mode: "user-only"`。

**② 锚点失效 → 整窗读**
`?since=` 返回 `reset` → `loadSession(sid)`；读回后若 `unconfirmedSendRef.key` 不在列表 → 交给 `settleUnconfirmedSend`（回填草稿 + `chat.sendNotReceived`，`lib/i18n/messages/zh-CN.ts:1029`）。

**③ 没落盘（不是“不一致”）**
`settle` 时 `?ids=1` 的 `lastEntryId === 发送点` → 判定没送到 → 回填输入框 + 提示 + 撤气泡（沿用 `settleUnconfirmedSend` 现有行为）。**立即发送同样记一条 `send` 记录**，只用于这条兜底，不删气泡、不重发。

### 4.3 最后一层兜底（一行）

`hooks/useAgentSession.ts:2565`：
```ts
// 列表里真的有这条用户消息才跳过；没有就必须追加（settle 的整窗读可能先于落盘）。
if (own) {
  return prev.some((m) => m.role === "user" && userMessageKey(m) === deliveredKey)
    ? prev
    : [...prev, delivered];
}
```

### 4.4 触发与频率

| 来源 | 时机 | 深度 |
|---|---|---|
| `gap` | SSE 心跳（30s，已有事件） | 跑中 user-only 补，空闲 `loadSession`（merge） |
| `sent` | `handleSend`、`sendStreamingPrompt` 成功后 1 次（1s 后） | user-only 单发，不轮询 |
| `settle` | `finishPromptWithoutStream` | 尾 id 比对 → `loadSession`（merge）；相同则不读 |
| `resume` | SSE `connected`、切回前台、`online` | 跑中 user-only 补，空闲 `loadSession`（merge） |

闸门：`reconcileInFlightRef` 单飞（四源同时触发只跑一次）。

## 5. 改动清单

| # | 文件 | 位置 | 改什么 |
|---|---|---|---|
| 1 | `hooks/useAgentSession.ts` | `appendSessionSince` | 加 `mode: "user-only"` 过滤 |
| 2 | `hooks/useAgentSession.ts` | 新增 `reconcileSession` | 统一入口，四条 reason + 单飞闸门 |
| 3 | `hooks/useAgentSession.ts` | `finishPromptWithoutStream` | 整窗读 → `reconcileSession(sid, "settle")`；保留“送到没”判定 |
| 4 | `hooks/useAgentSession.ts` | `handleSend` / `sendStreamingPrompt` 成功分支 | 1s 后 `reconcileSession(sid, "sent")` |
| 5 | `hooks/useAgentSession.ts` | `case "connected"`、`visibilitychange`/`online` effect、`case "heartbeat"` | 分别调 `resume` / `gap` |
| 6 | `hooks/useAgentSession.ts` | `message_end` 的 `own` 分支 | 按 key 查列表，没有就追加 |

不改：`lib/agent-event-stream.ts`、`lib/rpc-manager.ts`、`app/api/sessions/[id]/route.ts`、`lib/session-align.ts`、`components/ChatInput.tsx`、minimap、懒加载。

**已有的两套别重复造**：
- `reconcileAgentState()` 管**运行状态与队列**，不管消息；新的 `reconcileSession` 只管消息，不新增定时器（复用 30s 心跳与事件挂点）。
- SSE 心跳事件已存在（`lib/agent-event-stream.ts:417`），本次只让客户端消费它，不新增 `rev`。

## 6. 边界场景

| 场景 | 结果 |
|---|---|
| 立即发送，abort 的 settle 先读 | 追加不替换 → 气泡不丢；投递被 `own` 兜底追加 |
| 大消息多图 | `?since=` 带 `deferMedia=1`，补回不搬 base64；图片懒加载 |
| SSE 断流 30s | 重连 `resume` → 尾 id 比对 → 追加 |
| 另一标签页/CLI 改同一会话 | 尾 id 不同但 `?since=` 内容对不上 → `reset` → 整窗读 |
| fork / 编辑历史 | 同上走整窗 |
| 服务端重启 | 新流 `rev` 从 0 起，首帧做基线，不误判 |
| 消息真没写进文件 | settle 判“没送到” → 回填输入框 + 提示 |
| 流积压被关 | 重连 `resume` 补差，和现有行为一致 |

## 7. 验证（仓库禁测试）

1. `node_modules/.bin/tsc --noEmit` → 0 错。
2. `npm run lint` → 只剩现有 4 条旧告警（`ActivityRows.tsx`×2、`SourceCodeView.tsx`、`VirtualRows.tsx`）。
3. 真机（必须先 build + 重启，PWA 需完全重开）：
   - 立即发送连发 3 次（含 1 次多图）：每次气泡与列表都在，刷新后一致。
   - 引导、排队各 1 次：列表出现且不重复。
   - 拔网 10s 再恢复：重连后缺口自动补齐，无重复。
   - 两个标签页同时开同一会话，一边发送：另一边 10s 内自愈。
   - 大消息会话切前台：不出现整窗重载闪烁（除非真 `reset`）。

## 8. 上线与回滚

- 顺序：改 → `tsc` + `lint` → 用户点头 → `git push origin dev` → `bash ~/run-pi-web-build.sh` → 延迟重启 → 真机复验。
- 回滚：`git revert` 单次提交即可；不涉及数据/接口结构变更（`rev` 是附加字段，旧客户端忽略）。
