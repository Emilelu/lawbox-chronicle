/**
 * combat-engine · shove —— 布阵推挤战（纯函数，可独立 vitest）。
 * ---------------------------------------------------------------------------
 * 战斗前置「布阵阶段」：怪物方块化立在 3D 战斗网格上，玩家用推箱技巧
 * 把它们推下深渊/推进尖刺——推箱第一次成为战斗资源。
 *
 * 结构约束：边界/占位/连锁/坠落判定【全部】来自 core/gridMove.resolvePush
 * 共享原语（与 puzzle-engine move.ts 同源），本文件只叠加战斗层规则：
 *  - 怪物重量 ∝ HP：massFromMaxHp = clamp(ceil(maxHp/50), 1, 9)，链上被推者
 *    质量总和不得超过玩家推力预算（overweight → too-heavy，不改任何状态）；
 *  - 深渊/尖刺地形伤害：按比例扣血，小怪坠渊直接秒杀；
 *  - BOSS 免疫标记：shoveImmune 实体由原语直接 blocked(immovable)——
 *    BOSS 必须走公式战；
 *  - 分身上限 64 有界（根治 Game.java:1614-1828 long shadow = shadow * 2
 *    无界翻倍溢出）：nextCloneCount 恒 ≤ 64，spawnClones 恒 ≤ 空闲格数；
 *  - 箱落攻击联动：箱子被推落（坠渊/出界）时对落点相邻敌人造成
 *    boxDropDamage × 箱质量的冲击伤害——地形本身成为武器。
 *
 * 推挤与推箱的行为一致性 = 共享原语 + 本模块单测（几何结果逐格断言）。
 */

import { resolvePush } from '../../core/gridMove';
import { clampHp } from '../../core/formula';
import type { BlockReason, Dir, Grid, GridEntity, Vec2 } from '../../core/types';

/* ============================== 地形与实体 ================================= */

/** 战斗格特殊地形（叠加在 Grid 之上，不污染关卡图例 0-4） */
export type HazardKind = 'abyss' | 'spike';

/** "x,y" → 地形；深渊格任何可推实体踏入即坠落 */
export type HazardMap = Readonly<Record<string, HazardKind>>;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * 怪物推挤质量 ∝ HP：clamp(ceil(maxHp/50), 1, 9)。
 * 蔡徐坤 28→1、郭老师 98→2、冬泳怪鸽 149→3、影流之主 2333→9（且免疫）。
 * EnemyCombatProfile.shoveMass 可覆写。
 */
export function massFromMaxHp(maxHp: number): number {
  return Math.max(1, Math.min(9, Math.ceil(Math.max(0, maxHp) / 50)));
}

export interface FormationEnemySpec {
  /** ENEMIES 表 id（同时作为战场实体 id） */
  readonly enemyId: string;
  readonly x: number;
  readonly y: number;
  readonly maxHp: number;
  readonly boss: boolean;
  /** 质量覆写（缺省按 massFromMaxHp 现算） */
  readonly massOverride?: number;
}

export interface FormationBuild {
  readonly entities: readonly GridEntity[];
  readonly hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>;
  readonly playerId: string;
}

/**
 * 布阵阶段战场构建：敌人方块化（质量∝HP、BOSS 免疫标记）+ 玩家实体。
 * 落点在深渊格的敌人视为非法布置（跳过）——实体永不站在渊上。
 */
export function buildFormation(
  specs: readonly FormationEnemySpec[],
  playerPos: Vec2,
  playerHp: number,
  playerMaxHp: number,
  playerId = 'player-1',
): FormationBuild {
  const entities: GridEntity[] = [
    { id: playerId, kind: 'player', x: playerPos.x, y: playerPos.y, mass: Infinity, pushable: false },
  ];
  const hpById: Record<string, { hp: number; maxHp: number }> = {
    [playerId]: { hp: playerHp, maxHp: playerMaxHp },
  };
  for (const spec of specs) {
    entities.push({
      id: spec.enemyId,
      kind: 'enemy',
      x: spec.x,
      y: spec.y,
      mass: spec.massOverride ?? massFromMaxHp(spec.maxHp),
      pushable: true,
      // BOSS 免疫推挤：由共享原语的守卫 4 直接 blocked(immovable)
      shoveImmune: spec.boss || undefined,
    });
    hpById[spec.enemyId] = { hp: spec.maxHp, maxHp: spec.maxHp };
  }
  return { entities, hpById, playerId };
}

/* ============================== 分身（K10 有界） =========================== */

