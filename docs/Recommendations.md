# 首页推荐

首页在没有搜索关键词时展示推荐内容。推荐**数据源可在设置中切换**（设置 → 播放与过滤 → 「首页推荐」开关 + 「推荐数据源」下拉），同一时间只展示一个来源：

| 来源 | 内容 | 依赖 |
| --- | --- | --- |
| 豆瓣 | 电影/剧集分类 + 标签（热门、最新、高分等），分页加载 | 无 |
| Bangumi 新番放送 | 每日放送表，按星期筛选（周一~周日），一次全量 | 无，[api.bgm.tv](https://github.com/bangumi/api) 免 key |
| 影视榜单 | 豆瓣五个周榜（电影/国产剧/海外剧/国内外综艺）+ 百度热播剧，chips 切换 | [60s API](https://github.com/vikiboss/60s) 免 key，见 `60S_API_BASE` |

所有来源均在**服务端**直连上游并做内存缓存，浏览器只请求本站 API，不暴露用户 IP。

## 各来源实现细节

### 豆瓣（`/api/douban`）

- 上游 `movie.douban.com/j/search_subjects`，服务端伪装 UA/Referer 直连；
- 直连被拒时降级到 `FALLBACK_CORS_PROXY` 环境变量指定的代理；
- 缓存 10 分钟。

### Bangumi（`/api/bangumi/calendar`）

- 上游 `api.bgm.tv/calendar`（每日放送），完全公开免 key；
- 条目转换为与豆瓣一致的卡片结构：中文名优先（`name_cn`）、评分保留一位小数、封面取 `large` 档；
- 缓存 30 分钟；
- 点击卡片同样走标题搜索采集站，Bangumi 中文名可直接命中。

### 影视榜单（`/api/hot-list`）

经 [60s API](https://github.com/vikiboss/60s) 聚合，六个榜单：

| 榜单 | 标识 | 上游 |
| --- | --- | --- |
| 电影周榜 | `douban_movie_weekly` | 豆瓣移动端 rexxar 接口（60s 代为伪装 iPhone UA 抓取） |
| 国产剧周榜 | `douban_tv_chinese` | 同上 |
| 海外剧周榜 | `douban_tv_global` | 同上 |
| 国内综艺 | `douban_show_chinese` | 同上 |
| 海外综艺 | `douban_show_global` | 同上 |
| 百度热播剧 | `baidu_teleplay` | top.baidu.com 电视剧榜（无评分，海报偶缺，缺图条目已过滤） |

- 豆瓣周榜海报默认走 `doubanio.viki.moe` 代理域名，规避豆瓣图床防盗链；
- 缓存 1 小时；
- `60S_API_BASE` 环境变量可指向自部署的 60s 实例（`docker run -d -p 4399:4399 vikiboss/60s:latest`），官方公共实例有限流。

## 为什么默认是影视榜单

豆瓣搜索接口偶尔限流且封面有防盗链；影视榜单数据最完整（海报/评分/简介齐全）、60s 侧做了封面代理，且榜单内容与"找片看"的意图最匹配。旧部署升级后**已保存过设置的用户不受影响**，仍沿用其已持久化的选择。

## 常见问题

**Q: 首页推荐区完全不显示？**
检查设置 → 播放与过滤 → 「首页推荐」开关是否关闭。

**Q: 切换推荐源后没变化？**
来源选择保存在浏览器 localStorage，切换后立即生效；若被浏览器策略清除存储则回到默认。

**Q: 影视榜单加载失败？**
多为官方 60s 公共实例限流或被墙。可在服务端配置 `60S_API_BASE` 指向自部署实例或社区镜像后重启。
