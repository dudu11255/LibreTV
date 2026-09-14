'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { Drawer } from './drawer';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState, LoadingState } from './states';
import { db, clearAllHistory, removeHistory, upsertHistory, type HistoryEntry } from '@/lib/db';
import { buildWatchUrl, buildImageUrl, cn, formatRelativeTime, formatTime } from '@/lib/utils';
import { useToast } from './toast';
import { resolveSource, useAppStore } from '@/lib/store';

/**
 * 观看历史面板（IndexedDB 实时查询）。
 * 与旧版的区别：播放前按需重新拉取剧集详情，不再依赖历史记录里冗余存储的全集 URL。
 * 破坏性操作分级：清空全部走确认弹窗，删除单条支持撤销。
 */

export function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(50).toArray(), [open]);
  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <Drawer open={open} onClose={onClose} title="观看历史" width="max-w-lg">
      {!history ? (
        <LoadingState />
      ) : history.length === 0 ? (
        <EmptyState variant="plain" title="暂无观看记录" />
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <button
              className="text-xs text-faint hover:text-danger transition-colors"
              onClick={() => setConfirmClear(true)}
            >
              清空历史
            </button>
          </div>
          <ul className="space-y-2">
            {history.map((item) => (
              <HistoryItem key={`${item.sourceKey}_${item.vodId}`} item={item} />
            ))}
          </ul>
        </>
      )}

      {/* 重操作：清空不可撤销，先确认并说明数量 */}
      <ConfirmDialog
        open={confirmClear}
        danger
        title="清空全部观看历史？"
        message={history ? `将删除 ${history.length} 条观看记录，此操作不可撤销。` : undefined}
        confirmLabel="清空"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          void clearAllHistory().then(() => toast('观看历史已清空', 'success'));
          setConfirmClear(false);
        }}
      />
    </Drawer>
  );
}

function HistoryItem({ item }: { item: HistoryEntry }) {
  // 精确订阅：整份 useAppStore() 会让每条历史在任意 store 变化（搜索健康度、测活写回等）时重渲染
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const { toast } = useToast();
  const [imgFailed, setImgFailed] = useState(false);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const pic = buildImageUrl(item.pic, imageProxyMode, customImageProxy);

  const hasPercent =
    item.playbackPosition > 10 && item.duration > 0 && item.playbackPosition < item.duration * 0.95;
  const percent = hasPercent ? Math.round((item.playbackPosition / item.duration) * 100) : 0;

  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });

  const remove = () => {
    void removeHistory(item.sourceKey, item.vodId).then(() => {
      // 轻操作：给撤销窗口，恢复时写回原记录
      toast('已删除该记录', 'info', {
        action: {
          label: '撤销',
          onClick: () => {
            void upsertHistory({
              sourceKey: item.sourceKey,
              sourceUrl: item.sourceUrl,
              vodId: item.vodId,
              title: item.title,
              pic: item.pic,
              episodeIndex: item.episodeIndex,
              totalEpisodes: item.totalEpisodes,
              playbackPosition: item.playbackPosition,
              duration: item.duration,
              timestamp: item.timestamp,
            }).then(() => toast('已恢复', 'success'));
          },
        },
      });
    });
  };

  return (
    <li className="relative group">
      <Link
        href={href}
        onClick={() => {
          // 点击即同步一次时间戳，置顶最近观看
          upsertHistory({ ...item, timestamp: Date.now() }).catch(() => {});
        }}
        className="block bg-card hover:bg-hover rounded-lg p-3 pr-10 transition-colors"
      >
        <div className="flex items-center gap-3">
          {pic && !imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pic}
              alt=""
              className="w-10 h-14 object-cover rounded bg-chip"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-10 h-14 rounded bg-chip flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16m10-16v16M7 8h10M7 12h10" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-content truncate">{item.title}</div>
            <div className="text-xs text-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
              {item.totalEpisodes > 0 && <span>第 {item.episodeIndex + 1}/{item.totalEpisodes} 集</span>}
              {hasPercent && <span>· {formatTime(item.playbackPosition)}</span>}
              <span>· {formatRelativeTime(item.timestamp)}</span>
            </div>
            {hasPercent && (
              <div className="mt-1.5 h-1 bg-hover rounded-full overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        </div>
      </Link>
      <button
        className={cn(
          'absolute right-2 top-2 p-2 rounded-full text-faint hover:text-danger',
          'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'
        )}
        aria-label="删除记录"
        title="删除记录（可在提示中撤销）"
        onClick={remove}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}