/** 分身上限 64——Game.java:1828 `shadow = shadow * 2` 无界翻倍的根治常数 */
export const MAX_CLONES = 64;

/** 分身翻倍，恒有界：min(current × 2, 64)，绝不溢出、绝不指数失控 */
export function nextCloneCount(current: number): number {
  const safe = Math.max(0, Math.floor(current));
  return Math.min(safe * 2 > MAX_CLONES ? MAX_CLONES : safe * 2, MAX_CLONES);
}

export interface SpawnClonesResult {
  readonly entities: readonly GridEntity[];
  readonly spawned: readonly GridEntity[];
  readonly hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>;
}

/**
 * 在 boss 四周的空闲格（BFS 环序）放置 count 个分身实体。
 * 分身：质量 1、可推、HP 1——可被推挤/尖刺/箱落清理的战场杂兵。
 * 只放置 min(count, 空闲格数, 剩余额度) 个，永不死循环、永不越界。
 */
export function spawnClones(
  grid: Grid,
  entities: readonly GridEntity[],
  hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>,
  bossId: string,
  count: number,
  uidBase: string,
  hazards: HazardMap = {},
): SpawnClonesResult {
  const boss = entities.find((e) => e.id === bossId);
  if (boss === undefined || count <= 0) {
    return { entities, spawned: [], hpById };
  }

  const occupied = new Set(entities.map((e) => cellKey(e.x, e.y)));
  const freeCells: Vec2[] = [];
  // 环序收集空闲格：曼哈顿距离 1,2,3...（有界地图必然终止）
  for (let radius = 1; radius <= grid.length + (grid[0]?.length ?? 0); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        const x = boss.x + dx;
        const y = boss.y + dy;
        const row = grid[y];
        if (row === undefined || row[x] === undefined || row[x] !== 0) continue; // 守卫：界内且是地板
        const key = cellKey(x, y);
        if (occupied.has(key) || hazards[key] !== undefined) continue;
        freeCells.push({ x, y });
        occupied.add(key);
        if (freeCells.length >= count) break;
      }
      if (freeCells.length >= count) break;
    }
    if (freeCells.length >= count) break;
  }

  const placed: GridEntity[] = freeCells.map((cell, i) => ({
    id: `${uidBase}-clone-${i + 1}`,
    kind: 'enemy',
    x: cell.x,
    y: cell.y,
    mass: 1,
    pushable: true,
  }));
  const nextHp: Record<string, { hp: number; maxHp: number }> = { ...hpById };
  for (const clone of placed) {
    nextHp[clone.id] = { hp: 1, maxHp: 1 };
  }
  return {
    entities: [...entities, ...placed],
    spawned: placed,
    hpById: nextHp,
  };
}

/* ================================ 推挤结算 ================================= */

export interface ShoveOverlays {
  /** 玩家推力预算：链上被推实体质量总和上限（默认 9） */
  readonly shovePower?: number;
  /** 尖刺伤害占目标 maxHp 比例（默认 0.15，最少 1 点） */
  readonly spikeRatio?: number;
  /** 深渊/出界坠落伤害占目标 maxHp 比例（默认 0.5，最少 1 点） */
  readonly abyssRatio?: number;
  /** 质量 1 的杂兵（分身/小怪）坠渊是否直接秒杀（默认 true） */
  readonly minionFallLethal?: boolean;
  /** 箱落攻击：箱子坠落时对落点正交相邻敌人造成 base × 箱质量 伤害（0 = 关闭） */
  readonly boxDropDamage?: number;
  /** 连锁上限（透传原语；默认 4） */
  readonly maxChain?: number;
  /** 链尾越界是否坠落（透传原语；布阵战由法则「重力井」= RuleSet.fallFatal 注入） */
  readonly fallOffEdge?: boolean;
}

export type ShoveBlockReason = BlockReason | 'too-heavy' | 'hazard';

export interface ShoveDamageRecord {
  readonly entityId: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly source: 'abyss' | 'spike' | 'fall' | 'box-drop';
  readonly defeated: boolean;
}

export interface BoxDropImpact {
  /** 箱子落点（坠落格） */
  readonly at: Vec2;
  readonly damage: number;
  /** 被波及的敌人实体 id */
  readonly hits: readonly string[];
}

