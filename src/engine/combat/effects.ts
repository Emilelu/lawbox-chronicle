/**
 * combat-engine · effects —— 战斗效果原语（纯函数，可独立 vitest）。
 * ---------------------------------------------------------------------------
 * 根治映射：
 *  - K1（Game.java:941-956 / :1823 配合 :495 的「格挡」小贴士）：
 *    原版被击时 hp = hp - atk + def 再 clamp 到 maxHP——防御在 atk < def 时
 *    变成回血。本文件把格挡改建模为「独立护盾事件」（absorbByShield），
 *    防御值永不加回 HP；伤害公式统一 computeDamage = max(0, atk - def)，
 *    负伤害/回血路径在公式层不存在。
 *  - K2（Game.java:998-1011 逃跑只是 x++ 值传递空操作）：逃跑 = 真实位移——
 *    computeFlee 在网格上 BFS 最近的安全格（周围无敌人），返回位移后的实体层。
 *  - KT2：迷吼tiao 3 次爆炸耐久（consumeCharge，实例自带 remainingCharges）。
 *  - KT3：拐杖「击退 ? 米」落地为击退格数机制（computeKnockback）——
 *    每一步位移都调用 core/gridMove.resolvePush 共享原语，几何行为与推箱
 *    完全一致（守卫先行、占位、连锁、坠落由原语保证）。
 *  - 角色卡 buff：消费 core/lawRegistry 的 BuffId schema（validateBuff），
 *    坏档/篡改数值被拒收而不是污染战斗数值。
 *
 * 全部函数无副作用：入参不被修改，永远返回新对象。
 */

import { isInside, resolvePush } from '../../core/gridMove';
import { DIR_VECTORS } from '../../core/types';
import { clampHp } from '../../core/formula';
import { validateBuff, type Buff, type BuffId } from '../../core/lawRegistry';
import type { Dir, Grid, GridEntity, RuleSet, Vec2 } from '../../core/types';
import type { WeaponInstance } from '../../data/weapons';

/* ============================== 伤害与护盾 ================================ */

/**
 * 唯一伤害公式：damage = max(0, atk - def)。
 * 根治 K1/K16：永不为负（负差值=0 点伤害，绝不回血）。
 */
export function computeDamage(attack: number, defense: number): number {
  return Math.max(0, Math.round(attack) - Math.round(defense));
}

/**
 * 独立护盾事件：格挡值是一层会碎的盾，不是公式项。
 * 伤害先被护盾吸收，余量才落 HP——HP 只减不增（K1 根治）。
 */
export interface ShieldAbsorbResult {
  readonly shieldAfter: number;
  readonly hpDamage: number;
  readonly absorbed: number;
}

export function absorbByShield(shield: number, incoming: number): ShieldAbsorbResult {
  const incomingSafe = Math.max(0, Math.round(incoming));
  const current = Math.max(0, Math.round(shield));
  const absorbed = Math.min(current, incomingSafe);
  return { shieldAfter: current - absorbed, hpDamage: incomingSafe - absorbed, absorbed };
}

/** 摆出防御姿态获得的护盾值（= 当前防御，独立事件而非公式项） */
export function grantBlockShield(defense: number, defenseBonus: number): number {
  return Math.max(0, Math.round(defense) + Math.round(defenseBonus));
}

/**
 * HP 的唯一修改通道（除 core/formula.clampHp 外不得触碰 hp 数值）。
 * 全程 clamp[0, maxHp]——根治 K9 的负血结算。
 */
export function applyHp(hp: number, maxHp: number, delta: number): number {
  return clampHp(hp + delta, maxHp);
}

/* ============================== 击退位移（KT3） ============================ */

export interface KnockbackResult {
  /** 位移后的实体层（原数组不变） */
  readonly entities: readonly GridEntity[];
  /** 实际位移格数（0 = 一步都没推动） */
  readonly steps: number;
  /** 被击退者是否坠出地图边界（fallOffEdge 生效时） */
  readonly fell: boolean;
}

/**
 * 把 targetId 沿 dir 击退至多 maxSteps 格。
 * 界内每一步都通过共享原语 resolvePush（origin=target 自身位移）结算：
 * 撞墙/占位即停；被击退者撞上可推实体时会连锁推挤——与推箱行为一致。
 * 击退是外力位移：被击退者越出边界即坠落移除（共享原语的 fall 语义只覆盖
 * 「链尾被推者」，不含 self-move，故此处用同一套守卫 isInside 显式结算——
 * 依然是守卫先于索引，绝无裸访问）。坠落伤害由调用方结算。
 */
