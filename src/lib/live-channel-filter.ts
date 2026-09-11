/**
 * 直播频道侧栏的筛选/排序纯逻辑（便于单测，组件只负责渲染）。
 * 抽取自 live-channel-list.tsx，避免筛选语义散落在 JSX 里。
 */

export type LiveSortMode = 'default' | 'name' | 'group' | 'probe' | 'recent';

/** 可用性筛选档位：off=不过滤；ok=包含弱验证/超时（琥珀）；green=仅分片级验证通过 */
export type AliveFilter = 'off' | 'ok' | 'green';

export interface ProbeView {
  ok: boolean;
  level?: 'segment' | 'manifest' | 'head';
  ms?: number;
  timedOut?: boolean;
  error?: string;
}

/** 筛选/排序所需的最小频道字段（LiveChannel 结构上满足即可） */
export interface FilterableChannel {
  name: string;
  url: string;
  group?: string;
  tvgId?: string;
}

/** 搜索归一化：小写并去掉空白与常见分隔符，让 "cctv1" 能命中 "CCTV-1"、"东方-卫视" 命中 "东方卫视" */
export function normalizeForSearch(input: string): string {
  return input.toLowerCase().replace(/[\s\-_./·|+()（）【】[\]]/g, '');
}

/** 关键字匹配：频道名、tvg-id、分组名（均做归一化，分组名也参与匹配） */
export function matchesKeyword(
  channel: Pick<FilterableChannel, 'name' | 'tvgId' | 'group'>,
  keyword: string
): boolean {
  const kw = normalizeForSearch(keyword);
  if (!kw) return true;
  return (
    normalizeForSearch(channel.name).includes(kw) ||
    normalizeForSearch(channel.tvgId || '').includes(kw) ||
    normalizeForSearch(channel.group || '').includes(kw)
  );
}

/** 可用性判定 */
export function matchesAlive(probe: ProbeView | undefined, mode: AliveFilter): boolean {
  if (mode === 'off') return true;
  if (!probe) return false;
  if (mode === 'green') return probe.ok && probe.level === 'segment';
  return probe.ok; // ok=绿 + 琥珀（弱验证 / 超时）
}

/** 测活结果的排序权重：绿点（分片级）最优，其次弱验证、超时、失败、未测 */
function probeRank(probe: ProbeView | undefined): number {
  if (!probe) return 4;
  if (probe.ok) return probe.level === 'segment' ? 0 : 1;
  return probe.timedOut ? 2 : 3;
}

/** 按当前可见列表统计各分组的频道数 */
export function countGroups(list: Pick<FilterableChannel, 'group'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of list) {
    if (!c.group) continue;
    counts.set(c.group, (counts.get(c.group) ?? 0) + 1);
  }
  return counts;
}

/** 统计可用数：green 仅分片级；ok 含琥珀 */
export function countAlive(
  list: Pick<FilterableChannel, 'url'>[],
  probeOf: (url: string) => ProbeView | undefined
): { green: number; ok: number } {
  let green = 0;
  let ok = 0;
  for (const c of list) {
    const probe = probeOf(c.url);
    if (!probe?.ok) continue;
    ok++;
    if (probe.level === 'segment') green++;
  }
  return { green, ok };
}

/**
 * 排序：default 保持传入顺序（源顺序 / 最近观看顺序）；
 * probe 为"可用优先 + 分片耗时升序"，让能播且快的排前面。
 */
export function sortChannels<T extends FilterableChannel>(
  list: T[],
  mode: LiveSortMode,
  probeOf: (url: string) => ProbeView | undefined,
  recentOrder: Map<string, number>
): T[] {
  if (mode === 'default') return list;
  const copy = [...list];
  switch (mode) {
    case 'name':
      copy.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      break;
    case 'group':
      copy.sort(
        (a, b) =>
          (a.group || '').localeCompare(b.group || '', 'zh') || a.name.localeCompare(b.name, 'zh')
      );
      break;
    case 'probe':
      copy.sort((a, b) => {
        const pa = probeOf(a.url);
        const pb = probeOf(b.url);
        return (
          probeRank(pa) - probeRank(pb) ||
          (pa?.ms ?? Number.MAX_SAFE_INTEGER) - (pb?.ms ?? Number.MAX_SAFE_INTEGER)
        );
      });
      break;
    case 'recent':
      copy.sort(
        (a, b) =>
          (recentOrder.get(a.url) ?? Number.MAX_SAFE_INTEGER) -
          (recentOrder.get(b.url) ?? Number.MAX_SAFE_INTEGER)
      );
      break;
  }
  return copy;
}
