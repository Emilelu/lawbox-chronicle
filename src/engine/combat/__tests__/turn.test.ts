/**
 * combat-engine · turn 单测。
 * 覆盖：K1 格挡=护盾、K2 逃跑=真实位移、K9 结算报告对象/HP clamp、
 * K10 分身上限、K12 武器真实选择、K16 阶段技能参数化、KT2 爆炸耐久。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_SET } from '../../../core/lawRegistry';
import type { Rng } from '../../../core/rng';
import type { Grid } from '../../../core/types';
import { findEnemy, findEnemyProfile } from '../../../data/enemies';
import { createWeaponInstance } from '../../../data/weapons';
import type { BattleConfig, BattleState } from '../turn';
import { enqueueAction, resolveTurn, settleBattle, startBattle, stepBattle } from '../turn';

/** 7×5 封闭竞技场（四周墙） */
const arena: Grid = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

/** 永不暴击的确定性 rng（伤害断言不被随机性干扰） */
const neverCrit: Rng = {
  next: () => 0.99,
  int: (min) => min,
  chance: () => false,
  pick: (items) => items[0]!,
  fork: () => neverCrit,
  seedLabel: 'stub-never-crit',
};

function config(overrides?: Partial<BattleConfig>): BattleConfig {
  const enemy = findEnemy('enemy-caixukun')!;
  return {
    enemy,
    player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
    ruleSet: DEFAULT_RULE_SET,
    ...overrides,
  };
}

/** 布阵→开战 的便捷入口 */
function battleStart(overrides?: Partial<BattleConfig>): BattleState {
  return resolveTurn(startBattle(config(overrides)), { type: 'startBattle' }, neverCrit);
}

describe('startBattle —— 开战状态', () => {
  it('初始为布阵阶段，HP 满血，武器未选（K12：绝不代选）', () => {
    const state = startBattle(config());
    expect(state.phase).toBe('formation');
    expect(state.enemyHp).toBe(28);
    expect(state.weapon).toBeNull();
    expect(state.clones).toBe(0);
    expect(state.shield).toBe(0);
  });

  it('BOSS 读取档案：免疫推挤实体 + 开场 2 分身（Game.java:1614）', () => {
    const state = startBattle(
      config({
        enemy: findEnemy('enemy-ylzz')!,
        formation: { grid: arena, playerPos: { x: 1, y: 2 }, enemyPos: { x: 3, y: 2 } },
      }),
    );
    expect(state.enemyBoss).toBe(true);
    expect(state.clones).toBe(2);
    expect(state.enemyBaseAttack).toBe(233);
    const boss = state.formation?.entities.find((e) => e.id === 'enemy-ylzz');
    expect(boss?.shoveImmune).toBe(true);
    // 两个分身已被放置在 boss 周围空闲格（质量 1、可推、HP 1）
    const clones = state.formation?.entities.filter((e) => e.id.startsWith('battle-enemy-ylzz-clone')) ?? [];
    expect(clones).toHaveLength(2);
    for (const clone of clones) {
      expect(clone.mass).toBe(1);
      expect(clone.pushable).toBe(true);
    }
  });

  it('剧情覆写：作者问答把 BOSS 攻击设为 0（setEnemyAttack → 弱点路径）', () => {
    const state = startBattle(config({ enemy: findEnemy('enemy-ylzz')!, enemyAttackOverride: 0 }));
    expect(state.enemyBaseAttack).toBe(0);
  });
});

