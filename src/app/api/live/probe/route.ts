import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 直播频道批量测活。
 * POST /api/live/probe  body: { urls: string[] }
 *
 * 以带 Range 的 GET 轻量探测（部分源不支持 HEAD 且会忽略 Range），
 * 收到响应头即 cancel body 终止连接，不下载任何媒体数据；
 * 返回 2xx 视为可用（206 同样算通）。单次最多 50 条，服务端并发 8。
 * 结果为 best-effort：200 响应不保证编码可解码（H.265 等），仅代表网络可达。
 */

const MAX_URLS = 50;
const CONCURRENCY = 8;
const TIMEOUT_MS = 5000;
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

interface ProbeOutcome {
  url: string;
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
}

async function probeOne(url: string): Promise<ProbeOutcome> {
  const start = performance.now();
  const verdict = await checkUpstreamAllowed(url);
  if (!verdict.ok) return { url, ok: false, error: verdict.reason };
  try {
    const res = await fetchUpstream(url, {
      timeoutMs: TIMEOUT_MS,
      retries: 0,
      headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-1' },
    });
    const ms = Math.round(performance.now() - start);
    // 拿到响应头即断开，避免直播流持续下载
    if (res.body) {
      try { await res.body.cancel(); } catch { /* 忽略 */ }
    }
    return { url, ok: res.ok, status: res.status, ms };
  } catch (err) {
    return {
      url,
      ok: false,
      ms: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : '探测失败',
    };
  }
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: { urls?: unknown };
  try {
    body = (await req.json()) as { urls?: unknown };
  } catch {
    return jsonError('无效请求体', 400);
  }
  if (!Array.isArray(body.urls)) return jsonError('urls 必须为字符串数组', 400);

  const urls = [...new Set(
    body.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
  )].slice(0, MAX_URLS);
  if (urls.length === 0) return NextResponse.json({ results: [] });

  // 简单并发池：固定 worker 数从游标取任务
  const outcomes = new Map<string, ProbeOutcome>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      outcomes.set(url, await probeOne(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  return NextResponse.json(
    { results: urls.map((u) => outcomes.get(u)!) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
