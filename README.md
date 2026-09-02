# LibreTV-Next

LibreTV-Next 是原 LibreTV 的 Next.js 迁移版：免费在线视频聚合搜索与观看平台。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 📖 **完整文档（Wiki）**：[docs/](docs/Home) — [架构](docs/Architecture) · [部署](docs/Deployment) · [配置](docs/Configuration) · [数据源](docs/Data-Sources) · [播放器](docs/Player) · [代理与安全](docs/Proxy-Security) · [FAQ](docs/FAQ)

## 与旧版的主要差异

| 方面 | 旧版 | 本版 |
| --- | --- | --- |
| 架构 | 静态 HTML + 全局脚本 + Express | Next.js App Router + React 组件 + Route Handlers |
| 聚合搜索 | 浏览器内并行请求采集站（暴露用户 IP） | 服务端并行聚合 + 失败隔离 + 关键词过滤 |
| 鉴权 | 页面下发 sha256(password)，哈希即凭证 | httpOnly Cookie 会话（HMAC 签名），登录走 POST + 速率限制 |
| m3u8 代理 | 分片重写后丢失鉴权参数导致 401 | Cookie 同源自动携带，分片天然通过鉴权 |
| 播放入口 | watch.html → player.html 跳转链 | 单一 `/watch` 路由，URL 即状态，可分享/后退 |
| 播放失败 | 只能换源 | 直连失败自动回退内置代理重试 |
| 历史与进度 | localStorage 存全集 URL（易撑爆配额） | IndexedDB 只存定位信息，进入播放页按需拉详情 |
| 播放器加载 | Tailwind 运行时编译 | Tailwind 构建期编译 |
| 主题 | 仅深色 | 亮 / 暗 / 跟随系统三态切换，无首屏闪烁 |

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

镜像发布在 GHCR：`ghcr.io/bestzwei/libretv-next`（`latest` / `主.次` / 完整版本号三个 tag，
`linux/amd64` 与 `linux/arm64` 双架构）。需要固定版本时在 `.env` 中设置
`LIBRETV_NEXT_IMAGE=ghcr.io/bestzwei/libretv-next:2.0.1`。

> 版本号以 `package.json` 为单一来源，部署后可用 `/api/status` 返回的 `version` 字段核对。详见[部署文档](docs/Deployment)。

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
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
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

CI 校验通过后自动构建并推送 `ghcr.io/bestzwei/libretv-next:<版本>`（详见[部署文档](docs/Deployment)）。

## 安全说明

- 密码只保存在服务端环境变量中，前端不持有任何可重放凭证。
- 登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。