describe('K1 格挡 = 独立护盾事件（防御永不回血）', () => {
  it('敌方攻击 = max(0, atk-def)：12-10=2，玩家 HP 只减不增', () => {
    const started = battleStart();
    const afterAttack = resolveTurn(started, { type: 'attack' }, neverCrit);
    expect(afterAttack.playerHp).toBe(98); // 100 - (12-10)
    const report = settleBattle(afterAttack);
    expect(report.damageTaken).toBe(2);
  });

  it('defend 获得护盾，敌方命中先扣盾再扣血；护盾结算后清零', () => {
    const started = battleStart();
    // 用 stepBattle 逐项结算，观察护盾的中间态
    let state = enqueueAction(started, { type: 'defend' });
    state = stepBattle(state, neverCrit); // 玩家 defend
    expect(state.shield).toBe(10);
    expect(state.playerHp).toBe(100); // 防御姿态不回血
    state = stepBattle(state, neverCrit); // 敌方行动：12 攻 - 10 防 = 2，全被护盾吸收
    expect(state.shield).toBe(0);
    expect(state.playerHp).toBe(100);
    const enemyLog = state.log.find((e) => e.actor === 'enemy');
    expect(enemyLog?.shielded).toBe(2);
    expect(enemyLog?.damage).toBe(0);
  });

  it('攻击低于防御 → 0 伤害（负差值绝不变成回血，K16 同源）', () => {
    const state = battleStart({ enemy: findEnemy('enemy-caixukun')!, player: { hp: 5, maxHp: 100, baseAttack: 0, defense: 50 } });
    const after = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(after.playerHp).toBeLessThanOrEqual(5);
    // 敌方 12 攻 vs 50 防 → 0 伤害，玩家 HP 不变
    expect(after.playerHp).toBe(5);
  });
});

describe('K16 BOSS 攻击参数化为阶段技能（无裸乘溢出/秒杀）', () => {
  it('阶段切换：mul 作用于 baseAttack，分身翻倍有界，伤害可预期', () => {
    const profile = {
      enemyId: 'test-boss',
      phases: [
        { name: '一阶段', threshold: 1, attackMul: 1, hits: 1, cloneDouble: false },
        { name: '二阶段', threshold: 0.5, attackMul: 3, hits: 1, cloneDouble: true },
      ],
      initialClones: 2,
    };
    const enemy = { ...findEnemy('enemy-caixukun')!, id: 'test-boss', name: '测试BOSS', maxHp: 100, attack: 10, defense: 0, boss: true };
    let state = battleStart({
      enemy,
      profile,
      player: { hp: 10000, maxHp: 10000, baseAttack: 40, defense: 0 },
    });
    // 第一回合：40 伤害 → 60/100 = 0.6 > 0.5，仍一阶段；敌方 10 攻
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(state.enemyHp).toBe(60);
    expect(state.phaseIndex).toBe(0);
    expect(state.playerHp).toBe(9990);
    // 第二回合：40 → 20/100 = 0.2 ≤ 0.5 → 二阶段；敌方 10×3=30 攻，分身 2→4
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(state.enemyHp).toBe(20);
    expect(state.phaseIndex).toBe(1);
    expect(state.clones).toBe(4);
    expect(state.playerHp).toBe(9990 - 30);
    expect(state.log.some((e) => e.text.includes('二阶段'))).toBe(true);
  });

  it('影流之主阶段表：0.33 阈值神之乱击 = 233×3=699，而非 233666438×3', () => {
    const enemy = { ...findEnemy('enemy-ylzz')!, maxHp: 300, defense: 0 };
    let state = battleStart({
      enemy,
      profile: findEnemyProfile('enemy-ylzz'),
      player: { hp: 10000, maxHp: 10000, baseAttack: 101, defense: 0 },
    });
    state = resolveTurn(state, { type: 'attack' }, neverCrit); // hp 199 (0.663>0.66)
    state = resolveTurn(state, { type: 'attack' }, neverCrit); // hp 98 (0.327≤0.33 → 神之乱击)
    expect(state.enemyHp).toBe(98);
    expect(state.phaseIndex).toBe(2);
    const report = settleBattle(state);
    // 一阶段 233 + 神之乱击 699 = 932（而非 233 + 700999314）
    expect(report.damageTaken).toBe(233 + 699);
    expect(state.playerHp).toBe(10000 - 932);
    expect(state.log.some((e) => e.text.includes('神之乱击') || e.text.includes('分身成了三个'))).toBe(true);
  });

  it('攻击覆写为 0 时 BOSS 零伤害（作者问答弱点路径，永不产生负伤害）', () => {
    const state = battleStart({
      enemy: findEnemy('enemy-ylzz')!,
      enemyAttackOverride: 0,
      player: { hp: 50, maxHp: 50, baseAttack: 10, defense: 0 },
    });
    const after = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(after.playerHp).toBe(50);
    expect(after.stats.damageTaken).toBe(0);
  });
});

