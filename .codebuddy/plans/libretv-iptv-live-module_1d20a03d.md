---
name: libretv-iptv-live-module
overview: 为 LibreTV 新增 /live 直播模块：M3U 订阅解析（支持用户订阅 + 环境变量预置 + 导出）、HLS/HTTP-FLV 站内播放、XMLTV 节目单（EPG），并改造代理以适配直播长连接。
design:
  architecture:
    framework: react
  styleKeywords:
    - 深色直播控制台
    - 暗亮双主题
    - 毛玻璃导航
    - 分组标签条
    - LIVE 呼吸红点
    - 卡片圆角
    - 微交互动效
  fontSystem:
    fontFamily: Noto Sans
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 15px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#3B82F6"
      - "#1D4ED8"
    background:
      - "#0B0F1A"
      - "#121826"
      - "#FFFFFF"
    text:
      - "#E5E7EB"
      - "#9CA3AF"
      - "#111827"
    functional:
      - "#EF4444"
      - "#10B981"
      - "#F59E0B"
todos:
  - id: live-parsers
    content: 实现 m3u-parser.ts 与 xmltv.ts 并补齐 vitest 单测
    status: completed
  - id: live-api
    content: 新增 /api/live 的 playlist、epg、stream 三个路由与 live-cache
    status: completed
    dependencies:
      - live-parsers
  - id: live-config
    content: 新增 DEFAULT_LIVE_SOURCES 解析、status 下发与 types 扩展
    status: completed
    dependencies:
      - live-api
  - id: live-store
    content: 扩展 store 直播订阅/收藏/最近观看与 client-api 方法
    status: completed
    dependencies:
      - live-config
  - id: live-page
    content: 实现 /live 页面、live-player 与频道列表达
    status: completed
    dependencies:
      - live-store
---

## 产品概述

在 LibreTV 现有影视点播能力之外，新增一个独立的「直播 / IPTV」模块。用户（或部署者）提供 M3U 直播订阅地址后，可在站内 `/live` 页面按分组浏览频道、搜索频道、查看节目单，并直接在站内播放；不改动、不影响现有点播链路。项目本身不内置任何具体频道源，仅提供解析与播放能力。

## 核心功能

- **直播源管理**：支持用户粘贴 M3U/M3U8 订阅地址（订阅、手动同步、移除）与部署者环境变量预置两种方式；预置源开箱可见，用户取消后不再自动勾回。
- **频道列表**：按 `group-title` 分组展示频道卡片（台标、频道名、分组标签），支持关键字搜索、分组筛选、收藏与最近观看。
- **站内播放**：点击频道即在页面内播放，支持 HLS（m3u8）与 HTTP-FLV 两种直播流；播放失败时自动从直连切换到代理通道重试；直播态隐藏进度条、倍速、连播、截图等点播专属控件。
- **节目单（EPG）**：解析 XMLTV（含 gzip 压缩）并按 `tvg-id` 匹配频道，侧栏展示「正在播出 / 即将播出」与时间轴，点击节目可查看简介。
- **视觉效果**：沿用站点亮暗双主题与半透明导航风格；播放器区为 16:9 黑色画布，右侧为频道侧栏（分组折叠 + 频道项），底部为当前频道信息条与 EPG 时间轴；LIVE 状态以红色呼吸点标识，分组筛选为横向可滑动标签条。

## 技术栈

沿用项目现有技术栈，仅新增一个前端播放依赖：

- Next.js 15（App Router）+ TypeScript + Tailwind CSS 3 + React 19
- 播放：ArtPlayer 5 + hls.js 1.5（现有）+ **mpegts.js**（新增，仅直播页动态加载）
- 状态：zustand + persist（现有 `libretv-settings`）；数据获取：@tanstack/react-query
- 测试：vitest（对齐 `cms-parser.test.ts` 风格）
- 服务端：Node runtime 路由 + 项目现有 `fetchUpstream()` / `checkUpstreamAllowed()` / 内存 TTL 缓存

## 实现方案

### 整体架构

```mermaid
flowchart TB
    subgraph 客户端
        A[/live 页面] --> B[LivePlayer 协议分发]
        B -->|m3u8| C[hls.js]
        B -->|flv| D[mpegts.js 动态 import]
        A --> E[频道列表 / 分组 / 搜索]
        A --> F[EPG 时间轴]
        A --> G[直播源管理抽屉]
    end
    subgraph 服务端 Next.js API
        H[/api/live/playlist] -->|拉取+解析| I[m3u-parser]
        J[/api/live/epg] -->|拉取+解压+解析| K[xmltv]
        L[/api/live/stream/[url]] -->|长连接流式透传| M[上游直播源]
        N[/api/status] --> O[env-live-sources]
    end
    H -.复用.-> P[fetchUpstream + checkUpstreamAllowed]
    J -.复用.-> P
    L -.复用.-> P
    I -.写入.-> Q[live-cache 大对象 TTL 缓存]
    K -.写入.-> Q
```

