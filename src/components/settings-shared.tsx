'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useToast } from './toast';
import { Icon, type IconName } from './icon';

/**
 * 设置面板共享件：把此前点播源 / 直播源各自「抄一遍」的标题、开关、
 * 下拉、空态、搜索框、探活徽章与健康度统一到一处，保证两类源面板风格与行为一致。
 */

/** 探活结果（点播 / 直播共用同一结构） */
export type TestState =
  | { status: 'loading' }
  | { status: 'done'; ok: boolean; ms?: number; count?: number; error?: string };

/** 探活结果状态管理：替代两条源列表各自维护一份 tests 的实现 */
export function useSourceTests() {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const runTest = useCallback(
    async (
      key: string,
      run: () => Promise<{ ok: boolean; ms?: number; count?: number; error?: string }>
    ) => {
      setTests((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const r = await run();
        setTests((prev) => ({
          ...prev,
          [key]: r.ok
            ? { status: 'done', ok: true, ms: r.ms, count: r.count }
            : { status: 'done', ok: false, error: r.error },
        }));
      } catch (err) {
        setTests((prev) => ({
          ...prev,
          [key]: { status: 'done', ok: false, error: err instanceof Error ? err.message : '测试失败' },
        }));
      }
    },
    []
  );
  return { tests, runTest };
}

export function SectionTitle({ title, hint, extra }: { title: string; hint?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        {hint && <p className="text-[11px] text-faint truncate">{hint}</p>}
      </div>
      {extra}
    </div>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="min-w-0">
        <div className="text-sm text-content">{label}</div>
        <div className="text-xs text-faint">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn(
          'relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          checked ? 'bg-accent' : 'bg-chip ring-1 ring-inset ring-line'
        )}
        onClick={() => onChange(!checked)}
      >
        <span
          className={cn(
            'absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
            checked ? 'translate-x-[18px]' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}

export function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-content shrink-0">{label}</span>
      <div className="relative min-w-0">
        <select
          className="input !py-1.5 !pl-2.5 !pr-7 cursor-pointer appearance-none text-xs max-w-full"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevronDown"
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
        />
      </div>
    </div>
  );
}

export function EmptyState({
  icon = 'link',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-line rounded-lg p-6 text-center">
      <Icon name={icon} className="w-6 h-6 mx-auto text-faint mb-2" />
      <p className="text-sm text-muted">{title}</p>
      {description && <p className="text-xs text-faint mt-1 leading-relaxed">{description}</p>}
      {action && <div className="mt-3 flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Icon
        name="search"
        className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
      />
      <input
        className="input w-full !pl-8 !py-1.5 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/** 单源探活徽章 + 触发按钮（点播 / 直播共用；`badgeWhenOk` 决定成功文案） */
export function TestBadge({
  state,
  onTest,
  title,
  badgeWhenOk,
}: {
  state?: TestState;
  onTest: () => void;
  title: string;
  badgeWhenOk: (t: { ms?: number; count?: number }) => string;
}) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {state?.status === 'done' && (
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded',
            state.ok ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-red-500/15 text-red-500'
          )}
          title={state.ok ? `${state.ms}ms` : state.error}
        >
          {state.ok ? badgeWhenOk({ ms: state.ms, count: state.count }) : `✗ ${state.error?.slice(0, 12) || '失败'}`}
        </span>
      )}
      <button
        className={cn(
          'rounded-md p-2 transition-colors disabled:opacity-40',
          state?.status === 'done' && !state.ok
            ? 'text-red-400'
            : 'text-muted hover:text-accent hover:bg-hover'
        )}
        disabled={state?.status === 'loading'}
        onClick={onTest}
        aria-label={title}
        title={title}
      >
        {state?.status === 'loading' ? (
          <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Icon name="bolt" className="w-4 h-4" />
        )}
      </button>
    </span>
  );
}

/** 点播源搜索健康度徽章（随搜索/批量测活滚动更新）；被自动停用的源提供手动恢复入口 */
export function HealthBadge({ sourceKey }: { sourceKey: string }) {
  const entry = useAppStore((s) => s.sourceHealth[sourceKey]);
  const { toast } = useToast();
  if (!entry) return null;

  const disabled = !!entry.disabledUntil && entry.disabledUntil > Date.now();
  if (disabled) {
    const remainMin = Math.max(1, Math.ceil(((entry.disabledUntil ?? 0) - Date.now()) / 60000));
    return (
      <span className="flex items-center gap-1 shrink-0">
        <span
          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500"
          title={`连续 ${entry.failStreak} 次超时/失败，${remainMin} 分钟后自动恢复`}
        >
          <Icon name="clock" className="w-3 h-3" />
          {remainMin} 分
        </span>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded text-muted hover:text-accent hover:bg-hover transition-colors"
          aria-label="恢复此源"
          title="清除健康度记录，立即恢复参与搜索"
          onClick={() => {
            useAppStore.getState().clearSourceHealth(sourceKey);
            toast('已恢复，下次搜索重新参与', 'success');
          }}
        >
          恢复
        </button>
      </span>
    );
  }

  if (entry.ok) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 shrink-0" title={`上次搜索 ${entry.ms}ms`}>
        ✓ {entry.ms}ms
      </span>
    );
  }
  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded shrink-0',
        entry.timedOut ? 'bg-amber-500/15 text-amber-500' : 'bg-red-500/15 text-red-500'
      )}
      title={entry.error}
    >
      连续 {entry.failStreak} 次失败
    </span>
  );
}
