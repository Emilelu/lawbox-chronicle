/**
 * charModels —— 角色建模共享层单测（CHAR-2）。
 * 覆盖：玩家 5 皮肤部件掩码解析、皮肤号越界回退 0、squash 滑动拉伸/落定
 * 回弹（easeOutBack）、围巾摆动、消散采样、小怪 sprite-stacking 层变换、
 * BOSS 堆叠/分身摆位、接地阴影高度衰减、部件几何缓存与顶点预算。
 * 全部不依赖 WebGL（three 几何在 node 下纯 JS 构建）。
 */

import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color } from 'three';
import { easeOutBack } from '../theme'; // CAM-1 交付的回弹缓动（charModels 按契约消费）
import {
  BOSS_CLONE_SWAY_AMPLITUDE,
  BOSS_CLONE_SWAY_SPEED,
  BOSS_STACK_LAYERS,
  DISSOLVE_RISE,
  DISSOLVE_SECONDS,
  PLAYER_SKINS,
  SCARF_SWAY_AMPLITUDE,
  SCARF_SWAY_SPEED,
  SHADOW_BASE_OPACITY,
  SHADOW_FADE_HEIGHT,
  SQUASH_LAND_SECONDS,
  SQUASH_STRETCH,
  bossStackTransform,
  cloneOrbitYawAt,
  dissolveAt,
  playerSkinById,
  scarfSwayAt,
  shadowOpacityAt,
  squashScaleAt,
  spriteStackTransform,
  tintedGeometry,
} from '../entities/charModels';
import { parseArtMask } from '../entities/ActorMesh';
import { buildPlayerParts } from '../entities/PlayerAvatar';

describe('charModels · 玩家部件皮肤表', () => {
  it('5 张皮肤 id 连续 0..4，部件掩码/色板/臂/围巾声明齐备', () => {
    expect(PLAYER_SKINS.length).toBe(5);
    for (let i = 0; i < PLAYER_SKINS.length; i++) {
      const skin = PLAYER_SKINS[i];
      expect(skin !== undefined && skin.id).toBe(i);
      expect(skin?.label.length).toBeGreaterThan(0);
      expect(skin?.head.rows.length).toBeGreaterThan(0);
      expect(skin?.body.rows.length).toBeGreaterThan(0);
      expect(skin?.arm.size.length).toBe(3);
      expect(skin?.scarf.color.startsWith('#')).toBe(true);
      expect(skin?.scarf.tip.startsWith('#')).toBe(true);
    }
  });

  it('部件掩码 parseArtMask 通过：非空、head/body 同宽对齐、色索引有界', () => {
    for (const skin of PLAYER_SKINS) {
      const head = parseArtMask(skin.head.rows);
      const body = parseArtMask(skin.body.rows);
      expect(head.cells.length).toBeGreaterThan(0);
      expect(body.cells.length).toBeGreaterThan(0);
      expect(head.width).toBe(body.width); // 部件同宽 → 拼装后左右对称
      expect(head.height).toBe(skin.head.rows.length);
      expect(body.height).toBe(skin.body.rows.length);
      for (const cell of [...head.cells, ...body.cells]) {
        expect(cell.colorIndex).toBeGreaterThanOrEqual(0);
        expect(cell.colorIndex).toBeLessThanOrEqual(2);
      }
    }
  });

  it('皮肤条目不携带旋转/朝向字段（S5：皮肤表与朝向表结构分离）', () => {
    for (const skin of PLAYER_SKINS) {
      const record = skin as unknown as Record<string, unknown>;
      expect(record['yaw']).toBeUndefined();
      expect(record['rotation']).toBeUndefined();
      expect(record['facing']).toBeUndefined();
    }
  });

  it('皮肤号越界/缺省一律回退 0 号（负数/超界/NaN 同引用）', () => {
    const skin0 = PLAYER_SKINS[0];
    expect(skin0).toBeDefined();
    for (const id of [-1, 5, 99, Number.NaN]) {
      expect(playerSkinById(id)).toBe(skin0);
    }
    for (let i = 0; i < PLAYER_SKINS.length; i++) {
      expect(playerSkinById(i)).toBe(PLAYER_SKINS[i]);
    }
  });
});