### 关键技术决策

**1. 直播流不能复用 `/api/proxy`（必须新建专用通道）**
现有 `src/app/api/proxy/[url]/route.ts` 使用 `signal: AbortSignal.timeout(TIMEOUT_MS)`（默认 8000ms），该超时作用于**整个响应流**；且 M3U 不重写、非 m3u8 响应统一加 `Cache-Control: public, max-age=3600`，并且失败会重试。HTTP-FLV 是单一长连接，走该代理会在 8 秒后被切断。因此新建 `/api/live/stream/[url]`：

- 只对「收到响应头」设超时（约 15s），拿到响应后立即释放超时信号，之后不限总时长；
- 不重试、不读取 body 到内存（直接 `new NextResponse(response.body)`）；
- 响应头 `Cache-Control: no-store, no-transform`、`Connection: keep-alive`、透传 `content-type`；
- 客户端断开（`req.signal`）时主动 `abort` 上游，防止连接泄漏；
- 每次请求仍强制过 `checkUpstreamAllowed()`（不信任解析阶段的校验结果）。

**2. 直播播放器独立组件，不污染点播播放器**
新建 `src/components/live-player.tsx`，而非在 `player-shell.tsx` 的 `customType` 里加 flv 分支。理由：点播播放器耦合了进度恢复、IndexedDB 写入、自动连播、集数切换、广告过滤（剔除 `#EXT-X-DISCONTINUITY`，对直播有误伤风险），参数（backBufferLength/maxBufferLength）也是点播调优值。直播需要 `liveSyncDurationCount`、`lowLatencyMode`、直播态 UI。独立组件可将改动限制在新文件，点播链路零风险。

**3. mpegts.js 动态导入**
仅在检测到 flv 源时 `await import('mpegts.js')`，避免点播首屏为此多下载约 150KB。

**4. 频道源两种来源并存**

- 用户订阅：复用现有订阅心智（订阅 URL、手动同步、按前缀整体替换），但**独立于采集站订阅模型**存于 `liveSubscriptions`，避免与 `customAPIs` 的 `subKeyPrefix` 命名空间冲突；
- 部署者预置：新增 `DEFAULT_LIVE_SOURCES` 环境变量，解析逻辑对齐 `src/lib/env-sources.ts`（JSON 数组、解析失败仅告警忽略），经 `/api/status` 下发，沿用 `envKeysSeen` 的「首次自动勾选」策略。

**5. EPG 解析与大对象缓存**
XMLTV 文件常达数十 MB，不可每次请求拉取：服务端按 `tvg-id` 建立 `Map<channelId, 节目[]>` 后**只保留所需窗口**（当前及未来 24 小时）并丢弃原始文本，写入独立缓存（`src/lib/live-cache.ts`，独立 LRU/TTL 上限）。刻意不复用 `fetch-utils.ts` 的 `getCache/setCache`：其条目超 500 会 `cache.clear()`，EPG 大对象会连带清掉豆瓣等热点数据。M3U 列表用较短 TTL（10 分钟）走通用缓存即可。

**6. 安全与合规**

- 所有直播源 URL 播放前必须过 `checkUpstreamAllowed()`（M3U 内容远程可控，解析期校验不可信）；
- 频道名/logo 由 React 文本渲染天然转义；logo URL 仅放行 http(s)，渲染走现有图片代理模式；
- 不内置任何公共 IPTV 源列表；README 沿用「不存储不制作内容，合法性由数据源负责」声明；
- 内网自建源（`http://192.168.x.x`）默认仍被 SSRF 拦截，提供显式环境变量 `LIVE_ALLOW_PRIVATE=1` 供自部署者按需开启（默认关闭）。

### 性能要点

- M3U 解析为单趟扫描（O(n)），频道去重按 `url` + `tvg-id`；大列表（数千频道）在服务端裁剪后返回，前端分组用 `useMemo`；
- EPG 只在用户展开某频道时按需查询该 `tvg-id`，不做全量下发；
- 频道列表与 EPG 查询接入 react-query（`staleTime` 缓存），避免切台重复请求；
- 直播流代理为纯流式管道，无内存缓冲累积。

