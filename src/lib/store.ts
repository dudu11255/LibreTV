'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceConfig } from './types';

/**
 * 全局设置（zustand + localStorage 持久化）。
 * 旧版把 10+ 个零散 localStorage key 当作跨页面状态总线，这里统一为单一 store。
 */

export interface AppSettings {
  customAPIs: SourceConfig[];
  selectedKeys: string[];
  yellowFilter: boolean;
  adFilter: boolean;
  doubanEnabled: boolean;
  /** 首页推荐数据源：豆瓣热门 / Bangumi 每日放送（免 key） */
  recommendSource: 'douban' | 'bangumi';
  autoplayNext: boolean;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
}

/** 源订阅：远程源列表（LibreTV-SourceList JSON），可一键同步更新 */
export interface SourceSubscription {
  url: string;
  /** 订阅列表自带名称 */
  name?: string;
  /** 上次同步成功时间 */
  lastSync?: number;
}

/** 订阅导入的源 key 前缀：sub_<hash8(url)>_<i>，同步时按前缀整体替换 */
export function subKeyPrefix(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return `sub_${h.toString(36)}`;
}

interface AppState extends AppSettings {
  /** 部署者通过 DEFAULT_SOURCES 环境变量预置的源（服务端下发，不持久化） */
  envSources: SourceConfig[];
  /** 已向用户展示过并自动勾选过的预置源 key（持久化：用户取消勾选后不再反复勾上） */
  envKeysSeen: string[];
  subscriptions: SourceSubscription[];
  addCustomApi: (api: Omit<SourceConfig, 'key'> & { key?: string }) => void;
  updateCustomApi: (key: string, patch: Partial<SourceConfig>) => void;
  removeCustomApi: (key: string) => void;
  toggleSourceSelected: (key: string) => void;
  setSelectedKeys: (keys: string[]) => void;
  setEnvSources: (list: SourceConfig[]) => void;
  addSubscription: (url: string, name?: string) => void;
  removeSubscription: (url: string) => void;
  markSubscriptionSynced: (url: string, name?: string) => void;
  /** 用订阅内容整体替换该订阅名下的源，返回新增数量 */
  applySubscriptionSources: (subUrl: string, list: Omit<SourceConfig, 'key'>[]) => number;
  updateSettings: (patch: Partial<Omit<AppSettings, 'customAPIs' | 'selectedKeys'>>) => void;
}

