/**
 * 帷幕界面层 · 面板互斥回归（A4-3 / A4-4 / B3-8）。
 * ---------------------------------------------------------------------------
 * A4-3：LevelGuidePanel 补订阅 ui/closePanels —— Esc（closeOverlay 广播）能关掉
 *       攻略面板（此前三个分片面板只有两个订阅，攻略面板 Esc 关不掉）。
 * A4-4：档案/选关/攻略三个分片面板互斥 —— 打开任一分片面板（open 动作广播）或
 *       任一主面板（openPanel 广播）时，已开的其它浮层一并关闭，不再三层叠开。
 * B3-8：分片开启时的反向互斥 —— open/toggle 先调 gameStore.closeOverlay 关掉
 *       主浮层（activePanel 归 none、gacha 相复位、结算清空），兑现 openPanel
 *       注释承诺的「分片 open 广播 closePanels + closeOverlay」；主浮层开着时
 *       分片不再在底层打开被背板遮挡（形似无效）。
 * 渲染走 react-dom createRoot + act（仓库未引入 @testing-library）；
 * 三个分片面板常驻挂载，与 UiOverlaySuite 的生产挂载方式一致（互斥的 close
 * 动作由面板组件的 bus 订阅执行，未挂载即无订阅者）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../../core/store/gameStore';
import { bus } from '../../../core/events/bus';
import { ArchivePanel, useArchivePanelStore } from '../ArchivePanel';
import { LevelGuidePanel, useGuidePanelStore } from '../LevelGuidePanel';
import { LevelSelectPanel, useLevelSelectStore } from '../LevelSelectPanel';

// React 18 要求显式声明 act 环境，否则每次 act 都刷告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  useGameStore.getState().resetSave();
  useArchivePanelStore.getState().close();
  useLevelSelectStore.getState().close();
  useGuidePanelStore.getState().close();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

/** 常驻挂载三个分片面板（模拟 UiOverlaySuite），返回各面板挂载数的读取器 */
function mountPanels(): { archive: () => number; select: () => number; guide: () => number } {
  act(() => {
    root = createRoot(host);
    root!.render(
      <>
        <ArchivePanel />
        <LevelSelectPanel />
        <LevelGuidePanel />
      </>,
    );
  });
  return {
    archive: () => host.querySelectorAll('h3').length && [...host.querySelectorAll('h3')].filter((h) => h.textContent === '档案').length,
    select: () => [...host.querySelectorAll('h3')].filter((h) => h.textContent === '选关').length,
    guide: () => [...host.querySelectorAll('h3')].filter((h) => h.textContent?.startsWith('💡 攻略')).length,
  };
}

describe('A4-3 · 攻略面板响应 Esc（ui/closePanels 订阅）', () => {
  it('攻略面板打开后按 Esc（closeOverlay）→ 面板关闭（此前只能点 ✕）', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useGuidePanelStore.getState().openFor('level-sb-01');
    });
    expect(counts.guide()).toBe(1);
    act(() => {
      useGameStore.getState().closeOverlay(); // Esc 的 store 通道（广播 ui/closePanels）
    });
    expect(counts.guide()).toBe(0);
    expect(useGuidePanelStore.getState().open).toBe(false);
  });
});

describe('A4-4 · 三分片面板互斥（不再三层叠开）', () => {
  it('依次打开选关 → 档案 → 攻略，先开的被逐个顶掉（终态只留一个）', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useLevelSelectStore.getState().toggle(); // 开选关
    });
    expect(counts.select()).toBe(1);
    act(() => {
      useArchivePanelStore.getState().toggle(); // 开档案（广播关闭选关）
    });
    expect(counts.archive()).toBe(1);
    expect(counts.select()).toBe(0);
    act(() => {
      useGuidePanelStore.getState().openFor('level-sb-01'); // 开攻略（广播关闭档案）
    });
    expect(counts.guide()).toBe(1);
    expect(counts.archive()).toBe(0);
    expect(counts.select()).toBe(0);
    expect(useArchivePanelStore.getState().open).toBe(false);
    expect(useLevelSelectStore.getState().open).toBe(false);
    expect(useGuidePanelStore.getState().open).toBe(true);
  });

  it('分片面板开着时打开主面板（openPanel）→ 分片面板被关闭（互斥另一半）', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useArchivePanelStore.getState().toggle();
    });
    expect(counts.archive()).toBe(1);
    act(() => {
      useGameStore.getState().openPanel('deck');
    });
    expect(counts.archive()).toBe(0);
    expect(useArchivePanelStore.getState().open).toBe(false);
    expect(useGameStore.getState().activePanel).toBe('deck');
  });

  it('关闭方向不广播：已开面板再次 toggle 只关自己（无多余 closePanels）', () => {
    mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useArchivePanelStore.getState().toggle(); // 开
    });
    const received: string[] = [];
    const off = bus.subscribe((e) => {
      if (e.type === 'ui/closePanels') received.push(e.type);
    });
    act(() => {
      useArchivePanelStore.getState().toggle(); // 关（不该广播）
    });
    off();
    expect(received).toEqual([]);
    expect(useArchivePanelStore.getState().open).toBe(false);
  });
});

describe('B3-8 · 分片开启时的反向互斥（主浮层一并关闭）', () => {
  it('抽卡浮层开着时打开选关 → activePanel 归 none、选关打开（不再被背板遮挡）', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useGameStore.getState().openPanel('gacha');
    });
    expect(useGameStore.getState().activePanel).toBe('gacha');
    act(() => {
      useLevelSelectStore.getState().toggle();
    });
    expect(useGameStore.getState().activePanel).toBe('none');
    expect(counts.select()).toBe(1);
    expect(useLevelSelectStore.getState().open).toBe(true);
  });

  it('gacha 相开着时 openFor 攻略 → gacha 相复位 playing、攻略面板打开', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      // rollGacha 的落点（gameStore:1419）：抽卡演出期间 phase='gacha'
      useGameStore.setState({ phase: 'gacha' });
    });
    act(() => {
      useGuidePanelStore.getState().openFor('level-sb-01');
    });
    expect(useGameStore.getState().phase).toBe('playing');
    expect(counts.guide()).toBe(1);
    expect(useGuidePanelStore.getState().open).toBe(true);
  });

  it('档案 toggle 同样关闭主浮层（三个分片入口逐一兑现 closeOverlay）', () => {
    const counts = mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useGameStore.getState().openPanel('settings');
    });
    expect(useGameStore.getState().activePanel).toBe('settings');
    act(() => {
      useArchivePanelStore.getState().toggle();
    });
    expect(useGameStore.getState().activePanel).toBe('none');
    expect(counts.archive()).toBe(1);
    expect(useArchivePanelStore.getState().open).toBe(true);
  });

  it('关闭分支不触碰主浮层：开启已关掉 deck，关闭后 activePanel 保持 none', () => {
    mountPanels();
    act(() => {
      useGameStore.getState().startLevel('level-sb-01');
      useGameStore.getState().openPanel('deck');
    });
    act(() => {
      useArchivePanelStore.getState().toggle(); // 开（反向互斥关掉 deck）
    });
    expect(useGameStore.getState().activePanel).toBe('none');
    expect(useArchivePanelStore.getState().open).toBe(true);
    act(() => {
      useArchivePanelStore.getState().toggle(); // 关（只关自己）
    });
    expect(useArchivePanelStore.getState().open).toBe(false);
    expect(useGameStore.getState().activePanel).toBe('none');
  });
});
