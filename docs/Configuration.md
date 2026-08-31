# 配置参考

LibreTV 全部通过**环境变量**配置，无需改动源码。不同部署形态读取的变量略有差异。

## Node / Docker / Render（`server.mjs`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PASSWORD` | 空（**必填**） | 访问密码；未设置时页面强制提示 |
| `PROXY_SECRET` | 空 | 设置后启用服务端签发的短时效 token 鉴权（推荐）；留空回退静态哈希 |
| `PORT` | `8080` | 监听端口 |
| `CORS_ORIGIN` | `*` | 允许的跨域来源 |
| `REQUEST_TIMEOUT` | `5000` | 代理请求超时（毫秒） |
| `MAX_RETRIES` | `2` | 代理失败重试次数 |
| `CACHE_MAX_AGE` | `1d` | 代理响应缓存时长（HTTP `Cache-Control`） |
| `USER_AGENT` | 内置 Chrome UA | 代理请求携带的 UA |
| `DEBUG` | `false` | 设为 `true` 开启详细日志 |
| `BLOCKED_HOSTS` | `localhost,127.0.0.1,0.0.0.0,::1` | SSRF：被拦截的主机名（逗号分隔） |
| `BLOCKED_IP_PREFIXES` | `192.168.,10.,172.` | SSRF：被拦截的 IP 网段前缀 |
| `FILTERED_HEADERS` | `content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin,...` | 从上游响应中剥离的敏感头（逗号分隔） |

## 服务端函数（Vercel / Netlify / Cloudflare）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PASSWORD` | 空（**必填**） | 访问密码 |
| `PROXY_SECRET` | 由 `PASSWORD` 派生 | 函数环境通常无 token 签发，鉴权为静态哈希；可显式设置用于统一密钥 |
| `DEBUG` | `false` | 调试日志 |
| `CACHE_TTL` | `86400` | 代理缓存秒数 |
| `MAX_RECURSION` | `5` | m3u8 递归改写最大层数（防环） |
| `USER_AGENTS_JSON` | 空 | 可选：自定义 UA 池（JSON 数组字符串），用于随机化请求 UA |
| `BLOCKED_HOSTS` | `localhost,127.0.0.1,0.0.0.0,::1` | SSRF 拦截主机名 |
| `BLOCKED_IP_PREFIXES` | `192.168.,10.,172.` | SSRF 拦截网段 |
| `FILTERED_HEADERS` | 内置列表 | 剥离的敏感响应头 |

> 函数型部署（无 Node 进程）**不提供 `/api/proxy-token`**，前端走静态哈希鉴权（`PROXY_TOKEN_MODE` 由注入决定，函数环境通常为空）。

## 前端注入变量（由服务端替换）

`index.html` 含两个占位符，由 Node（`server.mjs`）或 Netlify Edge Function 在响应时替换：

- `{{PASSWORD}}`：页面是否已有密码（空字符串表示未配置，前端会提示设置）。
- `{{PROXY_TOKEN_MODE}}`：`"1"` 表示启用 token 模式（已配置 `PROXY_SECRET`），否则为空。

## 示例

```bash
# Node 安全模式
PASSWORD=strongpass PROXY_SECRET=$(openssl rand -hex 32) \
REQUEST_TIMEOUT=8000 MAX_RETRIES=3 DEBUG=true \
node server.mjs
```
