/**
 * 帷幕界面层 · HudBar 回归 —— L1（左上组窄视口折行）/ L4（◈ 快捷抽卡入口可点）
 * / R5（成就 toast 文案反查）/ B4-4（撤销/重玩按钮的 phase 门禁）。
 * ---------------------------------------------------------------------------
 * L1/L4 属挂载期样式断言：仓库未引入 @testing-library，用 react-dom 的
 * createRoot + act 直接挂载，断言回归关键的行内样式与点击行为；
 * R5/B4-4 是纯函数（resolveToastText / canRewindWorld），直接喂键断言；
 * B4-4 另断言对话/抽卡相下 ↩/⟲ 渲染为 disabled（与键盘门禁同款谓词）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../../core/store/gameStore';
import { achievementToastKey } from '../../../archive/logbook';
import { ACHIEVEMENTS } from '../../../data/lore/achievements';
import { canRewindWorld, HudBar, resolveToastText } from '../HudBar';

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

/** 进入游戏并挂载 HUD（标题页 phase 下 HudBar 返回 null，必须先 startLevel） */
function mountHud(): HTMLElement {
  useGameStore.getState().startLevel('level-sb-01');
  act(() => {
    root = createRoot(host);
    root!.render(<HudBar />);
  });
  return host;
}

describe('L4 · 星石胶囊是可点击的快捷抽卡入口', () => {
  it('◈ 按钮显式恢复 pointerEvents:auto（左上容器整体 none，不恢复即点击穿透 3D 画布）', () => {
    const mounted = mountHud();
    const gachaButton = [...mounted.querySelectorAll('button')].find((b) => b.textContent?.includes('◈'));
    expect(gachaButton).toBeDefined();
    expect(gachaButton!.style.pointerEvents).toBe('auto');
  });

  it('真实点击 ◈ 打开抽卡浮层（openPanel("gacha") 不再被吞）', () => {
    const mounted = mountHud();
    const gachaButton = [...mounted.querySelectorAll('button')].find((b) => b.textContent?.includes('◈'));
    expect(gachaButton).toBeDefined();
    act(() => {
      gachaButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useGameStore.getState().activePanel).toBe('gacha');
  });
});

describe('L1 · 左上组的窄视口折行策略', () => {
  it('左上容器声明 flexWrap + maxWidth 计算宽（<844px 时撤销/重玩行折行，两组互不遮挡）', () => {
    const mounted = mountHud();
    const leftGroup = mounted.children[0] as HTMLElement;
    expect(leftGroup.style.flexWrap).toBe('wrap');
    // 右上组左缘 = 100vw - 340（宽 328 + 右边距 12），再让出左边距 12 → 100vw - 352；
    // 用 max(220px, …) 钳下限：视口 <352px 时 calc 为负（会被浏览器丢弃），窄屏仍保最小可用宽
    expect(leftGroup.style.maxWidth).toBe('max(220px, calc(100vw - 352px))');
  });

  it('右上圆形按钮组仍为 7 枚（折行不改变右上组构成）', () => {
    const mounted = mountHud();
    const rightGroup = mounted.children[1] as HTMLElement;
    expect(rightGroup.querySelectorAll('button')).toHaveLength(7);
  });

  it('右上组窄视口换行收进视口（320px 溢出修复）', () => {
    const mounted = mountHud();
    const rightGroup = mounted.children[1] as HTMLElement;
    expect(rightGroup.style.flexWrap).toBe('wrap');
    expect(rightGroup.style.justifyContent).toBe('flex-end');
    expect(rightGroup.style.maxWidth).toBe('calc(100vw - 24px)');
  });
});

describe('B4-4 · 撤销/重玩按钮的 phase 门禁（与键盘同款谓词）', () => {
  /** 按按钮文本找 ↩（撤销）/⟲（重玩）按钮 */
  function rewindButton(host: HTMLElement, mark: '↩' | '⟲'): HTMLButtonElement {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(mark));
    expect(btn, `找不到 ${mark} 按钮`).toBeDefined();
    return btn as HTMLButtonElement;
  }

  it('canRewindWorld：playing/result/combat 放行，title/dialogue/gacha 禁止（与 useKeyActions 门禁同款）', () => {
    expect(canRewindWorld('playing')).toBe(true);
    expect(canRewindWorld('result')).toBe(true);
    expect(canRewindWorld('combat')).toBe(true);
    expect(canRewindWorld('title')).toBe(false);
    expect(canRewindWorld('dialogue')).toBe(false);
    expect(canRewindWorld('gacha')).toBe(false);
  });

  it('对话相下 ↩/⟲ 渲染为 disabled（剧情遮罩之下不再静默改写世界）', () => {
    const mounted = mountHud();
    act(() => {
      useGameStore.setState({ phase: 'dialogue' });
    });
    expect(rewindButton(mounted, '↩').disabled).toBe(true);
    expect(rewindButton(mounted, '⟲').disabled).toBe(true);
  });

  it('抽卡相下同样 disabled；回到 playing 相恢复可点（与键盘门禁同步开合）', () => {
    const mounted = mountHud();
    expect(rewindButton(mounted, '↩').disabled).toBe(false); // startLevel 后 phase=playing
    act(() => {
      useGameStore.setState({ phase: 'gacha' });
    });
    expect(rewindButton(mounted, '↩').disabled).toBe(true);
    expect(rewindButton(mounted, '⟲').disabled).toBe(true);
    act(() => {
      useGameStore.setState({ phase: 'playing' });
    });
    expect(rewindButton(mounted, '↩').disabled).toBe(false);
    expect(rewindButton(mounted, '⟲').disabled).toBe(false);
  });
});

describe('R5 · resolveToastText 的成就反查与回落', () => {
  it('lore:ach:<id> 反查为成就名（不再原样显示 key 字面量）', () => {
    const def = ACHIEVEMENTS[0]!;
    expect(resolveToastText('en', achievementToastKey(def.id))).toBe(def.title);
    expect(resolveToastText('zh-Hans', 'lore:ach:ach-hardhead')).toBe(
      ACHIEVEMENTS.find((a) => a.id === 'ach-hardhead')!.title,
    );
  });

  it('带前缀但 id 未知：回落旧字典 → key 字面量（不作假本地化）', () => {
    expect(resolveToastText('zh-Hans', 'lore:ach:ach-ghost')).toBe('lore:ach:ach-ghost');
  });

  it('非成就键走 uiText 键控字典与 data/i18n 旧字典', () => {
    expect(resolveToastText('zh-Hans', 'hud.quickGacha')).toBe('星石胶囊 · 点击打开快捷抽卡');
    expect(resolveToastText('en', 'toast.skeletonReady')).toBe(
      'Skeleton ready: store / engine / data pipeline connected',
    );
  });
});
