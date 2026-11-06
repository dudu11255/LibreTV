import { isAdultContent } from './cms-parser';
import type { CategoryGenre, CmsClass, SourceCategoryOutcome } from './types';

/**
 * 视频分类：把各采集站（Apple CMS）五花八门的 type 树归并成一套统一的大类。
 *
 * 各源命名差异极大——同一部电影，暴风叫「电影片/动作片」，360 叫「电影/动作片」，
 * 有的源干脆全扁平（type_pid 全为 0）。因此不依赖 type_pid 的父子关系，
 * 而是按分类名归入固定大类；父子关系只用来判断「哪些 type 是真正能取到内容的叶子」。
 */

/** 大类的固定展示顺序（与主流影视站的导航一致） */
export const GENRE_ORDER = ['电影', '电视剧', '综艺', '动漫', '纪录片', '短剧', '其他'] as const;
export type Genre = (typeof GENRE_ORDER)[number];

/**
 * 与大类同义的「容器名」：这类名字作为子分类标签没有信息量
 * （大类「电影」下的子分类如果叫「电影片」，等于重复了一遍大类名）。
 */
const GENERIC_BY_GENRE: Record<Genre, string[]> = {
  电影: ['电影', '电影片', '影片', '影院'],
  电视剧: ['电视剧', '连续剧', '剧集', '电视连续剧'],
  综艺: ['综艺', '综艺片'],
  动漫: ['动漫', '动漫片', '动画', '番剧'],
  纪录片: ['纪录片', '记录片', '记录'],
  短剧: ['短剧', '短剧大全', '微短剧'],
  其他: ['其他'],
};

/**
 * 分类名 → 大类；判不出时返回 undefined，由调用方决定是否继承父分类。
 *
 * 两个要点：
 * 1. 判定顺序即优先级。「电影解说」不能被「电影」吃掉、「动画片」属于动漫而非电影、
 *    「纪录片」在「片」之前；「片」必须排在「剧」之前——喜剧片、剧情片都含「剧」字，
 *    但它们是电影，而只叫「连续剧」「国产剧」的不含「片」，落到后面的「剧」规则仍然正确。
 * 2. 「解说/预告」返回的是「其他」而不是 undefined：同一部「预告片」，在 A 源是顶级分类、
 *    在 B 源挂在电影下，若两者都走继承，同一个分类名就会同时出现在两个大类里。
 *    「其他」只留给真正没命中任何规则的名字。
 */
function matchGenre(name: string): Genre | undefined {
  const n = name.trim();
  if (!n) return undefined;
  if (/解说|预告|花絮|周边|混剪/.test(n)) return '其他';
  if (/短剧|微剧/.test(n)) return '短剧';
  if (/动漫|动画|番剧|漫剧|卡通/.test(n)) return '动漫';
  if (/综艺/.test(n)) return '综艺';
  if (/纪录|记录/.test(n)) return '纪录片';
  if (/电影|片|影院/.test(n)) return '电影';
  if (/剧/.test(n)) return '电视剧';
  return undefined;
}

/** 分类名 → 大类（判不出时按「其他」处理） */
export function classifyGenre(name: string): Genre {
  return matchGenre(name) ?? '其他';
}

function isGenericName(name: string, genre: Genre): boolean {
  return GENERIC_BY_GENRE[genre].includes(name.trim());
}

/**
 * 为一棵分类树算大类，支持「子分类继承父分类」。
 *
 * 采集站的子分类经常只用题材命名、不含任何类型关键词——「短剧大全」下面是
 * 「重生民国」「穿越年代」「女恋总裁」，单看名字只能归到「其他」。
 * 因此自己判不出大类的节点，向上找父节点的大类；父节点本身是「其他」就不继承。
 */
export function classifyClasses(classes: CmsClass[]): Map<string, Genre> {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const memo = new Map<string, Genre>();

  const resolve = (cls: CmsClass, depth = 0): Genre => {
    const cached = memo.get(cls.id);
    if (cached) return cached;
    // 先占位，防止脏数据里的环（父指向子）导致无限递归
    memo.set(cls.id, '其他');
    let genre: Genre = '其他';
    const own = matchGenre(cls.name);
    if (own !== undefined) {
      genre = own;
    } else if (cls.pid !== '0' && depth < 5) {
      const parent = byId.get(cls.pid);
      if (parent) {
        const parentGenre = resolve(parent, depth + 1);
        if (parentGenre !== '其他') genre = parentGenre;
      }
    }
    memo.set(cls.id, genre);
    return genre;
  };

  for (const cls of classes) resolve(cls);
  return memo;
}

/**
 * 归并各源分类树：大类顺序固定，子分类按「有多少个源提供」降序。
 * filterAdult 打开时成人分类整类丢弃——否则「理论片」这类目录会直接出现在分类导航里。
 */
