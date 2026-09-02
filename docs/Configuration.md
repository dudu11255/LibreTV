# 配置

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `PASSWORD` | **是** | — | 访问密码。未设置时站点可用但所有功能接口返回 503，并提示管理员配置 |
| `PROXY_SECRET` | 否 | 从 PASSWORD 派生 | 会话与代理签名密钥。单实例可不设；多实例/负载均衡部署必须显式设置，否则各实例会话互不认账 |
| `REQUEST_TIMEOUT` | 否 | `8000` | 代理上游请求超时（毫秒） |
| `MAX_RETRIES` | 否 | `1` | 代理请求重试次数 |
| `USER_AGENT` | 否 | Chrome UA | 代理请求使用的 UA（豆瓣防盗链等场景） |
| `DEBUG` | 否 | `false` | 调试日志 |

> 旧版的 `CORS_ORIGIN`、`CACHE_MAX_AGE`、`BLOCKED_HOSTS`、`BLOCKED_IP_PREFIXES`、`FILTERED_HEADERS` 在重构版中已内化为安全默认值，不再需要配置。

## 运行时设置（用户级）

以下设置保存在每个用户浏览器的 localStorage（键 `libretv-settings`），通过「设置」抽屉修改：

### 数据源

- **自定义 API 列表**：名称、API 地址、详情页地址（可选）、成人标记；
- **勾选参与搜索的源**：仅勾选的源会参与聚合搜索与换源。

### 播放与过滤

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| 成人内容过滤 | 开 | 服务端按分类关键词过滤（伦理片/福利片等） |
| 广告过滤 | 开 | hls.js loader 剔除 m3u8 中的 `#EXT-X-DISCONTINUITY` 广告片段 |
| 自动连播 | 开 | 单集结束自动播放下一集 |
| 豆瓣推荐 | 开 | 首页展示豆瓣热门影视 |

### 封面图加载方式

| 方式 | 说明 |
| --- | --- |
| 直连（默认） | 浏览器直接加载豆瓣/采集站封面，最快；部分网络下豆瓣图会 418 |
| 内置代理 | 经 `/api/proxy/` 转发（带豆瓣 Referer 伪装），豆瓣图不再被拒 |
| 自定义代理 | 模板字符串，`{url}` 为编码后的原图地址；不含占位符则直接拼接 |

### 主题

- 头部太阳/月亮/显示器图标，点击在 **浅色 → 深色 → 跟随系统** 间循环；
- 存储于 `localStorage['libretv-theme']`；
- 页面 HTML 内有同步脚本，刷新无闪烁；
- 跟随系统模式下监听 `prefers-color-scheme` 变化实时切换。

### 配置导入导出

- **导出**：生成 `LibreTV-Settings_<时间戳>.json`（数据源、播放设置、观看历史、搜索历史）；
- **导入**：兼容旧版 LibreTV 导出的配置文件；旧版观看历史（含全集 URL 列表）会自动迁移为定位信息格式。

## 存储结构（IndexedDB `libretv-next`）

| 表 | 主键 | 字段 | 说明 |
| --- | --- | --- | --- |
| `history` | `id = sourceKey_vodId` | title, pic, episodeIndex, totalEpisodes, playbackPosition, duration, timestamp | 上限 100 条，超出淘汰最旧 |
| `progress` | `key = sourceKey_vodId_index` | position, duration, updatedAt | 每集一条，看完清除 |
| `searchHistory` | `text` | timestamp | 上限 10 条 |
