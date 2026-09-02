'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from './video-card';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

/** 豆瓣推荐区：影视切换 + 标签筛选 + 分页加载 */
export function DoubanSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');
  const [visibleCount, setVisibleCount] = useState(25);

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  if (!doubanEnabled) return null;

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];
  const shown = items.slice(0, visibleCount);

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag(t === 'movie' ? '热门' : '热门');
    setVisibleCount(25);
  };

  return (
    <section aria-label="豆瓣推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {tags.map((t) => (
          <button
            key={t}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              t === tag ? 'bg-accent text-white' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => {
              setTag(t);
              setVisibleCount(25);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">豆瓣推荐加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
              <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
            {shown.map((item) => (
              <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
            ))}
          </div>
          {visibleCount < items.length && (
            <div className="text-center mt-4">
              <button className="btn-ghost" onClick={() => setVisibleCount((v) => v + 25)}>
                加载更多
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-white' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