describe('charModels · squash 滑动拉伸与落定回弹', () => {
  it('easeOutBack 锚点：f(0)=0、f(1)=1、中段过冲 >1、越界钳制', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBeCloseTo(1, 12);
    expect(easeOutBack(0.5)).toBeGreaterThan(1); // 过冲段
    expect(easeOutBack(-3)).toBeCloseTo(0, 12); // clamp01 下界
    expect(easeOutBack(7)).toBe(1); // clamp01 上界
  });

  it('滑动期恒定拉伸：y*1.08 / xz*0.95', () => {
    expect(squashScaleAt(true, 0)).toEqual({ y: SQUASH_STRETCH.slideY, xz: SQUASH_STRETCH.slideXZ });
    expect(squashScaleAt(true, 99)).toEqual({ y: 1.08, xz: 0.95 });
  });

  it('落定回弹：起点 (0.88, 1.08) → 终点 (1, 1)，中段带过冲弹性', () => {
    const start = squashScaleAt(false, 0);
    expect(start.y).toBeCloseTo(SQUASH_STRETCH.landY, 12);
    expect(start.xz).toBeCloseTo(SQUASH_STRETCH.landXZ, 12);
    const end = squashScaleAt(false, SQUASH_LAND_SECONDS);
    expect(end.y).toBeCloseTo(1, 10);
    expect(end.xz).toBeCloseTo(1, 10);
    expect(squashScaleAt(false, SQUASH_LAND_SECONDS * 2).y).toBeCloseTo(1, 10);
    const mid = squashScaleAt(false, SQUASH_LAND_SECONDS * 0.5);
    expect(mid.y).toBeGreaterThan(SQUASH_STRETCH.landY); // 正在回弹
    expect(mid.y).toBeLessThan(1.05); // 过冲受 easeOutBack 峰值约束
    expect(mid.xz).toBeLessThan(SQUASH_STRETCH.landXZ);
    expect(mid.xz).toBeGreaterThan(0.9);
  });
});

describe('charModels · 围巾摆动', () => {
  it('sin 摆动：t=0 归零、界内 ±幅度、按周期复现', () => {
    expect(scarfSwayAt(0)).toBe(0);
    for (let t = 0; t < 4; t += 0.05) {
      expect(Math.abs(scarfSwayAt(t))).toBeLessThanOrEqual(SCARF_SWAY_AMPLITUDE + 1e-12);
    }
    const period = (Math.PI * 2) / SCARF_SWAY_SPEED;
    expect(scarfSwayAt(period)).toBeCloseTo(scarfSwayAt(0), 12);
    expect(scarfSwayAt(period * 1.5)).toBeCloseTo(scarfSwayAt(period * 0.5), 12);
  });
});

describe('charModels · 消散采样（0.6s 自终止）', () => {
  it('起止状态：p=0 全亮原位、p=1 散尽升顶缩至 55%', () => {
    const first = dissolveAt(0);
    expect(first.opacity).toBe(1);
    expect(first.rise).toBe(0);
    expect(first.scale).toBe(1);
    const last = dissolveAt(1);
    expect(last.opacity).toBe(0);
    expect(last.rise).toBeCloseTo(DISSOLVE_RISE, 10);
    expect(last.scale).toBeCloseTo(0.55, 10);
    expect(DISSOLVE_SECONDS).toBe(0.6);
  });

  it('单调性：透明度不升、上浮不减、收缩不增（越界钳制）', () => {
    let prevOpacity = Infinity;
    let prevRise = -Infinity;
    let prevScale = Infinity;
    for (let p = -0.5; p <= 1.5; p += 0.05) {
      const state = dissolveAt(p);
      expect(state.opacity).toBeLessThanOrEqual(prevOpacity);
      expect(state.rise).toBeGreaterThanOrEqual(prevRise);
      expect(state.scale).toBeLessThanOrEqual(prevScale);
      prevOpacity = state.opacity;
      prevRise = state.rise;
      prevScale = state.scale;
    }
  });
});

describe('charModels · sprite-stacking 层变换', () => {
  it('3 层缩放 1/0.86/0.72，纵向间隔与 z 错位随层递增', () => {
    expect(spriteStackTransform(0)).toEqual({ scale: 1, y: 0, z: 0 });
    expect(spriteStackTransform(1).scale).toBeCloseTo(0.86, 10);
    expect(spriteStackTransform(2).scale).toBeCloseTo(0.72, 10);
    expect(spriteStackTransform(1).y).toBeGreaterThan(spriteStackTransform(0).y);
    expect(spriteStackTransform(2).y).toBeGreaterThan(spriteStackTransform(1).y);
    expect(spriteStackTransform(2).z).toBeGreaterThan(spriteStackTransform(1).z);
    expect(spriteStackTransform(1).z).toBeGreaterThan(spriteStackTransform(0).z);
  });

  it('层号越界钳制到底/顶层', () => {
    expect(spriteStackTransform(-4)).toEqual(spriteStackTransform(0));
    expect(spriteStackTransform(99)).toEqual(spriteStackTransform(2));
  });
});

