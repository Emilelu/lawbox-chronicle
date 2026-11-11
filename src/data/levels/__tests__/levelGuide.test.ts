/**
 * 关卡攻略数据单测 —— 面板与文档 HTML 共用的 buildLevelGuide。
 * GUIDE-7 增补：twist（LEVEL_TWISTS 唯一文字源 / MECH-4 引擎字段联动锁定）、
 * pushes 与 PRECOMPUTED_SOLUTIONS 同源一致性（面板箭头 = 文档箭头 = 解路）、
 * gateHint 泛化消费 LAW_GATES（STORY-5 合入 level-sb-04 后自动覆盖 L4）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AREA_LEVELS } from '../areas';
import { PRECOMPUTED_SOLUTIONS } from '../solutionSteps';
import { LAW_GATES } from '../../../engine/story/triggers';
import { CARDS } from '../../gacha';
import { buildLevelGuide, LEVEL_TWISTS } from '../levelGuide';
import { LevelGuidePanel, useGuidePanelStore } from '../../../view/ui/LevelGuidePanel';

/** 与 levelGuide.ts 的 ARROWS 映射对照（测试内镜像，验证映射本身） */
const ARROWS: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

describe('levelGuide —— 主线关攻略', () => {
  it('主线 12 关每关都有攻略，推法数与预计算解路一致', () => {
    for (const level of AREA_LEVELS) {
      const guide = buildLevelGuide(level.id);
      expect(guide.known, `${level.id} 应为已知主线关`).toBe(true);
      expect(guide.name).toBe(level.name);
      expect(guide.pushes.length).toBe(PRECOMPUTED_SOLUTIONS[level.id]?.length ?? -1);
      expect(guide.stars.three).toBe(level.parSteps[0]);
      expect(guide.stars.two).toBe(level.parSteps[1]);
      expect(guide.mechanics.length).toBeGreaterThan(0);
    }
  });

  it('机制提示按关卡数据推导', () => {
    const hub = buildLevelGuide('level-sb-01');
    expect(hub.mechanics.some((m) => m.includes('星愿祭坛'))).toBe(true);
    expect(hub.mechanics.some((m) => m.includes('尖刺'))).toBe(true);

    const yin = buildLevelGuide('level-lb-09');
    expect(yin.mechanics.some((m) => m.includes('阴阳位面'))).toBe(true);

    const guards = buildLevelGuide('level-lb-08');
    expect(guards.mechanics.some((m) => m.includes('守卫'))).toBe(true);

    const height = buildLevelGuide('level-lb-08');
    expect(height.mechanics.some((m) => m.includes('立体高度层'))).toBe(true);
  });

  it('法则门提示与 LAW_GATES 一致（sb-02 需羽箱）', () => {
    const guide = buildLevelGuide('level-sb-02');
    expect(guide.gateHint).not.toBeNull();
    expect(guide.gateHint).toContain('羽箱');
  });

  it('推法描述含方向箭头与坐标', () => {
    const guide = buildLevelGuide('level-sb-01');
    expect(guide.pushes.length).toBeGreaterThan(0);
    const first = guide.pushes[0];
    expect(first?.arrow).toMatch(/^[↑↓←→]$/);
    expect(first?.label).toContain('(');
  });

  it('未知关卡（会话生成）返回无固定攻略的占位', () => {
    const guide = buildLevelGuide('endless-some-seed-1');
    expect(guide.known).toBe(false);
    expect(guide.pushes).toHaveLength(0);
    expect(guide.mechanics[0]).toContain('程序生成');
  });
});

