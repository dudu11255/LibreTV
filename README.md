# LibreTV

LibreTV Next.js 迁移版：免费在线视频聚合搜索与观看平台。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 📖 **完整文档**：[docs/Home.md](docs/Home.md) · [架构](docs/Architecture.md) · [部署](docs/Deployment.md) · [配置](docs/Configuration.md) · [数据源](docs/Data-Sources.md) · [播放器](docs/Player.md) · [代理与安全](docs/Proxy-Security.md) · [FAQ](docs/FAQ.md)

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **换源测速**：跨源搜索同名资源并测速排序，一键切换保留集数位置
- **源测试与订阅**：一键探活数据源；订阅远程源列表（LibreTV-SourceList JSON），可导出分享
- **豆瓣推荐**：电影 / 剧集分类浏览，服务端直连避免公共 CORS 代理
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 部署

### Docker（推荐）

```bash
# 在 .env 中设置 PASSWORD
echo "PASSWORD=your-password" > .env

# 方式一：拉取发布镜像（零构建）
docker compose pull && docker compose up -d

# 方式二：源码构建
docker compose up -d --build
```

### Docker Compose

```yaml
services:
  libretv:
    image: ghcr.io/librespark/libretv:latest
    container_name: libretv
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PASSWORD=change-me   # 必填：访问密码，务必修改
```

```bash
docker compose pull && docker compose up -d
```

> ⚠️ **生产部署必须通过 HTTPS 访问**（localhost 除外）：生产模式下会话 cookie 带 `Secure` 标记，浏览器只在 HTTPS（或 localhost）下保存它。因此用 `http://服务器IP:端口` 访问时，会出现"密码正确却无法登录"的现象——登录请求实际成功，但 cookie 被浏览器丢弃。请通过反向代理（Nginx / Caddy / Traefik）或 Cloudflare 等为站点套上 TLS 后再对外提供服务；本地开发用 `localhost` 不受影响。

镜像发布在 GHCR：`ghcr.io/librespark/libretv`（`latest` / `主.次` / 完整版本号三个 tag，
`linux/amd64` 与 `linux/arm64` 双架构）。需要固定版本时在 `.env` 中设置
`LIBRETV_IMAGE=ghcr.io/librespark/libretv:2.0.1`。

> 版本号以 `package.json` 为单一来源，部署后可用 `/api/status` 返回的 `version` 字段核对。详见[部署文档](docs/Deployment.md)。

### 手动运行

```bash
npm install
PASSWORD=your-password npm run build
PASSWORD=your-password npm start   # 监听 8080
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 是 | 访问密码；未设置时站点会提示管理员配置 |
| `PROXY_SECRET` | 否 | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置） |
| `DEFAULT_SOURCES` | 否 | 预置采集站（JSON 数组），用户端自动出现且默认勾选，详见[配置文档](docs/Configuration.md) |
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
| `SEARCH_MAX_PAGES` | 否 | 每个搜索源最多抓取的页数（1-50，默认 5）。第一页会读取源站 `pagecount`，实际页数 = min(源站总页数，该值)；页间并行请求，单页失败只丢该页 |
| `DEBUG` | 否 | 调试日志 |

## 使用说明

1. **添加数据源**：设置 → 添加 API，填入 Apple CMS 采集站地址（如 `https://example.com/api.php/provide/vod`），可选填详情页地址（部分源需要爬详情页提取播放地址）。
2. **搜索**：勾选数据源后输入片名；搜索通过服务端聚合，个别源失败不影响整体结果。
3. **播放**：详情弹窗选择剧集进入 `/watch`；支持快捷键（空格/←→/↑↓/F/Alt+←→）、移动端长按 3 倍速、自动连播、换源测速。
4. **进度与历史**：自动保存在本设备 IndexedDB，仅定位信息入库，播放时自动同步最新剧集。
5. **配置迁移**：设置 → 导出/导入配置（兼容旧版 LibreTV-Settings JSON 的历史记录迁移）。

## 源订阅 / 分享

源列表可以 **导出为 JSON → 托管到公开 URL → 他人在「设置」里填入该 URL 订阅**。

