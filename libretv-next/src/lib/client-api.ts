'use client';

import type { SearchResponse, VideoDetail, DoubanResponse, AuthStatusResponse, SourceConfig, SearchResultItem } from './types';

/**
 * 客户端 API 封装。401 时触发全局事件打开登录框，
 * 替代旧版在每个函数里手工检查 isPasswordVerified 的散弹式写法。
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UNAUTHORIZED_EVENT = 'libretv:unauthorized';

export function onUnauthorized(handler: (event: CustomEvent) => void): () => void {
  const wrapped = (e: Event) => handler(e as CustomEvent);
  window.addEventListener(UNAUTHORIZED_EVENT, wrapped);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, wrapped);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('网络请求失败，请检查网络连接', 0);
  }
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError('需要登录', 401);
  }
  if (res.status === 503) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: 'setup' }));
    throw new ApiError('服务器未配置密码', 503);
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch { /* 忽略解析失败 */ }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<AuthStatusResponse>('/api/status'),

  login: (password: string) =>
    request<{ success: boolean }>('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ success: boolean }>('/api/auth', { method: 'DELETE' }),

  search: (wd: string, sources: SourceConfig[], filterAdult: boolean, signal?: AbortSignal) =>
    request<SearchResponse>('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd, sources, filterAdult }),
      signal,
    }),

  detail: (id: string, source: SourceConfig, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ id, source: JSON.stringify(source) });
    return request<VideoDetail>(`/api/detail?${sp.toString()}`, { signal });
  },

  douban: (type: 'movie' | 'tv', tag: string, pageStart: number, pageSize: number, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ type, tag, pageStart: String(pageStart), pageSize: String(pageSize) });
    return request<DoubanResponse>(`/api/douban?${sp.toString()}`, { signal });
  },

  /** 换源：按标题跨源搜索并取详情，附带接口耗时（测速） */
  detailSpeed: async (id: string, source: SourceConfig) => {
    const start = performance.now();
    try {
      const detail = await api.detail(id, source);
      return { ok: true, ms: Math.round(performance.now() - start), detail };
    } catch (err) {
      return { ok: false, ms: Math.round(performance.now() - start), detail: undefined as VideoDetail | undefined, error: err instanceof Error ? err.message : '失败' };
    }
  },
};

export interface SearchFailure {
  sourceKey: string;
  error: string;
}

export type { SearchResponse, SearchResultItem };
