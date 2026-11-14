import type { AgentMessage, CustomMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

/**
 * React keys of the chat's messages (#1184). A message read from the session
 * file is keyed by its entry id. One added during a run (the sent prompt, each
 * `message_end`) has no id until the file is read again, so it is keyed by its
 * place after the last loaded entry: appends and older pages prepended leave
 * that place alone. When the read lands, `carryMessageKeys()` hands those keys
 * to the entry ids now at the same places, so React keeps those messages mounted,
 * their blocks too (MessageView keys a block by its place, not the entry id): a
 * scrolled prompt bubble, open thinking, a tool card and its output's scroll.
 * Still remounted: a message whose key does not pass (from the first mismatch on,
 * or all of a run longer than the first page), and, at the run's end, the process
 * messages moving into Process details (and an answer that followed thinking in
 * its message, whose blocks move up).
 */
const liveKey = (anchor: string | undefined, offset: number) => `live:${anchor ?? ""}:${offset}`;

/**
 * 当前流式气泡落进 `messages` 后将携带的键。它追加在已读条目之后，位置就是
 * `entryIds.length + liveCount`，因此键与列表那一行（`liveKey(anchor, idx -
 * entryIds.length)`）逐字相同；`carryMessageKeys()` 再把它交给同位置的条目 id。
 * 于是这一个键跨「流式 → message_end → 读文件」三跳不变，思考行的折叠选择与
 * 实测时长（`lib/thinking-durations.ts`）才能活过那几次重挂载。
 */
export function streamingMessageKey(entryIds: readonly string[], liveCount: number): string {
  return liveKey(entryIds[entryIds.length - 1], liveCount);
}

export function messageRenderKeys(entryIds: readonly string[], count: number, aliases: ReadonlyMap<string, string>): string[] {
  const anchor = entryIds[entryIds.length - 1];
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = entryIds[i];
    keys.push(id === undefined ? liveKey(anchor, i - entryIds.length) : aliases.get(id) ?? id);
  }
  return keys;
}

// The file holds pi's own message, except for the prompt, sent with the
// browser's timestamp, and a custom message, stamped when its entry was written.
export function sameMessage(live: AgentMessage, loaded: AgentMessage): boolean {
  if (live.role !== loaded.role) return false;
  if (live.role === "user") return userMessageKey(live) === userMessageKey(loaded);
  if (live.role === "custom") return live.customType === (loaded as CustomMessage).customType;
  return live.timestamp === loaded.timestamp;
}

/**
 * The aliases (entry id → key) once `next` replaces `previous`: those whose ids
 * are still loaded, plus one per live message of `previous` that the entries
 * after its anchor line up with, up to the first that does not. The rest keep
 * their id keys and remount. Keys never collide: an alias is its entry's place
 * after the anchor on its branch, and a loaded window is one branch, where each
 * place holds one entry (the reader shows an entry as one message at most).
 */
export function carryMessageKeys(
  previous: { messages: readonly AgentMessage[]; entryIds: readonly string[]; aliases: ReadonlyMap<string, string> },
  next: { messages: readonly AgentMessage[]; entryIds: readonly string[] },
): Map<string, string> {
  const loaded = new Set(next.entryIds);
  const aliases = new Map([...previous.aliases].filter(([id]) => loaded.has(id)));
  const liveStart = previous.entryIds.length;
  const anchor = previous.entryIds[liveStart - 1];
  const start = anchor === undefined ? 0 : next.entryIds.indexOf(anchor) + 1;
  // The window starts after the anchor (a run longer than the first page).
  if (start === 0 && anchor !== undefined) return aliases;
  for (let offset = 0; liveStart + offset < previous.messages.length; offset++) {
    const id = next.entryIds[start + offset];
    if (id === undefined || !sameMessage(previous.messages[liveStart + offset], next.messages[start + offset])) break;
    aliases.set(id, liveKey(anchor, offset));
  }
  return aliases;
}

