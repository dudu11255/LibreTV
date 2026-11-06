import { describe, expect, it } from 'vitest';
import {
  buildGenreSummary,
  buildYearOptions,
  classifyGenre,
  interleave,
  normalizeYearFilter,
  resolveTypeTargets,
} from './category';
import { parseClassList } from './cms-parser';
import type { CmsClass, SourceCategoryOutcome } from './types';

/** 暴风资源的真实分类片段：父分类带子分类，纪录片挂在电影下但语义独立 */
const BFZY: CmsClass[] = [
  { id: '20', name: '电影片', pid: '0' },
  { id: '21', name: '动作片', pid: '20' },
  { id: '22', name: '喜剧片', pid: '20' },
  { id: '23', name: '恐怖片', pid: '20' },
  { id: '28', name: '纪录片', pid: '20' },
  { id: '29', name: '理论片', pid: '20' },
  { id: '30', name: '连续剧', pid: '0' },
  { id: '31', name: '国产剧', pid: '30' },
  { id: '39', name: '动漫片', pid: '0' },
  { id: '40', name: '国产动漫', pid: '39' },
  { id: '45', name: '综艺片', pid: '0' },
  { id: '46', name: '大陆综艺', pid: '45' },
  { id: '51', name: '电影解说', pid: '0' },
  { id: '58', name: '短剧大全', pid: '0' },
  { id: '59', name: '重生民国', pid: '58' },
];

function outcome(key: string, classes: CmsClass[], ok = true): SourceCategoryOutcome {
  return { sourceKey: key, sourceName: key, ok, classes };
}

describe('classifyGenre', () => {
  it('按分类名归入固定大类', () => {
    expect(classifyGenre('电影片')).toBe('电影');
    expect(classifyGenre('动作片')).toBe('电影');
    expect(classifyGenre('连续剧')).toBe('电视剧');
    expect(classifyGenre('国产剧')).toBe('电视剧');
    expect(classifyGenre('综艺片')).toBe('综艺');
    expect(classifyGenre('动漫片')).toBe('动漫');
    expect(classifyGenre('国产动漫')).toBe('动漫');
    expect(classifyGenre('纪录片')).toBe('纪录片');
    expect(classifyGenre('短剧大全')).toBe('短剧');
    expect(classifyGenre('体育赛事')).toBe('其他');
  });

  it('易误判的名字按优先级归位', () => {
    // 含「电影」但是解说，不能进电影大类
    expect(classifyGenre('电影解说')).toBe('其他');
    // 含「片」但是动画，不能进电影大类
    expect(classifyGenre('动画片')).toBe('动漫');
    // 含「剧」但是短剧，不能进电视剧大类
    expect(classifyGenre('短剧')).toBe('短剧');
    // 含「片」但是纪录片
    expect(classifyGenre('纪录片')).toBe('纪录片');
  });
});

describe('buildGenreSummary', () => {
  it('按固定顺序归并大类并统计来源数', () => {
    const genres = buildGenreSummary([outcome('a', BFZY), outcome('b', BFZY)]);
    expect(genres.map((g) => g.name)).toEqual(['电影', '电视剧', '综艺', '动漫', '纪录片', '短剧', '其他']);

    const movie = genres.find((g) => g.name === '电影')!;
    expect(movie.sources).toBe(2);
    // 父分类「电影片」+ 动作/喜剧/恐怖三部片子（理论片是成人分类，已剔除）
    expect(movie.types).toBe(4);
    expect(movie.subs.map((s) => s.name)).not.toContain('电影片');
    expect(movie.subs.map((s) => s.name)).toEqual(expect.arrayContaining(['动作片', '喜剧片', '恐怖片']));
  });

  it('子分类按题材命名时继承父分类大类', () => {
    // 「重生民国」自己判不出类型，靠父分类「短剧大全」归入短剧
    const genres = buildGenreSummary([outcome('a', BFZY)]);
    const shortPlay = genres.find((g) => g.name === '短剧')!;
    expect(shortPlay.subs.map((s) => s.name)).toEqual(['重生民国']);
    expect(genres.find((g) => g.name === '其他')!.subs.map((s) => s.name)).toEqual(['电影解说']);
  });

  it('剔除成人分类，不让其进入分类导航', () => {
    const genres = buildGenreSummary([outcome('a', BFZY)]);
    const names = genres.flatMap((g) => [g.name, ...g.subs.map((s) => s.name)]);
    expect(names).not.toContain('理论片');
  });

  it('关闭敏感过滤后成人分类才出现', () => {
    const genres = buildGenreSummary([outcome('a', BFZY)], { filterAdult: false });
    const movie = genres.find((g) => g.name === '电影')!;
    expect(movie.subs.map((s) => s.name)).toContain('理论片');
    expect(resolveTypeTargets(BFZY, '电影', '理论片', { filterAdult: false })).toEqual(['29']);
  });

  it('同一分类名在不同源里落到同一个大类', () => {
    // A 源「预告片」是顶级分类，B 源把它挂在「电影」下：不该因此分到两个大类
    const topLevel: CmsClass[] = [
      { id: '1', name: '电影', pid: '0' },
      { id: '9', name: '预告片', pid: '0' },
    ];
    const nested: CmsClass[] = [
      { id: '1', name: '电影', pid: '0' },
      { id: '9', name: '预告片', pid: '1' },
    ];
    const genres = buildGenreSummary([outcome('a', topLevel), outcome('b', nested)]);
    const owners = genres.filter((g) => g.subs.some((s) => s.name === '预告片')).map((g) => g.name);
    expect(owners).toEqual(['其他']);
  });

  it('失败源不参与归并', () => {
    const genres = buildGenreSummary([outcome('a', BFZY), outcome('b', [], false)]);
    expect(genres.find((g) => g.name === '电影')!.sources).toBe(1);
  });

  it('子分类按提供它的源数量降序', () => {
    const other: CmsClass[] = [
      { id: '1', name: '电影', pid: '0' },
      { id: '2', name: '战争片', pid: '1' },
    ];
    const genres = buildGenreSummary([outcome('a', BFZY), outcome('b', other)]);
    const subs = genres.find((g) => g.name === '电影')!.subs;
    // 「动作片」只有一个源提供，仍排在前面（按源数再按名称）
    expect(subs[0].count).toBeGreaterThanOrEqual(subs[subs.length - 1].count);
  });
});

