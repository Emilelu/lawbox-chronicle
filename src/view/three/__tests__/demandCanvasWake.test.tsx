/**
 * demand 画布后台节流初始化兜底（N5 + K5）单测。
 * ---------------------------------------------------------------------------
 * 背景：react-use-measure 的 ResizeObserver 初次回调依赖渲染帧投递，rAF 停摆
 * 的后台标签页里 containerRect 恒 {0,0,0,0}，R3F Canvas 的 width>0 守卫永不
 * 通过 → 画布停在 300×150、data-engine 缺失、root 不建立；回前台补发一次
 * window resize（react-use-measure 的 resize 兜底监听不依赖渲染帧）即恢复。
 * 覆盖（全部真实 jsdom 事件/组件，零模块 mock）：
 *  1. installDemandCanvasWake：安装时 root 未建立 → 立即补发一次 resize
 *     （K5：后台打开且一直不回前台的标签页里 visibilitychange/focus 兜底
 *     永不触发，只有挂载即补发能初始化）；hidden→visible / focus 且 root
 *     未建立 → 各补发一次；visible→hidden / root 已建立 → 不发；卸载后全静默。
 *  2. WorldCanvas 接线：jsdom 无 ResizeObserver/无布局/无 WebGL，真实 R3F
 *     Canvas 挂载后容器量取恒 0 —— 恰好复刻「守卫不通过 ⇒ root 不建立 ⇒
 *     探针不 mount」的后台节流态：挂载即补发一次（K5），回前台再补发一次，
 *     卸载后不再补发。
 *  3. RootReadyProbe mount 回执契约：mount 即 onReady 恰好一次（与
 *     「R3F root 已建立」一一对应；同一 onReady 重复提交不重复回报）。
 */

import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RootReadyProbe, WorldCanvas, installDemandCanvasWake } from '../WorldCanvas';

/* ------------------------------ 事件小工具 -------------------------------- */

/** 计数器监听 window resize，返回计数值与拆除函数 */
function listenResize(): { count: () => number; restore: () => void } {
  let n = 0;
  const listener = (): void => {
    n += 1;
  };
  window.addEventListener('resize', listener);
  return { count: () => n, restore: () => window.removeEventListener('resize', listener) };
}

/** 遮蔽 jsdom 原型 getter，模拟页面可见性（restoreVisibility 恢复） */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function restoreVisibility(): void {
  Reflect.deleteProperty(document, 'visibilityState');
}

const fireVisibilityChange = (): void => {
  document.dispatchEvent(new Event('visibilitychange'));
};

const fireFocus = (): void => {
  window.dispatchEvent(new Event('focus'));
};

/* ------------------- 1. installDemandCanvasWake 补发时机 ------------------ */

describe('installDemandCanvasWake —— 补发时机', () => {
  it('K5：安装时 root 未建立 → 立即补发恰好一次 resize（后台打开、不回前台也能初始化）', () => {
    const probe = listenResize();
    const uninstall = installDemandCanvasWake(() => false);
    try {
      expect(probe.count()).toBe(1);
      // K5 场景不受可见性限制：hidden 态下打开的标签页恰恰是本用例的目标
      setVisibility('hidden');
      fireVisibilityChange();
      fireFocus();
      expect(probe.count()).toBe(1); // hidden 下事件兜底不发（安装补发只此一次）
    } finally {
      restoreVisibility();
      uninstall();
      probe.restore();
    }
  });

  it('K5：安装时 root 已建立 → 不补发（前台正常挂载是幂等空操作）', () => {
    const probe = listenResize();
    const uninstall = installDemandCanvasWake(() => true);
    try {
      expect(probe.count()).toBe(0);
    } finally {
      uninstall();
      probe.restore();
    }
  });

  it('root 未建立：切回前台（visible 态收到 visibilitychange）补发恰好一次 resize', () => {
    const uninstall = installDemandCanvasWake(() => false);
    const probe = listenResize(); // 安装补发（K5）先于监听：本用例只计事件兜底
    try {
      fireVisibilityChange();
      expect(probe.count()).toBe(1);
      // ready 仍为 false：再次回到前台（如又一次窗口切换）每次都兜底
      fireVisibilityChange();
      expect(probe.count()).toBe(2);
    } finally {
      uninstall();
      probe.restore();
    }
  });

  it('root 未建立且页面可见：window focus 补发 resize', () => {
    const uninstall = installDemandCanvasWake(() => false);
    const probe = listenResize(); // 同上：只计 focus 事件兜底
    try {
      fireFocus();
      expect(probe.count()).toBe(1);
    } finally {
      uninstall();
      probe.restore();
    }
  });

  it('切走（visible→hidden）不发 resize：后台期间无事可做', () => {
    const uninstall = installDemandCanvasWake(() => false);
    const probe = listenResize(); // 同上：安装补发不计入，断言事件兜底为 0
    try {
      setVisibility('hidden');
      fireVisibilityChange();
      fireFocus();
      expect(probe.count()).toBe(0);
    } finally {
      restoreVisibility();
      uninstall();
      probe.restore();
    }
  });

  it('卸载函数拆除全部监听：visible/focus 均不再补发', () => {
    const uninstall = installDemandCanvasWake(() => false);
    const probe = listenResize(); // 同上：安装补发不计入
    uninstall();
    try {
      fireVisibilityChange();
      fireFocus();
      expect(probe.count()).toBe(0);
    } finally {
      probe.restore();
    }
  });
});

