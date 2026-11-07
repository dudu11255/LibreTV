'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/states';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-recovery';

/**
 * 路由段级错误边界：捕获页面渲染/数据异常，避免落到 Next 默认英文白屏。
 * 刻意不放 Header——它依赖 zustand store，若异常源正是 store 会二次崩溃。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  // 构建更新后，旧页面引用的 chunk 文件名已不存在，reset() 重试只会再失败一次，
  // 正确做法是整页刷新（错误边界已自动尝试一次，见 chunk-recovery）
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    console.error('[LibreTV] 页面渲染异常:', error);
    if (isChunkLoadError(error) && reloadOnceForChunkError()) setReloading(true);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <ErrorState
          message={
            reloading
              ? '站点已更新，正在重新加载…'
              : chunkError
                ? '页面资源与当前版本不一致，刷新后可恢复。'
                : '页面出了点问题，请重试。若持续失败请返回首页。'
          }
          onRetry={chunkError ? () => window.location.reload() : reset}
          retryLabel={chunkError ? '刷新页面' : '重试'}
        />
      </main>
      <footer className="border-t border-line py-4">
        <p className="text-center text-xs text-faint">
          问题持续存在？{' '}
          <Link href="/" className="hover:text-accent">
            返回首页
          </Link>
        </p>
      </footer>
    </div>
  );
}
