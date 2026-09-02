/** 服务端上游请求工具：超时、重试、安全跳转、JSON 解析 */

import { checkUpstreamAllowed } from './ssrf';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /**
   * 安全跳转（默认开启）：禁用 fetch 的自动跟随，改为手动逐跳跟随，
   * 每一跳重新执行 SSRF 校验——否则公网 URL 可 302 跳转到内网地址绕过预检。
   */
  safeRedirects?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 5;

export async function fetchUpstream(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 8000, retries = 0, safeRedirects = true, ...init } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!safeRedirects) {
        return await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: init.redirect ?? 'follow',
        });
      }
      // 手动逐跳跟随，每一跳重新过 SSRF 校验
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const verdict = await checkUpstreamAllowed(current);
        if (!verdict.ok) {
          throw new Error(`跳转目标被拒绝: ${verdict.reason}`);
        }
        const res = await fetch(current, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!REDIRECT_STATUSES.has(res.status)) return res;
        const location = res.headers.get('location');
        if (!location) return res;
        current = new URL(location, current).href;
      }
      throw new Error('重定向次数过多');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('上游请求失败');
}

export async function fetchUpstreamJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetchUpstream(url, options);
  if (!res.ok) throw new Error(`上游请求失败: ${res.status}`);
  const data = (await res.json()) as T;
  return data;
}

/** 内存 TTL 缓存（豆瓣推荐等热点数据） */
const cache = new Map<string, { value: unknown; expiresAt: number }>();

export function getCache<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCache(key: string, value: unknown, ttlMs: number): void {
  if (cache.size > 500) {
    // 简单防膨胀：超限时清掉最早过期的条目
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k);
    }
    if (cache.size > 500) cache.clear();
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