describe('levelGuide —— twist 与文档同步（GUIDE-7）', () => {
  it('L10 guide 含 goalOrder 文案、L11 含单向门文案（MECH-4 引擎字段联动锁定）', () => {
    // 文案唯一文字源是 LEVEL_TWISTS（数据层）；MECH-4 的 goalOrder/oneWay 字段
    // 合入后机制行追加同一措辞 —— 断言针对 twist+mechanics 全文，两种来源皆绿。
    const l10 = buildLevelGuide('level-lb-10');
    const l10Text = [l10.twist ?? '', ...l10.mechanics].join('\n');
    expect(l10Text).toContain('旗位必须按序落座');

    const l11 = buildLevelGuide('level-lb-11');
    const l11Text = [l11.twist ?? '', ...l11.mechanics].join('\n');
    expect(l11Text).toContain('单向格仅允许箭头方向通过（箱子不受限）');
  });

  it('主线 12 关 twist 全部非空且与 LEVEL_TWISTS 逐字一致；未列入的关为 null', () => {
    for (const level of AREA_LEVELS) {
      const guide = buildLevelGuide(level.id);
      expect(guide.twist, `${level.id} 应有 twist`).not.toBeNull();
      expect(guide.twist?.length ?? 0).toBeGreaterThan(0);
      expect(LEVEL_TWISTS[level.id] ?? null).toBe(guide.twist);
    }
    // 无 twist 关（未列入 LEVEL_TWISTS，如程序生成/会话关）→ null
    const unknown = buildLevelGuide('endless-some-seed-1');
    expect(unknown.twist).toBeNull();
  });

  it('pushes 不受 twist 改动影响：逐推方向与 PRECOMPUTED_SOLUTIONS 同源（抽查 L10 首推向右）', () => {
    for (const level of AREA_LEVELS) {
      const guide = buildLevelGuide(level.id);
      const solution = PRECOMPUTED_SOLUTIONS[level.id] ?? [];
      expect(guide.pushes.length, `${level.id} 推法数应一致`).toBe(solution.length);
      solution.forEach((step, i) => {
        expect(guide.pushes[i]?.arrow, `${level.id} 第 ${i + 1} 推箭头应与解路同源`).toBe(ARROWS[step.dir]);
      });
    }
    // 抽查 L10 首推：解路 dir=right（stand(1,2) 把箱子 (2,2)→(3,2)），面板箭头应为 →
    const first = PRECOMPUTED_SOLUTIONS['level-lb-10']?.[0];
    expect(first?.dir).toBe('right');
    const l10 = buildLevelGuide('level-lb-10');
    expect(l10.pushes[0]?.arrow).toBe('→');
    expect(l10.pushes[0]?.label).toContain('(2,2)');
  });

  it('gateHint 泛化消费 LAW_GATES 全部条目（STORY-5 合入 level-sb-04 后自动覆盖 L4）', () => {
    expect(LAW_GATES.length).toBeGreaterThan(0);
    for (const gate of LAW_GATES) {
      const guide = buildLevelGuide(gate.levelId);
      expect(guide.gateHint, `${gate.levelId} 应有法则门提示`).not.toBeNull();
      for (const cardId of gate.requiredCardIds) {
        const name = CARDS.find((c) => c.id === cardId)?.name ?? cardId;
        expect(guide.gateHint, `${gate.levelId} 应提示卡名「${name}」`).toContain(name);
      }
    }
  });

  it('有预计算解路的关 note 含「新玩法已按引擎结算」句；未知关不含', () => {
    const hub = buildLevelGuide('level-sb-01');
    expect(hub.note).toContain('新玩法已在预计算解路中按引擎结算，照面板箭头推必落座');

    const unknown = buildLevelGuide('endless-some-seed-1');
    expect(unknown.note).toBe('本关无预计算解法。');
  });
});

describe('levelGuide —— 面板 twist 置顶渲染（GUIDE-7 验收②结构断言）', () => {
  // 渲染走 react-dom createRoot + act（仓库未引入 @testing-library，沿 panelLayout.test 先例）
  let host: HTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    useGuidePanelStore.getState().close();
  });

  function renderPanel(levelId: string): HTMLElement {
    act(() => {
      useGuidePanelStore.getState().openFor(levelId);
      root = createRoot(host);
      root!.render(createElement(LevelGuidePanel));
    });
    const panel = host.querySelector('div.glass');
    expect(panel, `${levelId} 攻略面板未挂载`).not.toBeNull();
    return panel as HTMLElement;
  }

  it('L10/L11 twist 行是面板首个内容节点（标题行之下、副标题之前）且带防溢出样式', () => {
    for (const [levelId, phrase] of [
      ['level-lb-10', '旗位必须按序落座'],
      ['level-lb-11', '单向格仅允许箭头方向通过（箱子不受限）'],
    ] as const) {
      const panel = renderPanel(levelId);
      const twist = panel.querySelector<HTMLElement>('[data-guide-twist]');
      expect(twist, `${levelId} twist 行应渲染`).not.toBeNull();
      expect(twist!.textContent).toContain(phrase);
      // 防溢出：长句必须可换行（whiteSpace 显式 normal + word-break 兜底）
      expect(twist!.style.whiteSpace).toBe('normal');
      expect(twist!.style.wordBreak).toBe('break-word');
      // 置顶：面板子节点顺序 = [标题行, twist 行, 副标题, …] —— twist 是第二个节点
      const children = Array.from(panel.children);
      expect(children[1], `${levelId} twist 行应紧跟标题行（置顶）`).toBe(twist);
      act(() => root?.unmount());
      root = null;
    }
  });

  it('无 twist 关（程序生成）面板不渲染 twist 行', () => {
    const panel = renderPanel('endless-some-seed-1');
    expect(panel.querySelector('[data-guide-twist]')).toBeNull();
  });
});
