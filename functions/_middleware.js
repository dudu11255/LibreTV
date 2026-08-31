import { sha256 } from '../js/sha256.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();

    // 注入访问密码哈希（sha256），与 server.mjs 行为一致
    const password = env.PASSWORD || "";
    const passwordHash = password ? await sha256(password) : "";
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
      `window.__ENV__.PASSWORD = "${passwordHash}";`);

    // 注入代理鉴权模式：Cloudflare Pages 函数不提供 /api/proxy-token 签发端点，
    // 固定为兼容（静态哈希）模式；前端据此回退到 auth=sha256(password)
    html = html.replace('window.__ENV__.PROXY_TOKEN_MODE = "{{PROXY_TOKEN_MODE}}";',
      `window.__ENV__.PROXY_TOKEN_MODE = "";`);

    // 复制响应头，并移除会因内容变化而过期的 content-length
    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(html, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}