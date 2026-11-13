/**
 * 帷幕界面层 · ResultModal / CombatPanel 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * summarizeResult：奖励数字必须与 store 结算同源（core/formula.starStoneReward），
 * 坏档（未知 levelId）返回 null；canEquipWeapon：K7 武器越界守卫。
 * findLevel 从真实关卡表取数（level-sb-01 的 parSteps=[60,110]、奖励 300◈ +
 * card-law-feather-chest），兼作 data 层契约的只读核对。
 * B3-3：组件注入点已改 findLevelAny（静态表 + 会话注册表）——会话生成关卡
 * （挑战层）吃到完整结算，不再走「坏档兜底」分支。
 */

import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../../data';
import { findLevel } from '../../../data/levels';
import { findLevelAny, registerSessionLevel } from '../../../core/store/gameStore';
import { canEquipWeapon } from '../CombatPanel';
import { summarizeResult } from '../ResultModal';
import type { Level3D } from '../../../engine/puzzle/grid';

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

  it('C4：奖励法则卡名按语种解析（en 下结算弹窗不再显示数据层中文卡名）', () => {
    const summary = summarizeResult({ levelId: 'level-sb-01', stars: 3, steps: 42 }, findLevel, 'en');
    expect(summary?.lawCardName).toBe('Law · Feather Chest');
    expect(summary?.lawCardName).not.toContain('法则');
  });
});

describe('B3-3 · 会话生成关卡的完整结算（findLevelAny 注入）', () => {
  it('静态表查不到的会话关卡经 findLevelAny 命中注册表，产出完整摘要（星级/步数线/奖励）', () => {
    const sessionLevel: Level3D = {
      id: 'endless-challenge-east-endless-f1',
      area: 'domain-3',
      name: '无尽回廊 · 第 1 层',
      subtitle: '程序生成 + 求解器验证的挑战层',
      grid: [
        [1, 1, 1, 1],
        [1, 2, 4, 1],
        [1, 3, 0, 1],
        [1, 1, 1, 1],
      ],
      parSteps: [20, 30],
      reward: { starStones: 80 },
    };
    registerSessionLevel(sessionLevel);
    // 对照：静态 findLevel 查不到会话关卡（修复前结算退化为坏档兜底的根因）
    expect(findLevel(sessionLevel.id)).toBeUndefined();
    // 组件注入 findLevelAny：摘要齐全（★/步数线/奖励明细），不再是 null
    const summary = summarizeResult({ levelId: sessionLevel.id, stars: 3, steps: 12 }, findLevelAny);
    expect(summary).not.toBeNull();
    expect(summary?.levelName).toBe('无尽回廊 · 第 1 层');
    expect(summary?.parThreeStar).toBe(20);
    expect(summary?.rewardStones).toBe(80);
    expect(summary?.lawCardName).toBeNull();
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
