import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { isBlockedByDNS, isValidProxyUrl } from '@/lib/ssrf';
import { rewriteM3u8 } from '@/lib/m3u8';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';

const TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT || '8000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 未鉴权的图片等资源也允许走代理（豆瓣防盗链需要 Referer 伪装）；
// 但为防止被当作开放代理滥用，仅放行图片类目标，其余必须已登录。
function looksLikeImageUrl(target: string): boolean {
  if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(target)) return true;
  const host = (() => {
    try { return new URL(target).hostname; } catch { return ''; }
  })();
  return host.endsWith('doubanio.com') || host.endsWith('douban.com');
}

/**
 * 通用流式代理：
 * - 已登录会话（httpOnly cookie）→ m3u8 重写后的分片同源请求自动携带，不再有旧版丢鉴权参数的问题；
 * - 未登录仅放行图片目标（豆瓣封面等），且同样受 SSRF 防护约束；
 * - m3u8 文本重写为代理路径，分片/key/map 全部经本站转发，规避上游 CORS。
 */
export async function GET(req: Request, ctx: { params: Promise<{ url: string }> }) {
  const { url: encodedUrl } = await ctx.params;
  const targetUrl = (() => {
    try { return decodeURIComponent(encodedUrl); } catch { return encodedUrl; }
  })();

  const guarded = guardRequest(req);
  if (guarded && !looksLikeImageUrl(targetUrl)) return guarded;

  if (!isValidProxyUrl(targetUrl)) {
    return new NextResponse('无效的 URL', { status: 400 });
  }
  if (await isBlockedByDNS(targetUrl)) {
    return new NextResponse('不允许访问私有/保留网络地址', { status: 403 });
  }

  const headers: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' };
  try {
    if (new URL(targetUrl).hostname.endsWith('doubanio.com')) {
      headers.Referer = 'https://movie.douban.com/';
    }
  } catch { /* 忽略非法 URL */ }

  const range = req.headers.get('range');
  if (range) headers.Range = range;

  let response: Response;
  try {
    response = await fetchUpstream(targetUrl, {
      timeoutMs: TIMEOUT_MS,
      retries: MAX_RETRIES,
      headers,
      redirect: 'follow',
    });
  } catch (err) {
    return new NextResponse(
      `代理请求失败: ${err instanceof Error ? err.message : '未知错误'}`,
      { status: 502 }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const isM3u8 =
    contentType.includes('mpegurl') || contentType.includes('x-mpegurl') ||
    targetUrl.toLowerCase().endsWith('.m3u8');

  // m3u8 文本：重写为代理路径
  if (isM3u8) {
    const text = await response.text();
    return new NextResponse(rewriteM3u8(text, targetUrl), {
      status: response.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 其余（图片 / JSON / 分片 / key）流式透传
  const outHeaders = new Headers();
  for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const v = response.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  // fetch 会自动解压，转发时必须去掉长度相关头避免浏览器二次解压
  outHeaders.set('Cache-Control', 'public, max-age=3600');
  outHeaders.set('Access-Control-Allow-Origin', '*');

  return new NextResponse(response.body, {
    status: response.status,
    headers: outHeaders,
  });
}
