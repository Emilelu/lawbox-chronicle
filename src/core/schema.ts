/**
 * 数据层 zod schema + 集成期引用一致性校验。
 * ---------------------------------------------------------------------------
 * 原仓库的硬编码数值表（Game.java:55-65、mapGenerator.js:4-65、
 * Lottery.java:40-46）外置为 src/data/ 唯一数据源后，这里负责：
 *  1. 形状校验（zod schema）；
 *  2. 跨表 id 引用校验（发卡→法则补丁、掉落→武器、事件→敌人、音频→文件），
 *     在集成期（vitest / 启动时 dev 断言）一次性拦截不一致。
 * README 与代码系统性不一致（Kichiku bug K14）类问题在此结构下无处藏身。
 */

import { z } from 'zod';
import type {
  AudioManifest,
  CardDef,
  EnemyDef,
  GachaConfig,
  LevelDef,
  StoryEventDef,
  TerrainCell,
  WeaponDef,
} from './types';
import { LOCALES } from './types';
import { LAW_PATCH_IDS, BUFF_IDS, BUFF_RANGES } from './lawRegistry';

/* ================================ 关卡 ==================================== */

export const TerrainCellSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5), // 尖刺格（战斗布阵 hazard 数据来源，见 core/types TerrainCell 注释）
]);

export const LevelDefSchema = z
  .object({
    id: z.string().min(1),
    area: z.enum(['main', 'domain-1', 'domain-2', 'domain-3']),
    name: z.string().min(1),
    subtitle: z.string().min(1),
    grid: z.array(z.array(TerrainCellSchema)).min(5),
    parSteps: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    reward: z.object({
      starStones: z.number().int().min(0),
      lawCardId: z.string().optional(),
    }),
    enemySpawns: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
    altarSpawns: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
  })
  .refine(
    (lv) => {
      const width = lv.grid[0]?.length ?? -1;
      return lv.grid.every((row) => row.length === width);
    },
    '关卡网格各行宽度不一致',
  )
  .refine(
    (lv) => countCells(lv.grid, 2) === 1,
    '关卡必须恰好 1 个玩家出生点(2)',
  )
  .refine(
    (lv) => countCells(lv.grid, 4) >= 1 && countCells(lv.grid, 4) === countCells(lv.grid, 3),
    '关卡箱子数(4)必须等于终点旗数(3)且 ≥1',
  )
  .refine(
    (lv) => {
      const width = lv.grid[0]?.length ?? 0;
      return (lv.enemySpawns ?? []).every(
        (s) => s.x >= 0 && s.y >= 0 && s.x < width && s.y < lv.grid.length,
      );
    },
    'enemySpawns 必须在网格边界内',
  )
  .refine(
    (lv) => {
      const seen = new Set<string>();
      for (const s of lv.enemySpawns ?? []) {
        const key = `${s.x},${s.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    'enemySpawns 不得出现重复坐标',
  )
  .refine(
    (lv) =>
      (lv.enemySpawns ?? []).every((s) => {
        const cell = lv.grid[s.y]?.[s.x];
        // 敌人可站地板(0)或旗位(3)（如守旗敌人）；墙(1)/玩家(2)/箱(4)/尖刺(5) 均冲突
        return cell === 0 || cell === 3;
      }),
    'enemySpawns 不得落在墙/尖刺/玩家/箱子出生点格',
  )
  .refine(
    (lv) => {
      const width = lv.grid[0]?.length ?? 0;
      return (lv.altarSpawns ?? []).every(
        (s) => s.x >= 0 && s.y >= 0 && s.x < width && s.y < lv.grid.length,
      );
    },
    'altarSpawns 必须在网格边界内',
  )
  .refine(
    (lv) => {
      const seen = new Set<string>();
      for (const s of lv.altarSpawns ?? []) {
        const key = `${s.x},${s.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    'altarSpawns 不得出现重复坐标',
  )
  .refine(
    (lv) =>
      (lv.altarSpawns ?? []).every((s) => {
        const cell = lv.grid[s.y]?.[s.x];
        // 祭坛只可立于可站立格（地板 0 / 旗位 3）；墙/玩家/箱/尖刺均冲突
        return cell === 0 || cell === 3;
      }),
    'altarSpawns 不得落在墙/尖刺/玩家/箱子出生点格',
  );

export function countCells(grid: readonly (readonly TerrainCell[])[], cell: TerrainCell): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c === cell) n++;
  return n;
}

/* ================================ 敌人 / 武器 ============================== */

export const EnemyDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  maxHp: z.number().int().positive(),
  attack: z.number().int().min(0),
  defense: z.number().int().min(0),
  originPos: z.object({ x: z.number().int(), y: z.number().int() }),
  boss: z.boolean(),
  dropWeaponId: z.string().optional(),
});

