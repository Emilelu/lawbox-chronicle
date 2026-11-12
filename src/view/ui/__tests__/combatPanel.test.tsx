/**
 * 帷幕界面层 · CombatPanel 回归 —— A1-5 布阵相「逃跑」零可见反馈根治。
 * ---------------------------------------------------------------------------
 * 老缺陷：布阵相（battle.phase='formation'）点「🏃 逃跑」，引擎 enqueueAction
 * 拒绝只记 system 日志，而 toCoreCombatState 过滤 actor==='system'（core actor
 * 只有双方）——按钮可点、点击后界面毫无变化，玩家无从得知需先确认布阵。
 * 修复：面板对布阵相逃跑就地拒绝并弹 ui/toast（与 store 的 shove 阶段门禁
 * 「推挤只在布阵阶段可用」同款反馈），不再派发注定被拒的无效行动。
 * battle 相逃跑路径不受新门禁影响（真实状态化逃跑，K2）也在此锁死。
 * 渲染走 react-dom createRoot + act（仓库未引入 @testing-library）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { bus } from '../../../core/events/bus';
import { DEFAULT_RULE_SET } from '../../../core/lawRegistry';
import { useGameStore } from '../../../core/store/gameStore';
import type { Grid } from '../../../core/types';
import { startBattle, toCoreCombatState, type BattleState } from '../../../engine/combat/turn';
import { findEnemy } from '../../../data/enemies';
import { CombatPanel } from '../CombatPanel';

// React 18 要求显式声明 act 环境，否则每次 act 都刷告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

/** GameState.battle 在 core 契约里是 unknown | null：测试侧断言引擎形状（flow.test 同款） */
const battleOf = (): BattleState | null => useGameStore.getState().battle as BattleState | null;

/** 7×5 封闭竞技场（与 turn.test 同款：玩家四邻必有安全格，逃跑必成功） */
const arena: Grid = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

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

/** 用引擎真实产物构造布阵相战斗（startBattle + toCoreCombatState，无 mock） */
function enterFormationBattle(): void {
  const enemy = findEnemy('enemy-caixukun');
  if (enemy === undefined) throw new Error('敌人表缺 enemy-caixukun');
  const battle = startBattle({
    enemy,
    player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
    ruleSet: { ...DEFAULT_RULE_SET },
    formation: { grid: arena, playerPos: { x: 1, y: 2 }, enemyPos: { x: 2, y: 2 } },
  });
  useGameStore.setState({ phase: 'combat', battle, combat: toCoreCombatState(battle) });
}

function mountPanel(): HTMLElement {
  act(() => {
    root = createRoot(host);
    root!.render(<CombatPanel />);
  });
  return host;
}

const fleeButton = (panel: HTMLElement): HTMLButtonElement => {
  const btn = [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('🏃'));
  expect(btn, '逃跑按钮未挂载').toBeDefined();
  return btn as HTMLButtonElement;
};

describe('A1-5 · 布阵相逃跑按钮可见反馈', () => {
  it('布阵相点「逃跑」弹 ui/toast，战斗状态零变化（不再静默吞进被过滤的 system 日志）', () => {
    enterFormationBattle();
    const toasts: string[] = [];
    const off = bus.subscribe((event) => {
      if (event.type === 'ui/toast') toasts.push(event.messageKey);
    });
    const panel = mountPanel();
    const btn = fleeButton(panel);
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    off();
    // 可见反馈：toast 明示布阵阶段不能逃跑（修复前：无 toast、日志区不显示、界面无变化）
    expect(toasts.some((t) => t.includes('布阵阶段不能逃跑'))).toBe(true);
    // 战斗状态零变化：没有派发注定被拒的 flee（队列空、无「无效行动」system 日志、仍在布阵相）
    const battle = battleOf();
    expect(battle?.phase).toBe('formation');
    expect(battle?.queue).toEqual([]);
    expect(battle?.log.some((entry) => entry.text.includes('无效行动'))).toBe(false);
  });

  it('battle 相「逃跑」不受新门禁影响：真实走 combatAct 结束战斗（K2 状态化逃跑）', () => {
    enterFormationBattle();
    // 确认布阵开打（store toggleFormation 的 formation 相语义 → startBattle）
    useGameStore.getState().dispatch({ type: 'toggleFormation' });
    expect(battleOf()?.phase).toBe('battle');
    const panel = mountPanel();
    const btn = fleeButton(panel);
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 逃跑真实生效：引擎 phase='fled' → store settleBattleEnd 收尾清空 combat 回世界
    expect(useGameStore.getState().combat).toBeNull();
    expect(useGameStore.getState().battle).toBeNull();
    expect(useGameStore.getState().phase).toBe('playing');
  });
});