## 目录结构

```
src/
├── lib/
│   ├── m3u-parser.ts            # [NEW] M3U/M3U8 播放列表解析：#EXTM3U 校验、#EXTINF 行与 tvg-id/tvg-name/tvg-logo/group-title 属性提取、频道去重、URL 标准化（相对地址按订阅 URL 解析）。导出 parseM3u() 返回 LiveChannel[]。
│   ├── m3u-parser.test.ts       # [NEW] 单测：标准 M3U、无属性简写、相对路径、重复频道去重、异常输入不抛错。对齐 cms-parser.test.ts 风格。
│   ├── xmltv.ts                 # [NEW] XMLTV 解析：gzip 解压（zlib.gunzipSync）、<channel id>/<programme channel start stop> 提取、YYYYMMDDHHmmss +0800 时间解析、按 tvg-id 索引、时间窗裁剪（当前至 +24h）。导出 parseXmltv()/pickPrograms()。
│   ├── xmltv.test.ts            # [NEW] 单测：gz 与明文、偏移时区、节目排序、当前/后续节目定位。
│   ├── live-cache.ts            # [NEW] 大对象专用 TTL 缓存（EPG），带条目数与内存上限的自清理，与 fetch-utils 通用缓存隔离。
│   ├── env-live-sources.ts      # [NEW] 解析 DEFAULT_LIVE_SOURCES 环境变量（JSON 数组：name/url/epg），失败仅 console.warn 并忽略，模式对齐 env-sources.ts。
│   ├── types.ts                 # [MODIFY] 新增 LiveSourceConfig / LiveChannel / EpgProgram / LivePlaylistResponse / LiveEpgResponse 类型；AuthStatusResponse 增加 defaultLiveSources 字段。
│   ├── store.ts                 # [MODIFY] 新增 liveSubscriptions、liveEnvSources、liveFavorites、liveRecent；对应 actions（订阅/同步/移除/整体替换、收藏切换、最近观看记录上限 20）；partialize 持久化白名单同步扩展（注意 skipHydration 的 SSR 一致性）。
│   └── client-api.ts            # [MODIFY] 新增 api.livePlaylist(url, force)、api.liveEpg(epgUrl, tvgId)、api.liveTest(url)，沿用 request() 的 401/503 处理。
├── app/
│   ├── api/
│   │   ├── live/
│   │   │   ├── playlist/route.ts      # [NEW] 拉取并解析 M3U 订阅 → 分组后的频道 JSON；SSRF 校验 + 通用缓存（TTL 10min）+ force 参数跳过缓存；支持 format=m3u 导出订阅文件。
│   │   │   ├── epg/route.ts           # [NEW] 拉取 XMLTV（含 .gz）→ 解析并按 tvg-id（批量）返回节目窗口；写入 live-cache（TTL 6h）。
│   │   │   └── stream/[url]/route.ts  # [NEW] 直播流专用长连接代理：首字节超时、无总时长限制、no-store、客户端断开即 abort 上游、强制 SSRF 校验、可选 LIVE_ALLOW_PRIVATE 放行内网。
│   │   └── status/route.ts            # [MODIFY] 下发 defaultLiveSources（由 env-live-sources 提供）。
│   └── live/page.tsx                  # [NEW] 直播页：左侧播放器 + 右侧频道侧栏（分组筛选/搜索/收藏/最近），底部 EPG 时间轴；URL 参数 ?src=&ch= 支持频道深链与刷新保持。
├── components/
│   ├── live-player.tsx           # [NEW] 直播播放器：ArtPlayer 直播态配置（隐藏进度/连播/截图/倍速）、扩展名→协议分发（m3u8→hls.js；flv→动态 import mpegts.js）、直连失败自动切 /api/live/stream 重试、错误提示与重载。
│   ├── live-channel-list.tsx     # [NEW] 频道侧栏：分组横向标签条 + 搜索框 + 频道项（台标走现有图片代理、名称、LIVE/收藏标记）、虚拟滚动或分页以应对大列表。
│   ├── live-epg-panel.tsx        # [NEW] EPG 面板：当前节目高亮、进度条、后续节目列表、点击展开简介；无数据时优雅降级。
│   ├── live-source-manager.tsx   # [NEW] 直播源管理（嵌入现有设置抽屉）：添加/同步/移除订阅、显示预置源、探活耗时、导出 .m3u。
│   ├── source-manager.tsx        # [MODIFY] 在设置抽屉中新增「直播源」分区并挂载 LiveSourceManager。
│   └── header.tsx                # [MODIFY] 顶部导航新增「直播」HeaderLink（复用现有 HeaderLink 组件与高亮逻辑）。
├── package.json                  # [MODIFY] 新增依赖 mpegts.js。
└── README.md                     # [MODIFY] 环境变量表格补充 DEFAULT_LIVE_SOURCES / LIVE_ALLOW_PRIVATE；核心特性与免责声明补充直播说明。
```