export function computeKnockback(
  grid: Grid,
  entities: readonly GridEntity[],
  targetId: string,
  dir: Dir,
  maxSteps: number,
): KnockbackResult {
  if (maxSteps <= 0) return { entities, steps: 0, fell: false };

  let current = entities;
  let moved = 0;
  let fell = false;

  for (let i = 0; i < maxSteps; i++) {
    const target = current.find((e) => e.id === targetId);
    if (target === undefined) break; // 已坠出或不存在：停止

    // 守卫：下一格越界 → 被击退者坠落（移除出实体层）
    const step = DIR_VECTORS[dir];
    const next = { x: target.x + step.x, y: target.y + step.y };
    if (!isInside(grid, next.x, next.y)) {
      current = current.filter((e) => e.id !== targetId);
      moved += 1;
      fell = true;
      break;
    }

    const result = resolvePush({
      grid,
      entities: current,
      origin: targetId,
      dir,
      rules: { maxChain: 4, fallOffEdge: true },
    });
    if (result.kind === 'blocked') break;
    current = result.entities;
    moved += 1;
    if (result.kind === 'fall') {
      fell = true;
      break;
    }
  }

  return { entities: current, steps: moved, fell };
}

/* ============================ 爆炸耐久（KT2） ============================== */

export interface ChargeConsumeResult {
  /** 消耗后的实例（remainingCharges - 1）；未消耗时原样返回 */
  readonly weapon: WeaponInstance;
  /** 本次是否真的消耗了一格耐久并爆炸 */
  readonly exploded: boolean;
  /** 剩余耐久（无耐久武器为 null） */
  readonly remaining: number | null;
  /** 是否已耗尽（3 次爆炸用完） */
  readonly spent: boolean;
}

/**
 * 消耗一格爆炸耐久（迷吼tiao）。
 * 无耐久武器 / 已耗尽 → 不消耗不爆炸（调用方据此决定本次攻击退化处理）。
 */
export function consumeCharge(weapon: WeaponInstance): ChargeConsumeResult {
  if (weapon.maxCharges === null || weapon.remainingCharges === null) {
    return { weapon, exploded: false, remaining: null, spent: false };
  }
  if (weapon.remainingCharges <= 0) {
    return { weapon, exploded: false, remaining: 0, spent: true };
  }
  const remaining = weapon.remainingCharges - 1;
  return {
    weapon: { ...weapon, remainingCharges: remaining },
    exploded: true,
    remaining,
    spent: remaining === 0,
  };
}

/* ============================ 逃跑 = 真实位移（K2） ======================== */

export interface FleeResult {
  readonly ok: boolean;
  readonly reason?: 'no-player' | 'no-safe-cell';
  /** 位移后的实体层（ok=false 时原样返回） */
  readonly entities: readonly GridEntity[];
  /** 玩家安全格坐标（ok=true 时给出；若原地已安全则与原坐标相同） */
  readonly to: Vec2 | null;
  /** 是否发生了实际位移 */
  readonly moved: boolean;
}

const NEIGHBORS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * 逃跑：BFS 最近的「安全格」（格内无敌人且四邻无敌人），把玩家真实位移过去。
 * 网格边界/墙/占位判定复用 core/gridMove 的守卫语义（isInside）。
 * 无安全格 → ok:false（本次逃跑失败，回合照常流转给敌方）。
 */
export function computeFlee(
  grid: Grid,
  entities: readonly GridEntity[],
  playerId: string,
): FleeResult {
  const player = entities.find((e) => e.id === playerId);
  if (player === undefined) {
    return { ok: false, reason: 'no-player', entities, to: null, moved: false };
  }
  const enemies = entities.filter((e) => e.kind === 'enemy');

  const isSafe = (x: number, y: number): boolean => {
    if (!isInside(grid, x, y)) return false;
    if (entities.some((e) => e.id !== playerId && e.x === x && e.y === y)) return false;
    return !enemies.some((e) => manhattan({ x, y }, e) <= 1);
  };

  if (isSafe(player.x, player.y)) {
    return { ok: true, entities, to: { x: player.x, y: player.y }, moved: false };
  }

  // BFS：从玩家位置向外找最近安全格（visited 防环，必终止）
  const visited = new Set<string>([`${player.x},${player.y}`]);
  let frontier: Vec2[] = [{ x: player.x, y: player.y }];
  while (frontier.length > 0) {
    const nextFrontier: Vec2[] = [];
    for (const cell of frontier) {
      for (const n of NEIGHBORS) {
        const nx = cell.x + n.x;
        const ny = cell.y + n.y;
        const key = `${nx},${ny}`;
        if (visited.has(key) || !isInside(grid, nx, ny)) continue;
        visited.add(key);
        if (entities.some((e) => e.id !== playerId && e.x === nx && e.y === ny)) continue;
        if (isSafe(nx, ny)) {
          const movedEntities = entities.map((e) =>
            e.id === playerId ? { ...e, x: nx, y: ny } : e,
          );
          return { ok: true, entities: movedEntities, to: { x: nx, y: ny }, moved: true };
        }
        nextFrontier.push({ x: nx, y: ny });
      }
    }
    frontier = nextFrontier;
  }
  return { ok: false, reason: 'no-safe-cell', entities, to: null, moved: false };
}

