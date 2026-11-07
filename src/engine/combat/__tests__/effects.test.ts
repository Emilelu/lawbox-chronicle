/**
 * combat-engine · effects 单测。
 * 重点：K1 伤害公式/护盾语义、HP clamp、KT2 爆炸耐久、KT3 击退位移
 * （共享原语）、K2 逃跑真实位移、角色卡 buff 校验。
 */

import { describe, expect, it } from 'vitest';
import type { Grid, GridEntity } from '../../../core/types';
import { createWeaponInstance, isWeaponSpent } from '../../../data/weapons';
import { DEFAULT_RULE_SET } from '../../../core/lawRegistry';
import {
  absorbByShield,
  applyBuffs,
  applyBuffTotals,
  applyHp,
  computeDamage,
  computeFlee,
  computeKnockback,
  consumeCharge,
  effectiveEnemyAttack,
  effectivePlayerAttack,
  emptyBuffedStats,
  grantBlockShield,
} from '../effects';

/** 7×5 封闭竞技场 */
const arena: Grid = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

/** 7×5 但顶行 (3,0) 是缺口 */
const gapped: Grid = [
  [1, 1, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function playerEntity(x: number, y: number): GridEntity {
  return { id: 'player-1', kind: 'player', x, y, mass: Infinity, pushable: false };
}
function enemyEntity(id: string, x: number, y: number): GridEntity {
  return { id, kind: 'enemy', x, y, mass: 1, pushable: true };
}

describe('computeDamage —— damage = max(0, atk - def)（K1/K16 公式根治）', () => {
  it('正常差值', () => {
    expect(computeDamage(12, 10)).toBe(2);
    expect(computeDamage(233, 233)).toBe(0);
    expect(computeDamage(80, 6)).toBe(74);
  });

  it('攻击低于防御 → 0，绝不为负（负差值≠回血）', () => {
    expect(computeDamage(10, 12)).toBe(0);
    expect(computeDamage(0, 233)).toBe(0);
    expect(computeDamage(-5, 3)).toBe(0);
  });
});

describe('absorbByShield —— 格挡 = 独立护盾事件', () => {
  it('护盾足额吸收：HP 零伤', () => {
    const result = absorbByShield(10, 4);
    expect(result).toEqual({ shieldAfter: 6, hpDamage: 0, absorbed: 4 });
  });

  it('护盾不足：余量落 HP', () => {
    const result = absorbByShield(10, 15);
    expect(result).toEqual({ shieldAfter: 0, hpDamage: 5, absorbed: 10 });
  });

  it('零/负入参安全', () => {
    expect(absorbByShield(0, 5).hpDamage).toBe(5);
    expect(absorbByShield(5, -3)).toEqual({ shieldAfter: 5, hpDamage: 0, absorbed: 0 });
  });

  it('grantBlockShield：防御 + 加成，永不负', () => {
    expect(grantBlockShield(10, 5)).toBe(15);
    expect(grantBlockShield(0, 0)).toBe(0);
    expect(grantBlockShield(1, -99)).toBe(0);
  });
});

describe('applyHp —— HP 全程 clamp[0, max]（K9）', () => {
  it('上限钳制：满血加血不溢出', () => {
    expect(applyHp(100, 100, 50)).toBe(100);
  });

  it('下限钳制：致死一击恰好 0，不为负', () => {
    expect(applyHp(100, 100, -1000)).toBe(0);
    expect(applyHp(5, 100, -3)).toBe(2);
  });

  it('hpUp 抬升后的 maxHp 内可正常回血（regenerate 通道）', () => {
    expect(applyHp(50, 150, 20)).toBe(70);
  });
});

describe('consumeCharge —— 迷吼tiao 3 次爆炸耐久（KT2）', () => {
  it('逐次消耗：3→2→1→0，第 3 次爆炸后 spent', () => {
    let weapon = createWeaponInstance('weapon-mihotel', 'u1')!;
    expect(weapon.remainingCharges).toBe(3);
    let result = consumeCharge(weapon);
    expect(result.exploded).toBe(true);
    expect(result.remaining).toBe(2);
    weapon = result.weapon;
    result = consumeCharge(weapon);
    weapon = result.weapon;
    result = consumeCharge(weapon);
    weapon = result.weapon;
    expect(result.remaining).toBe(0);
    expect(result.spent).toBe(true);
    expect(isWeaponSpent(weapon)).toBe(true);
  });

  it('耗尽后再消耗：不爆炸（调用方据此退化处理）', () => {
    const weapon = createWeaponInstance('weapon-mihotel', 'u1')!;
    const drained = consumeCharge(consumeCharge(consumeCharge(weapon).weapon).weapon).weapon;
    const result = consumeCharge(drained);
    expect(result.exploded).toBe(false);
    expect(result.spent).toBe(true);
  });

  it('无耐久武器（匕首）原样返回', () => {
    const dagger = createWeaponInstance('weapon-dagger', 'u2')!;
    const result = consumeCharge(dagger);
    expect(result.exploded).toBe(false);
    expect(result.weapon).toEqual(dagger);
  });

  it('实例自带 stats（K8）：实例数值独立于全局表', () => {
    const a = createWeaponInstance('weapon-mihotel', 'a')!;
    const b = createWeaponInstance('weapon-mihotel', 'b')!;
    const afterOne = consumeCharge(a).weapon;
    expect(afterOne.remainingCharges).toBe(2);
    expect(b.remainingCharges).toBe(3); // 另一个实例不受影响
    expect(afterOne.attack).toBe(80); // stats 副本仍在
  });
});

describe('computeKnockback —— 拐杖击退位移（KT3，共享原语）', () => {
  it('直线上击退 2 格', () => {
    const result = computeKnockback(arena, [playerEntity(1, 2), enemyEntity('mob', 2, 2)], 'mob', 'right', 2);
    expect(result.steps).toBe(2);
    expect(result.fell).toBe(false);
    expect(result.entities.find((e) => e.id === 'mob')?.x).toBe(4);
  });

  it('撞墙即停：实际位移 < maxSteps', () => {
    const result = computeKnockback(arena, [playerEntity(1, 2), enemyEntity('mob', 2, 2)], 'mob', 'right', 5);
    // (2,2)→(3,2)→(4,2)→(5,2)，(6,2) 是墙 → 停 3 步
    expect(result.steps).toBe(3);
    expect(result.entities.find((e) => e.id === 'mob')?.x).toBe(5);
  });

  it('击退出缺口 → 坠落移除（外力位移的越界由共享守卫 isInside 结算）', () => {
    const result = computeKnockback(gapped, [playerEntity(3, 1), enemyEntity('mob', 3, 0)], 'mob', 'up', 3);
    expect(result.fell).toBe(true);
    expect(result.entities.some((e) => e.id === 'mob')).toBe(false);
    expect(result.steps).toBe(1); // 起身即越界，一步坠出
  });

  it('被击退者撞上其他敌人时连锁推挤（与推箱行为一致）', () => {
    const entities = [playerEntity(1, 2), enemyEntity('a', 2, 2), enemyEntity('b', 3, 2)];
    const result = computeKnockback(arena, entities, 'a', 'right', 1);
    expect(result.steps).toBe(1);
    expect(result.entities.find((e) => e.id === 'a')?.x).toBe(3);
    expect(result.entities.find((e) => e.id === 'b')?.x).toBe(4);
  });

  it('maxSteps ≤ 0 / 目标不存在 → 零位移', () => {
    const entities = [enemyEntity('mob', 2, 2)];
    expect(computeKnockback(arena, entities, 'mob', 'right', 0).steps).toBe(0);
    expect(computeKnockback(arena, entities, 'ghost', 'right', 3).steps).toBe(0);
  });
});

describe('computeFlee —— 逃跑 = 真实位移（K2）', () => {
  it('毗邻敌人时逃到最近安全格，返回位移后的实体层', () => {
    const entities = [playerEntity(1, 2), enemyEntity('mob', 2, 2)];
    const result = computeFlee(arena, entities, 'player-1');
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(true);
    expect(result.to).toEqual({ x: 0, y: 2 });
    expect(result.entities.find((e) => e.id === 'player-1')?.x).toBe(0);
    // 新位置周围一格内无敌人
    const mob = result.entities.find((e) => e.id === 'mob')!;
    expect(Math.abs(mob.x - 0) + Math.abs(mob.y - 2)).toBeGreaterThan(1);
  });

  it('原地已安全 → ok 但不移动', () => {
    const entities = [playerEntity(1, 1), enemyEntity('mob', 5, 3)];
    const result = computeFlee(arena, entities, 'player-1');
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(false);
  });

  it('全部可达格都被敌人威慑 → 逃跑失败（ok:false，回合交给敌方）', () => {
    // 3×3 内场紧格：玩家居中，四个正交邻格全被敌人占住，
    // 四角 (1,1)(3,1)(1,3)(3,3) 各距某敌人 1 格 → 无安全格
    const tight: Grid = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const entities = [
      playerEntity(2, 2),
      enemyEntity('e1', 2, 1),
      enemyEntity('e2', 2, 3),
      enemyEntity('e3', 1, 2),
      enemyEntity('e4', 3, 2),
    ];
    const result = computeFlee(tight, entities, 'player-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-safe-cell');
  });

  it('玩家不存在 → no-player', () => {
    const result = computeFlee(arena, [enemyEntity('mob', 2, 2)], 'ghost');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-player');
  });
});

describe('applyBuffs —— 角色卡 buff 消费 lawRegistry schema', () => {
  it('合法 buff 全部生效', () => {
    const result = applyBuffs(emptyBuffedStats(), [
      { buffId: 'attackUp', value: 50 },
      { buffId: 'defenseUp', value: 10 },
      { buffId: 'hpUp', value: 100 },
      { buffId: 'firstStrike', value: 1 },
      { buffId: 'regenerate', value: 5 },
    ]);
    expect(result.rejected).toHaveLength(0);
    expect(result.stats).toEqual({ attackBonus: 50, defenseBonus: 10, maxHpBonus: 100, firstStrike: true, regen: 5 });
  });

  it('越界数值 / 未知 BuffId 拒收（坏档不污染战斗）', () => {
    const result = applyBuffs(emptyBuffedStats(), [
      { buffId: 'attackUp', value: 999 }, // > 120
      { buffId: 'regenerate', value: 0 }, // < 1
      { buffId: 'fly', value: 1 }, // 未知 id
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
    expect(result.stats).toEqual(emptyBuffedStats());
  });

  it('firstStrike 0 → 不触发先攻', () => {
    const result = applyBuffs(emptyBuffedStats(), [{ buffId: 'firstStrike', value: 0 }]);
    expect(result.stats.firstStrike).toBe(false);
  });

  it('applyBuffTotals 适配 selectors 的合计表', () => {
    const result = applyBuffTotals(emptyBuffedStats(), { attackUp: 60, defenseUp: 5 });
    expect(result.stats.attackBonus).toBe(60);
    expect(result.stats.defenseBonus).toBe(5);
  });
});

describe('effectivePlayerAttack / effectiveEnemyAttack —— RuleSet 消费', () => {
  it('base + 武器自带 attack + buff，再乘 playerAttackMul', () => {
    const mihotel = createWeaponInstance('weapon-mihotel', 'u1')!;
    const buffs = { ...emptyBuffedStats(), attackBonus: 7 };
    const ruleSet = { ...emptyRuleSet(), playerAttackMul: 1.5 };
    const breakdown = effectivePlayerAttack(10, mihotel, buffs, ruleSet);
    expect(breakdown.weaponBonus).toBe(80);
    expect(breakdown.total).toBe(Math.round((10 + 80 + 7) * 1.5)); // 145
  });

  it('武器耗尽 → 武器加成归零（徒手），实例 stats 不查全局表（K8）', () => {
    let weapon = createWeaponInstance('weapon-mihotel', 'u1')!;
    weapon = consumeCharge(consumeCharge(consumeCharge(weapon).weapon).weapon).weapon;
    const breakdown = effectivePlayerAttack(10, weapon, emptyBuffedStats(), emptyRuleSet());
    expect(breakdown.weaponBonus).toBe(0);
    expect(breakdown.total).toBe(10);
  });

  it('enemyAttackMul 生效且永不为负（K16 安全乘法）', () => {
    expect(effectiveEnemyAttack(233, { ...emptyRuleSet(), enemyAttackMul: 0.75 })).toBe(175);
    expect(effectiveEnemyAttack(0, emptyRuleSet())).toBe(0);
  });
});

function emptyRuleSet() {
  // 集成期：RuleSet 扩展了谜题侧字段，改从 core 默认值派生，避免手写漂移
  return { ...DEFAULT_RULE_SET };
}
