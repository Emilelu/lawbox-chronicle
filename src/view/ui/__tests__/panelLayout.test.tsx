/**
 * 帷幕界面层 · L3 面板居中回归 —— 选关 / 档案 / 卡组三个居中面板。
 * ---------------------------------------------------------------------------
 * 老缺陷：framer-motion 接管 transform 后，style 里的 translate(-50%,-50%)
 * 被 scale 动画整体覆盖，面板左上角锚定屏幕中心向右下展开，800×600 下 ✕
 * 关闭按钮完全落在视口外。修复后居中位移并入 motion 值（initial/animate 的
 * x/y 百分比），由 motion 合成完整 transform。
 * 断言挂载后的 DOM 内联 transform 同时含 translateX(-50%) 与 translateY(-50%)。
 * 渲染走 react-dom createRoot + act（仓库未引入 @testing-library）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../../core/store/gameStore';
import { ArchivePanel, useArchivePanelStore } from '../ArchivePanel';
import { DeckPanel } from '../DeckPanel';
import { LevelSelectPanel, useLevelSelectStore } from '../LevelSelectPanel';

// React 18 要求显式声明 act 环境，否则每次 act 都刷告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  useGameStore.getState().resetSave();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

function render(node: React.ReactElement): void {
  act(() => {
    root = createRoot(host);
    root!.render(node);
  });
}

/** 面板根节点的内联 transform 必须保留居中位移（motion 合成结果） */
function expectCentered(label: string): void {
  const panel = host.querySelector('div.glass');
  expect(panel, `${label} 面板未挂载`).not.toBeNull();
  const transform = (panel as HTMLElement).style.transform;
  expect(transform, `${label} 缺 translateX(-50%)`).toContain('translateX(-50%)');
  expect(transform, `${label} 缺 translateY(-50%)`).toContain('translateY(-50%)');
}

describe('L3 · 三面板居中位移不被 motion 动画覆盖', () => {
  it('选关面板（HUD 🗺 打开）', () => {
    useLevelSelectStore.getState().toggle();
    render(<LevelSelectPanel />);
    expectCentered('选关');
  });

  it('档案面板（HUD 📖 打开）', () => {
    useArchivePanelStore.getState().toggle();
    render(<ArchivePanel />);
    expectCentered('档案');
  });

  it('卡组面板（activePanel=deck）', () => {
    useGameStore.getState().openPanel('deck');
    render(<DeckPanel />);
    expectCentered('卡组');
  });
});
