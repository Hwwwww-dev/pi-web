/**
 * 灵感的客户端/服务端共享形态：常量与类型，零 node 依赖——客户端组件
 * 直接 import 这里，不碰落盘实现（lib/inspirations.ts）。
 */

/** 与 composer 附件同一上限：灵感就是要回到输入框的，超限的存了也发不出。 */
export const MAX_INSPIRATION_FILE_BYTES = 10 * 1024 * 1024;
/** 灵感文本上限：超过它是把整份文档当灵感存（粘贴有 /api/paste 负责）。 */
export const MAX_INSPIRATION_TEXT_CHARS = 64 * 1024;

/** 附件引用：id 定位文件；name 是落盘名（保留原名，同名加序号），即引用与下载所用之名。 */
export interface InspirationFileRef {
  id: string;
  name: string;
  mime: string;
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
