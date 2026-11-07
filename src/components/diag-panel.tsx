'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';

/**
 * 电视端自检面板：地址栏加 ?diag=1 打开。
 *
 * 投影仪/电视上的浏览器没有控制台，出问题时只能看到「加载失败」。这面板把
 * diag-recorder 记下的异常、fetch 失败、以及现场探测的接口状态直接铺在屏幕上，
 * 用遥控器就能读出原因（能拍照发给别人）。
 */

interface DiagEvent {
  t: 'err' | 'rej' | 'res' | 'http' | 'net' | 'evt' | 'probe';
  m: string;
  ms?: number;
  at?: number;
}

interface DiagStore {
  events: DiagEvent[];
  start?: number;
  push?: (t: string, m: string, ms?: number) => void;
}

declare global {
  interface Window {
    __LT_DIAG?: DiagStore;
  }
}

const TYPE_LABEL: Record<string, string> = {
  err: '脚本异常',
  rej: 'Promise 拒绝',
  res: '资源 404',
  http: '接口非 2xx',
  net: '请求未送达',
  evt: '网络事件',
  probe: '探测结果',
};

/** fetch 一次并把结果（状态码 / 耗时 / 响应前 80 字）记进面板，不抛错 */
async function probe(url: string, init?: RequestInit): Promise<string> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const text = (await res.text()).slice(0, 80).replace(/\s+/g, ' ');
    return `${res.status} ${Date.now() - t0}ms · ${text}`;
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return `未送达 ${Date.now() - t0}ms · ${msg}`;
  }
}

export function DiagPanel() {
  const [visible, setVisible] = useState(false);
  const { verified, version, openLogin } = useAuth();
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [info, setInfo] = useState<string[]>([]);
  const [probes, setProbes] = useState<string[]>([]);

  // 只在客户端读 URL，避免 SSR 与首帧不一致
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('diag') === '1') setVisible(true);
    } catch {
      /* 老浏览器不支持 URLSearchParams 时忽略 */
    }
  }, []);

  const refresh = useCallback(() => {
    const store = typeof window !== 'undefined' ? window.__LT_DIAG : undefined;
    setEvents((store?.events ?? []).slice(-40).reverse());

    if (typeof window === 'undefined') return;
    let storageOk = '未知';
    try {
      window.localStorage.setItem('__lt_probe', '1');
      window.localStorage.removeItem('__lt_probe');
      storageOk = '可用';
    } catch {
      storageOk = '不可用';
    }
    let cookie = '不可用';
    try {
      cookie = document.cookie ? `可写（已有 ${document.cookie.length} 字符）` : '可写（当前为空）';
    } catch {
      cookie = '不可用';
    }
    setInfo([
      `版本 ${version ?? '未取到（/api/status 未返回）'} · 登录态 ${verified ? '已验证' : '未登录'}`,
      `窗口 ${window.innerWidth}×${window.innerHeight} · DPR ${window.devicePixelRatio}`,
      `在线状态 navigator.onLine = ${String(navigator.onLine)} · cookie ${cookie} · localStorage ${storageOk}`,
      `UA ${navigator.userAgent.slice(0, 150)}`,
    ]);
  }, [verified, version]);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [visible, refresh]);

  if (!visible) return null;

  const runProbes = async () => {
    setProbes(['探测中…']);
    const lines: string[] = [];
    lines.push(`GET /api/status → ${await probe('/api/status', { cache: 'no-store' })}`);
    lines.push(`GET /api/hot-list → ${await probe('/api/hot-list?id=douban_movie_weekly', { cache: 'no-store' })}`);
    lines.push(
      `POST /api/auth(空密码) → ${await probe('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      })}`
    );
    setProbes(lines);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-surface text-content overflow-y-auto p-4 text-sm leading-relaxed">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold">电视端自检</h1>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={runProbes}>
              探测接口
            </button>
            <button className="btn-ghost btn-sm" onClick={openLogin}>
              打开登录框
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setVisible(false)}>
              关闭
            </button>
          </div>
        </div>

        <section className="bg-chip rounded-lg p-3 space-y-1">
          {info.length === 0 ? <p className="text-muted">正在收集环境信息…</p> : info.map((line) => <p key={line}>{line}</p>)}
        </section>

        {probes.length > 0 && (
          <section className="bg-chip rounded-lg p-3 space-y-1">
            <h2 className="font-medium mb-1">现场探测</h2>
            {probes.map((line) => (
              <p key={line} className="font-mono text-xs break-all">
                {line}
              </p>
            ))}
          </section>
        )}

        <section className="bg-chip rounded-lg p-3">
          <h2 className="font-medium mb-2">异常记录（{events.length} 条，新的在上）</h2>
          {events.length === 0 ? (
            <p className="text-muted">暂无异常记录：请求都拿到了 2xx，也没有脚本报错。</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e, i) => (
                <li key={`${e.at ?? i}-${i}`} className="flex gap-2 text-xs">
                  <span className="shrink-0 text-warning">[{TYPE_LABEL[e.t] ?? e.t}]</span>
                  <span className="font-mono break-all">{e.m}</span>
                  {e.ms ? <span className="shrink-0 text-faint">{e.ms}ms</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