export interface ShoveOutcome {
  readonly kind: 'blocked' | 'move' | 'push' | 'chain' | 'fall';
  /** kind=blocked 时的原因（战斗层扩展：too-heavy / hazard） */
  readonly reason?: ShoveBlockReason;
  /** 推挤后的实体层（blocked 时原样返回） */
  readonly entities: readonly GridEntity[];
  /** 位移的实体（不含坠落者） */
  readonly moved: readonly GridEntity[];
  /** 坠出地图边界者（原语已从 entities 移除） */
  readonly fell: readonly GridEntity[];
  /** 踏入深渊而消失者（原语不知情，由本层移除） */
  readonly fellIntoAbyss: readonly GridEntity[];
  /** 地形/箱落伤害记录（含玩家踩尖刺） */
  readonly damages: readonly ShoveDamageRecord[];
  /** 箱落攻击联动（boxDropDamage>0 且有箱子坠落时非空） */
  readonly boxDrop: readonly BoxDropImpact[];
  /** 推挤后 HP 归零的实体 id（含玩家以外的全部单位） */
  readonly defeatedIds: readonly string[];
  /** 推挤后的 hpById（blocked 时原样返回） */
  readonly hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>;
}

export interface ShoveInput {
  readonly grid: Grid;
  readonly hazards: HazardMap;
  readonly entities: readonly GridEntity[];
  readonly originId: string;
  readonly dir: Dir;
  readonly hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>;
  readonly overlays?: ShoveOverlays;
}

const DEFAULT_SHOVE_POWER = 9;
const DEFAULT_SPIKE_RATIO = 0.15;
const DEFAULT_ABYSS_RATIO = 0.5;

/**
 * 布阵推挤一次：几何完全交给共享原语，本函数只做三层战斗叠加——
 *  1) 玩家推力预算（质量总和 > 预算 → too-heavy，状态零变化）；
 *  2) 地形结算（深渊坠落移除 + 比例伤害、尖刺比例伤害、出界坠落伤害）；
 *  3) 箱落攻击联动（箱子坠落 → 冲击相邻敌人）。
 */