/* ---------------------- 2. WorldCanvas 接线（真实挂载） ------------------- */

describe('WorldCanvas 后台节流接线（jsdom 复刻「root 不建立」态）', () => {
  beforeAll(() => {
    // jsdom 无 ResizeObserver，react-use-measure 挂 ref 时会直接 throw；
    // 垫空实现后它永不回调 —— 与「RO 初次通知永不投递」的后台节流态等价
    (window as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterAll(() => {
    Reflect.deleteProperty(window as unknown as object, 'ResizeObserver');
  });

  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React 18 createRoot().render() 不同步刷 effect，须 act 等监听挂好
    await act(async () => {
      root?.render(createElement(WorldCanvas));
    });
  });

  afterEach(async () => {
    // 必须真正 unmount：只 remove 容器不会卸载 effect，监听会跨测试泄漏
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    restoreVisibility();
  });

  it('K5：挂载即补发一次 resize（jsdom 无布局 = root 不建立的后台节流态）', async () => {
    // 独立容器/root：beforeEach 已在同一 root 上挂过 WorldCanvas，重复 render
    // 会被 reconcile 视为同一组件（effect 不重跑），无法复现「挂载」时机
    const probe = listenResize();
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    try {
      await act(async () => {
        root2.render(createElement(WorldCanvas));
      });
      expect(probe.count()).toBe(1);
    } finally {
      probe.restore();
      await act(async () => {
        root2.unmount();
      });
      container2.remove();
    }
  });

  it('画布未初始化时切回前台补发恰好一次 resize（jsdom 无布局：守卫不通过、探针不 mount）', async () => {
    const probe = listenResize();
    try {
      await act(async () => {
        fireVisibilityChange();
      });
      expect(probe.count()).toBe(1);
    } finally {
      probe.restore();
    }
  });

  it('卸载 WorldCanvas 后切回前台不再补发（effect 清理随组件卸载生效）', async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const probe = listenResize();
    try {
      await act(async () => {
        fireVisibilityChange();
      });
      fireFocus();
      expect(probe.count()).toBe(0);
    } finally {
      probe.restore();
    }
  });
});

/* --------------------- 3. RootReadyProbe mount 回执契约 ------------------- */

describe('RootReadyProbe —— mount 回执契约', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
  });

  it('mount 即 onReady 恰好一次；同一 onReady 重复提交（父级重渲染）不重复回报', async () => {
    const onReady = (): void => {
      calls += 1;
    };
    let calls = 0;
    await act(async () => {
      root?.render(createElement(RootReadyProbe, { onReady }));
    });
    expect(calls).toBe(1);
    // WorldCanvas 重渲染时 Canvas 子树会经 root.render 重新提交；回调身份
    // 稳定（useCallback 空依赖）→ effect 依赖不变 → 不重复回报
    await act(async () => {
      root?.render(createElement(RootReadyProbe, { onReady }));
    });
    expect(calls).toBe(1);
  });
});
