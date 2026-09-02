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
  autoplayNext: boolean;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
}

interface AppState extends AppSettings {
  /** 部署者通过 DEFAULT_SOURCES 环境变量预置的源（服务端下发，不持久化） */
  envSources: SourceConfig[];
  /** 已向用户展示过并自动勾选过的预置源 key（持久化：用户取消勾选后不再反复勾上） */
  envKeysSeen: string[];
  addCustomApi: (api: Omit<SourceConfig, 'key'> & { key?: string }) => void;
  updateCustomApi: (key: string, patch: Partial<SourceConfig>) => void;
  removeCustomApi: (key: string) => void;
  toggleSourceSelected: (key: string) => void;
  setSelectedKeys: (keys: string[]) => void;
  setEnvSources: (list: SourceConfig[]) => void;
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
      selectedKeys: [],
      yellowFilter: true,
      adFilter: true,
      doubanEnabled: true,
      autoplayNext: true,
      imageProxyMode: 'direct',
      customImageProxy: '',

      addCustomApi: (api) => {
        const list = get().customAPIs;
        const entry: SourceConfig = { ...api, key: api.key || nextCustomKey(list) };
        set({
          customAPIs: [...list, entry],
          selectedKeys: [...get().selectedKeys, entry.key],
        });
      },

      updateCustomApi: (key, patch) => {
        set({
          customAPIs: get().customAPIs.map((a) => (a.key === key ? { ...a, ...patch } : a)),
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
        set({
          selectedKeys: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
        });
      },

      setSelectedKeys: (keys) => set({ selectedKeys: keys }),

      setEnvSources: (list) => {
        // 预置源首次出现时自动勾选（开箱即搜）；用户此后取消勾选不会被反复勾回
        const seen = new Set(get().envKeysSeen);
        const freshKeys = list.map((s) => s.key).filter((k) => !seen.has(k));
        set({
          envSources: list,
          envKeysSeen: [...get().envKeysSeen, ...freshKeys],
          selectedKeys: [...get().selectedKeys, ...freshKeys],
        });
      },

      updateSettings: (patch) => set(patch),
    }),
    {
      name: 'libretv-settings',
      // envSources 由服务端每次下发，不进 localStorage
      partialize: (s) => ({
        customAPIs: s.customAPIs,
        selectedKeys: s.selectedKeys,
        envKeysSeen: s.envKeysSeen,
        yellowFilter: s.yellowFilter,
        adFilter: s.adFilter,
        doubanEnabled: s.doubanEnabled,
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
