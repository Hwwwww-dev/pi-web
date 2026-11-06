import { useEffect, type RefObject } from "react";

/**
 * 非模态浮层（页头下挂的 系统 / 工具定义 / 会话信息 / 分支 面板）的
 * 点空白关闭：pointerdown 落在容器外即触发 onClose。捕获阶段监听，
 * 页面内任何 stopPropagation 都拦不掉。
 *
 * 容器内点击不关闭；标记了 data-outside-dismiss-ignore 的元素（浮层
 * 自己的触发钮）也不关闭——否则 pointerdown 先把浮层关掉、随后的
 * click 又把它 toggle 开，触发钮就永远关不上浮层。
 */
export function useOutsideDismiss(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (containerRef.current?.contains(target)) return;
      if (target.closest("[data-outside-dismiss-ignore]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, containerRef, onClose]);
}
