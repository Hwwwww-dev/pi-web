/**
 * 加载过的图片的自然尺寸缓存（src → naturalWidth/naturalHeight）。
 *
 * 用途：回合完成时消息会按文件重读并重挂载，重挂载后的 <img> 即使命中
 * HTTP 缓存也要等解码才知道尺寸，布局先塌陷再弹开（跳动）。渲染处把
 * 缓存里的尺寸写成 width/height 属性，浏览器即可在解码前按正确宽高比
 * 预留盒子（.markdown-body img 的 height:auto + max-width:100% 保证
 * 属性只推导比例、不锁定像素）。页面级缓存，会话切换时保留。
 */
const cache = new Map<string, { width: number; height: number }>();

export function getImageSize(src: string): { width: number; height: number } | undefined {
  return cache.get(src);
}

export function rememberImageSize(src: string, width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  cache.set(src, { width: Math.round(width), height: Math.round(height) });
}
