# LibreTV Wiki

欢迎来到 LibreTV 文档中心。本项目是一个**无内置数据源**的在线视频搜索与代理平台，本文档帮助你部署、配置与排错。

## 导航

| 页面 | 内容 |
|---|---|
| [部署指南](Deployment.md) | Node / Vercel / Netlify / Cloudflare Pages / Docker / Render 详细步骤 |
| [配置参考](Configuration.md) | 全部环境变量与默认值 |
| [代理鉴权与安全](Proxy-Security.md) | token 模式、静态哈希、SSRF 防护、源码保护 |
| [数据源配置](Data-Sources.md) | 如何添加苹果 CMS / 采集站 API |
| [播放器说明](Player.md) | 快捷键、HLS、手势操作 |
| [常见问题 FAQ](FAQ.md) | 部署与播放常见故障排查 |
| [架构说明](Architecture.md) | 前端结构、服务端适配器、数据流 |

## 核心设计

1. **空壳前端**：仓库不维护任何默认视频源，所有源由用户在「设置」中添加。
2. **服务端代理**：跨域抓取与 m3u8 改写集中在服务端函数，前端只负责渲染。
3. **安全优先**：代理鉴权、SSRF 拦截、源码保护为必保留能力。

> 想快速上手？先看 [部署指南](Deployment.md)，再读 [数据源配置](Data-Sources.md) 添加你的第一个采集站。