describe('charModels · BOSS 堆叠与分身摆位', () => {
  it('双层堆叠：本体完整 + 帽檐层缩窄上移（y 按本体高度比例）', () => {
    expect(BOSS_STACK_LAYERS.length).toBe(2);
    const baseHeight = 10 * 0.14;
    const base = bossStackTransform(0, baseHeight);
    const hood = bossStackTransform(1, baseHeight);
    expect(base.scale).toBe(1);
    expect(base.y).toBe(0);
    expect(hood.scale).toBeCloseTo(0.78, 10);
    expect(hood.y).toBeCloseTo(baseHeight, 10); // yRatio 1.0：帽檐接在头顶
    expect(bossStackTransform(-1, baseHeight)).toEqual(base);
    expect(bossStackTransform(9, baseHeight)).toEqual(hood);
  });

  it('分身公转角：t=0 归零、界内 ±幅度、按周期复现', () => {
    expect(cloneOrbitYawAt(0)).toBe(0);
    for (let t = 0; t < 8; t += 0.07) {
      expect(Math.abs(cloneOrbitYawAt(t))).toBeLessThanOrEqual(BOSS_CLONE_SWAY_AMPLITUDE + 1e-12);
    }
    const period = (Math.PI * 2) / BOSS_CLONE_SWAY_SPEED;
    expect(cloneOrbitYawAt(period)).toBeCloseTo(0, 12);
    expect(cloneOrbitYawAt(period * 2.25)).toBeCloseTo(cloneOrbitYawAt(period * 0.25), 12);
  });
});

describe('charModels · 接地阴影高度衰减', () => {
  it('地面满强度、随高度线性衰减、2 层高差后隐去', () => {
    expect(shadowOpacityAt(0)).toBe(SHADOW_BASE_OPACITY);
    expect(shadowOpacityAt(-1)).toBe(SHADOW_BASE_OPACITY);
    expect(shadowOpacityAt(SHADOW_FADE_HEIGHT)).toBe(0);
    expect(shadowOpacityAt(99)).toBe(0);
    expect(shadowOpacityAt(SHADOW_FADE_HEIGHT / 2)).toBeCloseTo(SHADOW_BASE_OPACITY / 2, 10);
    let prev = Infinity;
    for (let y = 0; y <= SHADOW_FADE_HEIGHT + 0.1; y += 0.1) {
      expect(shadowOpacityAt(y)).toBeLessThanOrEqual(prev);
      prev = shadowOpacityAt(y);
    }
  });
});

describe('charModels · 玩家部件几何（GEOMETRY_CACHE 键 actor:player-<id>:<part>）', () => {
  it('torso = 头+身+双臂合并（顶点预算精确），scarf = 3 节链', () => {
    const skin = playerSkinById(0);
    const headCells = parseArtMask(skin.head.rows).cells.length;
    const bodyCells = parseArtMask(skin.body.rows).cells.length;
    const parts = buildPlayerParts(0);
    // 每体素/box 24 顶点：掩码体素 + 左右臂两个 box
    expect(parts.torso.getAttribute('position').count).toBe((headCells + bodyCells) * 24 + 48);
    expect(parts.torso.getAttribute('color')).toBeDefined();
    expect(parts.scarf.getAttribute('position').count).toBe(72);
    // 颈点 pivot：围巾几何向下垂（minY<0）且颈环在 pivot 上方
    parts.scarf.computeBoundingBox();
    const bbox = parts.scarf.boundingBox;
    expect(bbox === null || bbox.min.y < 0).toBe(true);
    expect(bbox === null || bbox.max.y > 0.04).toBe(true);
    // 拼装高度：头部抬升后 torso 总高超过 body 掩码段
    parts.torso.computeBoundingBox();
    const torsoBox = parts.torso.boundingBox;
    const bodyHeight = skin.body.rows.length * 0.15;
    expect(torsoBox === null || torsoBox.max.y).toBeGreaterThan(bodyHeight);
    expect(parts.neckY).toBeCloseTo(bodyHeight, 10);
  });

  it('同皮肤二次构建命中缓存（同引用），同键不重建', () => {
    const first = buildPlayerParts(3);
    const second = buildPlayerParts(3);
    expect(second.torso).toBe(first.torso);
    expect(second.scarf).toBe(first.scarf);
    expect(second.neckY).toBe(first.neckY);
  });
});

describe('charModels · tintedGeometry（顶点色工具）', () => {
  it('色属性数量与顶点一致、通道值与 three Color 语义一致', () => {
    const box = tintedGeometry(new BoxGeometry(1, 1, 1), '#ff3366');
    const color = box.getAttribute('color');
    expect(color).toBeDefined();
    expect(color.count).toBe(box.getAttribute('position').count);
    // three Color 对 hex 字符串走 sRGB→Linear 转换（色彩管理），期望值取同源 Color
    const expected = new Color('#ff3366');
    for (let v = 0; v < color.count; v++) {
      expect(color.getX(v)).toBeCloseTo(expected.r, 5);
      expect(color.getY(v)).toBeCloseTo(expected.g, 5);
      expect(color.getZ(v)).toBeCloseTo(expected.b, 5);
    }
  });
});