export const WeaponDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    attack: z.number().int().min(0).max(9999),
    description: z.string().min(1),
    source: z.enum(['angel-gift', 'monster-drop', 'story-reward']),
    droppedBy: z.string().optional(),
  })
  .refine((w) => w.source !== 'monster-drop' || w.droppedBy !== undefined, 'monster-drop 武器必须声明 droppedBy');

/* ================================ 抽卡 ==================================== */

export const GachaConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    baseRates: z
      .object({ fourStar: z.number().min(0).max(1), threeStar: z.number().min(0).max(1) })
      .refine((r) => r.fourStar + r.threeStar <= 1, '4★+3★ 概率不得超过 1'),
    everyNthBoost: z.object({
      every: z.number().int().min(2),
      rates: z
        .object({ fourStar: z.number().min(0).max(1), threeStar: z.number().min(0).max(1) })
        .refine((r) => r.fourStar + r.threeStar <= 1, '强化档 4★+3★ 概率不得超过 1'),
    }),
    pity: z.object({
      perTenPullThreeStar: z.boolean(),
      hardFourStar: z.number().int().min(10),
      bonusThreeStarOnPity: z.boolean(),
    }),
    costPerPull: z.number().int().min(0),
  });

export const CardDefSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['law', 'character']),
    name: z.string().min(1),
    rarity: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    description: z.string().min(1),
    lawPatchId: z.string().optional(),
    buff: z
      .object({ buffId: z.enum(BUFF_IDS), value: z.number() })
      .refine(
        (b) => {
          const range = BUFF_RANGES[b.buffId];
          return range !== undefined && b.value >= range.min && b.value <= range.max;
        },
        '角色卡 Buff 数值超出 lawRegistry 注册范围',
      )
      .optional(),
  })
  .refine((c) => c.kind !== 'law' || c.lawPatchId !== undefined, '法则卡必须引用 lawPatchId')
  .refine((c) => c.kind !== 'character' || c.buff !== undefined, '角色卡必须携带 buff');

/* ================================ 剧情 ==================================== */

export const StoryEventDefSchema = z.object({
  id: z.string().min(1),
  area: z.enum(['main', 'domain-1', 'domain-2', 'domain-3']),
  title: z.string().min(1),
  lines: z
    .array(
      z.object({
        speakerId: z.string().min(1),
        text: z.string().min(1),
      }),
    )
    .min(1),
  trigger: z.enum(['npc', 'tile', 'battle-end']),
  pos: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  effects: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('grantWeapon'), weaponId: z.string().min(1) }),
      z.object({ kind: z.literal('setEnemyAttack'), enemyId: z.string().min(1), value: z.number().int().min(0) }),
      z.object({ kind: z.literal('grantStarStones'), amount: z.number().int().min(0) }),
      z.object({ kind: z.literal('unlockPlaneShift') }),
    ]),
  ),
  relatedEnemyIds: z.array(z.string()).optional(),
});

/* ============================= 多语言 / 音频 =============================== */

export const I18nPackSchema = z.object({
  locale: z.enum(LOCALES),
  entries: z.record(z.string().min(1), z.string().min(1)),
});

export const AudioManifestSchema = z.object({
  bgm: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        file: z.string().min(1),
        source: z.string().min(1),
        playable: z.boolean(),
      }),
    )
    .min(1),
  sfx: z.array(
    z.object({
      id: z.string().min(1),
      file: z.string().min(1),
      source: z.string().min(1),
    }),
  ),
});

/* ============================ 集成期一致性校验 ============================= */

export interface ValidationIssue {
  readonly table: string;
  readonly id: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface WorldTables {
  readonly levels: readonly LevelDef[];
  readonly enemies: readonly EnemyDef[];
  readonly weapons: readonly WeaponDef[];
  readonly gachaConfig: GachaConfig;
  readonly cards: readonly CardDef[];
  readonly storyEvents: readonly StoryEventDef[];
  readonly audio: AudioManifest;
}

/** 单表 zod 批量校验 */
function checkEach<T>(table: string, items: readonly T[], schema: z.ZodTypeAny): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  items.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (!r.success) {
      const id =
        typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { id: unknown }).id)
          : `#${i}`;
      issues.push({ table, id, message: r.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; ') });
    }
  });
  return issues;
}