## 关键代码结构

```ts
// src/lib/types.ts 新增（示意）
export interface LiveSourceConfig {
  key: string;
  name: string;
  url: string;          // M3U 订阅地址
  epg?: string;         // XMLTV 地址，可选
  builtin?: boolean;    // 来自 DEFAULT_LIVE_SOURCES
}

export interface LiveChannel {
  id: string;           // tvg-id 或由 url 生成的稳定 id
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  rawName?: string;
}

export interface EpgProgram {
  channelId: string;
  start: number;        // epoch ms
  stop: number;
  title: string;
  desc?: string;
}
```

```ts
// src/lib/m3u-parser.ts
export function parseM3u(content: string, baseUrl?: string): LiveChannel[];

// src/lib/xmltv.ts
export function parseXmltv(content: string | Buffer, windowMs?: number): Map<string, EpgProgram[]>;
export function currentAndNext(programs: EpgProgram[], at?: number): { current?: EpgProgram; next?: EpgProgram };
```

## 实施注意事项

- **不改动** `src/app/api/proxy/[url]/route.ts` 与 `src/components/player-shell.tsx` 的点播行为，直播全部走新增文件，blast radius 可控；
- 直播路由需显式 `export const runtime = 'nodejs'` 与 `export const dynamic = 'force-dynamic'`，避免被静态化或缓存；
- 流式响应禁用 Next.js 缓冲：不要 `await response.text()`，且勿设置 `content-length`；
- 新解析器必须补 vitest 单测，`npm test` 是 CI 门禁；
- 交付前需全部通过：`npm run typecheck`、`npm test`、`npm run lint`、`npm run build`。

## 设计风格

沿用 LibreTV 现有视觉语言（亮暗双主题、半透明毛玻璃导航、蓝色强调色 #2563eb），新增直播模块仅在既有设计系统内扩展，不引入新组件库：全部使用 Tailwind 工具类，复用项目现成的 `Drawer`、`HeaderLink`、`btn / btn-ghost / btn-primary`、`input`、`bg-surface / bg-surface-raised`、`text-content / text-muted / text-faint`、`border-line`、`bg-hover`、`accent` 等既有 class，保证与点播页视觉完全一致。

## 页面：/live（单页，桌面为主、移动端单列自适应）

1. **顶部导航条（复用全局 Header）**：Logo、搜索框（首页外可见）、新增「直播」入口高亮、主题切换、历史、设置；sticky + backdrop-blur。
2. **主播放区（左侧主栏）**：16:9 纯黑画布，圆角卡片；右下角红色圆点 + "LIVE" 呼吸动效；播放失败时黑色遮罩 + 重试按钮；加载中显示旋转指示器。
3. **频道信息条（播放器下方）**：当前频道台标（40px 圆角）、频道名、分组标签、EPG 当前节目名与进度条、收藏星标、复制/外部打开按钮。
4. **频道侧栏（右侧 300px，移动端下移到底部）**：分组横向可滑动标签条（全部 / 央视 / 卫视 / 地方 / 体育...）+ 搜索输入框 + 频道列表项（台标 28px、名称单行截断、LIVE 红点、收藏星）；当前播放项左侧蓝色竖条高亮并自动滚动进视区；支持「收藏 / 最近观看」切换 tab。
5. **EPG 时间轴（侧栏底部或主栏下方）**：当前节目卡片（标题 + 时间 + 简介折叠）+ 「接下来」列表（时间 + 标题），时间轴用细横线 + 已播进度条表示；无 EPG 数据时显示占位文案。

## 交互与动效

- 切台：频道项点击即播，播放器淡入切换，列表高亮平滑过渡；
- 分组切换：标签条滑动 + 下划线指示器动画；
- LIVE 标识：红色圆点 2s 周期呼吸；
- 收藏：星标填充时 0.2s 缩放弹跳；
- 全部动效时长控制在 150-300ms，与现有 `animate-fade-in` / `animate-slide-up` 保持一致。