export function buildGenreSummary(
  outcomes: SourceCategoryOutcome[],
  opts: { filterAdult?: boolean } = {}
): CategoryGenre[] {
  const filterAdult = opts.filterAdult !== false;
  const acc = new Map<Genre, { sources: Set<string>; types: Set<string>; subs: Map<string, Set<string>> }>();

  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    const genres = classifyClasses(outcome.classes);
    for (const cls of outcome.classes) {
      if (filterAdult && isAdultContent(cls.name)) continue;
      const genre = genres.get(cls.id) ?? '其他';
      let entry = acc.get(genre);
      if (!entry) {
        entry = { sources: new Set(), types: new Set(), subs: new Map() };
        acc.set(genre, entry);
      }
      entry.sources.add(outcome.sourceKey);
      // 跨源同名分类只算一次：这个数字要表达「该大类下有多少个分类」，
      // 而不是「所有源加起来有多少个 type 节点」
      entry.types.add(cls.name);
      if (!isGenericName(cls.name, genre)) {
        if (!entry.subs.has(cls.name)) entry.subs.set(cls.name, new Set());
        entry.subs.get(cls.name)!.add(outcome.sourceKey);
      }
    }
  }

  return GENRE_ORDER.filter((genre) => acc.has(genre)).map((genre) => {
    const entry = acc.get(genre)!;
    return {
      name: genre,
      sources: entry.sources.size,
      types: entry.types.size,
      subs: [...entry.subs.entries()]
        .map(([name, set]) => ({ name, count: set.size }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN')),
    };
  });
}

/**
 * 叶子分类 = 没有任何子节点的 type。
 *
 * 采集站的父分类基本是空壳（暴风「电影片」只有 14 条，而它的七个子分类各有数千条），
 * 直接按父 type_id 取列表会得到一个几乎空白的页面，所以「全部」必须下沉到叶子再合并。
 */
function leavesOf(all: CmsClass[], candidates: CmsClass[]): CmsClass[] {
  const ids = new Set(all.map((c) => c.id));
  const parents = new Set(all.map((c) => c.pid).filter((pid) => ids.has(pid)));
  const leaves = candidates.filter((c) => !parents.has(c.id));
  // 完全扁平的源没有父子关系，此时叶子就是全部候选
  return leaves.length > 0 ? leaves : candidates;
}

/**
 * 解析「某源 + 大类 + 子类」应请求的 type_id 列表。
 * 未指定子类时返回该大类下所有叶子，用于「全部」的合并浏览。
 */
export function resolveTypeTargets(
  classes: CmsClass[],
  genre: string,
  sub?: string,
  opts: { maxTypes?: number; filterAdult?: boolean } = {}
): string[] {
  const filterAdult = opts.filterAdult !== false;
  const genres = classifyClasses(classes);
  const usable = filterAdult ? classes.filter((c) => !isAdultContent(c.name)) : classes;
  const inGenre = usable.filter((c) => genres.get(c.id) === genre);
  const picked = sub ? inGenre.filter((c) => c.name === sub) : leavesOf(usable, inGenre);
  const maxTypes = opts.maxTypes ?? 12;
  return [...new Set(picked.map((c) => c.id))].slice(0, maxTypes);
}

/**
 * 多桶轮流取一。
 * 「全部」时每个源要合并十来个叶子分类的结果，直接拼接会让整屏都是「动作片」，
 * 轮流取一能把子类与源都打散，首屏的题材/来源分布才自然。
 */
export function interleave<T>(buckets: T[][]): T[] {
  const out: T[] = [];
  const max = buckets.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < max; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) out.push(bucket[i]);
    }
  }
  return out;
}

// —— 年份筛选 ——

/**
 * 年份筛选不是本站自己过滤的：`ac=list` 的响应里**不带** `vod_year`
 * （只有标题/封面/备注/分类名），拿到手再筛等于筛空气。
 * 因此年份只能作为参数交给源站：MacCMS 的 vod 接口支持 `year=` 单值查询，
 * 带上后 total / pagecount 都会按该年份收窄，分页才仍然是对的。
 */

/** 当前年份（分类页的年份选项以此为上界） */
export function currentYear(now: Date = new Date()): number {
  return now.getFullYear();
}

/**
 * 年份筛选值归一化：只接受单个四位年份，其余（空串、「全部」、区间、越界）一律
 * 当作「不筛选」。宁可退化成看全部，也不要给源站发一个它读不懂的值——那种情况下
 * 源站多半直接忽略参数，用户看到的就是「筛了等于没筛」。
 */
export function normalizeYearFilter(input: unknown, now: Date = new Date()): number | undefined {
  const raw =
    typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : '';
  if (!/^\d{4}$/.test(raw)) return undefined;
  const year = Number(raw);
  // 上界放到次年：源站常提前上架明年的片子
  if (year < 1900 || year > currentYear(now) + 1) return undefined;
  return year;
}

/** 年份筛选条的可选年份：从当年往回数 span 个（含当年） */
export function buildYearOptions(now: Date = new Date(), span = 12): number[] {
  const top = currentYear(now);
  return Array.from({ length: Math.max(1, span) }, (_, i) => top - i);
}