function nextCustomKey(apiList: SourceConfig[]): string {
  let i = 0;
  const used = new Set(apiList.map((a) => a.key));
  while (used.has(`custom_${i}`)) i++;
  return `custom_${i}`;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      customAPIs: [],
      envSources: [],
      envKeysSeen: [],
      subscriptions: [],
      selectedKeys: [],
      yellowFilter: true,
      adFilter: true,
      doubanEnabled: true,
      recommendSource: 'douban',
      autoplayNext: true,
      imageProxyMode: 'proxy',
      customImageProxy: '',

      addCustomApi: (api) => {
        const list = get().customAPIs;
        const entry: SourceConfig = { ...api, key: api.key || nextCustomKey(list) };
        // 成人内容过滤开启时，成人源默认不勾选（用户可在关闭过滤后手动勾选）
        const selectable = !(entry.isAdult && get().yellowFilter);
        set({
          customAPIs: [...list, entry],
          selectedKeys: selectable ? [...get().selectedKeys, entry.key] : get().selectedKeys,
        });
      },

      updateCustomApi: (key, patch) => {
        // 源被标记为成人内容且过滤开启时，同步取消勾选
        const drop = patch.isAdult === true && get().yellowFilter;
        set({
          customAPIs: get().customAPIs.map((a) => (a.key === key ? { ...a, ...patch } : a)),
          selectedKeys: drop ? get().selectedKeys.filter((k) => k !== key) : get().selectedKeys,
        });
      },

      removeCustomApi: (key) => {
        set({
          customAPIs: get().customAPIs.filter((a) => a.key !== key),
          selectedKeys: get().selectedKeys.filter((k) => k !== key),
        });
      },

      toggleSourceSelected: (key) => {
        const cur = get().selectedKeys;
        if (cur.includes(key)) {
          set({ selectedKeys: cur.filter((k) => k !== key) });
          return;
        }
        // 成人内容过滤开启时不允许勾选成人源
        const src = [...get().customAPIs, ...get().envSources].find((a) => a.key === key);
        if (src?.isAdult && get().yellowFilter) return;
        set({ selectedKeys: [...cur, key] });
      },

      setSelectedKeys: (keys) => set({ selectedKeys: keys }),

      setEnvSources: (list) => {
        // 预置源首次出现时自动勾选（开箱即搜）；用户此后取消勾选不会被反复勾回
        const seen = new Set(get().envKeysSeen);
        const freshKeys = list.map((s) => s.key).filter((k) => !seen.has(k));
        // 成人内容过滤开启时，成人预置源不自动勾选
        const toSelect = freshKeys.filter((k) => {
          const src = list.find((s) => s.key === k);
          return !src?.isAdult || !get().yellowFilter;
        });
        set({
          envSources: list,
          envKeysSeen: [...get().envKeysSeen, ...freshKeys],
          selectedKeys: [...get().selectedKeys, ...toSelect],
        });
      },

      addSubscription: (url, name) => {
        if (get().subscriptions.some((s) => s.url === url)) return;
        set({ subscriptions: [...get().subscriptions, { url, name }] });
      },

      removeSubscription: (url) => {
        const prefix = subKeyPrefix(url);
        set({
          subscriptions: get().subscriptions.filter((s) => s.url !== url),
          customAPIs: get().customAPIs.filter((a) => !a.key.startsWith(prefix)),
          selectedKeys: get().selectedKeys.filter((k) => !k.startsWith(prefix)),
        });
      },

      markSubscriptionSynced: (url, name) => {
        set({
          subscriptions: get().subscriptions.map((s) =>
            s.url === url ? { ...s, lastSync: Date.now(), name: name ?? s.name } : s
          ),
        });
      },

      applySubscriptionSources: (subUrl, list) => {
        const prefix = subKeyPrefix(subUrl);
        // 与订阅源 URL 相同的手动添加源视为重复，避免同步后出现双份
        const subUrls = new Set(list.map((s) => s.url.replace(/\/+$/, '')));
        const keptCustom = get().customAPIs.filter(
          (a) => !a.key.startsWith(prefix) && !subUrls.has(a.url.replace(/\/+$/, ''))
        );
        const incoming: SourceConfig[] = list.map((s, i) => ({
          ...s,
          key: `${prefix}_${i}`,
        }));
        // 自动勾选（成人过滤开启时跳过成人源）
        const toSelect = incoming
          .filter((s) => !s.isAdult || !get().yellowFilter)
          .map((s) => s.key);
        set({
          customAPIs: [...keptCustom, ...incoming],
          selectedKeys: [...get().selectedKeys.filter((k) => !k.startsWith(prefix)), ...toSelect],
        });
        return incoming.length;
      },

      updateSettings: (patch) => {
        // 打开成人内容过滤时，同步取消勾选所有成人源，避免两者并存
        if (patch.yellowFilter === true) {
          const adultKeys = new Set(
            [...get().customAPIs, ...get().envSources]
              .filter((s) => s.isAdult)
              .map((s) => s.key)
          );
          set({
            ...patch,
            selectedKeys: get().selectedKeys.filter((k) => !adultKeys.has(k)),
          });
          return;
        }
        set(patch);
      },
    }),
    {
      name: 'libretv-settings',
      // envSources 由服务端每次下发，不进 localStorage
      partialize: (s) => ({
        customAPIs: s.customAPIs,
        selectedKeys: s.selectedKeys,
        envKeysSeen: s.envKeysSeen,
        subscriptions: s.subscriptions,
        yellowFilter: s.yellowFilter,
        adFilter: s.adFilter,
        doubanEnabled: s.doubanEnabled,
        recommendSource: s.recommendSource,
        autoplayNext: s.autoplayNext,
        imageProxyMode: s.imageProxyMode,
        customImageProxy: s.customImageProxy,
      }),
      // 同步 storage 会在模块加载时立即 rehydrate（早于 React hydration），
      // 一旦首屏渲染依赖持久化状态就会与 SSR 输出不一致。
      // 改为由 Providers 在挂载后手动 rehydrate。
      skipHydration: true,
    }
  )
);

/** 获取指定 key 的源配置；找不到时支持从 URL 参数兜底构造 */
export function resolveSource(
  store: Pick<AppState, 'customAPIs' | 'envSources'>,
  key: string,
  fallback?: { url?: string; detail?: string; name?: string }
): SourceConfig | undefined {
  const found = store.customAPIs.find((a) => a.key === key) ?? store.envSources.find((a) => a.key === key);
  if (found) return found;
  if (fallback?.url) {
    return {
      key,
      name: fallback.name || '自定义源',
      url: fallback.url,
      detail: fallback.detail,
    };
  }
  return undefined;
}
