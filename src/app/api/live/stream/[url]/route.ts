import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkUpstreamAllowed, type UpstreamVerdict } from '@/lib/ssrf';
import { rewriteM3u8 } from '@/lib/m3u8';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 直播流专用长连接代理（不复用 /api/proxy）：
 *
 * /api/proxy 的 AbortSignal.timeout(TIMEOUT_MS) 作用于整个响应流，
 * 8 秒后即切断长连接——对 HTTP-FLV（单一无限长连接）是致命的。
 * 本路由改为「仅对响应头等待设超时」：fetch 拿到响应头后立即清除计时器，
 * 之后 body 无限时长流式透传，直到客户端断开。
 *
 * - 不重试（重试对直播无意义）；
 * - m3u8 manifest 仍需重写（变体/分片地址改指本路由），FLV 等纯透传；
 * - 每一跳都强制 SSRF 校验（不信任解析阶段的校验结果）；
 * - 部署者可设 LIVE_ALLOW_PRIVATE=1 显式放行内网自建源（默认拒绝）。
 */

const HEADER_TIMEOUT_MS = 15_000;
const LIVE_PREFIX = '/api/live/stream/';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 5;
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function allowPrivate(): boolean {
  return process.env.LIVE_ALLOW_PRIVATE === '1';
}

/** 直播流地址校验：协议必须 http(s)；内网放行仅限显式开启 LIVE_ALLOW_PRIVATE */
async function checkStreamAllowed(urlString: string): Promise<UpstreamVerdict> {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: '直播流仅支持 http/https 协议' };
    }
  } catch {
    return { ok: false, reason: '无效的直播流地址' };
  }
  if (allowPrivate()) return { ok: true };
  return checkUpstreamAllowed(urlString);
}

/**
 * 带响应头超时的上游抓取：仅首字节（响应头）限时，超时 abort；
 * 响应头到达后清除计时器，body 流不再受限。手动逐跳跟随重定向，
 * 每一跳重新执行 SSRF 校验（302 跳内网是经典绕过手法）。
 */
async function fetchLiveUpstream(
  targetUrl: string,
  headers: Record<string, string>,
  controller: AbortController
): Promise<Response> {
  let current = targetUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const verdict = await checkStreamAllowed(current);
    if (!verdict.ok) throw new Error(`跳转目标被拒绝: ${verdict.reason}`);

    const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    current = new URL(location, current).href;
  }
  throw new Error('重定向次数过多');
}

export async function GET(req: Request, ctx: { params: Promise<{ url: string }> }) {
  const { url: encodedUrl } = await ctx.params;
  const targetUrl = (() => {
    try { return decodeURIComponent(encodedUrl); } catch { return encodedUrl; }
  })();

  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const verdict = await checkStreamAllowed(targetUrl);
  if (!verdict.ok) return jsonError(verdict.reason, 403);

  const controller = new AbortController();
  // 客户端断开（切台/关页）时终止上游连接，防止连接泄漏
  const onClientAbort = () => controller.abort();
  req.signal.addEventListener('abort', onClientAbort, { once: true });

  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' };

  let response: Response;
  try {
    response = await fetchLiveUpstream(targetUrl, headers, controller);
  } catch (err) {
    return jsonError(
      `直播流连接失败: ${err instanceof Error ? err.message : '未知错误'}`,
      502
    );
  }

  if (!response.ok && response.body) {
    // 非直播正常响应（403/404 等）：丢弃 body 连接
    try { await response.body.cancel(); } catch { /* 忽略 */ }
    return jsonError(`直播流上游返回 ${response.status}`, 502);
  }

  const contentType = response.headers.get('content-type') || '';
  const isM3u8 =
    contentType.includes('mpegurl') || contentType.includes('x-mpegurl') ||
    targetUrl.toLowerCase().split('?')[0].endsWith('.m3u8');

  // HLS manifest：重写变体/分片地址指向本路由，保证后续请求同源同鉴权
  if (isM3u8) {
    const text = await response.text();
    return new NextResponse(rewriteM3u8(text, targetUrl, 0, LIVE_PREFIX), {
      status: response.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      },
    });
  }

  // FLV / TS 等流媒体：纯流式透传（禁止缓冲与缓存）
  const outHeaders = new Headers();
  const ct = contentType || 'video/mp2t';
  outHeaders.set('Content-Type', ct);
  outHeaders.set('Cache-Control', 'no-store, no-transform');
  outHeaders.set('X-Accel-Buffering', 'no');

  return new NextResponse(response.body, {
    status: response.status,
    headers: outHeaders,
  });
}
