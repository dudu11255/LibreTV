# LibreTV - 在线视频搜索与观看平台

<div align="center">
  <img src="image/logo.png" alt="LibreTV Logo" width="120">
  <br>
  <p><strong>自由观影，畅享精彩</strong></p>
</div>

## 📺 项目简介

LibreTV 是一个轻量级、免费、开源的在线视频搜索与观看平台。**本项目本身不内置任何视频数据源**——它只是一个"空壳"前端 + 服务端代理，需要你自行在「设置」中添加自己的采集站 / 苹果 CMS API 后才能搜索与播放。这样做的好处是：

- ✅ **完全可控**：数据来源由你自己决定，不依赖任何第三方维护的默认源；
- ✅ **合规安全**：项目不存储、不上传、不分发任何视频内容，仅作搜索与代理转发；
- ✅ **部署灵活**：同一套代码可运行在 Node、Vercel、Netlify、Cloudflare Pages、Docker 等环境。

项目结合了前端技术和服务端代理（解决跨域与 HLS 直链播放问题），可部署在支持服务端函数的各类托管服务上。

> 本项目基于 [bestK/tv](https://github.com/bestK/tv) 进行重构与增强，并移除了内置数据源，改为完全可配置。

## 🚨 重要声明

- 本项目仅供**学习和个人使用**。为避免版权纠纷，**首次启动必须设置 `PASSWORD` 环境变量**，否则页面会强制提示设置密码。
- 请勿将部署的实例用于商业用途或公开分享。
- 项目开发者不对用户的使用行为承担任何法律责任；如因公开分享导致法律问题，由使用者自行承担。

## 🚀 快速部署

> 一键部署按钮会克隆**默认仓库**。如果你 fork 了本项目（尤其是做了自定义修改），请先将按钮中的仓库地址替换为你自己的仓库地址。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLibreSpark%2FLibreTV)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/LibreSpark/LibreTV)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/LibreSpark/LibreTV)

部署完成后，记得设置环境变量 `PASSWORD`（见下方「配置」）。

## 📋 详细部署指南

不同平台使用不同的服务端适配器，但前端逻辑一致：

| 平台 | 服务端入口 | 代理路由 | 鉴权方式 |
|---|---|---|---|
| Node / Render / Docker | `server.mjs` | `/proxy/*` | 推荐 `PROXY_SECRET` 短时效 token；缺省为静态哈希 |
| Vercel | `api/proxy/[...path].mjs` | `/proxy/*`（rewrite） | 静态哈希（无 token 签发） |
| Netlify | `netlify/functions/proxy.mjs` + Edge Function `inject-env` | `/.netlify/functions/proxy/*` | 静态哈希（无 token 签发） |
| Cloudflare Pages | `functions/proxy/[[path]].js` | `/proxy/*` | 静态哈希（无 token 签发） |

完整步骤见 **[Wiki · 部署指南](docs/Deployment.md)**。

### Node / 本地开发

```bash
# 安装依赖（已就绪可跳过）
npm install

# 设置环境变量并启动
PASSWORD=your_password node server.mjs
# 或开发模式（nodemon 热重载）
npm run dev
```

访问 `http://localhost:8080`（端口由 `PORT` 控制）。

> ⚠️ 用纯静态服务器（如 `python -m http.server`）打开时，代理功能不可用，视频无法播放。完整功能请使用 Node 开发服务器或上述任一服务端环境。

### Docker

```bash
docker run -d \
  --name libretv \
  --restart unless-stopped \
  -p 8899:8080 \
  -e PASSWORD=your_password \
  bestzwei/libretv:latest
```

### Docker Compose

```bash
PASSWORD=your_password docker compose up -d
```

访问 `http://localhost:8899`。

## 🔧 配置（环境变量）