describe('K10 分身上限 64 有界（Game.java:1828 shadow=shadow*2 溢出根治）', () => {
  it('阶段切入翻倍：40 → min(80, 64) = 64，恒有界且为安全整数', () => {
    const profile = {
      enemyId: 'clone-boss',
      phases: [
        { name: '蓄势', threshold: 1, attackMul: 0, hits: 1, cloneDouble: false },
        { name: '分身狂潮', threshold: 1, attackMul: 0, hits: 1, cloneDouble: true },
      ],
      initialClones: 40,
    };
    const enemy = { ...findEnemy('enemy-caixukun')!, id: 'clone-boss', maxHp: 9999, attack: 0, defense: 0, boss: true };
    let state = battleStart({ enemy, profile, player: { hp: 9999, maxHp: 9999, baseAttack: 0, defense: 0 } });
    expect(state.clones).toBe(40);
    state = resolveTurn(state, { type: 'defend' }, neverCrit);
    expect(state.clones).toBe(64);
    expect(Number.isSafeInteger(state.clones)).toBe(true);
    // 已在最高阶段，反复行动不再翻倍、不再越界
    for (let i = 0; i < 5; i++) {
      state = resolveTurn(state, { type: 'defend' }, neverCrit);
      expect(state.clones).toBe(64);
    }
  });
});

describe('K12 布阵阶段真实选择武器（绝不代选）', () => {
  it('选择 availableWeapons 之外的 uid → 拒绝且武器仍为空', () => {
    const dagger = createWeaponInstance('weapon-dagger', 'w-dagger-1')!;
    const started = startBattle(config({ availableWeapons: [dagger] }));
    const rejected = resolveTurn(started, { type: 'selectWeapon', uid: 'w-fake' }, neverCrit);
    expect(rejected.weapon).toBeNull();
    expect(rejected.log.some((e) => e.text.includes('没有这把武器'))).toBe(true);
  });

  it('合法选择后攻击结算使用实例自带 stats（K8：不查全局表）', () => {
    const dagger = createWeaponInstance('weapon-dagger', 'w-dagger-1')!;
    const started = startBattle(config({ availableWeapons: [dagger] }));
    const equipped = resolveTurn(started, { type: 'selectWeapon', uid: 'w-dagger-1' }, neverCrit);
    expect(equipped.weapon?.attack).toBe(20);
    const fought = resolveTurn(equipped, { type: 'startBattle' }, neverCrit);
    const after = resolveTurn(fought, { type: 'attack' }, neverCrit);
    // (10 + 20) - 6 = 24（蔡徐坤防御 6）
    expect(after.enemyHp).toBe(28 - 24);
  });
});

describe('KT2 迷吼tiao 3 次爆炸耐久', () => {
  function mihotelBattle(): BattleState {
    const enemy = { ...findEnemy('enemy-caixukun')!, maxHp: 300 };
    const mihotel = createWeaponInstance('weapon-mihotel', 'w-mihotel-1')!;
    const started = startBattle(config({ enemy, availableWeapons: [mihotel] }));
    const equipped = resolveTurn(started, { type: 'selectWeapon', uid: 'w-mihotel-1' }, neverCrit);
    return resolveTurn(equipped, { type: 'startBattle' }, neverCrit);
  }

  it('每次攻击消耗 1 耐久，3 次后耗尽退化为徒手', () => {
    let state = mihotelBattle();
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(state.weapon?.remainingCharges).toBe(2);
    expect(state.enemyHp).toBe(300 - 84); // (10+80)-6
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(state.weapon?.remainingCharges).toBe(0);
    expect(state.stats.chargesSpent).toBe(3);
    // 第 4 次攻击：武器耗尽 → (10-6)=4 点徒手伤害
    const enemyHpBefore = state.enemyHp;
    state = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(state.enemyHp).toBe(enemyHpBefore - 4);
  });

  it('item 动作掷爆：直伤 80（不吃防御，与普攻的 84-6=74 区分开）', () => {
    const state = mihotelBattle();
    const after = resolveTurn(state, { type: 'item' }, neverCrit);
    expect(after.enemyHp).toBe(300 - 80);
    expect(after.phase).toBe('battle');
    expect(after.stats.chargesSpent).toBe(1);
  });

  it('耐久内 item 爆炸逐次消耗，耗尽后 item 空转（不产生伤害）', () => {
    const enemy = { ...findEnemy('enemy-caixukun')!, maxHp: 300 };
    const mihotel = createWeaponInstance('weapon-mihotel', 'w-mihotel-1')!;
    const started = startBattle(config({ enemy, availableWeapons: [mihotel] }));
    const equipped = resolveTurn(started, { type: 'selectWeapon', uid: 'w-mihotel-1' }, neverCrit);
    const battle = resolveTurn(equipped, { type: 'startBattle' }, neverCrit);
    let state = resolveTurn(battle, { type: 'item' }, neverCrit);
    expect(state.enemyHp).toBe(300 - 80);
    state = resolveTurn(state, { type: 'item' }, neverCrit);
    state = resolveTurn(state, { type: 'item' }, neverCrit);
    expect(state.weapon?.remainingCharges).toBe(0);
    const hpBefore = state.enemyHp;
    state = resolveTurn(state, { type: 'item' }, neverCrit);
    expect(state.enemyHp).toBe(hpBefore); // 空转
    expect(state.log.some((e) => e.text.includes('没有可引爆的道具'))).toBe(true);
  });
});