托管地址没有特殊要求，可用 [npoint.io](https://www.npoint.io/) 免费托管 JSON（粘贴内容即可得到一个公开 URL），Gist、对象存储、任意静态托管同样可用。

### 订阅格式（LibreTV-SourceList JSON）

```json
{
  "name": "我的源列表",
  "version": 1,
  "sources": [
    { "name": "示例源", "url": "https://example.com/api.php/provide/vod" }
  ]
}
```

- 必填字段只有 `sources[].url`；`detail` 为详情页根地址，`isAdult` 为成人内容标记；
- 也接受裸数组 `[{ "name": "...", "url": "..." }]`；
- 按 `url` 去重，最多 100 个源；非公网 http(s) 地址会被静默过滤。

### 订阅行为

- **订阅**：设置 → 源订阅 / 分享 → 填入订阅地址 → 「订阅」，导入的源自动勾选并带「订阅」标识；
- **同步**：订阅条目上的 **⟳** 手动强制同步，整体替换该订阅名下的源；
- **管理边界**：订阅源以远端列表为准，单独编辑会在下次同步时被覆盖，单独移除会在重新同步时恢复；如需调整请改远端列表，或直接删除整个订阅（会一并移除其导入的源）；
- **导出分享**：设置 → 源订阅 / 分享 → 「导出源列表」，把当前全部来源（预置 + 手动 + 订阅，按 URL 去重）导出为上述 JSON。

> 订阅由服务端拉取（经过 SSRF 校验），因此订阅地址无需配置 CORS。完整说明见 [数据源文档](docs/Data-Sources.md#源订阅--分享)。

## 开发

```bash
npm install
PASSWORD=dev-password npm run dev   # http://localhost:8080
npm test                            # 核心库单元测试（cms-parser / m3u8 / ssrf）
npm run typecheck
```

## 发布新版本

版本号以 `package.json` 为单一来源，发布镜像由 GitHub Actions 自动完成：

```bash
npm version patch       # 或 minor / major；会更新 package.json 并打 git tag
git push && git push --tags
```

CI 校验通过后自动构建并推送 `ghcr.io/librespark/libretv:<版本>`（详见[部署文档](docs/Deployment.md)）。

## 安全说明

- 密码只保存在服务端环境变量中，前端不持有任何可重放凭证。
- 登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）。

## 延伸项目

基于 LibreTV 生态的衍生作品：

| 项目 | 说明 |
| --- | --- |
| [OrionTV](https://github.com/orion-lib/OrionTV) | Apple TV / Android TV 客户端（React Native TVOS + Expo），配合 MoonTV 使用 |
| [LunaTV](https://github.com/MoonTechLab/LunaTV) | 影视聚合站（Next.js），支持 Redis / Upstash 等多存储后端 |
| [Selene-TV](https://github.com/MoonTechLab/Selene-TV) | Android TV（Leanback）客户端，Kotlin + Compose，对接 MoonTV / Helios |
| [EchoTV](https://github.com/hoowhoami/EchoTV) | Flutter 全平台客户端（已归档） |
| [WarHutTV](https://github.com/OuOumm/WarHutTV) | Go + React 的自托管影视聚合站 |
| [DecoTV](https://github.com/Decohererk/DecoTV) | 聚合播放站（原 KatelyaTV） |
| [Joyflix](https://github.com/jeffernn/Joyflix-Mac-Objective-C) | macOS 原生影视聚合客户端（Objective-C） |
| [MoonCakeTV](https://github.com/MoonCakeTV/MoonCakeTV) | 影视聚合搜索站（Next.js），文件存储、一键脚本部署 |
| [OrangeTV](https://github.com/djteang/OrangeTV) | 跨平台影视聚合播放器（Next.js），Kvrocks/Redis/Upstash 多存储与多端同步 |

> 旧版 LibreTV（静态 HTML + Express）完整代码见 [backup-2025 分支](https://github.com/LibreSpark/LibreTV/tree/backup-2025)。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。

<sub>☕ 觉得有用的话，可以到 [AFDIAN](https://afdian.com/a/veehub) 请我喝杯咖啡。</sub>