# 部署指南

LibreTV 通过同一套前端 + 不同的服务端适配器运行在各种平台。所有平台都**必须设置 `PASSWORD`**。

## 平台与服务端适配器对照

| 平台 | 服务端入口 | 前端 `/proxy` 路由指向 | 代理鉴权 |
|---|---|---|---|
| Node（裸机 / Render） | `server.mjs` | `/proxy/*` | 推荐 `PROXY_SECRET` 短时效 token |
| Docker | `server.mjs`（容器内） | `/proxy/*` | 同上 |
| Vercel | `api/proxy/[...path].mjs` + `vercel.json` rewrite | `/proxy/*` | 静态哈希 |
| Netlify | `netlify/functions/proxy.mjs` + Edge `inject-env` | `/.netlify/functions/proxy/*` | 静态哈希 |
| Cloudflare Pages | `functions/proxy/[[path]].js` | `/proxy/*` | 静态哈希（见下方注意事项） |

> `vercel.json` 已配置 `/proxy/:path*` → `/api/proxy/:path*` 的 rewrite，因此前端 `PROXY_URL` 统一为 `/proxy/`，无需按平台改动前端。

---

## 1. Node / 本地开发

```bash
npm install
PASSWORD=your_password node server.mjs
# 开发热重载：
npm run dev
```

- 默认端口 `8080`，可用 `PORT` 修改。
- 推荐同时设置 `PROXY_SECRET`（任意随机长字符串）以启用更安全的 token 鉴权。

## 2. Docker

```bash
docker run -d \
  --name libretv \
  --restart unless-stopped \
  -p 8899:8080 \
  -e PASSWORD=your_password \
  -e PROXY_SECRET=你的随机长字符串 \
  bestzwei/libretv:latest
```

镜像内置 `HEALTHCHECK`，监听 `8080`。`docker-compose.yml` 已提供，运行：

```bash
PASSWORD=your_password docker compose up -d
```

## 3. Render

`render.yaml` 已配置 `buildCommand: npm install` 与 `startCommand: node server.mjs`。在 Render 控制台导入仓库后，于 Environment 中添加 `PASSWORD`（以及可选的 `PROXY_SECRET`），直接 Deploy 即可。

## 4. Vercel

1. 导入仓库，使用默认设置（`vercel.json` 已处理 rewrite）。
2. 在 **Settings → Environment Variables** 添加 `PASSWORD`（以及可选的 `PROXY_SECRET`）。
3. Deploy。运行时走 `api/proxy`，鉴权为静态哈希（Vercel 函数不签发 token）。

## 5. Netlify

`netlify.toml` 已配置 Functions 目录与 `inject-env` Edge Function（负责把 `{{PASSWORD}}`、`{{PROXY_TOKEN_MODE}}` 占位符替换为真实值）。部署时只需在站点 Environment Variables 设置 `PASSWORD` 即可，代理走 `/.netlify/functions/proxy/*`，鉴权为静态哈希。

## 6. Cloudflare Pages

Cloudflare Pages 使用 `functions/proxy/[[path]].js` 提供代理，并由 `functions/_middleware.js`（Pages Middleware）在返回 HTML 时注入占位符，因此直接部署即可正常工作：

- `{{PASSWORD}}` 被替换为 `sha256(PASSWORD)`（与 Node 端逻辑一致）；
- `{{PROXY_TOKEN_MODE}}` 固定为空，前端走兼容（静态哈希）鉴权，因为 CF 函数不提供 `/api/proxy-token` 签发端点。

鉴权为静态哈希（弱于 Node 的 token 模式）。如需更强安全性，建议用 Node / Docker 部署并配置 `PROXY_SECRET`。

> 已知差异：CF Pages 未配置 `/s=关键词` 的深链重写（Vercel/Netlify 有），直接访问 `/s=...` 会 404；通过站内搜索不受影响。

---

## 通用提示

- 使用纯静态服务器（如 `python -m http.server`）打开时**没有代理能力**，视频无法播放，仅适合预览静态页面。
- 修改 `PASSWORD` 等环境变量后，函数型平台需重新部署，Node 需重启进程。
- 浏览器端配置（收藏、历史、自定义源）保存在 `localStorage`，清 Cookie / 换浏览器会丢失，重要配置请在「设置」中导出备份。