describe('K9 结算报告对象（替代 finally 块结算与 System.exit）', () => {
  it('胜利：报告含掉落武器与 clamp 后的 HP 终值', () => {
    const state = battleStart({ player: { hp: 100, maxHp: 100, baseAttack: 1000, defense: 10 } });
    const after = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(after.phase).toBe('victory');
    const report = settleBattle(after);
    expect(report.outcome).toBe('victory');
    expect(report.enemyHpFinal).toBe(0);
    expect(report.playerHpFinal).toBe(100);
    expect(report.dropWeaponId).toBe('weapon-basketball');
  });

  it('败北：HP 终值恰好 0 而非负数；不抛异常不退出', () => {
    const enemy = { ...findEnemy('enemy-caixukun')!, attack: 1000 };
    const state = battleStart({ enemy, player: { hp: 100, maxHp: 100, baseAttack: 0, defense: 0 } });
    const after = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(after.phase).toBe('defeat');
    const report = settleBattle(after);
    expect(report.outcome).toBe('defeat');
    expect(report.playerHpFinal).toBe(0);
    expect(report.playerHpFinal).toBeGreaterThanOrEqual(0);
  });

  it('逃跑：phase fled + 报告 outcome fled', () => {
    const state = battleStart();
    const after = resolveTurn(state, { type: 'flee' }, neverCrit);
    expect(after.phase).toBe('fled');
    expect(settleBattle(after).outcome).toBe('fled');
  });

  it('再临法则：致死一击后 HP=1 且战斗继续', () => {
    const enemy = { ...findEnemy('enemy-caixukun')!, attack: 1000 };
    const state = battleStart({
      enemy,
      player: { hp: 100, maxHp: 100, baseAttack: 0, defense: 0 },
      ruleSet: { ...DEFAULT_RULE_SET, secondChance: true },
    });
    const after = resolveTurn(state, { type: 'attack' }, neverCrit);
    expect(after.phase).toBe('battle');
    expect(after.playerHp).toBe(1);
    expect(after.stats.secondChanceUsed).toBe(true);
  });
});

describe('K2 逃跑 = 真实位移回安全格', () => {
  it('有战场时玩家实体真实移动到安全格', () => {
    const state = startBattle(
      config({
        formation: { grid: arena, playerPos: { x: 1, y: 2 }, enemyPos: { x: 2, y: 2 } },
      }),
    );
    const fought = resolveTurn(state, { type: 'startBattle' }, neverCrit);
    const fled = resolveTurn(fought, { type: 'flee' }, neverCrit);
    expect(fled.phase).toBe('fled');
    const player = fled.formation?.entities.find((e) => e.kind === 'player');
    // BFS 最近安全格：右侧被敌人堵死，(0,2) 距敌人 (2,2) 曼哈顿距离 2 → 首个安全格
    expect(player?.x).toBe(0);
    expect(player?.y).toBe(2);
    // 战场无敌人毗邻新位置
    const enemies = fled.formation?.entities.filter((e) => e.kind === 'enemy') ?? [];
    for (const e of enemies) {
      expect(Math.abs(e.x - player!.x) + Math.abs(e.y - player!.y)).toBeGreaterThan(1);
    }
  });
});

