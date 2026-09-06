# 架构

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 15（App Router）+ React 19 | 服务端 API Routes 与客户端页面同仓 |
| 语言 | TypeScript（strict） | 全量类型覆盖 |
| 样式 | Tailwind CSS（构建期编译）+ CSS 变量主题 | 亮暗双主题，`darkMode: 'class'` |
| 数据获取 | TanStack Query | 搜索/详情/推荐数据的缓存、重试、失效 |
| 客户端状态 | Zustand（persist → localStorage） | 数据源列表与播放设置 |
| 持久化 | Dexie（IndexedDB） | 观看历史、播放进度、搜索历史 |
| 播放 | ArtPlayer + hls.js | 广告过滤 loader、代理回退 |

## 目录结构

```
libretv/
├── src/
│   ├── app/
│   │   ├── page.tsx                # 首页：搜索 + 推荐区（?s= URL 驱动）
│   │   ├── watch/page.tsx          # 播放页（唯一入口，URL 即状态）
│   │   ├── about/page.tsx
│   │   ├── layout.tsx              # 主题无闪烁内联脚本 + Providers
│   │   ├── manifest.ts             # PWA manifest
│   │   └── api/                    # 服务端 Route Handlers
│   │       ├── auth/route.ts       # 登录/登出/会话状态
│   │       ├── status/route.ts     # 站点状态（客户端据此弹登录框）
│   │       ├── search/route.ts     # 聚合搜索（并行 + 失败隔离 + 过滤）
│   │       ├── detail/route.ts     # 详情（列表接口 → 详情页 HTML 降级）
│   │       ├── douban/route.ts     # 豆瓣推荐（直连 + 缓存 + 代理降级）
│   │       ├── bangumi/calendar/   # Bangumi 每日放送（免 key）
│   │       ├── hot-list/route.ts   # 影视榜单（60s API：豆瓣周榜 + 百度热播）
│   │       └── proxy/[url]/route.ts# 流式代理（SSRF 防护 + m3u8 重写）
│   ├── components/                 # UI 组件（见下）
│   └── lib/                        # 纯逻辑库（可单元测试）
│       ├── cms-parser.ts           # Apple CMS 解析（列表/详情/详情页爬取）
│       ├── m3u8.ts                 # m3u8 重写与广告过滤
│       ├── ssrf.ts                 # 内网地址识别与 DNS 校验
│       ├── auth.ts                 # 会话签名/校验、登录限流
│       ├── douban.ts               # 豆瓣数据获取（降级链 + TTL 缓存）
│       ├── bangumi.ts              # Bangumi 每日放送（免 key，星期分组）
│       ├── douban-weekly.ts        # 影视榜单聚合（60s API，六个榜单归一化）
│       ├── fetch-utils.ts          # 超时/重试/内存缓存
│       ├── db.ts                   # Dexie schema 与历史/进度 CRUD
│       ├── store.ts                # Zustand 全局设置
│       ├── client-api.ts           # 客户端 API 封装（401 → 全局登录框）
│       └── utils.ts                # 时间格式化、图片代理 URL、sha256 等
├── docs/                           # 本 Wiki
├── Dockerfile / docker-compose.yml
└── README.md
```

## 组件一览

| 组件 | 职责 |
| --- | --- |
| `providers.tsx` | QueryClient + Theme + Toast + Auth 四层 Provider 嵌套 |
| `theme.tsx` | 亮暗主题上下文与三态切换按钮（light/dark/system） |
| `auth.tsx` | 认证上下文；监听全局 401 事件弹出登录框 |
| `header.tsx` | 顶部导航 + 通用抽屉（Drawer）骨架 |
| `search`（page.tsx 内联） | 搜索框、历史 chips、结果网格、空态引导 |
| `douban-section.tsx` | 首页推荐区（RecommendSection）：豆瓣 / Bangumi / 影视榜单三源按设置分支渲染 |
| `video-card.tsx` | 搜索结果卡片 / 豆瓣卡片（封面多级降级） |
| `detail-modal.tsx` | 详情弹窗（海报 + 元信息 + 剧集 + 复制链接） |
| `source-manager.tsx` | 设置抽屉：数据源 CRUD、过滤开关、封面加载方式、配置导入导出 |
| `history-panel.tsx` | 观看历史抽屉（Dexie liveQuery 实时刷新） |
| `player-shell.tsx` | ArtPlayer/HLS 封装：广告过滤、快捷键、长按倍速、代理回退 |
| `switch-source.tsx` | 换源面板：跨源搜索 → 同名匹配 → 测速排序 → 切换 |
| `toast.tsx` | 并行堆叠 Toast + 全局 Loading 遮罩 |

## 数据流

### 搜索

```
浏览器                      服务端                        上游
  │ POST /api/search          │                            │
  │ {wd, sources[], filter}   │── 并行 fetch（8s 超时）────→│ 采集站 ×N
  │                           │← JSON ─────────────────────│
  │← {list, failures[]} ──────│ 合并/去重/排序/成人过滤      │
```

- 客户端把自定义数据源配置随请求上传（数据源配置仅存于用户浏览器）；
- 单源失败进入 `failures`，不影响其他源结果；
- React Query 以 `['search', wd, selectedKeys, filter]` 为缓存键。

### 播放

```
/watch?source=key&id=vodId&index=n&title=..&sourceUrl=..
  │
  ├─ resolveSource(): 从 Zustand store 取数据源配置（URL 参数兜底，支持分享链接）
  ├─ GET /api/detail → episodes[] → 当前集 URL
  └─ PlayerShell(ArtPlayer+hls)
       ├─ 直连 m3u8
       └─ 致命网络错误 → /api/proxy/<url> 重试一次（cookie 鉴权）
```

进度：`video:timeupdate`（5s 节流）+ 暂停 + 卸载 → IndexedDB `progress`；
历史：进入播放页 2s 后 upsert，仅存定位信息（`sourceKey + vodId + episodeIndex`），不存全集 URL。

### 换源

`switch-source.tsx` → `POST /api/search`（按标题）→ 每源取完全同名结果（否则第一条）→ `GET /api/detail` 并发测速（接口耗时）→ 按速度排序展示 → 切换时保留集数索引。

## 与旧版的架构差异

| 维度 | 旧版 | 本版 |
| --- | --- | --- |
| API 层 | 浏览器内 monkey-patch `window.fetch` 假装 `/api/*` | 真实服务端 Route Handlers |
| 聚合搜索位置 | 用户浏览器（IP 暴露、无法缓存） | 服务端 |
| 鉴权 | 页面下发 sha256(password)，`auth=` 哈希即凭证 | httpOnly cookie + HMAC 签名会话 |
| m3u8 分片 | 重写为 `/proxy/...` 但丢失鉴权参数 → 401 | cookie 同源自动携带，天然通过 |
| 页面间状态 | URL + localStorage 双总线（10+ key） | URL 即状态 + IndexedDB |
| 播放入口 | watch.html → player.html 跳转链 | 单一 `/watch` 路由 |
| 转义 | 4 种手工转义函数，存在 XSS 缺口 | React 自动转义，无 innerHTML |
| 主题 | 无 | CSS 变量 + class 策略，三态切换 |
