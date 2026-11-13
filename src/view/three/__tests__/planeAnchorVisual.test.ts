/**
 * 位面锚点浮空石板（C1 视觉收尾）—— 纯逻辑单测，不依赖 WebGL。
 * ---------------------------------------------------------------------------
 * 老缺陷：planeAnchors 全仓无 3D 视觉渲染（仅 grid.ts playerOnAnchor 逻辑消费），
 * 锚点对玩家完全不可见，只能盲试 F。修复后 GridArena 经 planeAnchorItems 把
 * 锚点渲染为悬浮石板（levelGuide「浮空石板」承诺兑现）。本文件锁死派生行为：
 * 抬升高度 / 尺寸 / 颜色透传 / 海拔叠加 / 空表零实例。
 */

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../core/types';
import { HEIGHT_STEP } from '../theme';
import { PLANE_ANCHOR_HEIGHT, PLANE_ANCHOR_LIFT, PLANE_ANCHOR_SIZE, planeAnchorItems } from '../GridArena';

/** 恒等换算：世界坐标 = 格坐标（测试只关心 y 抬升与 x/z 映射通道） */
const identityToWorld = (x: number, y: number): [number, number, number] => [x, 0, y];

describe('planeAnchorItems · 锚点石板派生（C1）', () => {
  it('每个锚点生成一块石板：悬浮于格面之上（surface + LIFT + 半厚度）', () => {
    const anchors: readonly Vec2[] = [{ x: 4, y: 1 }, { x: 9, y: 1 }];
    const items = planeAnchorItems(anchors, identityToWorld, undefined, '#7c5cff');
    expect(items).toHaveLength(2);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const anchor = anchors[i]!;
      expect(item.position[0]).toBe(anchor.x);
      expect(item.position[2]).toBe(anchor.y);
      expect(item.position[1]).toBeCloseTo(PLANE_ANCHOR_LIFT + PLANE_ANCHOR_HEIGHT / 2, 12);
    }
  });

  it('尺寸取 PLANE_ANCHOR_SIZE × 厚度 × SIZE（略小于整格，露出底格）', () => {
    const [item] = planeAnchorItems([{ x: 2, y: 3 }], identityToWorld, undefined, '#ffffff');
    expect(item?.scale).toEqual([PLANE_ANCHOR_SIZE, PLANE_ANCHOR_HEIGHT, PLANE_ANCHOR_SIZE]);
  });

  it('颜色透传（vfx.plane 同源色由调用方传入）与海拔叠加（抬升基于格面海拔）', () => {
    const heights = [[0, 0, 0], [0, 2, 0]];
    const [flat, raised] = planeAnchorItems(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      identityToWorld,
      heights,
      '#ffcf5c',
    );
    expect(flat?.color).toBe('#ffcf5c');
    expect(raised?.color).toBe('#ffcf5c');
    expect(raised?.position[1]).toBeCloseTo(2 * HEIGHT_STEP + PLANE_ANCHOR_LIFT + PLANE_ANCHOR_HEIGHT / 2, 12);
    expect(raised!.position[1] - flat!.position[1]).toBeCloseTo(2 * HEIGHT_STEP, 12);
  });

  it('空锚点表返回空数组（无锚点关卡零实例、零 draw call 语义）', () => {
    expect(planeAnchorItems([], identityToWorld, undefined, '#7c5cff')).toEqual([]);
  });
});