/**
 * 尾部合并：回合结束时（agent_settled / prompt_done / 晚到 message_end / 重连
 * onopen）的整载不再整体替换列表——那会把流式行的 `live:` 键全部换成 entryId，
 * carryMessageKeys 对不上的行从第一个 mismatch 起整体重挂载，一轮回复超过首屏
 * 窗口时就是一次全列表重绘。改为保留已加载的行（含翻页历史），只把文件里新出现
 * 的尾部条目接上去；窗口条目按序消费本地尾部行，对上的就地升级为持久身份
 * （entryId，内容以落盘版为准），key 通过别名迁移保持不变，React 不重挂载。
 *
 * 已加载段与窗口能按「本地最后一个持久条目在窗口中的位置」锚定对齐，合并才
 * 成立；锚缺失（跨叶切换、分叉、被 TUI 截断）返回 null，调用方回退整载替换。
 */
export function mergeLoadedTail(
  prevIds: readonly string[],
  prevMessages: readonly AgentMessage[],
  nextIds: readonly string[],
  nextMessages: readonly AgentMessage[],
): { entryIds: string[]; messages: AgentMessage[] } | null {
  const P = prevIds.length;
  // 锚定重叠：文件持续写入时服务端窗口（末尾倒数 N 条）起点不断前移，已加载段
  // 不再是新窗口的严格前缀——逐位比较恒失败、合并永不生效，每次保险读（回合
  // 结束/晚到 message_end/重连）都退化成整载替换：挂着不动列表也被整窗重绘，
  // 视口被拉进旧消息区（「没贴顶也自动加载了旧的」）。改为按锚对齐：窗口外的
  // 已载入历史（含翻页历史）原样保留，窗口内的重叠段逐 id 校验，新尾部追加。
  const anchorId = P > 0 ? prevIds[P - 1] : undefined;
  if (anchorId === undefined) return null;
  const anchorIdx = nextIds.indexOf(anchorId);
  if (anchorIdx < 0) return null;
  const held = anchorIdx + 1; // 已加载段落在窗口内的条数
  const headLen = P - held; // 窗口外的已载入历史（含翻页历史），原样保留
  for (let j = 0; j < held; j++) {
    if (prevIds[headLen + j] !== nextIds[j]) return null;
  }
  // 窗口条目按序消费本地尾部（无 id 的流式/乐观行）：对上的就地升级为持久
  // 条目——id 收编、内容以落盘版为准、本地副本不再保留；对不上的直接追加。
  // 旧实现把对上的行既留在本地尾部又追加进落盘段，每次合并都重复一份流式行
  // （回合结束几秒后整条回复重绘一次的直接机制）；对齐断裂时剩余窗口条目也
  // 会整段追加、已持有的行再重复一份（回复文字被工具行「拆开」的错乱）。
  const messages: AgentMessage[] = [...prevMessages.slice(0, P)];
  const entryIds: string[] = [...prevIds];
  let local = P;
  let appended = 0;
  for (let i = anchorIdx + 1; i < nextIds.length; i++) {
    const id = nextIds[i];
    const persisted = nextMessages[i];
    if (id === undefined || persisted === undefined) break;
    const matchIdx = prevMessages.slice(local).findIndex((live) => sameMessage(live, persisted));
    if (matchIdx !== -1) {
      // 消费对上之前的未匹配本地行（在途乐观行等，保持原样、无 id）。
      for (let k = local; k < local + matchIdx; k++) messages.push(prevMessages[k]);
      local = local + matchIdx + 1;
    }
    entryIds.push(id);
    messages.push(persisted);
    appended += 1;
  }
  // 窗口没覆盖的剩余本地行（尚未落盘的在途行）原样保留。
  for (let k = local; k < prevMessages.length; k++) messages.push(prevMessages[k]);
  if (appended === 0) return null;
  return { entryIds, messages };
}
