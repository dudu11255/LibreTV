/**
 * 懒加载 chunk 拉取失败的识别与「一次性自愈」。
 *
 * 典型场景：站点重新部署后，仍开着旧页面的浏览器会拿着**旧构建**的 chunk 文件名去请求
 * （`_next/static/chunks/*` 的文件名里含 contenthash，每次构建都变），而服务端只剩新产物，
 * 于是 404 → ChunkLoadError。此时错误边界的 reset() 重试必然还是失败 —— 只有整页刷新，
 * 让浏览器重新取到新的 HTML/RSC 与 webpack runtime 才能恢复。
 *
 * 但「产物本身缺失」（构建有问题）不能无限刷新，否则用户会看到页面疯狂自刷。
 * 因此这里加了冷却窗口：10 秒内只允许自动刷新一次，超出就交给错误边界展示提示。
 */

const RELOAD_AT_KEY = 'libretv:chunk-reload-at';
const COOLDOWN_MS = 10_000;

/** 是否是「chunk 拉取失败」类错误（含动态 import 失败、模块脚本加载失败） */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  if (err.name === 'ChunkLoadError') return true;
  const msg = typeof err.message === 'string' ? err.message : String(error);
  return (
    /Loading (CSS )?chunk \S+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

/**
 * 触发一次整页刷新以重取 chunk；冷却窗口内重复调用返回 false（不刷新）。
 * sessionStorage 不可用时（部分电视端内核/隐私模式）也返回 false —— 宁可展示错误页，
 * 也不要因为存不下时间戳而陷入刷新死循环。
 */
export function reloadOnceForChunkError(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_AT_KEY) || 0);
    if (Date.now() - last < COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
