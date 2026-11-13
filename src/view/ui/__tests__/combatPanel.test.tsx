/**
 * 帷幕界面层 · CombatPanel 回归 —— A1-5 布阵相「逃跑」零可见反馈根治。
 * ---------------------------------------------------------------------------
 * 老缺陷：布阵相（battle.phase='formation'）点「🏃 逃跑」，引擎 enqueueAction
 * 拒绝只记 system 日志，而 toCoreCombatState 过滤 actor==='system'（core actor
 * 只有双方）——按钮可点、点击后界面毫无变化，玩家无从得知需先确认布阵。
 * 修复：面板对布阵相逃跑就地拒绝并弹 ui/toast（与 store 的 shove 阶段门禁
 * 「推挤只在布阵阶段可用」同款反馈），不再派发注定被拒的无效行动。
 * battle 相逃跑路径不受新门禁影响（真实状态化逃跑，K2）也在此锁死。
 * C4/C5 增补：逃跑 toast 改键控 combat.fleeLocked（原硬编码中文整句在非中文
 * 语种下同样漏中文）；武器栏只渲染 battle.availableWeapons（此前渲染全武器
 * 表，未持有武器也显示为可点按钮），且武器名按语种经 weaponName 解析。
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
import { createWeaponInstance } from '../../../data/weapons';
import { resolveToastText } from '../HudBar';
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
    // 可见反馈：toast 键控 combat.fleeLocked（C4 收尾：原硬编码中文整句在非中文
    // 语种下同样漏中文），zh-Hans 解析回执仍明示「布阵阶段不能逃跑」语义
    expect(toasts).toContain('combat.fleeLocked');
    expect(resolveToastText('zh-Hans', 'combat.fleeLocked')).toContain('布阵阶段不能逃跑');
    expect(resolveToastText('en', 'combat.fleeLocked')).toContain('No fleeing during formation');
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

/* ==================== C5 · 武器栏只渲染真实可装备武器 ==================== */

/**
 * 老缺陷：武器栏 WEAPONS.map 渲染全武器表 —— battle.availableWeapons 只有 2 把
 * （匕首/篮球）时面板仍显示 5 个等样式按钮，点击未持有的迷吼tiao/大宝剑/拐杖被
 * selectWeapon 守卫拒绝弹 toast，可见性与可用性不一致。修复后武器栏按
 * battle.availableWeapons 渲染（实例 uid 键控，名称按语种经 weaponName 解析）。
 */
describe('C5 · 武器栏渲染 battle.availableWeapons（未持有武器不再出现）', () => {
  /** 构造带可用武器清单的布阵相战斗（玩家只持有匕首） */
  function enterBattleWith(availableWeapons: readonly string[]): void {
    const enemy = findEnemy('enemy-caixukun');
    if (enemy === undefined) throw new Error('敌人表缺 enemy-caixukun');
    const battle = startBattle({
      enemy,
      player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
      ruleSet: { ...DEFAULT_RULE_SET },
      formation: { grid: arena, playerPos: { x: 1, y: 2 }, enemyPos: { x: 2, y: 2 } },
      availableWeapons: availableWeapons.map((defId, i) => {
        const instance = createWeaponInstance(defId, `wi-${defId}-${i}`);
        if (instance === undefined) throw new Error(`武器表缺 ${defId}`);
        return instance;
      }),
    });
    useGameStore.setState({ phase: 'combat', battle, combat: toCoreCombatState(battle) });
  }

  const buttonTexts = (panel: HTMLElement): readonly string[] =>
    [...panel.querySelectorAll('button')].map((b) => b.textContent ?? '');

  it('availableWeapons 仅匕首时，武器栏只出现「匕首 +20」，全表其余武器不再渲染', () => {
    enterBattleWith(['weapon-dagger']);
    const texts = buttonTexts(mountPanel());
    expect(texts.some((t) => t.includes('匕首 +20'))).toBe(true);
    // 未持有的武器（全武器表内的其它成员）一律不出现
    expect(texts.some((t) => t.includes('迷吼tiao'))).toBe(false);
    expect(texts.some((t) => t.includes('张牙舞爪大宝剑'))).toBe(false);
    expect(texts.some((t) => t.includes('爷爷的拐杖'))).toBe(false);
  });

  it('两把持有武器都渲染（篮球与匕首同栏），未持有的迷吼tiao 仍不出现', () => {
    enterBattleWith(['weapon-dagger', 'weapon-basketball']);
    const texts = buttonTexts(mountPanel());
    expect(texts.some((t) => t.includes('匕首 +20'))).toBe(true);
    expect(texts.some((t) => t.includes('篮球 +50'))).toBe(true);
    expect(texts.some((t) => t.includes('迷吼tiao'))).toBe(false);
  });

  it('en 语种下武器名走 weaponName 表（Dagger +20），不再漏中文卡面名', () => {
    enterBattleWith(['weapon-dagger']);
    act(() => {
      useGameStore.getState().setLocale('en');
    });
    const texts = buttonTexts(mountPanel());
    expect(texts.some((t) => t.includes('Dagger +20'))).toBe(true);
    expect(texts.some((t) => t.includes('匕首'))).toBe(false);
    // 还原语种（面板仍挂载，包进 act 避免 React 状态更新告警）
    act(() => {
      useGameStore.getState().setLocale('zh-Hans');
    });
  });
});
