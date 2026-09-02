import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed, isValidProxyUrl } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';

const MAX_SOURCES = 100;

interface RawSource {
  name?: unknown;
  url?: unknown;
  detail?: unknown;
  isAdult?: unknown;
}

/**
 * 拉取远程源订阅列表。
 * 接受两种格式：
 * 1. LibreTV-SourceList JSON：{ name?, sources: [{name,url,detail?,isAdult?}] }
 * 2. 裸数组：[{name,url,...}, ...]
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const requestUrl = new URL(req.url);
  const target = (requestUrl.searchParams.get('url') || '').trim();
  if (!/^https?:\/\//.test(target)) {
    return NextResponse.json({ error: '无效的订阅地址' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(target);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 });
  }

  try {
    const res = await fetchUpstream(target, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return NextResponse.json({ error: `订阅地址返回 HTTP ${res.status}` }, { status: 502 });
    }
    const json = (await res.json()) as { name?: unknown; sources?: unknown } | RawSource[];

    const rawList = Array.isArray(json)
      ? json
      : Array.isArray((json as { sources?: unknown }).sources)
        ? ((json as { sources: RawSource[] }).sources)
        : null;
    if (!rawList) {
      return NextResponse.json({ error: '订阅内容格式不正确（缺少 sources 数组）' }, { status: 400 });
    }

    const name = Array.isArray(json) ? undefined : (typeof (json as { name?: unknown }).name === 'string' ? (json as { name: string }).name : undefined);

    const seenUrls = new Set<string>();
    const sources = rawList.slice(0, MAX_SOURCES).flatMap((s) => {
      const url = typeof s?.url === 'string' ? s.url.trim().replace(/\/+$/, '') : '';
      // 拒绝非公网 http(s) 地址（DNS 层校验在搜索/详情请求时另有兜底）
      if (!isValidProxyUrl(url) || seenUrls.has(url)) return [];
      seenUrls.add(url);
      return [{
        name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : new URL(url).hostname,
        url,
        detail: typeof s?.detail === 'string' && s.detail.trim() ? s.detail.trim() : undefined,
        isAdult: s?.isAdult === true,
      }];
    });

    return NextResponse.json({ name, sources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '订阅拉取失败' },
      { status: 502 }
    );
  }
}
