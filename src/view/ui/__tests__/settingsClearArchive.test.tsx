/**
 * 帷幕界面层 · 「清空档案」按钮回归（A4-6）。
 * ---------------------------------------------------------------------------
 * logbook.ts 头注释承诺「设置面板的『清空档案』才清本片」，此前该入口不存在
 * （存档页签只有导出/重置主存档，clearLogbook/clearStats 生产零调用）。本回归：
 *  - 两步确认（第一次点击只置确认态，不清数据）；
 *  - 确认后 logbook 分片（图鉴/成就/关卡纪录）与 stats 分片（抽卡历史/曲线/计数）
 *    全部归零，主存档（player/gacha/story 等）不受影响；
 *  - 完成后确认态复位。
 * 渲染走 react-dom createRoot + act（仓库未引入 @testing-library）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../../core/store/gameStore';
import { useLogbookStore } from '../../../archive/logbook';
import { useStatsStore } from '../../../archive/statsCollector';
import { CARDS } from '../../../data/gacha';
import { SettingsDrawer } from '../SettingsDrawer';

// React 18 要求显式声明 act 环境，否则每次 act 都刷告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  useGameStore.getState().resetSave();
  useLogbookStore.getState().clearLogbook();
  useStatsStore.getState().clearStats();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

function mountDrawer(): HTMLElement {
  useGameStore.setState({ activePanel: 'settings' });
  act(() => {
    root = createRoot(host);
    root!.render(<SettingsDrawer />);
  });
  return host;
}

/** 填充两个档案分片的可清数据（走真实 API；lore id 取注册表成员 cheat-baba） */
function seedArchives(): void {
  act(() => {
    useLogbookStore.getState().recordCardObtained(CARDS[0]!.id);
    useLogbookStore.getState().recordLoreEvent('cheat-baba');
    useStatsStore.getState().bumpCounters({ pushBlocked: 7, planeShifts: 2 });
  });
}

function findClearButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('清空档案'));
  if (button === undefined) throw new Error('存档页签没有「清空档案」按钮');
  return button as HTMLButtonElement;
}

describe('A4-6 · 清空档案（兑现 logbook 的承诺）', () => {
  it('存档页签存在「清空档案」按钮，两步确认后清空 logbook 与 stats 分片', () => {
    const mounted = mountDrawer();
    // 切到存档页签
    const saveTab = [...mounted.querySelectorAll('button')].find((b) => b.textContent === '存档');
    if (saveTab === undefined) throw new Error('设置抽屉没有存档页签');
    act(() => {
      (saveTab as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    seedArchives();
    const before = useGameStore.getState();
    expect(before.gacha.starStones).toBeGreaterThan(0); // 主存档基线（清档不应触碰）

    const clearButton = findClearButton(mounted);
    // 第一步：置确认态，数据仍在
    act(() => {
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clearButton.textContent).toContain('再点一次');
    expect(Object.keys(useLogbookStore.getState().codexCards)).toHaveLength(1);
    expect(useStatsStore.getState().counters.pushBlocked).toBe(7);

    // 第二步：真清 —— 两分片归零，主存档不动
    act(() => {
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useLogbookStore.getState().codexCards).toEqual({});
    expect(useLogbookStore.getState().loreEventsSeen).toEqual({});
    expect(useStatsStore.getState().counters.pushBlocked).toBe(0);
    expect(useStatsStore.getState().counters.planeShifts).toBe(0);
    const after = useGameStore.getState();
    expect(after.gacha.starStones).toBe(before.gacha.starStones);
    expect(after.player).toBe(before.player);
    // 确认态复位（再点回到第一步，不会连清）
    expect(clearButton.textContent).not.toContain('再点一次');
  });

  it('清空档案不影响「重置存档」按钮（两动作独立并存）', () => {
    const mounted = mountDrawer();
    const saveTab = [...mounted.querySelectorAll('button')].find((b) => b.textContent === '存档');
    act(() => {
      (saveTab as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect([...mounted.querySelectorAll('button')].some((b) => b.textContent?.includes('清空存档'))).toBe(true);
    expect([...mounted.querySelectorAll('button')].some((b) => b.textContent?.includes('清空档案'))).toBe(true);
  });
});
