import { describe, expect, it } from 'vitest';
import {
  countAlive,
  countGroups,
  matchesAlive,
  matchesKeyword,
  normalizeForSearch,
  sortChannels,
  type ProbeView,
} from './live-channel-filter';

const ch = (name: string, url: string, group?: string, tvgId?: string) => ({ name, url, group, tvgId });

describe('normalizeForSearch / matchesKeyword', () => {
  it('忽略空白与分隔符，cctv1 可命中 CCTV-1', () => {
    expect(normalizeForSearch('CCTV-1 综合')).toBe('cctv1综合');
    expect(matchesKeyword(ch('CCTV-1 综合', 'u1'), 'cctv1')).toBe(true);
    expect(matchesKeyword(ch('CCTV-1 综合', 'u1'), 'cctv-1')).toBe(true);
  });

  it('匹配 tvg-id 与分组名', () => {
    const c = ch('浙江影视', 'u2', '浙江频道', 'zjys.cn');
    expect(matchesKeyword(c, 'zjys')).toBe(true);
    expect(matchesKeyword(c, '浙江频道')).toBe(true);
    expect(matchesKeyword(c, '不存在')).toBe(false);
  });

  it('空关键字命中所有', () => {
    expect(matchesKeyword(ch('任意', 'u3'), '   ')).toBe(true);
  });
});

describe('matchesAlive', () => {
  const green: ProbeView = { ok: true, level: 'segment', ms: 100 };
  const weak: ProbeView = { ok: true, level: 'head' };
  const manifest: ProbeView = { ok: true, level: 'manifest' };
  const timeout: ProbeView = { ok: false, timedOut: true, error: '探测超时（10000ms）' };
  const dead: ProbeView = { ok: false, error: '入口响应 404' };

  it('off 全部通过（含未探测）', () => {
    expect(matchesAlive(undefined, 'off')).toBe(true);
    expect(matchesAlive(dead, 'off')).toBe(true);
  });

  it('green 仅分片级通过', () => {
    expect(matchesAlive(green, 'green')).toBe(true);
    expect(matchesAlive(weak, 'green')).toBe(false);
    expect(matchesAlive(manifest, 'green')).toBe(false);
    expect(matchesAlive(timeout, 'green')).toBe(false);
    expect(matchesAlive(undefined, 'green')).toBe(false);
  });

  it('ok 含弱验证与超时，但不含不可达', () => {
    expect(matchesAlive(green, 'ok')).toBe(true);
    expect(matchesAlive(weak, 'ok')).toBe(true);
    expect(matchesAlive(manifest, 'ok')).toBe(true);
    expect(matchesAlive(timeout, 'ok')).toBe(false);
    expect(matchesAlive(dead, 'ok')).toBe(false);
  });
});

describe('countGroups / countAlive', () => {
  const list = [ch('a', 'u1', '央视'), ch('b', 'u2', '央视'), ch('c', 'u3', '卫视'), ch('d', 'u4')];

  it('统计分组数量并忽略无分组频道', () => {
    const counts = countGroups(list);
    expect(counts.get('央视')).toBe(2);
    expect(counts.get('卫视')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('统计可用数：green 仅分片级，ok 含琥珀', () => {
    const probes = new Map<string, ProbeView>([
      ['u1', { ok: true, level: 'segment' }],
      ['u2', { ok: true, level: 'head' }],
      ['u3', { ok: false, timedOut: true }],
    ]);
    const { green, ok } = countAlive(list, (url) => probes.get(url));
    expect(green).toBe(1);
    expect(ok).toBe(2);
  });
});

describe('sortChannels', () => {
  const list = [ch('B频道', 'u1', '乙'), ch('A频道', 'u2', '甲'), ch('C频道', 'u3', '乙')];
  const noProbe = () => undefined;
  const emptyRecent = new Map<string, number>();

  it('default 保持原顺序（源顺序 / 最近观看顺序）', () => {
    expect(sortChannels(list, 'default', noProbe, emptyRecent).map((c) => c.url)).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
  });

  it('name 按名称排序', () => {
    expect(sortChannels(list, 'name', noProbe, emptyRecent).map((c) => c.name)).toEqual([
      'A频道',
      'B频道',
      'C频道',
    ]);
  });

  it('group 先按分组再按名称', () => {
    expect(sortChannels(list, 'group', noProbe, emptyRecent).map((c) => c.name)).toEqual([
      'A频道',
      'B频道',
      'C频道',
    ]);
  });

  it('probe 可用优先 + 分片耗时升序，未测排最后', () => {
    const probes = new Map<string, ProbeView>([
      ['u1', { ok: true, level: 'segment', ms: 800 }],
      ['u2', { ok: true, level: 'head' }],
      ['u3', { ok: true, level: 'segment', ms: 200 }],
    ]);
    expect(sortChannels(list, 'probe', (u) => probes.get(u), emptyRecent).map((c) => c.url)).toEqual([
      'u3',
      'u1',
      'u2',
    ]);
  });

  it('recent 按最近观看顺序，未观看排最后', () => {
    const recent = new Map([
      ['u3', 0],
      ['u1', 1],
    ]);
    expect(sortChannels(list, 'recent', noProbe, recent).map((c) => c.url)).toEqual([
      'u3',
      'u1',
      'u2',
    ]);
  });
});