export function resolveShove(input: ShoveInput): ShoveOutcome {
  const { grid, hazards, entities, originId, dir, hpById } = input;
  const overlays = input.overlays ?? {};
  const shovePower = overlays.shovePower ?? DEFAULT_SHOVE_POWER;
  const spikeRatio = overlays.spikeRatio ?? DEFAULT_SPIKE_RATIO;
  const abyssRatio = overlays.abyssRatio ?? DEFAULT_ABYSS_RATIO;
  const minionFallLethal = overlays.minionFallLethal ?? true;
  const boxDropDamage = overlays.boxDropDamage ?? 0;

  const origin = entities.find((e) => e.id === originId);
  if (origin === undefined) {
    return blockedOutcome(entities, hpById, 'no-origin');
  }

  // 守卫 0（战斗层）：origin 的目标格是深渊 → 拒绝踏入（玩家不自灭）
  const stepX = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const stepY = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  if (hazards[cellKey(origin.x + stepX, origin.y + stepY)] === 'abyss') {
    return blockedOutcome(entities, hpById, 'hazard');
  }

  // ---- 几何结算：全部交给共享原语 ----
  const primitive = resolvePush({
    grid,
    entities,
    origin: originId,
    dir,
    rules: {
      maxChain: overlays.maxChain ?? 4,
      fallOffEdge: overlays.fallOffEdge ?? false,
    },
  });
  if (primitive.kind === 'blocked') {
    return blockedOutcome(entities, hpById, primitive.reason);
  }

  // ---- 叠加 1：推力预算（被推者质量总和） ----
  const pushedIds = new Set(
    primitive.kind === 'push' || primitive.kind === 'chain'
      ? primitive.moved.map((e) => e.id)
      : [],
  );
  const massSum = entities
    .filter((e) => pushedIds.has(e.id))
    .reduce((sum, e) => sum + (Number.isFinite(e.mass) ? e.mass : 0), 0);
  if (massSum > shovePower) {
    return blockedOutcome(entities, hpById, 'too-heavy');
  }

  let nextEntities = primitive.entities;
  let nextHp = hpById;
  const damages: ShoveDamageRecord[] = [];
  const defeatedIds: string[] = [];
  const abyssFallen: GridEntity[] = [];

  /** 结算一次伤害（HP 恒 clamp[0,max]，与 turn/effects 同一纪律） */
  const dealDamage = (
    entityId: string,
    raw: number,
    source: ShoveDamageRecord['source'],
  ): void => {
    const entry = nextHp[entityId];
    if (entry === undefined) return;
    const hpBefore = entry.hp;
    const hpAfter = clampHp(hpBefore - Math.max(0, Math.round(raw)), entry.maxHp);
    if (hpAfter === hpBefore) return;
    nextHp = { ...nextHp, [entityId]: { ...entry, hp: hpAfter } };
    damages.push({ entityId, hpBefore, hpAfter, source, defeated: hpAfter <= 0 });
    if (hpAfter <= 0 && !defeatedIds.includes(entityId)) defeatedIds.push(entityId);
  };

  // ---- 叠加 2：地形结算 ----
  // 2a. 链尾坠出地图边界（原语 fall）→ 坠落伤害
  if (primitive.kind === 'fall') {
    for (const fellEntity of primitive.fell) {
      dealDamage(fellEntity.id, fallDamageFor(fellEntity, nextHp, abyssRatio, minionFallLethal), 'fall');
    }
  }

  // 2b. 仍在场上的实体：踏入深渊 → 坠入（移除）+ 伤害；踩尖刺 → 比例伤害
  const afterAbyss: GridEntity[] = [];
  for (const entity of nextEntities) {
    const hazard = hazards[cellKey(entity.x, entity.y)];
    if (hazard === 'abyss') {
      abyssFallen.push(entity);
      dealDamage(entity.id, fallDamageFor(entity, nextHp, abyssRatio, minionFallLethal), 'abyss');
      continue; // 坠入深渊：从实体层移除
    }
    if (hazard === 'spike') {
      const entry = nextHp[entity.id];
      if (entry !== undefined) {
        dealDamage(entity.id, Math.max(1, Math.round(entry.maxHp * spikeRatio)), 'spike');
      }
    }
    afterAbyss.push(entity);
  }
  nextEntities = afterAbyss;

  // 2c. 箱子坠落（出界 fall 或坠入深渊）→ 箱落攻击联动
  const boxDrop: BoxDropImpact[] = [];
  const fallenChests = [
    ...(primitive.kind === 'fall' ? primitive.fell : []),
    ...abyssFallen,
  ].filter((e) => e.kind === 'chest');
  if (fallenChests.length > 0 && boxDropDamage > 0) {
    for (const chest of fallenChests) {
      const impact = boxDropImpactAt(chest, nextEntities, boxDropDamage, nextHp);
      if (impact === null) continue;
      boxDrop.push(impact);
      for (const hitId of impact.hits) {
        dealDamage(hitId, impact.damage, 'box-drop');
      }
    }
  }

  return {
    kind: primitive.kind,
    entities: nextEntities,
    moved: primitive.kind === 'move' ? [] : primitive.moved,
    fell: primitive.kind === 'fall' ? primitive.fell : [],
    fellIntoAbyss: abyssFallen,
    damages,
    boxDrop,
    defeatedIds,
    hpById: nextHp,
  };
}

function blockedOutcome(
  entities: readonly GridEntity[],
  hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>,
  reason: ShoveBlockReason,
): ShoveOutcome {
  return {
    kind: 'blocked',
    reason,
    entities,
    moved: [],
    fell: [],
    fellIntoAbyss: [],
    damages: [],
    boxDrop: [],
    defeatedIds: [],
    hpById,
  };
}

/** 坠落伤害：maxHp × abyssRatio；质量 1 杂兵（分身/小怪）且 minionFallLethal → 直接斩杀线 */
function fallDamageFor(
  entity: GridEntity,
  hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>,
  abyssRatio: number,
  minionFallLethal: boolean,
): number {
  const entry = hpById[entity.id];
  if (entry === undefined) return 0;
  if (minionFallLethal && entity.mass <= 1) return entry.hp; // 秒杀小怪/分身
  return Math.max(1, Math.round(entry.maxHp * abyssRatio));
}

/** 箱落冲击：以箱子落点为心的正交相邻敌人各受 boxDropDamage × 箱质量 */
function boxDropImpactAt(
  chest: GridEntity,
  entities: readonly GridEntity[],
  base: number,
  hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>,
): BoxDropImpact | null {
  const at = { x: chest.x, y: chest.y };
  const damage = Math.max(1, Math.round(base * (Number.isFinite(chest.mass) ? chest.mass : 1)));
  const hits = NEIGHBOR_DIRS
    .map((d) => entities.find((e) => e.kind === 'enemy' && e.x === at.x + d.x && e.y === at.y + d.y))
    .filter((e): e is GridEntity => e !== undefined && hpById[e.id] !== undefined)
    .map((e) => e.id);
  return hits.length > 0 ? { at, damage, hits } : null;
}

const NEIGHBOR_DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
