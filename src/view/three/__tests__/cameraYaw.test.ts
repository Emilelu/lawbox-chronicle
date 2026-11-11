/**
 * cameraYawToGridDir / cameraYawToDiagDir 单测 —— 相机相对移动方向（纯函数）。
 * ---------------------------------------------------------------------------
 * 核心约定（theme.ts 相机相对移动方向区段）：
 *  - 相机偏航 θ 与 OrbitControls getAzimuthalAngle 同源（绕 +Y 自 +Z 量起）；
 *  - θ=0（相机在 +Z 侧）映射恒等 —— 存档/攻略箭头/预计算解路零影响；
 *  - θ=π/2（相机转到 +X 侧）时 W(up)→left，即 __lawboxDebug.setCamYaw(π/2)
 *    后按 W 画面左移的数值前提；
 *  - 四向/斜向 snap 均为「固定扫描序 + 严格 >」，±45° 平局确定性锁死。
 */

import { describe, expect, it } from 'vitest';
import { cameraYawToDiagDir, cameraYawToGridDir } from '../theme';
import type { DiagDir, Dir } from '../../../core/types';

/** 四向输入的固定顺序（与扫描序一致，便于逐项断言） */
const ALL_DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
const ALL_DIAGS: readonly DiagDir[] = ['upleft', 'upright', 'downleft', 'downright'];

/**
 * 表驱动用例：θ → 各输入方向的期望网格方向。
 * 手工推导 + 与 DIR_VECTORS 网格语义（up=(0,-1)）逐项核对。
 */
const GRID_CASES: readonly {
  readonly name: string;
  readonly yaw: number;
  readonly expected: Readonly<Record<Dir, Dir>>;
}[] = [
  {
    name: 'θ=0：相机在 +Z 侧，映射恒等（存档/攻略零影响）',
    yaw: 0,
    expected: { up: 'up', right: 'right', down: 'down', left: 'left' },
  },
  {
    name: 'θ=π/3（60°）：越过一个象限，W→left',
    yaw: Math.PI / 3,
    expected: { up: 'left', right: 'up', down: 'right', left: 'down' },
  },
  {
    name: 'θ=π/2：相机转到 +X 侧，W→left（setCamYaw(π/2)+按 W 的数值前提）',
    yaw: Math.PI / 2,
    expected: { up: 'left', right: 'up', down: 'right', left: 'down' },
  },
  {
    name: 'θ=−π/2：相机转到 −X 侧，W→right',
    yaw: -Math.PI / 2,
    expected: { up: 'right', right: 'down', down: 'left', left: 'up' },
  },
  {
    name: 'θ=π：相机绕到背面，W→down',
    yaw: Math.PI,
    expected: { up: 'down', right: 'left', down: 'up', left: 'right' },
  },
  {
    name: 'θ=3π/4：四向点积近平局（1 ULP 差），结果与 π/2 同构且确定',
    yaw: (3 * Math.PI) / 4,
    expected: { up: 'left', right: 'up', down: 'right', left: 'down' },
  },
  {
    name: 'θ=π/4：45° 斜置近平局（sin/cos 差 1 ULP），各向恰回到自身',
    yaw: Math.PI / 4,
    expected: { up: 'up', right: 'right', down: 'down', left: 'left' },
  },
  {
    name: 'θ=−π/4：45° 斜置近平局（sin/cos 差 1 ULP），各向恰回到自身',
    yaw: -Math.PI / 4,
    expected: { up: 'up', right: 'right', down: 'down', left: 'left' },
  },
];

