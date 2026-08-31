# 代理鉴权与安全

LibreTV 的视频直链通过服务端代理转发，以解决跨域与 HLS 直链播放问题。代理接口是系统的安全边界，以下说明其鉴权机制与防护。

## 两种鉴权模式

### 1. 安全模式：`PROXY_SECRET` 短时效 token（推荐）

当服务端设置了 `PROXY_SECRET`：

1. 用户在前端输入密码校验通过后，前端调用 `GET /api/proxy-token?password=...`；
2. 服务端校验密码，签发一个**带时间戳**的 HMAC token（`t` 为毫秒时间戳，`token = HMAC(secret, t + path + query)`）；
3. 后续代理请求 `GET /proxy/<encodedUrl>?token=...&t=...` 需携带该 token；
4. 服务端校验签名与时间窗口（默认 60 秒），过期或签名不符返回 `401`；
5. **前端持有的静态哈希不再被接受**（修复了旧版可被伪造的鉴权）。

前端通过 `window.__ENV__.PROXY_TOKEN_MODE === "1"` 自动切换该模式，无需手动配置。

### 2. 兼容模式：静态哈希（函数型部署）

未设置 `PROXY_SECRET` 时回退：代理请求携带 `auth=sha256(password)`。该哈希暴露在前端页面中，**可被提取后伪造请求**，安全性较弱。仅建议用于无 Node 进程的函数型环境，并尽量通过 `PROXY_SECRET` 升级。

## SSRF 防护

代理在发起上游请求前会校验目标 URL，拦截：

- 协议非 `http`/`https`；
- 主机名命中 `BLOCKED_HOSTS`（默认 `localhost,127.0.0.1,0.0.0.0,::1`）；
- IP 命中私有网段前缀 `BLOCKED_IP_PREFIXES`（默认 `192.168.,10.,172.`）；
- 字面量 IP 经 `isPrivateIP` 判定为内网 / 环回 / 链路本地（含云元数据 `169.254.169.254`、`100.100.100.100` 等）；
- DNS 解析后的地址若落入私有段，同样被拦截（`isBlockedByDNS`）。

返回码：非法 URL为 `400`，命中拦截为 `400/403`。

## 响应头过滤

代理会从上游响应中剥离敏感头（默认 `content-security-policy`、`cookie`、`set-cookie`、`x-frame-options`、`access-control-allow-origin` 等），避免将上游的 Cookie / CSP 泄漏到浏览器，降低会话劫持与 XSS 风险。可用 `FILTERED_HEADERS` 覆盖。

## 源码保护

Node 服务端对 `.js`/`.mjs`/`.json` 等源码路径（如 `/server.mjs`、`/api/*`）做了静态白名单保护，未命中白名单的源码请求返回 `404`，防止源码泄露。

## 安全建议

- ✅ 所有部署**必须**设置强 `PASSWORD`。
- ✅ 能运行 Node 的环境**务必**设置 `PROXY_SECRET`（随机 32 字节以上）。
- ✅ 不要将实例公开分享；私有网段与云元数据已被默认拦截，但仍应避免暴露到公网。
- ⚠️ 函数型部署（Vercel / Netlify / CF）默认走静态哈希，安全性弱于 token 模式。
