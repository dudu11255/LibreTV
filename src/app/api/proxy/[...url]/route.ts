import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { isBlockedByDNS, isValidProxyUrl } from '@/lib/ssrf';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import { rewriteM3u8 } from '@/lib/m3u8';

export const runtime = 'nodejs';

const TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT || '8000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * 精确域名匹配：仅 `douban.com` 本身及其子域放行。
 * 不能用 endsWith('douban.com')——那样 `evil-douban.com` 也会命中，形成鉴权绕过。
 */
function isDoubanHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'douban.com' || h.endsWith('.douban.com') ||
    h === 'doubanio.com' || h.endsWith('.doubanio.com')
  );
}

/**
 * 未登录即可代理的图片域白名单（精确后缀匹配，防 `evil-bgm.tv` 类绕过）：
 * 豆瓣封面需要 Referer 伪装；热榜 cover_proxy 镜像与 Bangumi 封面
 * 均为公开图片 CDN，无 Referer 校验，仅需防开放代理滥用。
 */
function isAnonymousImageHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    isDoubanHost(h) ||
    h === 'doubanio.viki.moe' || h.endsWith('.doubanio.viki.moe') ||
    h === 'bgm.tv' || h.endsWith('.bgm.tv')
  );
}

// 未鉴权的图片等资源也允许走代理（豆瓣防盗链需要 Referer 伪装）；
// 但为防止被当作开放代理滥用，仅放行上述公开图片域，其余必须已登录。
function looksLikeImageUrl(target: string): boolean {
  const host = (() => {
    try { return new URL(target).hostname; } catch { return ''; }
  })();
  return isAnonymousImageHost(host);
}

/**
 * 从动态段还原目标 URL。
 *
 * 客户端统一生成 `/api/proxy/<encodeURIComponent(target)>`，但不同网关的
 * 转发行为不同：
 * - 标准网关（Vercel / 自托管 Node）：`%2F` 原样保留，catch-all 只捕获
 *   一段仍带编码的完整 URL；
 * - EdgeOne 等边缘网关：转发前把路径中的 `%2F`（可能还有 `%3A`/`%3F`）解码，
 *   路径变成多段（`/api/proxy/https:/host/a/b`），单段动态路由会 404。
 *
 * 因此先按段拼接、修补被解码破坏的 scheme 双斜杠，再做一次宽容解码
 * （对已是明文的字符串 decodeURIComponent 无副作用）。
 */
function resolveTargetUrl(url: string[] | string): string {
  const parts = Array.isArray(url) ? url : [url];
  let joined = parts.join('/');
  // 网关解码 %3A 后 scheme 可能被折叠成 "https:/host"，补回双斜杠；
  // 仍是编码形态（"https%3A//..."）时该正则不命中，交给下方 decode。
  joined = joined.replace(/^(https?):\/(?!\/)/i, '$1://');
  let target = joined;
  try {
    target = decodeURIComponent(joined);
  } catch {
    // 含孤立 % 等非法序列时按原样使用
  }
  return target;
}

/**
 * 通用流式代理：
 * - 已登录会话（httpOnly cookie）→ m3u8 重写后的分片同源请求自动携带，不再有旧版丢鉴权参数的问题；
 * - 未登录仅放行图片目标（豆瓣封面等），且同样受 SSRF 防护约束；
 * - m3u8 文本重写为代理路径，分片/key/map 全部经本站转发，规避上游 CORS。
 */
export async function GET(req: Request, ctx: { params: Promise<{ url: string[] }> }) {
  let targetUrl = resolveTargetUrl((await ctx.params).url);

  // 网关若把目标 URL 里的 %3F 解码成「?」，其查询串会脱离路径落进本次请求的
  // query；目标本身不含「?」时把它们补回（客户端自加的 cache-bust 等参数
  // 混入对上游无副作用）。目标已含「?」说明网关未解码 %3F，不动。
  if (!targetUrl.includes('?')) {
    try {
      const search = new URL(req.url).search;
      if (search) targetUrl += search;
    } catch { /* 忽略非法 req.url */ }
  }

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
    if (isDoubanHost(new URL(targetUrl).hostname)) {
      headers.Referer = 'https://movie.douban.com/';
    }
  } catch { /* 忽略非法 URL */ }

  const range = req.headers.get('range');
  if (range) headers.Range = range;

  let response: Response | undefined;
  let finalUrl = targetUrl;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchWithSafeRedirects(targetUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      response = result.res;
      finalUrl = result.finalUrl;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!response) {
    return new NextResponse(
      `代理请求失败: ${lastError instanceof Error ? lastError.message : '未知错误'}`,
      { status: 502 }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const isM3u8 =
    contentType.includes('mpegurl') || contentType.includes('x-mpegurl') ||
    targetUrl.toLowerCase().endsWith('.m3u8');

  // m3u8 文本：重写为代理路径（以重定向后的最终 URL 为 base 解析相对地址）
  if (isM3u8) {
    const text = await response.text();
    return new NextResponse(rewriteM3u8(text, finalUrl), {
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
