'use client';

import { useMemo } from 'react';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import { validateSourceUrl } from '@/lib/utils';
import type { SourceConfig } from '@/lib/types';

export interface SelectedSourcesState {
  /** 本次实际参与请求的源（已去重、URL 合法、未被停用、订阅未关闭） */
  sources: SourceConfig[];
  /** 因连续超时/失败被自动停用的 key（需提示用户） */
  disabledKeys: string[];
  /** 所属订阅被整体停用的 key（勾选还在，但本轮用不到） */
  offSubscriptionKeys: string[];
  /** key → 友好源名，用于提示文案 */
  sourceName: (key: string) => string;
}

/**
 * 解析「当前选中的点播源」。
 *
 * 首页搜索与分类浏览必须用同一套筛选规则（去重、URL 合法、自动停用、订阅关闭），
 * 否则同一个源会出现「能搜到但分类里没有」这类难以解释的差异，因此抽成共享 hook。
 */
export function useSelectedSources(): SelectedSourcesState {
  // 精确订阅所需字段：搜索/分类结果逐源回写健康度时，不应触发整棵组件树重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);

  const sources = useMemo(() => {
    // selectedKeys 可能含历史残留的重复 key：按 key 去重，避免同源重复请求
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is SourceConfig => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      // 自动停用期内的源不参与请求（到期自动恢复）
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      // 所属订阅被整体停用的源同样跳过（无损：各源勾选状态保留，重新启用即恢复）
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);

  const disabledKeys = useMemo(
    () => selectedKeys.filter((key) => isSourceDisabled({ sourceHealth }, key)),
    [selectedKeys, sourceHealth]
  );

  const offSubscriptionKeys = useMemo(
    () =>
      selectedKeys.filter(
        (key) => !isSourceDisabled({ sourceHealth }, key) && isInDisabledSubscription({ subscriptions }, key)
      ),
    [selectedKeys, sourceHealth, subscriptions]
  );

  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ?? envSources.find((a) => a.key === key)?.name ?? key;

  return { sources, disabledKeys, offSubscriptionKeys, sourceName };
}