所有可调参数均为环境变量，无需改动代码。常用项：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PASSWORD` | 空（必填） | 访问密码；未设置时页面强制提示 |
| `PROXY_SECRET` | 空 | **强烈建议设置**。设置后启用服务端签发的短时效 token 鉴权（更安全）；留空则回退为静态哈希 |
| `PORT` | `8080` | Node 监听端口 |
| `CORS_ORIGIN` | `*` | 允许的跨域来源 |
| `REQUEST_TIMEOUT` | `5000` | 代理请求超时（毫秒） |
| `MAX_RETRIES` | `2` | 代理失败重试次数 |
| `CACHE_MAX_AGE` | `1d` | 代理响应缓存时长 |
| `BLOCKED_HOSTS` | `localhost,127.0.0.1,0.0.0.0,::1` | SSRF 拦截的主机名 |
| `BLOCKED_IP_PREFIXES` | `192.168.,10.,172.` | SSRF 拦截的 IP 网段前缀 |
| `DEBUG` | `false` | 开启调试日志（`true`） |
| `USER_AGENT` | 内置 | 代理请求使用的 UA |

> 服务端函数（Vercel / Netlify / CF）另有 `CACHE_TTL`、`MAX_RECURSION`、`FILTERED_HEADERS` 等项，详见 **[Wiki · 配置参考](docs/Configuration.md)**。

## 🗂️ 添加数据源（无内置源）

LibreTV 默认没有任何视频源。首次使用后，请在「设置 → 自定义接口」中添加你信任的采集站 API（苹果 CMS V10 格式）：

- 搜索接口：`https://example.com/api.php/provide/vod/?ac=videolist&wd=关键词`
- 详情接口：`https://example.com/api.php/provide/vod/?ac=detail&ids=视频ID`

详细格式与排错见 **[Wiki · 数据源配置](docs/Data-Sources.md)**。

## 🔐 代理鉴权与安全

- **服务端部署（推荐）**：设置 `PROXY_SECRET` 后，前端在密码校验通过后向 `/api/proxy-token` 换取短时效 token（`PROXY_TOKEN_MODE=1`），代理请求携带该 token。静态哈希不再被接受，**可防伪造**。
- **无服务端的静态/函数部署**：沿用页面内的静态哈希（由 `sha256(password)` 派生），安全性较弱，建议尽量设置 `PROXY_SECRET`。
- 代理内置 **SSRF 防护**：拦截 `localhost`、`127.0.0.1`、私有网段及云元数据地址（`169.254.169.254` 等），并过滤响应中的敏感头（`set-cookie`/`csp` 等）。
- 服务端对源码路径（`/server.mjs` 等）做了静态保护，避免源码泄露。

详见 **[Wiki · 代理鉴权与安全](docs/Proxy-Security.md)**。

## ⌨️ 键盘快捷键

播放器支持：空格（播放/暂停）、←/→（快退/快进）、↑/↓（音量）、`M`（静音）、`F`（全屏）、`Esc`（退出全屏）。详见 **[Wiki · 播放器](docs/Player.md)**。

## 🛠️ 技术栈

- 前端：HTML5 + CSS3 + ES6+，Tailwind CSS，HLS.js，DPlayer
- 服务端：Node.js（Express 5）/ Vercel Functions / Netlify Functions / Cloudflare Pages Functions
- 存储：localStorage（配置、收藏、历史）

## 📚 文档 / Wiki

更完整的文档在 [`docs/`](docs/Home.md) 目录（可作为 GitHub Wiki 内容）：

- [首页 / 导航](docs/Home.md)
- [部署指南](docs/Deployment.md)
- [配置参考](docs/Configuration.md)
- [代理鉴权与安全](docs/Proxy-Security.md)
- [数据源配置](docs/Data-Sources.md)
- [播放器说明](docs/Player.md)
- [常见问题 FAQ](docs/FAQ.md)
- [架构说明](docs/Architecture.md)

## ⚠️ 免责声明

LibreTV 仅作为视频搜索与代理工具，不存储、上传或分发任何视频内容。所有视频均来自你自行配置的第三方 API 返回的搜索结果。如有侵权内容，请联系相应的内容提供方。使用本项目时，你必须遵守当地法律法规。

## 🤝 衍生项目

- **[MoonTV](https://github.com/senshinya/MoonTV)**
- **[OrionTV](https://github.com/zimplexing/OrionTV)**

## 🥇 感谢支持

- **[Sharon](https://sharon.io)** · **[ZMTO](https://zmto.com)** · **[YXVM](https://yxvm.com)**
