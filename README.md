# LibreTV

LibreTV Next.js 迁移版：免费在线视频聚合搜索与观看平台。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 📖 **完整文档**：[docs/Home.md](docs/Home.md) · [架构](docs/Architecture.md) · [部署](docs/Deployment.md) · [配置](docs/Configuration.md) · [数据源](docs/Data-Sources.md) · [播放器](docs/Player.md) · [代理与安全](docs/Proxy-Security.md) · [FAQ](docs/FAQ.md)

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索，单源失败不影响整体，用户 IP 不暴露给第三方
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **智能回退**：视频直连失败（CORS / 防盗链）时自动改走内置代理重试
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
| [LunaTV](https://github.com/MoonTechLab/LunaTV) | 受本项目启发的影视聚合站（Next.js），支持 Redis / Upstash 等多存储后端 |
| [Selene-TV](https://github.com/MoonTechLab/Selene-TV) | Android TV（Leanback）客户端，Kotlin + Compose，对接 MoonTV / Helios |
| [EchoTV](https://github.com/hoowhoami/EchoTV) | Flutter 全平台客户端，受 LunaTV 启发（已归档） |
| [WarHutTV](https://github.com/OuOumm/WarHutTV) | Go + React 的自托管影视聚合站，灵感来自 LunaTV |
| [DecoTV](https://github.com/Decohererk/DecoTV) | 基于 LunaTV 二次开发的聚合播放站（原 KatelyaTV） |
| [Joyflix](https://github.com/jeffernn/Joyflix-Mac-Objective-C) | macOS 原生影视聚合客户端（Objective-C）|

> 旧版 LibreTV（静态 HTML + Express）完整代码见 [backup-2025 分支](https://github.com/LibreSpark/LibreTV/tree/backup-2025)。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。