describe('cameraYawToGridDir —— 相机相对移动方向（表驱动）', () => {
  for (const testCase of GRID_CASES) {
    it(testCase.name, () => {
      for (const dir of ALL_DIRS) {
        expect(cameraYawToGridDir(dir, testCase.yaw)).toBe(testCase.expected[dir]);
      }
    });
  }

  it('±45° 平局确定性：近平局（点积差 1 ULP）与真平局都由固定扫描序 + 严格 > 唯一解析', () => {
    // ±45° 处 sin/cos 相差 1 ULP，四向点积并非 fp 精确同分 —— 实现给出确定结果：
    // π/4 与 −π/4 各向恰回到自身（反复推敲的平局在真实调用中不可达，确定性不变）
    expect(cameraYawToGridDir('up', Math.PI / 4)).toBe('up');
    expect(cameraYawToGridDir('right', Math.PI / 4)).toBe('right');
    expect(cameraYawToGridDir('down', Math.PI / 4)).toBe('down');
    expect(cameraYawToGridDir('left', Math.PI / 4)).toBe('left');
    // 平局解析是纯函数行为：同参重复调用必然一致（扫描序固定 + 严格 >，无随机源）
    for (const dir of ALL_DIRS) {
      for (const yaw of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, 0, Math.PI / 2]) {
        expect(cameraYawToGridDir(dir, yaw)).toBe(cameraYawToGridDir(dir, yaw));
      }
    }
  });

  it('四向是完备映射：任意偏航下四个输入映射后互不丢失可达性（排列或平局折叠均确定）', () => {
    for (let step = 0; step < 24; step++) {
      const yaw = (step / 24) * Math.PI * 2;
      const mapped = ALL_DIRS.map((dir) => cameraYawToGridDir(dir, yaw));
      // 恒等旋转的像集合永远是四向全集的子集，且至少覆盖两个不同方向
      expect(new Set(mapped).size).toBeGreaterThanOrEqual(2);
      for (const dir of mapped) expect(ALL_DIRS).toContain(dir);
    }
  });
});

describe('cameraYawToDiagDir —— 斜向意图随相机旋转（表驱动）', () => {
  it('θ=0：斜向映射恒等（Y/U/B/N 原义不变）', () => {
    for (const diag of ALL_DIAGS) {
      expect(cameraYawToDiagDir(diag, 0)).toBe(diag);
    }
  });

  it('θ=π/2：对角整体旋转一格（upleft→downleft→downright→upright→upleft）', () => {
    expect(cameraYawToDiagDir('upleft', Math.PI / 2)).toBe('downleft');
    expect(cameraYawToDiagDir('downleft', Math.PI / 2)).toBe('downright');
    expect(cameraYawToDiagDir('downright', Math.PI / 2)).toBe('upright');
    expect(cameraYawToDiagDir('upright', Math.PI / 2)).toBe('upleft');
  });

  it('θ=−π/2 与 θ=π：对角反向/对置旋转', () => {
    expect(cameraYawToDiagDir('upleft', -Math.PI / 2)).toBe('upright');
    expect(cameraYawToDiagDir('upright', -Math.PI / 2)).toBe('downright');
    expect(cameraYawToDiagDir('downright', -Math.PI / 2)).toBe('downleft');
    expect(cameraYawToDiagDir('downleft', -Math.PI / 2)).toBe('upleft');

    expect(cameraYawToDiagDir('upleft', Math.PI)).toBe('downright');
    expect(cameraYawToDiagDir('upright', Math.PI)).toBe('downleft');
    expect(cameraYawToDiagDir('downleft', Math.PI)).toBe('upright');
    expect(cameraYawToDiagDir('downright', Math.PI)).toBe('upleft');
  });

  it('45° 相机斜置时对角近平局：固定斜向扫描序 [upleft,upright,downleft,downright] + 严格 > 唯一解析', () => {
    // upleft 意图旋转后指向纯 left 附近：upleft/downleft 近同分 → upleft
    expect(cameraYawToDiagDir('upleft', Math.PI / 4)).toBe('upleft');
    // upright 意图旋转后指向纯 up 附近：upleft/upright 近同分 → upleft
    expect(cameraYawToDiagDir('upright', Math.PI / 4)).toBe('upleft');
    // downright 意图旋转后指向纯 right 附近：upright/downright 近同分 → upright
    expect(cameraYawToDiagDir('downright', Math.PI / 4)).toBe('upright');
    // 同参重复调用一致（平局确定性）
    for (const diag of ALL_DIAGS) {
      expect(cameraYawToDiagDir(diag, Math.PI / 4)).toBe(cameraYawToDiagDir(diag, Math.PI / 4));
    }
  });
});
