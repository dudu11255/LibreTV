'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 局部错误边界：抽屉 / 推荐区这类「子模块」崩掉时只坏一块，不再拖垮整页。
 *
 * 电视端尤其需要：整个页面都挂了的时候屏幕上什么都没有（或只剩一个白色/空抽屉），
 * 用户完全无法判断是没网、没登录还是脚本坏了。这里把错误本身印在位置上，
 * 同时把错误塞进 window.__LT_DIAG，之后可以在 ?diag=1 面板里看到。
 */

interface Props {
  children: ReactNode;
  /** 出错时的标题（如「设置面板」），用于让用户知道坏的是哪一块 */
  title?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      const diag = typeof window !== 'undefined' ? window.__LT_DIAG : undefined;
      diag?.push?.('err', `[${this.props.title ?? '组件'}] ${error.name}: ${error.message}`);
      if (info.componentStack) {
        diag?.push?.('err', `[${this.props.title ?? '组件'}] ${String(info.componentStack).slice(0, 180)}`);
      }
    } catch {
      // 自检记录失败不影响兜底 UI
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="m-3 rounded-lg border border-danger/40 bg-chip p-4 text-sm leading-relaxed">
        <p className="font-medium text-content mb-1">{this.props.title ?? '这部分'}加载出错</p>
        <p className="text-muted break-all">
          {error.name}: {error.message}
        </p>
        <div className="flex gap-2 mt-3">
          <button className="btn-ghost btn-sm" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button className="btn-ghost btn-sm" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
