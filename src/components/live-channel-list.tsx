'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildImageUrl, cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  countAlive,
  countGroups,
  matchesAlive,
  matchesKeyword,
  sortChannels,
  type AliveFilter,
  type LiveSortMode,
  type ProbeView,
} from '@/lib/live-channel-filter';
import { useLiveProbe, type ProbeResult } from './use-live-probe';
import type { LiveChannel } from '@/lib/types';

/**
 * 直播频道侧栏：全部/收藏/最近三个视图 + 分组标签条 + 关键字搜索 + 排序 + 可用性筛选。
 *
 * 筛选语义（四层可叠加，界面始终显示"显示 N / 共 M"并可一键重置）：
 *   视图（全部/收藏/最近） → 分组 → 关键字（频道名/tvg-id/分组名，忽略空格分隔符） → 可用性
 * - 分组标签条在「全部」「收藏」视图都显示（避免筛选状态不可见）；
 * - 可用性两档：仅绿点（分片级验证通过）/ 含琥珀（弱验证、超时）；
 * - 列表渐进渲染 + 滚动到底自动续载；支持 ↑↓ 换台、Enter 播放。
 */

const PAGE_SIZE = 300;

export interface LiveChannelItem extends LiveChannel {
  /** 来源订阅的 EPG 地址（用于节目单查询） */
  epg?: string;
  /** 所属直播源地址（M3U 订阅 URL），写入最近观看以便订阅删除时清理 */
  sourceUrl?: string;
}

interface ChannelListProps {
  channels: LiveChannelItem[];
  groups: string[];
  currentUrl: string;
  onSelect: (channel: LiveChannelItem) => void;
}

type View = 'all' | 'fav' | 'recent';

const SORT_LABELS: Record<LiveSortMode, string> = {
  default: '默认',
  name: '名称',
  group: '分组',
  probe: '测活',
  recent: '最近观看',
};

