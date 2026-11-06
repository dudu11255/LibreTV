'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { DetailModal } from '@/components/detail-modal';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { useSelectedSources } from '@/components/use-selected-sources';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { SiteFooter } from '@/components/site-footer';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { SearchResultItem } from '@/lib/types';

/**
 * 分类浏览页：把各采集站的 type 树归并成统一大类后按类目翻页。
 *
 * 与搜索页的分工——搜索解决「知道片名」，分类解决「不知道看什么」。
 * 大类/子类写在 URL 上（?g=电影&t=动作片），可后退、可分享、刷新保持。
 */

/** 首屏渲染的卡片数：一次挂载几百张卡会明显掉帧，滚到底再追加 */
const RESULT_PAGE_SIZE = 60;

/** 子分类默认最多显示几个：电影大类常有近二十个子类，全铺开会占掉首屏 */
const SUB_CHIP_LIMIT = 12;

export default function CategoryPage() {
  return (
    <Suspense>
      <CategoryContent />
    </Suspense>
  );
}

function CategoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sources, sourceName } = useSelectedSources();
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);

  const urlGenre = searchParams.get('g') || '';
  const urlSub = searchParams.get('t') || '';
  // 源集合变化时必须重新取分类树：不同源的分类树完全不同
  const sourceUrls = sources.map((s) => s.url).join('|');

  const treeQuery = useQuery({
    queryKey: ['category-tree', sourceUrls, yellowFilter],
    queryFn: ({ signal }) => api.categoryTree(sources, yellowFilter, signal),
    enabled: sources.length > 0,
    // 源站分类极少改动，且服务端另有 30 分钟缓存
    staleTime: 10 * 60_000,
  });

  const genres = treeQuery.data?.genres ?? [];
  // URL 里的分类可能已不存在（源站下线该分类 / 换了源）：回落到第一个可用大类
  const activeGenre = genres.find((g) => g.name === urlGenre) ?? genres[0];
  const activeSub = urlSub && activeGenre?.subs.some((s) => s.name === urlSub) ? urlSub : undefined;

  const listQuery = useInfiniteQuery({
    queryKey: ['category-list', activeGenre?.name ?? '', activeSub ?? '', sourceUrls, yellowFilter],
    queryFn: ({ pageParam, signal }) =>
      api.categoryList(
        { sources, genre: activeGenre!.name, sub: activeSub, page: pageParam, filterAdult: yellowFilter },
        signal
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: Boolean(activeGenre) && sources.length > 0,
    staleTime: 5 * 60_000,
  });

  const pages = listQuery.data?.pages;
  const list = useMemo(() => (pages ?? []).flatMap((p) => p.list), [pages]);
  const groups = useMemo(() => aggregateResults(list), [list]);

  // 失败源按 key 去重：翻了几页后同一个源会重复出现
  const failures = useMemo(() => {
    const seen = new Map<string, { sourceKey: string; error: string; timedOut?: boolean }>();
    for (const page of pages ?? []) {
      for (const f of page.failures) if (!seen.has(f.sourceKey)) seen.set(f.sourceKey, f);
    }
    return [...seen.values()];
  }, [pages]);

  const usedSources = pages?.[0]?.usedSources ?? 0;

  // 换分类（或换源）时回到首批；追加分页不能重置，否则「加载更多」会把自己弹回去
  const listKey = `${activeGenre?.name ?? ''}|${activeSub ?? ''}|${sourceUrls}|${yellowFilter}`;
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const [showAllSubs, setShowAllSubs] = useState(false);
  useEffect(() => {
    setVisibleCount(RESULT_PAGE_SIZE);
    setShowAllSubs(false);
  }, [listKey]);

  const visibleGroups = groups.slice(0, visibleCount);
  const remaining = groups.length - visibleCount;

  // 当前子分类排在折叠区外时必须展开，否则选中的标签会「消失」
  const subs = activeGenre?.subs ?? [];
  const activeSubIndex = subs.findIndex((s) => s.name === activeSub);
  const subsExpanded = showAllSubs || activeSubIndex >= SUB_CHIP_LIMIT;
  const visibleSubs = subsExpanded ? subs : subs.slice(0, SUB_CHIP_LIMIT);
  const hiddenSubCount = subs.length - visibleSubs.length;

  const go = (genre: string, sub?: string) => {
    const params = new URLSearchParams({ g: genre });
    if (sub) params.set('t', sub);
    router.replace(`/category?${params.toString()}`, { scroll: false });
  };

  const showMore = () => {
    // 先把已经取回来的条目显示完，再向源站要下一页：切分类时一页就是几百条
    if (remaining > 0) setVisibleCount((v) => v + RESULT_PAGE_SIZE);
    else if (listQuery.hasNextPage) void listQuery.fetchNextPage();
  };

  const isFirstLoading = listQuery.isPending && Boolean(activeGenre);

  return (
    <div className="min-h-screen flex flex-col">
      <Header showSearch />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h1 className="text-lg font-semibold text-content">分类浏览</h1>
          {sources.length > 0 && (
            <span className="text-xs text-faint shrink-0">来自 {sources.length} 个点播源</span>
          )}
        </div>

        {sources.length === 0 ? (
          <EmptyState
            icon="filter"
            title="尚未选择点播源"
            description="点击右上角「设置」勾选要参与分类浏览的点播源，或在设置中添加一个 Apple CMS 采集站。"
            className="!py-16"
          />
        ) : treeQuery.isLoading ? (
          <LoadingState label="正在读取各源的分类…" />
        ) : treeQuery.isError ? (
          <ErrorState
            message={treeQuery.error instanceof Error ? treeQuery.error.message : '分类读取失败'}
            onRetry={() => void treeQuery.refetch()}
          />
        ) : genres.length === 0 ? (
          <EmptyState
            icon="filter"
            title="所选源都没有提供分类"
            description="部分采集站关闭了分类接口，可以换一个点播源，或直接用搜索找片。"
            className="!py-16"
          />
        ) : (
          <>
            {/* 大类 */}
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {genres.map((g) => (
                <Chip
                  key={g.name}
                  active={g.name === activeGenre?.name}
                  onClick={() => go(g.name)}
                  title={`${g.sources} 个源提供该分类`}
                >
                  {g.name}
                </Chip>
              ))}
            </div>

            {/* 子分类：只有一个「全部」时整行没有意义，直接省略 */}
            {activeGenre && subs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Chip active={!activeSub} onClick={() => go(activeGenre.name)}>
                  全部
                </Chip>
                {visibleSubs.map((s) => (
                  <Chip
                    key={s.name}
                    active={s.name === activeSub}
                    onClick={() => go(activeGenre.name, s.name)}
                    title={`${s.count} 个源提供该分类`}
                  >
                    {s.name}
                  </Chip>
                ))}
                {hiddenSubCount > 0 && (
                  <button
                    className="px-2.5 py-1 rounded-full text-xs text-accent hover:bg-accent/10 transition-colors"
                    onClick={() => setShowAllSubs(true)}
                  >
                    +{hiddenSubCount} 个分类
                  </button>
                )}
                {showAllSubs && subs.length > SUB_CHIP_LIMIT && (
                  <button
                    className="px-2.5 py-1 rounded-full text-xs text-faint hover:text-content hover:bg-hover transition-colors"
                    onClick={() => setShowAllSubs(false)}
                  >
                    收起
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 mb-3 text-xs text-faint">
              <span>
                {activeGenre?.name}
                {activeSub ? ` · ${activeSub}` : ''}
                {usedSources > 0 && `（${usedSources} 个源有该分类）`}
              </span>
              {listQuery.isFetching && <span>加载中…</span>}
            </div>

            {failures.length > 0 && (
              <div className="mb-3 text-xs bg-chip rounded-lg px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-faint">部分点播源请求失败：</span>
                {failures.map((f) => (
                  <span key={f.sourceKey} className={f.timedOut ? 'text-warning' : 'text-faint'}>
                    ✗ {sourceName(f.sourceKey)}
                  </span>
                ))}
              </div>
            )}

            {isFirstLoading ? (
              <ResultsSkeleton />
            ) : listQuery.isError ? (
              <ErrorState
                message={listQuery.error instanceof Error ? listQuery.error.message : '分类内容加载失败'}
                onRetry={() => void listQuery.refetch()}
              />
            ) : groups.length === 0 ? (
              <EmptyState
                icon="filter"
                title="该分类暂无内容"
                description={
                  usedSources === 0
                    ? '所选源都没有这个分类，换一个点播源或切换到其他大类再试。'
                    : '这个分类在所选源里暂时是空的，过段时间再来看看。'
                }
                className="!py-16"
              />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {visibleGroups.map((group) => (
                    <AggregatedCard
                      key={group.key}
                      group={group}
                      sources={sources}
                      onOpen={(item) => setDetailItem(item)}
                    />
                  ))}
                </div>
                {(remaining > 0 || listQuery.hasNextPage) && (
                  <div className="flex justify-center mt-4">
                    <button className="btn-ghost btn-sm" onClick={showMore} disabled={listQuery.isFetching}>
                      {remaining > 0
                        ? `显示更多（还有 ${remaining} 部）`
                        : listQuery.isFetching
                          ? '加载中…'
                          : '加载下一页'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <SiteFooter />

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        // 结构对齐真实结果卡（左侧缩略图 + 右侧文字块），避免占位与真实卡片形状不符
        <div key={i} className="card flex h-28 overflow-hidden">
          <div className="w-[105px] sm:w-[120px] shrink-0 bg-chip animate-pulse" />
          <div className="flex-1 p-2.5 space-y-2">
            <div className="h-4 w-3/4 rounded bg-chip animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-chip animate-pulse" />
            <div className="h-3 w-full rounded bg-chip animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