/* ======================= 角色卡 Buff（core/lawRegistry） =================== */

/** buff 加成后的玩家战斗面板（base + buff 的加成值，倍率由调用方套 RuleSet） */
export interface BuffedStats {
  readonly attackBonus: number;
  readonly defenseBonus: number;
  readonly maxHpBonus: number;
  readonly firstStrike: boolean;
  readonly regen: number;
}

export function emptyBuffedStats(): BuffedStats {
  return { attackBonus: 0, defenseBonus: 0, maxHpBonus: 0, firstStrike: false, regen: 0 };
}

export interface BuffRejection {
  readonly buffId: string;
  readonly value: number;
  readonly error: string;
}

export interface BuffApplyResult {
  readonly stats: BuffedStats;
  /** 通过 lawRegistry 校验并生效的 buff id */
  readonly applied: readonly BuffId[];
  /** 未通过校验的 buff（坏档/外挂数据——拒收而非崩溃） */
  readonly rejected: readonly BuffRejection[];
}

/**
 * 消费角色卡 buff 数组：逐条过 lawRegistry 的 BuffSchema（BuffId 枚举 + 数值范围）。
 * 非法条目进 rejected，绝不静默套用越界数值。
 */
export function applyBuffs(
  base: BuffedStats,
  buffs: readonly { readonly buffId: string; readonly value: number }[],
): BuffApplyResult {
  let stats = base;
  const applied: BuffId[] = [];
  const rejected: BuffRejection[] = [];

  for (const entry of buffs) {
    const checked = validateBuff({ buffId: entry.buffId, value: entry.value });
    if (!checked.ok) {
      rejected.push({ buffId: entry.buffId, value: entry.value, error: checked.error });
      continue;
    }
    const buff: Buff = checked.buff;
    switch (buff.buffId) {
      case 'attackUp':
        stats = { ...stats, attackBonus: stats.attackBonus + buff.value };
        break;
      case 'defenseUp':
        stats = { ...stats, defenseBonus: stats.defenseBonus + buff.value };
        break;
      case 'hpUp':
        stats = { ...stats, maxHpBonus: stats.maxHpBonus + buff.value };
        break;
      case 'firstStrike':
        stats = { ...stats, firstStrike: stats.firstStrike || buff.value >= 1 };
        break;
      case 'regenerate':
        stats = { ...stats, regen: stats.regen + buff.value };
        break;
    }
    applied.push(buff.buffId);
  }
  return { stats, applied, rejected };
}

/** selectors 的 buff 合计表（Record<BuffId, 总值>）→ applyBuffs 适配 */
export function applyBuffTotals(
  base: BuffedStats,
  totals: Readonly<Record<string, number>>,
): BuffApplyResult {
  const entries = Object.entries(totals).map(([buffId, value]) => ({ buffId, value }));
  return applyBuffs(base, entries);
}

/* ========================= 数值汇总（RuleSet 消费） ======================== */

export interface AttackBreakdown {
  readonly weaponBonus: number;
  readonly buffBonus: number;
  readonly total: number;
}

/**
 * 玩家有效攻击力：(baseAttack + 武器自带 attack + buff) × ruleSet.playerAttackMul。
 * 武器耗尽（迷吼tiao 爆完）时武器加成为 0——实例自带 stats，不查全局表（K8）。
 */
export function effectivePlayerAttack(
  baseAttack: number,
  weapon: WeaponInstance | null,
  buffs: BuffedStats,
  ruleSet: RuleSet,
): AttackBreakdown {
  const spent = weapon !== null && weapon.maxCharges !== null && weapon.remainingCharges === 0;
  const weaponBonus = weapon !== null && !spent ? weapon.attack : 0;
  const buffBonus = buffs.attackBonus;
  const total = Math.max(
    0,
    Math.round((Math.round(baseAttack) + weaponBonus + buffBonus) * ruleSet.playerAttackMul),
  );
  return { weaponBonus, buffBonus, total };
}

/** 敌方有效攻击力：baseAttack × ruleSet.enemyAttackMul（K16：只做安全乘法） */
export function effectiveEnemyAttack(baseAttack: number, ruleSet: RuleSet): number {
  return Math.max(0, Math.round(Math.round(baseAttack) * ruleSet.enemyAttackMul));
}
