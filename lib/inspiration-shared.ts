/**
 * 灵感的客户端/服务端共享形态：常量与类型，零 node 依赖——客户端组件
 * 直接 import 这里，不碰落盘实现（lib/inspirations.ts）。
 */

/** 与 composer 附件同一上限：灵感就是要回到输入框的，超限的存了也发不出。 */
export const MAX_INSPIRATION_FILE_BYTES = 10 * 1024 * 1024;
/** 灵感文本上限：超过它是把整份文档当灵感存（粘贴有 /api/paste 负责）。 */
export const MAX_INSPIRATION_TEXT_CHARS = 64 * 1024;

/** 灵感附件在统一上传仓库里的固定子域；attach 时服务端按它校验 path。 */
export const INSPIRATION_UPLOAD_PREFIX = "~/.pi-web/upload/inspiration/";

/**
 * 附件引用：文件本体在统一上传仓库（`~/.pi-web/upload/inspiration/<日期>/<原名>`，
 * 上传接口写入），条目只记录引用。name 是原文件名（展示与「实现」引用所用），
 * path 是 `~` 形态的仓库路径（缩略图/下载走 /api/files?type=read，「实现」直接 @ 它）。
 */
export interface InspirationFileRef {
  name: string;
  mime: string;
  path: string;
}

export interface Inspiration {
  id: string;
  text: string;
  files: InspirationFileRef[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  deletedAt: string | null;
}
