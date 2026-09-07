'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/client-api';

/**
 * 直播频道批量测活 hook：
 * - 目标列表分批（每批 10 条）顺序发给 /api/live/probe，服务端批内并发 8；
 * - 结果渐进写入 Map，列表可实时显示状态点；
 * - 再次调用自动作废上一轮（runId 比对），clear 重置。
 */

export interface ProbeResult {
  ok: boolean;
  ms?: number;
  error?: string;
}

const CHUNK_SIZE = 10;
const MAX_TARGETS = 400;

export function useLiveProbe() {
  const [results, setResults] = useState<Map<string, ProbeResult>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runIdRef = useRef(0);

  const clear = useCallback(() => {
    runIdRef.current++;
    setResults(new Map());
    setProgress(null);
  }, []);

  const probe = useCallback(async (targets: { url: string }[]) => {
    const urls = [...new Set(targets.map((t) => t.url))].slice(0, MAX_TARGETS);
    if (urls.length === 0) return;
    const runId = ++runIdRef.current;
    setProgress({ done: 0, total: urls.length });

    for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
      if (runIdRef.current !== runId) return;
      const chunk = urls.slice(i, i + CHUNK_SIZE);
      try {
        const { results: list } = await api.liveProbe(chunk);
        setResults((prev) => {
          const next = new Map(prev);
          for (const r of list) next.set(r.url, { ok: r.ok, ms: r.ms, error: r.error });
          return next;
        });
      } catch (err) {
        // 整批请求失败（网络断开等）：标记为不可达而非静默丢弃
        const msg = err instanceof Error ? err.message : '探测失败';
        setResults((prev) => {
          const next = new Map(prev);
          for (const u of chunk) if (!next.has(u)) next.set(u, { ok: false, error: msg });
          return next;
        });
      }
      if (runIdRef.current !== runId) return;
      setProgress({ done: Math.min(i + CHUNK_SIZE, urls.length), total: urls.length });
    }
    if (runIdRef.current !== runId) return;
    setProgress(null);
  }, []);

  return { results, progress, probe, clear, isProbing: progress !== null };
}
