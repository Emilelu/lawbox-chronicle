/**
 * 敌人数据 —— 唯一数据源。
 * ---------------------------------------------------------------------------
 * 数值搬自 KichikuAdventure Game.java:52-65 的怪物构造（原为 main() 内 new 出
 * 来的硬编码对象）：
 *   蔡徐坤 28/12/6 @(4,2)、郭老师 98/24/12 @(3,-3)、
 *   冬泳怪鸽 149/32/16 @(-4,-4)、影流之主 2333/233/防御233 @(-5,5)。
 *
 * 修复映射：
 *  - K16（Game.java:1602-1606 彩蛋「ylzz.getAttack() * 3」= 233666438×3 秒杀、
 *    Game.java:1828 分身 shadow=shadow*2 无界翻倍）：影流之主的基础攻击回归
 *    233（与防御同源的原值），彩蛋攻击 233666438 降级为档案字段
 *    easterEggAttack（仅展示，绝不进结算），「×3」改写为参数化阶段技能
 *    attackMul: 3——伤害恒为 baseAttack×3 = 699，可被护盾/血量吸收，无溢出、
 *    无无条件秒杀路径。
 *  - 弱点可配置：weakness 声明「哪把武器是克星、倍率多少」，由
 *    engine/combat/turn.ts 在结算时消费（数据驱动，非硬编码）。
 *  - 布阵推挤：shoveMass/shoveImmune 声明推挤参数（BOSS 默认免疫推挤，
 *    必须走公式战）。
 * 掉落关系（Game.java:989/1229/1470）写入 dropWeaponId，集成期由
 * core/schema.ts 校验掉落闭环（敌人→武器、武器→droppedBy 双向一致）。
 */

import type { EnemyDef } from '../core/types';

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'enemy-caixukun',
    name: '蔡徐坤',
    maxHp: 28,
    attack: 12,
    defense: 6,
    originPos: { x: 4, y: 2 },
    boss: false,
    dropWeaponId: 'weapon-basketball',
  },
  {
    id: 'enemy-guolaoshi',
    name: '郭老师',
    maxHp: 98,
    attack: 24,
    defense: 12,
    originPos: { x: 3, y: -3 },
    boss: false,
    dropWeaponId: 'weapon-mihotel',
  },
  {
    id: 'enemy-dygg',
    name: '冬泳怪鸽',
    maxHp: 149,
    attack: 32,
    defense: 16,
    originPos: { x: -4, y: -4 },
    boss: false,
    dropWeaponId: 'weapon-bigsword',
  },
  {
    id: 'enemy-ylzz',
    name: '影流之主',
    maxHp: 2333,
    attack: 233,
    defense: 233,
    originPos: { x: -5, y: 5 },
    boss: true,
  },
];

export function findEnemy(enemyId: string): EnemyDef | undefined {
  return ENEMIES.find((e) => e.id === enemyId);
}

/* ========================== 战斗侧档案（可配置层） ========================= */

/** 阶段技能：伤害 = max(0, round(baseAttack × attackMul × enemyAttackMul)) × hits */
export interface EnemyPhaseDef {
  readonly name: string;
  /** 敌方 HP 比例 ≤ threshold 时进入（首阶段恒为 1，按降序声明） */
  readonly threshold: number;
  /** 参数化攻击倍率（K16：不再裸乘原值） */
  readonly attackMul: number;
  /** 该阶段每次行动的攻击段数 */
  readonly hits: number;
  /** 阶段切入时是否分身翻倍（上限 64 由引擎保证，根治 Game.java:1828） */
  readonly cloneDouble: boolean;
  /** 阶段切入时的演出提示文案 */
  readonly announce?: string;
}

/** 弱点：数据驱动的克星武器声明 */
export interface EnemyWeaknessDef {
  /** 克星武器（WEAPONS 表 id） */
  readonly weaponId: string;
  /** 用克星武器攻击时的伤害倍率 */
  readonly damageMul: number;
  /** 图鉴/战斗提示文案 */
  readonly note: string;
}

/** 敌人战斗档案：布阵推挤参数 + 弱点 + 阶段技能 */
export interface EnemyCombatProfile {
  readonly enemyId: string;
  /** 推挤质量覆写（缺省由 shove.ts 的 massFromMaxHp 按 HP 比例现算） */
  readonly shoveMass?: number;
  /** 免疫推挤覆写（BOSS 默认 true） */
  readonly shoveImmune?: boolean;
  readonly weakness?: EnemyWeaknessDef;
  /** 阶段技能表（普通怪为单阶段） */
  readonly phases: readonly EnemyPhaseDef[];
  /** 开场分身数（Game.java:1614 long shadow = 2） */
  readonly initialClones?: number;
  /** 原作彩蛋攻击值——仅档案/图鉴展示，绝不参与任何结算（K16） */
  readonly easterEggAttack?: number;
}

/** 单阶段兜底档案（未配置档案的敌人使用，引擎侧 fallback） */
export const SINGLE_PHASE: readonly EnemyPhaseDef[] = Object.freeze([
  Object.freeze({ name: '普通攻击', threshold: 1, attackMul: 1, hits: 1, cloneDouble: false }),
]);

export const ENEMY_COMBAT_PROFILES: Readonly<Record<string, EnemyCombatProfile>> = Object.freeze({
  'enemy-caixukun': {
    enemyId: 'enemy-caixukun',
    phases: SINGLE_PHASE,
  },
  'enemy-guolaoshi': {
    enemyId: 'enemy-guolaoshi',
    phases: SINGLE_PHASE,
  },
  'enemy-dygg': {
    enemyId: 'enemy-dygg',
    phases: SINGLE_PHASE,
  },
  'enemy-ylzz': {
    enemyId: 'enemy-ylzz',
    shoveImmune: true,
    weakness: {
      weaponId: 'weapon-gfsStick',
      damageMul: 2,
      note: '爷爷的拐杖是影流之主的克星（原作成就：用一根爷爷祖传的拐杖打败 BOSS）',
    },
    // Game.java:1614 开场 shadow = 2
    initialClones: 2,
    phases: [
      { name: '影分身阵', threshold: 1, attackMul: 1, hits: 1, cloneDouble: false },
      {
        name: '影替身连环',
        threshold: 0.66,
        attackMul: 0.5,
        hits: 3,
        cloneDouble: true,
        announce: '影流之主：“草！怎么打不动你这个逼崽子！MD，逼爷继续分身！”',
      },
      {
        // K16：原 Game.java:1603-1606 的 233666438×3 秒杀，参数化为 baseAttack(233)×3
        name: '神之乱击',
        threshold: 0.33,
        attackMul: 3,
        hits: 1,
        cloneDouble: true,
        announce: '影流之主分身成了三个！并且朝你冲了过来！',
      },
    ],
    // 原作彩蛋攻击原值：档案展示用，结算永不引用
    easterEggAttack: 233666438,
  },
});

export function findEnemyProfile(enemyId: string): EnemyCombatProfile | undefined {
  return ENEMY_COMBAT_PROFILES[enemyId];
}
