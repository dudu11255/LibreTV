import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { SourceConfig, SourceSearchOutcome } from '@/lib/types';

export const runtime = 'nodejs';

interface SearchBody {
  wd: string;
  sources: SourceConfig[];
  filterAdult?: boolean;
}

/**
 * 服务端聚合搜索：并行请求所有选中源，任一源失败不影响整体。
 * 旧版在浏览器里打满 N 个请求（暴露用户 IP、无法缓存、超时失控），现全部上移。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const wd = (body.wd || '').trim();
  if (!wd || wd.length > 100) {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return NextResponse.json({ error: '请至少选择一个数据源' }, { status: 400 });
  }
  const sources = body.sources.slice(0, 50);

  const outcomes: SourceSearchOutcome[] = await Promise.all(
    sources.map(async (source): Promise<SourceSearchOutcome> => {
      if (!/^https?:\/\//.test(source.url || '')) {
        return { sourceKey: source.key, ok: false, list: [], error: '无效的源地址' };
      }
      // 用户可控地址发起服务端请求，必须先过 SSRF 校验（协议白名单 + 内网/保留地址）
      const verdict = await checkUpstreamAllowed(source.url);
      if (!verdict.ok) {
        return { sourceKey: source.key, ok: false, list: [], error: verdict.reason };
      }
      const api = `${source.url.replace(/\/+$/, '')}?ac=videolist&wd=${encodeURIComponent(wd)}`;
      try {
        const res = await fetchUpstream(api, {
          timeoutMs: 8000,
          headers: cmsRequestHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = parseSearchList(data, source);
        return { sourceKey: source.key, ok: true, list };
      } catch (err) {
        return {
          sourceKey: source.key,
          ok: false,
          list: [],
          error: err instanceof Error ? err.message : '请求失败',
        };
      }
    })
  );

  // 合并 + 跨源去重（同源同 vodId 视为重复）
  const seen = new Set<string>();
  let list = outcomes.flatMap((o) => o.list).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  list = filterAdultResults(list, body.filterAdult !== false);

  // 按名称排序（与旧版一致），名称相同按源名
  list.sort((a, b) => {
    const nameCompare = (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    return (a.sourceName || '').localeCompare(b.sourceName || '', 'zh-Hans-CN');
  });

  const failures = outcomes
    .filter((o) => !o.ok)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败' }));

  return NextResponse.json({ list, failures });
}
