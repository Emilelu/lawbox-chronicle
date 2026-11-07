/**
 * sfxTable 单测 —— 事件→音效映射的完备性与清单一致性。
 * 依赖极轻：只 import sfxTable、manifest 与 bus 的类型，不碰 howler。
 */

import { describe, expect, it } from 'vitest';
import type { FxEvent } from '../../core/events/bus';
import { ASSET_MANIFEST, ALL_SFX_IDS } from '../../data/audio/manifest';
import {
  PRELOAD_SFX_IDS,
  SFX,
  SFX_MIN_INTERVAL_MS,
  eventSfx,
  type SfxKey,
} from '../sfxTable';

/** 每个总线事件类型造一个代表性事件（新事件类型加入时本表会逼你补映射） */
const SAMPLE_EVENTS: readonly FxEvent[] = [
  { type: 'bgm/play', bgmId: 'bgm-sanb' },
  { type: 'bgm/stop' },
  { type: 'sfx/play', sfxId: 'sfx-effect-1' },
  { type: 'anim/slide', entityId: 'e1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, dir: 'right' },
  { type: 'anim/blocked', reason: 'wall' },
  { type: 'anim/goalBurst', entityId: 'c1' },
  { type: 'anim/spark', at: { x: 0, y: 0 }, blocked: false },
  { type: 'anim/spark', at: { x: 0, y: 0 }, blocked: true },
  { type: 'anim/screenShake', intensity: 0.6 },
  { type: 'anim/bossTitle', enemyId: 'enemy-ylzz', title: '影 流 之 主' },
  { type: 'anim/gachaBurst', rarity: 2 },
  { type: 'anim/gachaBurst', rarity: 4 },
  { type: 'fx/planeShift' },
  { type: 'camera/orbitTo', target: { x: 0, y: 0 }, pitch: 60 },
  { type: 'ui/toast', messageKey: 'toast.skeletonReady' },
  { type: 'ui/closePanels' },
  { type: 'debug/mark', label: 'test' },
];

describe('sfxTable —— 事件映射', () => {
  it('每个总线事件都有明确归属（配音或显式 null），绝不抛异常', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(() => eventSfx(event)).not.toThrow();
      const key = eventSfx(event);
      if (key !== null) {
        expect(Object.keys(SFX)).toContain(key);
      }
    }
  });

  it('演出事件的语义归属正确', () => {
    expect(eventSfx({ type: 'anim/blocked', reason: 'wall' })).toBe('pushBlocked');
    expect(eventSfx({ type: 'anim/goalBurst', entityId: 'c1' })).toBe('stoneOnBase');
    expect(eventSfx({ type: 'anim/spark', at: { x: 0, y: 0 }, blocked: false })).toBe('combatSpark');
    expect(eventSfx({ type: 'anim/spark', at: { x: 0, y: 0 }, blocked: true })).toBe('combatBlocked');
    expect(eventSfx({ type: 'anim/screenShake', intensity: 1 })).toBe('critStrike');
    expect(eventSfx({ type: 'anim/bossTitle', enemyId: 'e', title: 't' })).toBe('bossTitle');
    expect(eventSfx({ type: 'anim/gachaBurst', rarity: 4 })).toBe('gachaRare');
    expect(eventSfx({ type: 'anim/gachaBurst', rarity: 3 })).toBe('gachaBurst');
    expect(eventSfx({ type: 'fx/planeShift' })).toBe('planeShift');
    expect(eventSfx({ type: 'anim/slide', entityId: 'e', from: { x: 0, y: 0 }, to: { x: 0, y: 1 }, dir: 'down' })).toBeNull();
    expect(eventSfx({ type: 'camera/orbitTo', target: { x: 0, y: 0 }, pitch: 45 })).toBeNull();
  });

  it('与 store 已发布的裸 id 约定一致（不许另起一套）', () => {
    // gameStore.applyMoveResult / interact / finishLevelSuccessfully / applyLawCard
    expect(SFX.pushBlocked).toBe('sfx-effect-3');
    expect(SFX.uiCancel).toBe('sfx-effect-2');
    expect(SFX.levelComplete).toBe('sfx-effect-10');
    expect(SFX.lawApplied).toBe('sfx-effect-16');
  });
});

describe('sfxTable —— 清单一致性', () => {
  it('语义表引用的每个 sfx id 都存在于资源清单', () => {
    for (const id of Object.values(SFX)) {
      expect(ALL_SFX_IDS).toContain(id);
    }
  });

  it('预载清单是语义表值的去重全集，且都在清单内', () => {
    const expected = Array.from(new Set(Object.values(SFX)));
    expect([...PRELOAD_SFX_IDS].sort()).toEqual([...expected].sort());
    for (const id of PRELOAD_SFX_IDS) {
      expect(ALL_SFX_IDS).toContain(id);
    }
  });

  it('节流表覆盖全部语义键且数值非负', () => {
    const keys = Object.keys(SFX) as SfxKey[];
    for (const key of keys) {
      const ms = SFX_MIN_INTERVAL_MS[key];
      expect(ms, `语义键 ${key} 缺少最小重播间隔`).toBeDefined();
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    expect((Object.keys(SFX_MIN_INTERVAL_MS) as SfxKey[]).sort()).toEqual([...keys].sort());
  });
});

describe('sfxTable —— 资产清单侧写（20×wav 的事实约束）', () => {
  it('SFX 池的预载规模不超过 20（池化预载成本可控）', () => {
    expect(ASSET_MANIFEST.sfx.length).toBe(20);
    expect(PRELOAD_SFX_IDS.length).toBeLessThanOrEqual(20);
  });
});
