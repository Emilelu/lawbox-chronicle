/**
 * ErrorBoundary —— 全局渲染异常屏障。
 * ---------------------------------------------------------------------------
 * S14 根治：老 SanBPushChest 在 keyDown 里 try/catch 吞掉一切异常，只留一句
 * 「虽然出现了 ... 但是这根本就不是问题!」（service.js:93-95），异常从此不可见、
 * 不可修。新架构的分工：
 *   - 输入层（useKeyActions/TouchPad）不再捕获任何异常，让它抛；
 *   - React 渲染树里的异常由本组件接管：上屏告警 + 可恢复操作，
 *     开发模式下 console.error 全量细节（组件栈），绝不静默。
 * 在 App 根部包一层即可： <ErrorBoundary><App/></ErrorBoundary>
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useGameStore } from '../core/store/gameStore';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发告警：全量细节进控制台（含组件栈），修复线索永不被吞
    console.error('[ErrorBoundary] 捕获到渲染异常：', error, '\n组件栈：', info.componentStack);
  }

  private readonly handleRetry = () => {
    this.setState({ error: null }); // 重建子树：瞬时异常（如演出态）可原地恢复
  };

  private readonly handleBackToTitle = () => {
    useGameStore.getState().backToTitle();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'rgba(3, 6, 18, 0.82)',
        }}
      >
        <div className="glass" style={{ maxWidth: 560, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="neon-text" style={{ fontSize: 20, letterSpacing: '0.12em' }}>
            箱庭规则出现了异常
          </h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.7 }}>
            渲染过程中抛出了一个异常。它已被上屏记录（开发模式详见控制台），游戏状态未被静默吞掉。
            你可以尝试原地恢复，或返回标题页。
          </p>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              maxHeight: 160,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--neon-rose)',
              background: 'rgba(20, 26, 48, 0.6)',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {error.message}
          </pre>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="btn-neon" onClick={this.handleRetry}>
              原地恢复
            </button>
            <button type="button" className="chip" style={{ cursor: 'pointer' }} onClick={this.handleBackToTitle}>
              返回标题页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
