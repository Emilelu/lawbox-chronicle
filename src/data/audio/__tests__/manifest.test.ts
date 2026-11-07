/**
 * manifest 单测 —— 许可字段完备性 + 与数据层音频清单零漂移 + 磁盘实存。
 * 与 core/__tests__/schema.test.ts 的「音频→磁盘文件」检查同构，但范围
 * 扩展到 32 张图片与 license 维度。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AUDIO_MANIFEST } from '../../audio';
import {
  ALL_SFX_IDS,
  ASSET_MANIFEST,
  LICENSE_CREDITS,
  PLAYABLE_BGM_IDS,
  WALL_SKIN_IDS,
  findBgmEntry,
  findImageEntry,
  findSfxEntry,
  wallSkinImageId,
} from '../manifest';

const here = dirname(fileURLToPath(import.meta.url)); // src/data/audio/__tests__
const projectRoot = resolve(here, '../../../..'); // lawbox-chronicle 根

describe('manifest —— 许可维度完备性', () => {
  it('每条 bgm/sfx/image 都带 source + license + origin', () => {
    for (const entry of [...ASSET_MANIFEST.bgm, ...ASSET_MANIFEST.sfx, ...ASSET_MANIFEST.images]) {
      expect(entry.source.length, `${entry.id} 缺 source`).toBeGreaterThan(0);
      expect(['GPL-3.0', 'replaceBeforeShip'], `${entry.id} 许可值非法`).toContain(entry.license);
      expect(['SanBPushChest', 'BandoriLotteryEmulator', 'KichikuAdventure'], `${entry.id} origin 非法`).toContain(
        entry.origin,
      );
    }
  });

  it('Bandori BGM 标注 replaceBeforeShip（官方专辑，上架前替换）', () => {
    const bandori = findBgmEntry('bgm-bandori');
    expect(bandori).toBeDefined();
    expect(bandori?.license).toBe('replaceBeforeShip');
    expect(bandori?.origin).toBe('BandoriLotteryEmulator');
    expect(bandori?.note).toContain('BanG Dream');
  });

  it('两首 KichikuAdventure 曲目已由 .mid 转码为可播 mp3（GPL-3.0）', () => {
    const converted = ASSET_MANIFEST.bgm.filter(
      (b) => b.id === 'bgm-god-knows' || b.id === 'bgm-black-rose',
    );
    expect(converted.map((b) => b.id).sort()).toEqual(['bgm-black-rose', 'bgm-god-knows']);
    for (const b of converted) {
      expect(b.playable).toBe(true);
      expect(b.file).toMatch(/^bgm\/(god-knows|black-rose)\.mp3$/);
      expect(b.license).toBe('GPL-3.0');
      expect(b.origin).toBe('KichikuAdventure');
    }
  });

  it('20×wav + 14×墙皮 + 全部 32 图都是 SanBPushChest 自有 GPL-3.0', () => {
    for (const sfx of ASSET_MANIFEST.sfx) {
      expect(sfx.license).toBe('GPL-3.0');
      expect(sfx.origin).toBe('SanBPushChest');
    }
    expect(ASSET_MANIFEST.sfx.length).toBe(20);
    const barriers = ASSET_MANIFEST.images.filter((i) => i.kind === 'barrier');
    expect(barriers.length).toBe(14);
    expect(ASSET_MANIFEST.images.length).toBe(32);
    for (const image of ASSET_MANIFEST.images) {
      expect(image.license).toBe('GPL-3.0');
      expect(image.origin).toBe('SanBPushChest');
    }
  });

  it('三仓库署名齐备（LICENSE_CREDITS）', () => {
    expect(LICENSE_CREDITS.map((c) => c.origin).join('\n')).toContain('SanBPushChest');
    expect(LICENSE_CREDITS.map((c) => c.origin).join('\n')).toContain('BandoriLotteryEmulator');
    expect(LICENSE_CREDITS.map((c) => c.origin).join('\n')).toContain('KichikuAdventure');
    expect(LICENSE_CREDITS.length).toBe(3);
  });
});

describe('manifest —— 与数据层 audio.ts 零漂移', () => {
  it('bgm 的 id/file/title/playable 与 data/audio.ts 完全一致', () => {
    expect(ASSET_MANIFEST.bgm.length).toBe(AUDIO_MANIFEST.bgm.length);
    for (let i = 0; i < AUDIO_MANIFEST.bgm.length; i++) {
      const base = AUDIO_MANIFEST.bgm[i];
      const licensed = ASSET_MANIFEST.bgm[i];
      expect(licensed?.id).toBe(base?.id);
      expect(licensed?.file).toBe(base?.file);
      expect(licensed?.title).toBe(base?.title);
      expect(licensed?.playable).toBe(base?.playable);
      expect(licensed?.source).toBe(base?.source);
    }
  });

  it('sfx 的 id/file/source 与 data/audio.ts 完全一致', () => {
    expect(ASSET_MANIFEST.sfx.length).toBe(AUDIO_MANIFEST.sfx.length);
    for (let i = 0; i < AUDIO_MANIFEST.sfx.length; i++) {
      const base = AUDIO_MANIFEST.sfx[i];
      const licensed = ASSET_MANIFEST.sfx[i];
      expect(licensed?.id).toBe(base?.id);
      expect(licensed?.file).toBe(base?.file);
      expect(licensed?.source).toBe(base?.source);
    }
  });

  it('可播 BGM 为全部四首（两首原曲 + 两首 .mid 转码）', () => {
    expect([...PLAYABLE_BGM_IDS].sort()).toEqual(
      ['bgm-bandori', 'bgm-sanb', 'bgm-god-knows', 'bgm-black-rose'].sort(),
    );
  });
});

describe('manifest —— 磁盘实存（缺文件即测试失败）', () => {
  it('bgm/sfx 文件存在于 src/assets/audio/ 下', () => {
    for (const bgm of ASSET_MANIFEST.bgm) {
      const p = resolve(projectRoot, 'src/assets/audio', bgm.file);
      expect(() => readFileSync(p), `缺失 BGM 资产: ${bgm.file}`).not.toThrow();
    }
    for (const sfx of ASSET_MANIFEST.sfx) {
      const p = resolve(projectRoot, 'src/assets/audio', sfx.file);
      expect(() => readFileSync(p), `缺失 SFX 资产: ${sfx.file}`).not.toThrow();
    }
  });

  it('32 张图片文件存在于 src/assets/ 下', () => {
    for (const image of ASSET_MANIFEST.images) {
      const p = resolve(projectRoot, 'src/assets', image.file);
      expect(() => readFileSync(p), `缺失图片资产: ${image.file}`).not.toThrow();
    }
  });
});

describe('manifest —— 阴面墙皮查询', () => {
  it('WALL_SKIN_IDS 恰为 1..14，编号越界返回 undefined', () => {
    expect(WALL_SKIN_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(wallSkinImageId(7)).toBe('img-barrier-7');
    expect(findImageEntry(wallSkinImageId(7) ?? '')).toBeDefined();
    expect(wallSkinImageId(0)).toBeUndefined();
    expect(wallSkinImageId(15)).toBeUndefined();
    expect(wallSkinImageId(-1)).toBeUndefined();
  });

  it('findSfxEntry / findBgmEntry 的查无返回 undefined（调用方必须守卫）', () => {
    expect(findSfxEntry('sfx-effect-20')).toBeDefined();
    expect(findSfxEntry('sfx-effect-21')).toBeUndefined();
    expect(findBgmEntry('bgm-sanb')).toBeDefined();
    expect(findBgmEntry('bgm-unknown')).toBeUndefined();
    expect(findSfxEntry('')).toBeUndefined();
    expect(ALL_SFX_IDS.length).toBe(20);
  });
});