describe('resolveTypeTargets', () => {
  it('「全部」下沉到叶子分类，跳过空壳父分类', () => {
    expect(resolveTypeTargets(BFZY, '电影')).toEqual(['21', '22', '23']);
  });

  it('指定子分类时只取该 type', () => {
    expect(resolveTypeTargets(BFZY, '电影', '喜剧片')).toEqual(['22']);
  });

  it('纪录片虽挂在电影下，但仍归纪录片大类', () => {
    expect(resolveTypeTargets(BFZY, '纪录片')).toEqual(['28']);
    expect(resolveTypeTargets(BFZY, '电影')).not.toContain('28');
  });

  it('成人分类不可达', () => {
    expect(resolveTypeTargets(BFZY, '电影', '理论片')).toEqual([]);
  });

  it('完全扁平的源回退为全部候选', () => {
    const flat: CmsClass[] = [
      { id: '1', name: '电影', pid: '0' },
      { id: '2', name: '动作片', pid: '0' },
    ];
    expect(resolveTypeTargets(flat, '电影')).toEqual(['1', '2']);
  });

  it('叶子数量受上限约束', () => {
    expect(resolveTypeTargets(BFZY, '电影', undefined, { maxTypes: 2 })).toEqual(['21', '22']);
  });

  it('未知大类返回空数组', () => {
    expect(resolveTypeTargets(BFZY, '不存在的大类')).toEqual([]);
  });
});

describe('interleave', () => {
  it('按轮次打散多个桶，长度不齐时先耗尽短桶', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual([
      'a1', 'b1', 'c1', 'a2', 'c2', 'a3',
    ]);
  });

  it('空桶不影响结果', () => {
    expect(interleave([[], ['x'], []])).toEqual(['x']);
  });
});

describe('parseClassList', () => {
  it('解析数组形式的分类树', () => {
    expect(parseClassList({ class: [{ type_id: 20, type_pid: 0, type_name: '电影片' }] })).toEqual([
      { id: '20', name: '电影片', pid: '0' },
    ]);
  });

  it('兼容以 id 为键的对象形式', () => {
    const data = { class: { 20: { type_id: 20, type_pid: 0, type_name: '电影片' } } };
    expect(parseClassList(data)).toEqual([{ id: '20', name: '电影片', pid: '0' }]);
  });

  it('丢弃脏条目并去重', () => {
    const data = {
      class: [
        { type_id: 1, type_pid: 0, type_name: '电影' },
        { type_id: 1, type_pid: 0, type_name: '电影' },
        { type_id: '', type_name: '空 id' },
        { type_id: 3, type_name: '' },
        null,
      ],
    };
    expect(parseClassList(data)).toEqual([{ id: '1', name: '电影', pid: '0' }]);
  });

  it('没有 class 字段时返回空数组', () => {
    expect(parseClassList({ list: [] })).toEqual([]);
    expect(parseClassList(null)).toEqual([]);
  });
});

describe('年份筛选', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('接受合法的四位年份', () => {
    expect(normalizeYearFilter('2024', now)).toBe(2024);
    expect(normalizeYearFilter(2024, now)).toBe(2024);
    expect(normalizeYearFilter(' 2015 ', now)).toBe(2015);
  });

  it('非法值退回「不限年份」，不给源站发它读不懂的参数', () => {
    expect(normalizeYearFilter('', now)).toBeUndefined();
    expect(normalizeYearFilter(undefined, now)).toBeUndefined();
    expect(normalizeYearFilter(null, now)).toBeUndefined();
    expect(normalizeYearFilter('全部', now)).toBeUndefined();
    expect(normalizeYearFilter('2020-2024', now)).toBeUndefined();
    expect(normalizeYearFilter('20', now)).toBeUndefined();
    expect(normalizeYearFilter('1899', now)).toBeUndefined();
    expect(normalizeYearFilter('0', now)).toBeUndefined();
    expect(normalizeYearFilter('2028', now)).toBeUndefined();
  });

  it('次年放行：源站常提前上架明年的片子', () => {
    expect(normalizeYearFilter('2027', now)).toBe(2027);
  });

  it('年份选项从当年往回数，连续且不含未来', () => {
    expect(buildYearOptions(now, 5)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(buildYearOptions(now)).toHaveLength(12);
    expect(buildYearOptions(now, 0)).toEqual([2026]);
  });
});
