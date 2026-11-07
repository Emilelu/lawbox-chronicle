/**
 * 数据集成期校验 —— validateWorld 全库一致性 + 素材文件存在性。
 * 这正是「每个开发者只看 coreFiles 契约即可独立开工」的守护网：
 * 任何表之间 id 引用断裂、重复 id、素材缺失，在这里一次性拦下。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LevelDefSchema, validateWorld } from '../schema';
import { WORLD_TABLES } from '../../data';
import { LEVELS } from '../../data/levels';
import { AREA_LEVELS } from '../../data/levels/areas';
import { importLevel } from '../store/gameStore';
import { resolvePush } from '../gridMove';

const here = dirname(fileURLToPath(import.meta.url)); // src/core/__tests__
const projectRoot = resolve(here, '../../..'); // lawbox-chronicle 根

describe('validateWorld —— 集成期一致性', () => {
  it('全库校验通过（形状 + 跨表 id 引用）', () => {
    const result = validateWorld(WORLD_TABLES);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('id 唯一性：levels/enemies/weapons/cards 无重复', () => {
    const uniq = (xs: readonly string[]) => new Set(xs).size === xs.length;
    expect(uniq(LEVELS.map((l) => l.id))).toBe(true);
    expect(uniq(WORLD_TABLES.enemies.map((e) => e.id))).toBe(true);
    expect(uniq(WORLD_TABLES.weapons.map((w) => w.id))).toBe(true);
    expect(uniq(WORLD_TABLES.cards.map((c) => c.id))).toBe(true);
  });

  it('敌人掉落与武器 droppedBy 双向闭环', () => {
    for (const enemy of WORLD_TABLES.enemies) {
      if (enemy.dropWeaponId === undefined) continue;
      const weapon = WORLD_TABLES.weapons.find((w) => w.id === enemy.dropWeaponId);
      expect(weapon, `${enemy.name} 的掉落物 ${enemy.dropWeaponId} 必须在武器表`).toBeTruthy();
      expect(weapon?.droppedBy).toBe(enemy.id);
    }
  });

  it('每关箱子数与旗数相等（原 mapList 的保真断言）', () => {
    for (const level of LEVELS) {
      const flat = level.grid.flat();
      const chests = flat.filter((c) => c === 4).length;
      const flags = flat.filter((c) => c === 3).length;
      expect(chests).toBeGreaterThan(0);
      expect(chests).toBe(flags);
    }
  });
});

describe('enemySpawns 出生点校验（R7）', () => {
  it('lb-08 / lb-12 的敌人出生点通过 schema（界内/不重复/不撞墙或出生点）', () => {
    for (const id of ['level-lb-08', 'level-lb-12']) {
      const lv = AREA_LEVELS.find((l) => l.id === id);
      expect(lv, id).toBeDefined();
      if (lv === undefined) continue;
      const parsed = LevelDefSchema.safeParse(lv);
      expect(parsed.success, `${id}: ${parsed.success ? '' : JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('越界/负坐标/重复/撞墙/撞尖刺/撞玩家/撞箱子出生点均被拒绝（并断言命中的 refine）', () => {
    const base = AREA_LEVELS.find((l) => l.id === 'level-lb-08');
    if (base === undefined) throw new Error('lb-08 缺失');
    const mk = (enemySpawns: readonly { x: number; y: number }[]) => ({ ...base, enemySpawns });
    // 与 altarSpawns 同款护栏：断言「被哪条 refine 拒绝」而不只是被拒绝
    const expectRejectedBy = (spawns: readonly { x: number; y: number }[], message: string) => {
      const parsed = LevelDefSchema.safeParse(mk(spawns));
      expect(parsed.success, `期望被拒绝：${JSON.stringify(spawns)}`).toBe(false);
      if (parsed.success) return;
      expect(
        parsed.error.issues.some((i) => i.message === message),
        `${JSON.stringify(spawns)} 应由「${message}」拒绝，实际 issues=${JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    };
    expectRejectedBy([{ x: 99, y: 0 }], 'enemySpawns 必须在网格边界内'); // 越界
    expectRejectedBy([{ x: -1, y: 0 }], 'enemySpawns 必须在网格边界内'); // 负坐标
    expectRejectedBy([{ x: 5, y: 5 }, { x: 5, y: 5 }], 'enemySpawns 不得出现重复坐标'); // 重复
    expectRejectedBy([{ x: 0, y: 1 }], 'enemySpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞墙
    expectRejectedBy([{ x: 5, y: 3 }], 'enemySpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞尖刺
    expectRejectedBy([{ x: 1, y: 1 }], 'enemySpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞玩家出生点
    expectRejectedBy([{ x: 2, y: 2 }], 'enemySpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞箱子出生点
  });
});

describe('altarSpawns 出生点校验', () => {
  it('主城 altarSpawns(7,11) 合法并通过 schema', () => {
    const lv = AREA_LEVELS.find((l) => l.id === 'level-sb-01');
    expect(lv, 'level-sb-01').toBeDefined();
    if (lv === undefined) return;
    expect(lv.altarSpawns).toEqual([{ x: 7, y: 11 }]);
    const parsed = LevelDefSchema.safeParse(lv);
    expect(parsed.success, `${lv.id}: ${parsed.success ? '' : JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });

  it('越界/负坐标/重复/撞墙/撞尖刺/撞玩家/撞箱子 altarSpawns 均被拒绝', () => {
    const base = AREA_LEVELS.find((l) => l.id === 'level-sb-01');
    if (base === undefined) throw new Error('level-sb-01 缺失');
    const mk = (altarSpawns: readonly { x: number; y: number }[]) => ({ ...base, altarSpawns });
    // 断言「被哪条 refine 拒绝」，而不只是被拒绝：规则错位时要能立刻定位
    const expectRejectedBy = (spawns: readonly { x: number; y: number }[], message: string) => {
      const parsed = LevelDefSchema.safeParse(mk(spawns));
      expect(parsed.success, `期望被拒绝：${JSON.stringify(spawns)}`).toBe(false);
      if (parsed.success) return;
      expect(
        parsed.error.issues.some((i) => i.message === message),
        `${JSON.stringify(spawns)} 应由「${message}」拒绝，实际 issues=${JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    };
    expectRejectedBy([{ x: 99, y: 0 }], 'altarSpawns 必须在网格边界内'); // 越界
    expectRejectedBy([{ x: -1, y: 0 }], 'altarSpawns 必须在网格边界内'); // 负坐标
    expectRejectedBy([{ x: 7, y: 11 }, { x: 7, y: 11 }], 'altarSpawns 不得出现重复坐标'); // 重复
    expectRejectedBy([{ x: 0, y: 1 }], 'altarSpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞墙
    expectRejectedBy([{ x: 6, y: 1 }], 'altarSpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞尖刺
    expectRejectedBy([{ x: 13, y: 1 }], 'altarSpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞玩家出生点
    expectRejectedBy([{ x: 6, y: 4 }], 'altarSpawns 不得落在墙/尖刺/玩家/箱子出生点格'); // 撞箱子出生点
  });
});

describe('importLevel —— 关卡导入纯函数', () => {
  it('出生点 2/4 从地形剥离为实体，地形归 0', () => {
    const level = LEVELS[0];
    if (level === undefined) throw new Error('关卡表为空');
    const imported = importLevel(level.id);
    expect(imported).toBeDefined();
    if (imported === undefined) return;
    const flatTerrain = imported.terrain.flat();
    expect(flatTerrain.some((c) => c === 2 || c === 4)).toBe(false);
    const players = imported.entities.filter((e) => e.kind === 'player');
    const chests = imported.entities.filter((e) => e.kind === 'chest');
    expect(players).toHaveLength(1);
    expect(chests.length).toBeGreaterThan(0);
  });

  it('导入后的段位可走通 resolvePush（store→引擎闭环冒烟）', () => {
    const level = LEVELS[0];
    if (level === undefined) throw new Error('关卡表为空');
    const imported = importLevel(level.id);
    if (imported === undefined) throw new Error('导入失败');
    const player = imported.entities.find((e) => e.kind === 'player');
    if (player === undefined) throw new Error('无玩家出生点');
    // 朝四个方向各推一步：要么动，要么被墙挡 —— 绝不抛异常
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const result = resolvePush({
        grid: imported.terrain,
        entities: imported.entities,
        origin: player.id,
        dir,
      });
      expect(['move', 'push', 'chain', 'blocked', 'fall']).toContain(result.kind);
    }
  });
});

describe('音频素材 —— manifest 声明的文件必须真实存在', () => {
  it('bgm/sfx 每一条都有对应资产文件（file 相对 src/assets/audio）', () => {
    for (const bgm of WORLD_TABLES.audio.bgm) {
      const p = resolve(projectRoot, 'src/assets/audio', bgm.file);
      expect(() => readFileSync(p), `缺失 BGM 资产: ${bgm.file}`).not.toThrow();
    }
    for (const sfx of WORLD_TABLES.audio.sfx) {
      const p = resolve(projectRoot, 'src/assets/audio', sfx.file);
      expect(() => readFileSync(p), `缺失 SFX 资产: ${sfx.file}`).not.toThrow();
    }
  });

  it('全部 BGM 均可播（.mid 已转码为 mp3，file 均为浏览器可播扩展名）', () => {
    for (const b of WORLD_TABLES.audio.bgm) {
      expect(b.playable, `${b.id} 应可播`).toBe(true);
      expect(b.file, `${b.id} 文件扩展名`).toMatch(/\.(mp3|ogg|wav)$/);
    }
  });
});