function dupCheck(table: string, ids: readonly string[]): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const id of ids) {
    if (seen.has(id)) issues.push({ table, id, message: '重复 id' });
    seen.add(id);
  }
  return issues;
}

/**
 * 全库校验：形状 + 跨表 id 引用。
 * 集成期调用点：vitest（src/core/__tests__/schema.test.ts）与应用启动。
 */
export function validateWorld(tables: WorldTables): ValidationResult {
  const issues: ValidationIssue[] = [];

  issues.push(...checkEach('levels', tables.levels, LevelDefSchema));
  issues.push(...dupCheck('levels', tables.levels.map((l) => l.id)));
  issues.push(...checkEach('enemies', tables.enemies, EnemyDefSchema));
  issues.push(...dupCheck('enemies', tables.enemies.map((e) => e.id)));
  issues.push(...checkEach('weapons', tables.weapons, WeaponDefSchema));
  issues.push(...dupCheck('weapons', tables.weapons.map((w) => w.id)));
  issues.push(...checkEach('cards', tables.cards, CardDefSchema));
  issues.push(...dupCheck('cards', tables.cards.map((c) => c.id)));
  issues.push(...checkEach('storyEvents', tables.storyEvents, StoryEventDefSchema));
  issues.push(...dupCheck('storyEvents', tables.storyEvents.map((e) => e.id)));

  {
    const r = GachaConfigSchema.safeParse(tables.gachaConfig);
    if (!r.success) {
      issues.push({ table: 'gachaConfig', id: tables.gachaConfig.id, message: r.error.message });
    }
  }
  {
    const r = AudioManifestSchema.safeParse(tables.audio);
    if (!r.success) {
      issues.push({ table: 'audio', id: 'manifest', message: r.error.message });
    }
  }

  // ---- 跨表引用 ----
  const enemyIds = new Set(tables.enemies.map((e) => e.id));
  const weaponIds = new Set(tables.weapons.map((w) => w.id));
  const cardIds = new Set(tables.cards.map((c) => c.id));
  const lawPatchIds = new Set<string>(LAW_PATCH_IDS);

  for (const e of tables.enemies) {
    if (e.dropWeaponId !== undefined && !weaponIds.has(e.dropWeaponId)) {
      issues.push({ table: 'enemies', id: e.id, message: `掉落武器 ${e.dropWeaponId} 不存在于 weapons 表` });
    }
  }
  for (const w of tables.weapons) {
    if (w.droppedBy !== undefined && !enemyIds.has(w.droppedBy)) {
      issues.push({ table: 'weapons', id: w.id, message: `droppedBy 敌人 ${w.droppedBy} 不存在于 enemies 表` });
    }
  }
  for (const c of tables.cards) {
    if (c.kind === 'law' && c.lawPatchId !== undefined && !lawPatchIds.has(c.lawPatchId)) {
      issues.push({ table: 'cards', id: c.id, message: `法则补丁 ${c.lawPatchId} 未在 lawRegistry 注册` });
    }
  }
  for (const lv of tables.levels) {
    if (lv.reward.lawCardId !== undefined && !cardIds.has(lv.reward.lawCardId)) {
      issues.push({ table: 'levels', id: lv.id, message: `奖励卡 ${lv.reward.lawCardId} 不存在于 cards 表` });
    }
  }
  for (const ev of tables.storyEvents) {
    for (const eff of ev.effects) {
      if (eff.kind === 'grantWeapon' && !weaponIds.has(eff.weaponId)) {
        issues.push({ table: 'storyEvents', id: ev.id, message: `奖励武器 ${eff.weaponId} 不存在于 weapons 表` });
      }
      if (eff.kind === 'setEnemyAttack' && !enemyIds.has(eff.enemyId)) {
        issues.push({ table: 'storyEvents', id: ev.id, message: `敌人 ${eff.enemyId} 不存在于 enemies 表` });
      }
    }
    for (const rid of ev.relatedEnemyIds ?? []) {
      if (!enemyIds.has(rid)) {
        issues.push({ table: 'storyEvents', id: ev.id, message: `relatedEnemyId ${rid} 不存在于 enemies 表` });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
