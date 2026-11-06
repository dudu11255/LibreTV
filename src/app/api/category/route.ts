import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { buildGenreSummary, interleave, resolveTypeTargets } from '@/lib/category';
import { cmsRequestHeaders, filterAdultResults, parseClassList, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type {
  CategoryListResponse,
  CategoryTreeResponse,
  CmsClass,
  SearchResultItem,
  SourceCategoryOutcome,
  SourceConfig,
} from '@/lib/types';

export const runtime = 'nodejs';

/** 分类树极少变动：缓存 30 分钟，避免每次进分类页都把每个源重新打一遍 */
const CLASSES_CACHE_TTL = 30 * 60 * 1000;
/** 列表缓存：翻页往返/切换大类再切回来时命中，短 TTL 只为挡住重复点击 */
const LIST_CACHE_TTL = 2 * 60 * 1000;

const UPSTREAM_TIMEOUT_MS = 8000;
/** 每个源单页最多合并的叶子分类数：十几个叶子全打一遍既慢又没必要 */
const MAX_FANOUT = 10;
const MAX_SOURCES = 50;
const MAX_PAGE = 200;

interface CategoryBody {
  action?: 'tree' | 'list';
  sources: SourceConfig[];
  /** 大类（电影 / 电视剧 / …），action=list 时必填 */
  genre?: string;
  /** 子分类名，缺省表示「全部」 */
  sub?: string;
  page?: number;
  filterAdult?: boolean;
}

/**
 * 取某源的分类树。
 *
 * 用 `ac=list` 而不是 `ac=videolist`：分类浏览只需要封面/标题/年份，
 * 后者会附带每条影片的完整播放地址，单页体积是前者的十倍以上。
 */
async function loadClasses(source: SourceConfig): Promise<CmsClass[]> {
  const cacheKey = `category-classes:${source.url.replace(/\/+$/, '')}`;
  const cached = getCache<CmsClass[]>(cacheKey);
  if (cached) return cached;

  const base = source.url.replace(/\/+$/, '');
  const res = await fetchUpstream(`${base}?ac=list`, {
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    headers: cmsRequestHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const classes = parseClassList(await res.json());
  if (classes.length === 0) throw new Error('该源未返回分类');
  setCache(cacheKey, classes, CLASSES_CACHE_TTL);
  return classes;
}

interface TypePage {
  list: SearchResultItem[];
  /** 该分类的总页数 */
  pageCount: number;
}

/** 按分类取一页列表 */
async function fetchTypePage(source: SourceConfig, typeId: string, page: number): Promise<TypePage> {
  const base = source.url.replace(/\/+$/, '');
  const params = new URLSearchParams({ ac: 'list', pg: String(page) });
  if (typeId) params.set('t', typeId);
  const res = await fetchUpstream(`${base}?${params.toString()}`, {
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    headers: cmsRequestHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { pagecount?: unknown };
  const raw = parseInt(String(data.pagecount ?? '1'), 10);
  return {
    list: parseSearchList(data, source),
    pageCount: Number.isFinite(raw) ? Math.max(1, raw) : 1,
  };
}

/** 分类树：并行拉取各源 class，单源失败不影响整体 */
async function handleTree(sources: SourceConfig[], filterAdult: boolean): Promise<CategoryTreeResponse> {
  const outcomes = await Promise.all(
    sources.map(async (source): Promise<SourceCategoryOutcome> => {
      const base = { sourceKey: source.key, sourceName: source.name };
      const verdict = await checkUpstreamAllowed(source.url);
      if (!verdict.ok) return { ...base, ok: false, error: verdict.reason, classes: [] };
      try {
        return { ...base, ok: true, classes: await loadClasses(source) };
      } catch (err) {
        return {
          ...base,
          ok: false,
          error: err instanceof Error ? err.message : '请求失败',
          classes: [],
        };
      }
    })
  );
  return { sources: outcomes, genres: buildGenreSummary(outcomes, { filterAdult }) };
}

/**
 * 分类列表：每个源把「大类 → 叶子 type_id」展开后并行取同一页，再合并。
 *
 * 采集站的父分类基本是空壳（「电影片」只有 14 条，它的子分类各有数千条），
 * 所以「全部」会下沉到叶子分类逐个取，用 interleave 打散后合并，
 * 首屏才不会整屏都是同一个子类、同一个源。
 */
async function handleList(
  sources: SourceConfig[],
  genre: string,
  sub: string | undefined,
  page: number,
  filterAdult: boolean
): Promise<CategoryListResponse> {
  type SourceResult = {
    sourceKey: string;
    ok: boolean;
    error?: string;
    buckets: SearchResultItem[][];
    hasMore: boolean;
    used: boolean;
  };

  const results = await Promise.all(
    sources.map(async (source): Promise<SourceResult> => {
      const base: SourceResult = { sourceKey: source.key, ok: true, buckets: [], hasMore: false, used: false };
      const verdict = await checkUpstreamAllowed(source.url);
      if (!verdict.ok) return { ...base, ok: false, error: verdict.reason };

      let targets: string[];
      try {
        targets = resolveTypeTargets(await loadClasses(source), genre, sub, {
          maxTypes: MAX_FANOUT,
          filterAdult,
        });
      } catch (err) {
        return { ...base, ok: false, error: err instanceof Error ? err.message : '请求失败' };
      }
      // 该源没有这个分类（例如只提供电影、不提供纪录片）：静默跳过，不算失败
      if (targets.length === 0) return base;

      const settled = await Promise.allSettled(targets.map((typeId) => fetchTypePage(source, typeId, page)));
      const buckets: SearchResultItem[][] = [];
      let hasMore = false;
      let error: string | undefined;
      for (const item of settled) {
        if (item.status === 'fulfilled') {
          if (item.value.list.length > 0) buckets.push(item.value.list);
          if (item.value.pageCount > page) hasMore = true;
        } else {
          error = item.reason instanceof Error ? item.reason.message : '请求失败';
        }
      }
      // 全部子分类都失败才算这个源失败；部分成功时仍展示拿到的结果
      if (buckets.length === 0 && error) return { ...base, ok: false, error };
      return { ...base, buckets, hasMore, used: true };
    })
  );

  const seen = new Set<string>();
  let list = interleave(results.flatMap((r) => r.buckets)).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  list = filterAdultResults(list, filterAdult);

  return {
    list,
    failures: results
      .filter((r) => !r.ok)
      .map((r) => ({ sourceKey: r.sourceKey, error: r.error || '请求失败' })),
    page,
    hasMore: results.some((r) => r.used && r.hasMore),
    usedSources: results.filter((r) => r.used).length,
  };
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: CategoryBody;
  try {
    body = (await req.json()) as CategoryBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return NextResponse.json({ error: '请至少选择一个点播源' }, { status: 400 });
  }
  const sources = body.sources
    .slice(0, MAX_SOURCES)
    .filter((s) => typeof s?.url === 'string' && /^https?:\/\//.test(s.url));
  if (sources.length === 0) {
    return NextResponse.json({ error: '没有可用的点播源地址' }, { status: 400 });
  }

  if (body.action === 'tree') {
    return NextResponse.json(await handleTree(sources, body.filterAdult !== false));
  }

  const genre = (body.genre || '').trim().slice(0, 30);
  if (!genre) {
    return NextResponse.json({ error: '缺少分类参数' }, { status: 400 });
  }
  const sub = (body.sub || '').trim().slice(0, 30) || undefined;
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(body.page) || 1)));
  const filterAdult = body.filterAdult !== false;

  const cacheKey = `category-list:${sources
    .map((s) => s.url.replace(/\/+$/, ''))
    .sort()
    .join('|')}\n${genre}\n${sub ?? ''}\n${page}\n${filterAdult ? 1 : 0}`;
  const cached = getCache<CategoryListResponse>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const payload = await handleList(sources, genre, sub, page, filterAdult);
  setCache(cacheKey, payload, LIST_CACHE_TTL);
  return NextResponse.json(payload);
}
