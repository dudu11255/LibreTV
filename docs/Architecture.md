# 架构说明

LibreTV 采用「**配置驱动的空壳前端 + 服务端代理**」架构。仓库本身不含任何视频数据，所有内容来自用户自行添加的数据源。

## 目录结构（关键部分）

```
.
├── index.html / player.html / watch.html   # 前端页面（含 {{PASSWORD}} / {{PROXY_TOKEN_MODE}} 占位符）
├── js/                                      # 前端逻辑（app / config / player / ui / douban / proxy-auth ...）
├── css/                                     # 样式
├── server.mjs                               # Node 服务端：静态托管 + /proxy + /api/proxy-token + 占位符注入
├── api/proxy/[...path].mjs                  # Vercel Functions 代理
├── netlify/functions/proxy.mjs             # Netlify Functions 代理
├── netlify/functions/inject-env.(js|mjs)   # Netlify Edge Function：注入占位符
├── functions/proxy/[[path]].js             # Cloudflare Pages Functions 代理
├── vercel.json / netlify.toml / render.yaml / Dockerfile / docker-compose.yml
└── docs/                                    # 本文档（Wiki）
```

## 数据流

```
用户输入关键词
   │
   ▼
前端 app.js ──(同源 /api 或直连 CMS)──► 采集站 API (用户配置的源)
   │   搜索结果合并 / 去重
   ▼
详情页 (douban 匹配封面/简介)
   │
   ▼
点击播放 → player.js 生成 /proxy/<encodedUrl>
   │
   ▼
服务端代理 server.mjs / Functions
   ├─ 鉴权 (token 或静态哈希)
   ├─ SSRF 校验 (拦截内网/元数据)
   ├─ 抓取上游 (带 UA、重试、超时)
   ├─ 若 m3u8：递归改写分片地址为 /proxy/...
   ├─ 过滤敏感响应头
   └─ 返回给浏览器 (HLS.js / DPlayer 播放)
```

## 鉴权边界

- **Node 模式**：`server.mjs` 在返回 `index.html` 时注入 `PROXY_TOKEN_MODE`；密码校验后由 `/api/proxy-token` 签发短时效 token。
- **函数模式**：由平台 Edge Function（Netlify）或静态占位符注入；鉴权为静态哈希（无 token 签发）。

## 设计要点

1. **无内置源**：`config.js` 默认不含任何数据源数组，避免维护负担与合规风险。
2. **代理集中**：跨域与 HLS 改写只在服务端，前端保持轻量、可静态托管。
3. **安全边界**：代理是唯一对外请求入口，承载鉴权、SSRF、头过滤、源码保护。
4. **可移植**：同一前端适配 Node / Vercel / Netlify / Cloudflare / Docker，差异仅在服务端适配器。