describe('角色卡 buff 消费（core/lawRegistry BuffId schema）', () => {
  it('合法 buff 生效，非法数值被拒收（坏档不污染战斗）', () => {
    const dagger = createWeaponInstance('weapon-dagger', 'w-dagger-1')!;
    const started = startBattle(
      config({
        availableWeapons: [dagger],
        buffs: [
          { buffId: 'attackUp', value: 50 },
          { buffId: 'attackUp', value: 999 }, // 超出 lawRegistry 范围 → 拒收
          { buffId: 'fly', value: 1 }, // 未知 BuffId → 拒收
        ],
      }),
    );
    expect(started.buffs.attackBonus).toBe(50);
    expect(started.buffRejections).toHaveLength(2);
    const equipped = resolveTurn(started, { type: 'selectWeapon', uid: 'w-dagger-1' }, neverCrit);
    const fought = resolveTurn(equipped, { type: 'startBattle' }, neverCrit);
    const after = resolveTurn(fought, { type: 'attack' }, neverCrit);
    // (10 + 20 + 50) - 6 = 74 ≥ 28 → 一击致胜，HP clamp 到 0
    expect(after.enemyHp).toBe(0);
    expect(after.phase).toBe('victory');
  });
});

describe('布阵推挤 → 直接胜利联动', () => {
  it('小怪被推入深渊 → HP 归零，战斗直接进入 victory', () => {
    const hazards = { '4,2': 'abyss' as const };
    const state = startBattle(
      config({
        player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
        formation: { grid: arena, hazards, playerPos: { x: 2, y: 2 }, enemyPos: { x: 3, y: 2 } },
      }),
    );
    const shoved = resolveTurn(state, { type: 'shove', dir: 'right' }, neverCrit);
    // 蔡徐坤质量 1 → 坠渊秒杀 → 胜利
    expect(shoved.phase).toBe('victory');
    expect(shoved.enemyHp).toBe(0);
    expect(shoved.formation?.entities.some((e) => e.id === 'enemy-caixukun')).toBe(false);
    const report = settleBattle(shoved);
    expect(report.outcome).toBe('victory');
    expect(report.dropWeaponId).toBe('weapon-basketball');
  });

  it('BOSS 免疫推挤：shove 被 blocked(immovable)，必须走公式战', () => {
    const state = startBattle(
      config({
        enemy: findEnemy('enemy-ylzz')!,
        formation: { grid: arena, playerPos: { x: 2, y: 2 }, enemyPos: { x: 3, y: 2 } },
      }),
    );
    const shoved = resolveTurn(state, { type: 'shove', dir: 'right' }, neverCrit);
    expect(shoved.phase).toBe('formation');
    expect(shoved.log.some((e) => e.text.includes('免疫推挤'))).toBe(true);
    const boss = shoved.formation?.entities.find((e) => e.id === 'enemy-ylzz');
    expect(boss?.x).toBe(3);
  });
});

describe('行动队列纪律', () => {
  it('战斗期禁止布阵行动；布阵期禁止战斗行动（入队即拦截并留痕）', () => {
    const started = startBattle(config());
    const illegal = enqueueAction(started, { type: 'attack' });
    expect(illegal.queue).toHaveLength(0);
    expect(illegal.log.some((e) => e.text.includes('无效行动'))).toBe(true);
    const fought = battleStart();
    const illegalShove = enqueueAction(fought, { type: 'shove', dir: 'right' });
    expect(illegalShove.queue).toHaveLength(0);
  });

  it('结算报告可在进行中调用 → ongoing（K9：无 finally 依赖）', () => {
    const started = battleStart();
    const report = settleBattle(started);
    expect(report.outcome).toBe('ongoing');
    expect(report.turns).toBeGreaterThanOrEqual(1);
  });
});
