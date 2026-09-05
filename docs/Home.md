# LibreTV Wiki

欢迎来到 LibreTV 的项目文档。LibreTV 是一个免费的在线视频聚合搜索与观看平台，基于 Next.js 15 重构。

## 文档目录

| 文档 | 内容 |
| --- | --- |
| [Architecture](Architecture.md) | 系统架构、目录结构、数据流、技术选型说明 |
| [Deployment](Deployment.md) | Docker / 手动部署、环境变量、升级指南 |
| [Configuration](Configuration.md) | 环境变量详解、主题系统、数据源管理、配置导入导出 |
| [Data-Sources](Data-Sources.md) | 采集站（Apple CMS）接入说明、自定义 API 格式、常见问题源 |
| [Player](Player.md) | 播放器功能、快捷键、广告过滤、代理回退、进度与历史 |
| [Proxy-Security](Proxy-Security.md) | 代理鉴权设计、SSRF 防护、安全模型与旧版对比 |
| [FAQ](FAQ.md) | 常见问题排查 |

## 快速开始

```bash
# Docker 部署（推荐）
echo "PASSWORD=your-password" > .env
docker compose up -d

# 本地开发
npm install
PASSWORD=dev-password npm run dev   # http://localhost:8080
```

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索，单源失败不影响整体，用户 IP 不暴露给第三方
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **智能回退**：视频直连失败（CORS / 防盗链）时自动改走内置代理重试
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **换源测速**：跨源搜索同名资源并测速排序，一键切换保留集数位置
- **源测试与订阅**：一键探活数据源；订阅远程源列表（LibreTV-SourceList JSON），可导出分享
- **豆瓣推荐**：电影 / 剧集分类浏览，服务端直连避免公共 CORS 代理
- **亮暗主题**：跟随系统 / 手动切换，无首屏闪烁
- **PWA**：可安装到桌面 / 主屏幕

## 与旧版（静态 HTML + Express）的关系

本项目是 [LibreTV 旧版](https://github.com/LibreSpark/LibreTV)的完整重构。功能对齐的同时修复了旧版的多项问题（历史记录 XSS、m3u8 分片鉴权丢失、密码哈希暴露等），架构差异详见 [Architecture](Architecture.md)。