export function LiveChannelList({ channels, groups, currentUrl, onSelect }: ChannelListProps) {
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const liveRecent = useAppStore((s) => s.liveRecent);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  const [view, setView] = useState<View>('all');
  const [group, setGroup] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<LiveSortMode>('default');
  const [alive, setAlive] = useState<AliveFilter>('off');
  const [limit, setLimit] = useState(PAGE_SIZE);
  // 键盘导航光标（-1 = 未启用），与"正在播放"的高亮互相独立
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { results: probeResults, progress: probeProgress, probe, clear: clearProbe, isProbing, hint: probeHint } = useLiveProbe();

  const favSet = useMemo(() => new Set(liveFavorites), [liveFavorites]);
  const recentOrder = useMemo(
    () => new Map(liveRecent.map((r, i) => [r.url, i] as const)),
    [liveRecent]
  );
  const probeOf = useCallback(
    (url: string): ProbeView | undefined => probeResults.get(url),
    [probeResults]
  );

  // 视图 → 基础列表（分组/关键字/可用性在之后叠加）
  const baseList = useMemo(() => {
    if (view === 'fav') return channels.filter((c) => favSet.has(c.url));
    if (view === 'recent') {
      return liveRecent
        .map((r) => channels.find((c) => c.url === r.url))
        .filter((c): c is LiveChannelItem => Boolean(c));
    }
    return channels;
  }, [channels, favSet, liveRecent, view]);

  // 分组计数基于"视图 + 关键字"过滤后的列表，保证数字与选择该项后的结果一致
  const groupCounts = useMemo(
    () => countGroups(keyword.trim() ? baseList.filter((c) => matchesKeyword(c, keyword)) : baseList),
    [baseList, keyword]
  );

  const filtered = useMemo(() => {
    let list = baseList;
    if (view !== 'recent' && group) list = list.filter((c) => c.group === group);
    if (keyword.trim()) list = list.filter((c) => matchesKeyword(c, keyword));
    if (alive !== 'off') list = list.filter((c) => matchesAlive(probeOf(c.url), alive));
    return sortChannels(list, sort, probeOf, recentOrder);
  }, [baseList, view, group, keyword, alive, sort, probeOf, recentOrder]);

  const aliveCounts = useMemo(() => countAlive(baseList, probeOf), [baseList, probeOf]);

  // 切换筛选/排序时重置渐进渲染并回到顶部
  useEffect(() => {
    setLimit(PAGE_SIZE);
    setCursor(-1);
    listRef.current?.scrollTo({ top: 0 });
  }, [view, group, keyword, alive, sort]);

  // 测活结果被清空时，可用性筛选同步复位，避免停留在"永远为空"的状态
  useEffect(() => {
    if (alive !== 'off' && probeResults.size === 0) setAlive('off');
  }, [alive, probeResults.size]);

  // 滚动到底自动续载（保留"加载更多"按钮作为兜底）
  useEffect(() => {
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target || filtered.length <= limit) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => Math.min(l + PAGE_SIZE, filtered.length));
        }
      },
      { root, rootMargin: '240px' }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [filtered.length, limit]);

  const visible = filtered.slice(0, limit);

  const scrollToUrl = (url: string) => {
    const root = listRef.current;
    if (!root) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(url) : url;
    root.querySelector(`[data-url="${escaped}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  // ↑↓ 换台、Enter 播放（电视/遥控场景）
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    if (filtered.length === 0) return;
    if (e.key === 'Enter') {
      if (cursor >= 0 && filtered[cursor]) {
        e.preventDefault();
        onSelect(filtered[cursor]);
      }
      return;
    }
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const next = cursor < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, cursor + delta));
    setCursor(next);
    if (next >= limit) setLimit(Math.min(next + 1, filtered.length));
    scrollToUrl(filtered[next].url);
  };

  const filterActive = group !== '' || keyword.trim() !== '' || alive !== 'off';
  const resetFilters = () => {
    setGroup('');
    setKeyword('');
    setAlive('off');
    setSort('default');
  };

  const emptyText = (() => {
    if (view === 'fav') return '暂无收藏频道，点击频道右侧星标即可收藏';
    if (view === 'recent') return '暂无观看记录';
    if (channels.length === 0) return '暂无频道，请先在设置中添加直播源';
    if (alive !== 'off' && aliveCounts.ok === 0) return '没有探测到可用频道，可「清除结果」后重试';
    if (filterActive) return '没有匹配的频道，可重置筛选条件';
    return '没有匹配的频道';
  })();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 视图 tab */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-line shrink-0">
        {(
          [
            ['all', `全部${channels.length ? ` ${channels.length}` : ''}`],
            ['fav', `收藏${liveFavorites.length ? ` ${liveFavorites.length}` : ''}`],
            ['recent', '最近'],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs transition-colors',
              view === v ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-faint tabular-nums whitespace-nowrap">
          显示 {filtered.length}/{baseList.length}
        </span>
      </div>

      {/* 搜索框（归一化匹配频道名 / tvg-id / 分组名） */}
      <div className="px-3 py-2 shrink-0 relative">
        <input
          className="input w-full !py-1.5 text-xs !pr-7"
          placeholder="搜索频道 / tvg-id / 分组..."
          value={keyword}
          maxLength={60}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              listRef.current?.focus();
            }
          }}
        />
        {keyword && (
          <button
            className="absolute right-5 top-1/2 -translate-y-1/2 text-faint hover:text-content text-xs"
            aria-label="清空搜索"
            title="清空搜索"
            onClick={() => setKeyword('')}
          >
            ✕
          </button>
        )}
      </div>

      {/* 工具条：测活 / 排序 / 可用性筛选 */}
      <div className="flex items-center gap-1.5 px-3 pb-2 shrink-0 flex-wrap">
        <button
          className="btn-ghost !py-1 !px-2 text-xs"
          disabled={isProbing || filtered.length === 0}
          onClick={() => void probe(filtered)}
          title="探测当前列表频道是否可播（分片级校验，每批 50 条并发，结果 6 小时内有效）"
        >
          ⚡ 测活
        </button>
        <select
          className="rounded border border-line bg-chip px-1 py-0.5 text-[10px] text-muted hover:text-content"
          value={sort}
          onChange={(e) => setSort(e.target.value as LiveSortMode)}
          title="排序方式（测活=可用优先且分片耗时升序；最近观看=按观看顺序）"
        >
          {(Object.keys(SORT_LABELS) as LiveSortMode[]).map((m) => (
            <option key={m} value={m}>
              排序：{SORT_LABELS[m]}
            </option>
          ))}
        </select>
        {isProbing && probeProgress && (
          <span className="text-[10px] text-faint">
            探测中 {probeProgress.done}/{probeProgress.total}
          </span>
        )}
        {probeHint && !isProbing && <span className="text-[10px] text-faint">{probeHint}</span>}
        {probeResults.size > 0 && !isProbing && (
          <>
            <button
              className={cn(
                'shrink-0 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-colors border',
                alive === 'green'
                  ? 'bg-green-500/15 text-green-600 border-green-500/40'
                  : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
              )}
              onClick={() => setAlive(alive === 'green' ? 'off' : 'green')}
              title="只显示分片级验证通过的频道（最可信）"
            >
              🟢 仅绿点 {aliveCounts.green}
            </button>
            <button
              className={cn(
                'shrink-0 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-colors border',
                alive === 'ok'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
              )}
              onClick={() => setAlive(alive === 'ok' ? 'off' : 'ok')}
              title="绿点 + 琥珀（弱验证 / 超时）"
            >
              可用（含琥珀）{aliveCounts.ok}
            </button>
            <button
              className="text-[10px] text-faint hover:text-content transition-colors"
              onClick={() => {
                clearProbe();
                setAlive('off');
              }}
            >
              清除结果
            </button>
          </>
        )}
        {(filterActive || sort !== 'default') && (
          <button
            className="text-[10px] text-faint hover:text-content transition-colors underline decoration-dotted"
            onClick={resetFilters}
          >
            重置筛选
          </button>
        )}
      </div>

      {/* 分组标签条：全部/收藏视图都显示（换行平铺 + 数量，避免横滑找不到） */}
      {view !== 'recent' && groups.length > 0 && (
        <div className="px-3 pb-2 shrink-0">
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto scrollbar-thin">
            <GroupChip
              active={!group}
              label={`全部分组 ${baseList.length}`}
              onClick={() => setGroup('')}
            />
            {groups.map((g) => (
              <GroupChip
                key={g}
                active={group === g}
                label={`${g} ${groupCounts.get(g) ?? 0}`}
                onClick={() => setGroup(g === group ? '' : g)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 频道列表（可聚焦：↑↓ 换台、Enter 播放） */}
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-2 outline-none"
        title="↑↓ 选择频道，Enter 播放"
      >
        {visible.length === 0 ? (
          <p className="text-center text-xs text-faint py-10">{emptyText}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((c, i) => (
              <ChannelRow
                key={c.url}
                channel={c}
                active={c.url === currentUrl}
                cursor={i === cursor}
                isFav={favSet.has(c.url)}
                probe={probeResults.get(c.url)}
                logoUrl={buildImageUrl(c.logo, imageProxyMode, customImageProxy)}
                onSelect={onSelect}
                onRemoveRecent={view === 'recent' ? removeRecent : undefined}
              />
            ))}
          </ul>
        )}
        {/* 无限滚动哨兵 */}
        <div ref={sentinelRef} className="h-1" />
        {filtered.length > limit && (
          <button
            className="btn-ghost w-full mt-2 !py-1.5 text-xs"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
          >
            加载更多（剩余 {filtered.length - limit}）
          </button>
        )}
      </div>
    </div>
  );
}

/** 从最近观看中移除单条（不订阅 store，点击时读取状态，避免整列表重渲染） */
function removeRecent(url: string) {
  useAppStore.getState().removeLiveRecent(url);
}

function GroupChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={cn(
        'shrink-0 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors border',
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-chip text-muted border-line hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

interface ChannelRowProps {
  channel: LiveChannelItem;
  active: boolean;
  /** 键盘光标所在行（与"正在播放"相互独立） */
  cursor: boolean;
  isFav: boolean;
  probe?: ProbeResult;
  logoUrl?: string;
  onSelect: (channel: LiveChannelItem) => void;
  /** 传入时显示"从最近观看移除"按钮 */
  onRemoveRecent?: (url: string) => void;
}

/** 行组件 memo 化：测活流式写回时只重渲染状态真正变化的行 */
const ChannelRow = memo(function ChannelRow({
  channel,
  active,
  cursor,
  isFav,
  probe,
  logoUrl,
  onSelect,
  onRemoveRecent,
}: ChannelRowProps) {
  const ref = useRef<HTMLLIElement>(null);

  // 当前播放项自动滚入视区
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // H.265/HEVC：国内 IPTV 常见，测活通过但 Chromium 内核通常无法软解
  const isHevc = Boolean(probe?.codec && /hvc1|hev1|hevc/i.test(probe.codec));
  // 状态点语义：绿=分片级验证通过；琥珀=仅弱验证（直链/清单级）或超时（源可能只是慢）；红=不可达
  const weakLevel = probe?.ok && probe.level !== 'segment';
  const amber = Boolean(probe && (weakLevel || (!probe.ok && probe.timedOut)));
  const dotClass = amber ? 'bg-amber-400' : probe?.ok ? 'bg-green-500' : 'bg-red-400';
  const levelText =
    probe?.level === 'segment'
      ? '分片可用'
      : probe?.level === 'head'
        ? '直链可达（未验证可播性）'
        : '播放列表可达（无分片，未验证可播）';
  const probeTitle = probe
    ? probe.ok
      ? `${levelText}${probe.ms != null && probe.level === 'segment' ? ` · 分片耗时 ${probe.ms}ms` : ''}${isHevc ? ' · H.265 编码，需 Edge/Safari' : ''}`
      : probe.timedOut
        ? `${probe.error || '探测超时'} · 源可能只是慢，可直接试播确认`
        : probe.error || '不可用'
    : undefined;

  return (
    <li ref={ref} data-url={channel.url}>
      <div
        role="button"
        tabIndex={-1}
        className={cn(
          'group flex items-center gap-2.5 px-2 py-2 rounded-md cursor-pointer transition-colors relative',
          active ? 'bg-accent/10' : 'hover:bg-hover',
          cursor && !active && 'ring-1 ring-accent/40 bg-hover'
        )}
        onClick={() => onSelect(channel)}
      >
        {/* 当前播放高亮竖条 */}
        <span
          className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full bg-accent transition-all duration-200',
            active ? 'h-5 opacity-100' : 'h-0 opacity-0'
          )}
        />
        {/* 台标 */}
        <div className="w-7 h-7 shrink-0 rounded bg-chip flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="w-full h-full object-contain"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
          ) : (
            <span className="text-[10px] text-faint">{channel.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {probe && (
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClass)} title={probeTitle} />
            )}
            <span className={cn('text-xs truncate', active ? 'text-accent font-medium' : 'text-content')}>
              {channel.name}
            </span>
            {isHevc && (
              <span
                className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-medium text-amber-500"
                title="H.265 编码：测活通过但 Chromium 内核通常无法解码，建议用 Edge/Safari"
              >
                H.265
              </span>
            )}
          </div>
          {channel.group && <div className="text-[10px] text-faint truncate">{channel.group}</div>}
        </div>
        {/* 最近观看：移除该条记录 */}
        {onRemoveRecent && (
          <button
            className="shrink-0 p-1 rounded text-faint/60 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-colors"
            aria-label="从最近观看移除"
            title="从最近观看移除"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRecent(channel.url);
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* 收藏星标（不订阅 store：点击时直接触发动作） */}
        <button
          className={cn(
            'shrink-0 p-1 rounded transition-transform active:scale-125',
            isFav ? 'text-amber-400' : 'text-faint/50 opacity-0 group-hover:opacity-100 hover:text-amber-400'
          )}
          aria-label={isFav ? '取消收藏' : '收藏'}
          title={isFav ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            useAppStore.getState().toggleLiveFavorite(channel.url);
          }}
        >
          <svg className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      </div>
    </li>
  );
});
