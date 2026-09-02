# 代理与安全

本项目的服务端承担三类安全职责：**访问鉴权**、**代理防护（SSRF）**、**上游伪装（防盗链）**。

## 鉴权模型

### 会话

- 登录：`POST /api/auth`，body 携带明文密码（**不走 URL**，避免进访问日志）；
- 服务端用 SHA-256 摘要做**恒定时间比较**（`crypto.timingSafeEqual`），不暴露时序信息；
- 通过后签发会话 Cookie：`ltv_session = <过期时间戳>.<HMAC-SHA256(密钥, 时间戳)>`；
  - `httpOnly`（JS 不可读）、`SameSite=Lax`、生产环境 `Secure`、有效期 90 天；
  - 密钥 = `PROXY_SECRET`，未设置时从 `PASSWORD` 派生；
- 所有 `/api/*`（除 status/登录外）通过 `guardRequest` 校验会话，未登录返回 401，客户端全局弹出登录框。

### 速率限制

登录接口按 IP 限流：**10 次 / 10 分钟**，超限返回 429。内存实现，适合单实例部署。

### 与旧版的安全差异

| 问题 | 旧版 | 本版 |
| --- | --- | --- |
| 密码哈希下发 | 页面源码含 `sha256(PASSWORD)` | 服务端独享，前端零凭证 |
| 哈希即凭证 | `?auth=<哈希>` 可无限重放代理请求 | 已移除该兼容模式 |
| 明文密码上 URL | `GET /api/proxy-token?password=...` | `POST /api/auth` body |
| 登录限流 | 无 | 10 次 / 10 分钟 |
| token 轮换 | 10 分钟短时效 token（需手工附参） | 会话 Cookie，m3u8 分片同源自动携带 |

## 代理（`GET /api/proxy/<encoded-url>`）

### 访问规则

- **已登录**：可代理任意符合 SSRF 校验的目标（视频分片、key、JSON、图片）；
- **未登录**：仅放行图片类目标（`.jpg/.png/...` 或 `doubanio.com` 域），用于登录页前的封面展示；其余一律 401。

### SSRF 防护（双层）

1. **字面量校验**（请求前）：协议白名单 http/https；主机名黑名单（localhost 等）；IPv4/IPv6 字面量直接比对私有段；
2. **DNS 解析校验**（请求前）：域名解析出的所有地址逐一检查，拦截解析到内网的域名（防 DNS rebinding 基础形态）。

被拦截的地址段：回环（127.0.0.0/8, ::1）、私有（10/8, 172.16/12, 192.168/16）、链路本地（169.254/16，含云元数据 169.254.169.254）、CGNAT（100.64/10）、协议保留（192.0.0.0/24）、唯一本地（fc00::/7）、链路本地 v6（fe80::/10）。

### 行为

- **流式透传**：视频分片 / 图片 / key 不落盘，直接 pipe；
- **m3u8 重写**：manifest/level 文本中的分片、`#EXT-X-KEY`、`#EXT-X-MAP` 地址全部改写为 `/api/proxy/<encoded>`（递归深度 ≤5），嵌套播放列表同样经代理，规避上游 CORS 限制；
- **响应头净化**：剔除 CSP/Cookie/Set-Cookie/X-Frame-Options/CORS 头与 Content-Encoding/Length（fetch 已解压，防止二次解压乱码）；
- **Range 透传**：保留 `Range`/`Content-Range`，支持拖动；
- **重试**：上游失败按 `MAX_RETRIES` 重试。

### 上游伪装

- 目标为 `doubanio.com` 时自动携带 `Referer: https://movie.douban.com/`，绕过豆瓣图片 418 防盗链；
- 统一携带 Chrome UA。

## 已知边界

- 速率限制为内存实现，多实例部署需换共享存储（Redis）；
- SSRF 的 DNS 校验存在理论上的 TOCTOU 窗口（校验后、请求前 DNS 记录变更）；对公网部署建议叠加网络层出口限制；
- 会话无法服务端主动吊销（无状态签名）；更换 `PROXY_SECRET` 或 `PASSWORD` 可使全部会话失效。
