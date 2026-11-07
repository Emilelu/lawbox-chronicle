/**
 * 帷幕界面层 · ResultModal / CombatPanel 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * summarizeResult：奖励数字必须与 store 结算同源（core/formula.starStoneReward），
 * 坏档（未知 levelId）返回 null；canEquipWeapon：K7 武器越界守卫。
 * findLevel 从真实关卡表取数（level-sb-01 的 parSteps=[60,110]、奖励 300◈ +
 * card-law-feather-chest），兼作 data 层契约的只读核对。
 */

import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../../data';
import { findLevel } from '../../../data/levels';
import { canEquipWeapon } from '../CombatPanel';
import { summarizeResult } from '../ResultModal';

describe('summarizeResult · 结算摘要（真实关卡表）', () => {
  it('三星：奖励 = 基础 300 × 3/3 = 300，附法则卡名与稀有度', () => {
    const summary = summarizeResult({ levelId: 'level-sb-01', stars: 3, steps: 42 }, findLevel);
    expect(summary).not.toBeNull();
    expect(summary?.levelName).toBe('初醒箱庭');
    // 集成期：parSteps 以 areas.ts 的 solver 实测标定为准（原 4 关基座化后重标）
    expect(summary?.parThreeStar).toBe(findLevel('level-sb-01')?.parSteps[0]);
    expect(summary?.rewardStones).toBe(300);
    expect(summary?.lawCardName).toBe('法则·羽箱');
    expect(summary?.lawCardRarity).toBe(2);
  });

  it('一星：奖励 = ⌊300 × 1/3⌋ = 100（与 store 结算同源）', () => {
    const summary = summarizeResult({ levelId: 'level-sb-01', stars: 1, steps: 500 }, findLevel);
    expect(summary?.rewardStones).toBe(100);
    expect(summary?.stars).toBe(1);
    expect(summary?.steps).toBe(500);
  });

  it('无法则卡奖励的关卡：lawCardName 为 null', () => {
    const summary = summarizeResult({ levelId: 'level-sb-02', stars: 3, steps: 10 }, findLevel);
    expect(summary?.lawCardName).toBeNull();
    expect(summary?.lawCardRarity).toBeNull();
  });

  it('未知 levelId（坏档）→ null，由组件走可关闭兜底（S11）', () => {
    expect(summarizeResult({ levelId: 'level-ghost', stars: 3, steps: 1 }, findLevel)).toBeNull();
  });
});

describe('canEquipWeapon · K7 武器守卫', () => {
  it('武器表内 id 可装备', () => {
    expect(canEquipWeapon('weapon-dagger', WEAPONS)).toBe(true);
    expect(canEquipWeapon('weapon-gfsStick', WEAPONS)).toBe(true);
  });

  it('未知 id / 空表拒绝（off-by-one 与幽灵 id 双防）', () => {
    expect(canEquipWeapon('weapon-ghost', WEAPONS)).toBe(false);
    expect(canEquipWeapon('', WEAPONS)).toBe(false);
    expect(canEquipWeapon('weapon-dagger', [])).toBe(false);
  });
});
