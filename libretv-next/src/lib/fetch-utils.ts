/** 服务端上游请求工具：超时、重试、JSON 解析 */

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

export async function fetchUpstream(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 8000, retries = 0, ...init } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: init.redirect ?? 'follow',
      });
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
