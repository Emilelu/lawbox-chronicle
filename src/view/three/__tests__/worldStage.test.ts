/**
 * 三维世界舞台 —— 纯逻辑单测。
 * 覆盖：格子派生尺寸/坐标换算、S5 皮肤与朝向分离、0.15s 滑动 lerp、
 * 地形派生（地面/墙/深渊/基座/阴面石板）、法则之门派生、NPC 钳位、
 * 区域分块挂卸规则、镜头位姿、阴阳主题与墙皮色阶、ASCII 造型皮肤解析
 * （13 段 art 重铸）、VFX 粒子参数。全部不依赖 WebGL。
 */

import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import {
  AREA_WORLD_OFFSETS,
  CAMERA_ZOOM_LIMITS,
  FACING_RENDER_YAW_LIMIT,
  FACING_YAW,
  POLAR_MAX,
  POLAR_MIN,
  SLIDE_SECONDS,
  VFX_PARTICLES,
  WALL_SHADE_COUNT,
  cellWorldCenter,
  clampNpcCell,
  computeExploreResetPose,
  computePose,
  deriveGates,
  deriveTileField,
  easeOutCubic,
  facingRenderYaw,
  gridCenterWorld,
  hash2,
  mixHex,
  planeTheme,
  selectMountedAreas,
  slidePosition,
  wallShadeColor,
} from '../theme';
import {
  ACTOR_SKINS,
  buildVoxelGeometry,
  parseArtMask,
  SPEAKER_SKINS,
} from '../entities/ActorMesh';
import { PLAYER_SKINS } from '../entities/PlayerAvatar';
import { buildBurstParams, createLcg } from '../effects/Vfx';
import { LEVELS } from '../../../data/levels';

/** level-sb-01 的原始关卡网格（含 2/4 出生点，供派生函数直测） */
const MAIN_GRID = LEVELS[0]?.grid ?? [];
if (MAIN_GRID.length === 0) throw new Error('关卡数据缺失');

describe('theme · 格子派生与坐标换算', () => {
  it('网格以区域锚点为中心：四角到中心距离对称', () => {
    const rows = 13;
    const cols = 15;
    const c0 = cellWorldCenter(0, 0, rows, cols, 'main');
    const c1 = cellWorldCenter(cols - 1, rows - 1, rows, cols, 'main');
    const center = gridCenterWorld(rows, cols, 'main');
    expect(center[0]).toBeCloseTo(0, 10);
    expect(center[2]).toBeCloseTo(0, 10);
    expect(c0[0]).toBeCloseTo(-c1[0], 10);
    expect(c0[2]).toBeCloseTo(-c1[2], 10);
  });

  it('区域锚点把外域搬离主区（分块挂卸的空间前提）', () => {
    const d1 = AREA_WORLD_OFFSETS['domain-1'];
    const d3 = AREA_WORLD_OFFSETS['domain-3'];
    expect(d1 !== undefined && d1.x).toBeGreaterThan(10); // 东
    expect(d3 !== undefined && d3.x).toBeLessThan(-10); // 西
  });

  it('hash2 稳定且落在无符号 32 位域', () => {
    expect(hash2(3, 5)).toBe(hash2(3, 5));
    expect(hash2(3, 5)).not.toBe(hash2(5, 3));
    for (let i = 0; i < 50; i++) {
      const h = hash2(i, i * 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('theme · S5：皮肤表与朝向表彻底分离', () => {
  it('朝向只由 Dir 决定，且与世界轴一致（模型正面 +Z）', () => {
    const forward = new Vector3(0, 0, 1);
    const expectAxis = (dir: keyof typeof FACING_YAW, x: number, z: number) => {
      const yaw = FACING_YAW[dir];
      const rotated = forward.clone().applyEuler(new Euler(0, yaw, 0));
      expect(rotated.x).toBeCloseTo(x, 6);
      expect(rotated.z).toBeCloseTo(z, 6);
    };
    expectAxis('down', 0, 1);
    expectAxis('up', 0, -1);
    expectAxis('right', 1, 0);
    expectAxis('left', -1, 0);
  });

  it('任何皮肤条目都不携带旋转/朝向字段（结构上不可能错位）', () => {
    for (const skin of PLAYER_SKINS) {
      const record = skin as unknown as Record<string, unknown>;
      expect(record['yaw']).toBeUndefined();
      expect(record['rotation']).toBeUndefined();
      expect(record['facing']).toBeUndefined();
    }
    for (const skin of Object.values(ACTOR_SKINS)) {
      const record = skin as unknown as Record<string, unknown>;
      expect(record['yaw']).toBeUndefined();
      expect(record['rotation']).toBeUndefined();
      expect(record['facing']).toBeUndefined();
    }
  });
});

describe('theme · 0.15s 滑动 lerp', () => {
  it('起止点精确、中间单调收敛（easeOutCubic）', () => {
    expect(slidePosition(2, 7, 0)).toBe(2);
    expect(slidePosition(2, 7, SLIDE_SECONDS)).toBeCloseTo(7, 10);
    let prev = -Infinity;
    for (let t = 0; t <= 0.3; t += 0.01) {
      const v = slidePosition(2, 7, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(7);
      prev = v;
    }
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // 先快后慢
  });
});

describe('theme · 地形派生（GridArena 输入）', () => {
  const field = deriveTileField(MAIN_GRID);

  const countCells = (match: (cell: number) => boolean): number => {
    let n = 0;
    for (const row of MAIN_GRID) {
      if (row === undefined) continue;
      for (const cell of row) if (cell !== undefined && match(cell)) n += 1;
    }
    return n;
  };

  it('地板/墙/基座数量与关卡表逐格一致（2/4 出生点按地板渲染）', () => {
    expect(field.floors.length).toBe(countCells((c) => c === 0 || c === 2 || c === 4));
    expect(field.walls.length).toBe(countCells((c) => c === 1));
    expect(field.goals.length).toBe(countCells((c) => c === 3));
    expect(field.goals.length).toBeGreaterThan(0);
  });

  it('深渊 = 包围盒外扩圈中不属于网格的格子（浮空岛托底）', () => {
    const rows = MAIN_GRID.length;
    const cols = MAIN_GRID[0]?.length ?? 0;
    const pad = 2;
    const expected = (rows + pad * 2) * (cols + pad * 2) - rows * cols;
    expect(field.abyss.length).toBe(expected);
  });

  it('墙皮色阶 index 有界、高度层 1~3；同一格装饰确定性复现', () => {
    for (const wall of field.walls) {
      expect(wall.tier).toBeGreaterThanOrEqual(0);
      expect(wall.tier).toBeLessThan(3);
      expect(wall.shade).toBeGreaterThanOrEqual(0);
      expect(wall.shade).toBeLessThan(WALL_SHADE_COUNT);
    }
    expect(deriveTileField(MAIN_GRID)).toEqual(field);
  });

  it('阴面石板是地板子集（纯装饰，不越出地板）', () => {
    const floorKeys = new Set(field.floors.map((t) => `${t.x},${t.y}`));
    expect(field.phaseTiles.length).toBeGreaterThan(0);
    for (const tile of field.phaseTiles) {
      expect(floorKeys.has(`${tile.x},${tile.y}`)).toBe(true);
    }
  });
});

describe('theme · 法则之门派生', () => {
  it('有开口的边各出一座门，最多 4 座，门位落在边格上', () => {
    const gates = deriveGates(MAIN_GRID);
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.length).toBeLessThanOrEqual(4);
    const rows = MAIN_GRID.length;
    const cols = MAIN_GRID[0]?.length ?? 0;
    for (const gate of gates) {
      expect(gate.spanCells).toBeGreaterThanOrEqual(1);
      if (gate.dir === 'up') expect(gate.y).toBe(0);
      if (gate.dir === 'down') expect(gate.y).toBe(rows - 1);
      if (gate.dir === 'left') expect(gate.x).toBe(0);
      if (gate.dir === 'right') expect(gate.x).toBe(cols - 1);
      const cell = MAIN_GRID[gate.y]?.[gate.x];
      expect(cell).not.toBe(1); // 门不可能立在墙里
    }
  });

  it('空网格返回空（守卫先行）', () => {
    expect(deriveGates([])).toEqual([]);
  });
});

describe('theme · NPC 落位钳制', () => {
  it('网格内地板坐标原样保留', () => {
    expect(clampNpcCell({ x: 2, y: 2 }, MAIN_GRID)).toEqual({ x: 2, y: 2 });
  });

  it('Kichiku ±5 语义的越界坐标（作者 {-2,4}）钳进网格并落在地板', () => {
    const cell = clampNpcCell({ x: -2, y: 4 }, MAIN_GRID);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(MAIN_GRID[cell.y]?.[cell.x]).toBe(0);
  });

  it('墙格坐标螺旋外扩到最近地板（天使事件 {1,0} 在顶边墙上）', () => {
    const cell = clampNpcCell({ x: 1, y: 0 }, MAIN_GRID);
    expect(MAIN_GRID[cell.y]?.[cell.x]).toBe(0);
    expect(Math.max(Math.abs(cell.x - 1), Math.abs(cell.y - 0))).toBeLessThanOrEqual(3);
  });
});

describe('theme · 区域分块挂卸（主区+当前外域常驻）', () => {
  it('主区/空段位只挂主区；外域挂主区+外域', () => {
    expect(selectMountedAreas(null)).toEqual(['main']);
    expect(selectMountedAreas('main')).toEqual(['main']);
    expect(selectMountedAreas('domain-2')).toEqual(['main', 'domain-2']);
  });
});

describe('theme · 镜头位姿', () => {
  const ctx = {
    playerPos: [1, 0, 2] as const,
    focusPos: [4, 0, 5] as const,
    arenaCenter: [0, 0, 0] as const,
  };

  it('所有模式极角落在 OrbitControls 俯仰限制内', () => {
    for (const mode of ['dialogue', 'combat', 'victory', 'boss'] as const) {
      const pose = computePose(mode, ctx);
      expect(pose.polar).toBeGreaterThanOrEqual(POLAR_MIN);
      expect(pose.polar).toBeLessThanOrEqual(POLAR_MAX);
      expect(pose.distance).toBeGreaterThanOrEqual(CAMERA_ZOOM_LIMITS.min);
      expect(pose.distance).toBeLessThanOrEqual(CAMERA_ZOOM_LIMITS.max);
    }
  });

  it('过关拉升远景：victory 距离显著大于 explore，注视点回 arenaCenter', () => {
    const victory = computePose('victory', ctx);
    const explore = computePose('explore', ctx);
    expect(explore.distance).not.toBeNull(); // explore 常规位姿给出具体距离（回正位姿才传 null）
    expect(victory.distance).toBeGreaterThan((explore.distance ?? 0) * 1.8);
    expect(victory.target).toEqual([0, 0, 0]);
  });

  it('对话注视说话者头部；战斗取玩家-敌人中点且方位角归 0（I1：推挤方向=画面方向）', () => {
    const dialogue = computePose('dialogue', ctx);
    expect(dialogue.target[0]).toBeCloseTo(4, 10);
    expect(dialogue.target[1]).toBeCloseTo(0.55, 10);
    expect(dialogue.azimuth).toBeNull(); // 保持用户方位

    const combat = computePose('combat', ctx);
    expect(combat.target[0]).toBeCloseTo(2.5, 10);
    expect(combat.target[2]).toBeCloseTo(3.5, 10);
    // 战斗期与谜题期同方位（azimuth=0，相机在 +Z 侧）：W=画面上。
    // 曾是 π/2 的侧视运镜，导致布阵期 WASD 与画面整体相差 90°（I1）。
    expect(combat.azimuth).toBe(0);
  });

  it('explore 回正位姿只收敛方位角，距离/俯仰保持当前值（I2）', () => {
    const pose = computeExploreResetPose(ctx);
    expect(pose.distance).toBeNull(); // 不抢用户的缩放
    expect(pose.polar).toBeNull(); // 不抢用户的俯仰
    expect(pose.azimuth).toBe(0); // 方位角回正到网格正方向（与按键语义一致）
    // 注视点沿用 explore 惯例：玩家头顶 0.4
    expect(pose.target[0]).toBeCloseTo(1, 10);
    expect(pose.target[1]).toBeCloseTo(0.4, 10);
    expect(pose.target[2]).toBeCloseTo(2, 10);
  });
});

describe('theme · 朝向渲染收敛（I4：侧视不再缩成竖条）', () => {
  it('facingRenderYaw：up/down 保持正/背视，left/right 收敛为 ±45° 3/4 视角', () => {
    expect(facingRenderYaw('down')).toBe(0);
    expect(facingRenderYaw('up')).toBe(Math.PI);
    expect(facingRenderYaw('left')).toBe(-FACING_RENDER_YAW_LIMIT);
    expect(facingRenderYaw('right')).toBe(FACING_RENDER_YAW_LIMIT);
    expect(FACING_RENDER_YAW_LIMIT).toBeCloseTo(Math.PI / 4, 12);
  });

  it('语义真值 FACING_YAW 不变：±90° 方向语义保留，收敛只发生在渲染层', () => {
    expect(FACING_YAW.left).toBe(-Math.PI / 2);
    expect(FACING_YAW.right).toBe(Math.PI / 2);
    // 3/4 视角下正面剪影宽度保留 cos(45°)≈71%，侧视不再只剩一列侧棱
    expect(Math.cos(Math.abs(facingRenderYaw('right')))).toBeCloseTo(Math.SQRT1_2, 12);
    expect(Math.cos(Math.abs(facingRenderYaw('right')))).toBeGreaterThan(0.7);
  });
});

describe('theme · 阴阳位面双主题', () => {
  it('阳/阴主题不同；14 阶墙皮全部是合法 hex 且随位面变化', () => {
    expect(planeTheme(false).id).toBe('yang');
    expect(planeTheme(true).id).toBe('yin');
    expect(planeTheme(false).fogColor).not.toBe(planeTheme(true).fogColor);
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      const yang = wallShadeColor(false, i);
      expect(yang).toMatch(/^#[0-9a-f]{6}$/);
      expect(wallShadeColor(true, i)).toMatch(/^#[0-9a-f]{6}$/);
    }
    // 越界 index 安全取模（负数也稳定）
    expect(wallShadeColor(false, -1)).toBe(wallShadeColor(false, WALL_SHADE_COUNT - 1));
    expect(wallShadeColor(false, WALL_SHADE_COUNT)).toBe(wallShadeColor(false, 0));
  });

  it('mixHex 中点插值正确', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});

describe('ActorMesh · 13 段 ASCII art 造型皮肤', () => {
  it('皮肤表恰有 13 段，掩码全部非空且解析可逆', () => {
    const skins = Object.values(ACTOR_SKINS);
    expect(skins.length).toBe(13);
    for (const skin of skins) {
      const mask = parseArtMask(skin.rows);
      expect(mask.cells.length).toBeGreaterThan(0);
      expect(mask.width).toBeGreaterThan(0);
      expect(mask.height).toBe(skin.rows.length);
      for (const cell of mask.cells) {
        expect(cell.colorIndex).toBeGreaterThanOrEqual(0);
        expect(cell.colorIndex).toBeLessThanOrEqual(2);
      }
    }
  });

  it('剧情说话者与皮肤一一对应（四天使/作者）', () => {
    expect(SPEAKER_SKINS['npc-angel-1']).toBe('angel-1');
    expect(SPEAKER_SKINS['npc-author']).toBe('author');
    // 集成期：三小怪 + BOSS 说话者入列（遭遇战世界内实体渲染），5 → 9
    expect(SPEAKER_SKINS['npc-caixukun']).toBe('caixukun');
    expect(SPEAKER_SKINS['npc-ylzz']).toBe('ylzz');
    expect(Object.keys(SPEAKER_SKINS).length).toBe(9);
  });

  it('buildVoxelGeometry：合并为单几何（顶点色），同 key 命中缓存', () => {
    const mask = parseArtMask(ACTOR_SKINS['angel-1']?.rows ?? []);
    const geometry = buildVoxelGeometry('test:angel-1', mask, 0.14, ['#ffffff', '#888888', '#ff0000']);
    expect(geometry.getAttribute('position').count).toBe(mask.cells.length * 24);
    expect(geometry.getAttribute('color').count).toBe(mask.cells.length * 24);
    expect(buildVoxelGeometry('test:angel-1', mask, 0.14, ['#ffffff', '#888888', '#ff0000'])).toBe(geometry);
  });

  it('行 0 在顶：首行体素的世界 Y 高于末行', () => {
    const mask = parseArtMask(['#.', '.#']);
    const first = mask.cells[0];
    const last = mask.cells[1];
    expect(first !== undefined && first.row).toBe(0);
    expect(last !== undefined && last.row).toBe(1);
    expect(first !== undefined && first.x).toBe(0);
    expect(last !== undefined && last.x).toBe(1);
  });
});

describe('Vfx · 粒子参数（固定池预算）', () => {
  it('确定性：同 seed 同参数；每槽 VFX_PARTICLES×3 速度分量', () => {
    const a = buildBurstParams('spark', 12345);
    const b = buildBurstParams('spark', 12345);
    expect(b.velocities).toEqual(a.velocities);
    expect(a.velocities.length).toBe(VFX_PARTICLES * 3);
  });

  it('种类差异：spark 有下坠重力，plane 上升且带旋绕', () => {
    const spark = buildBurstParams('spark', 7);
    const plane = buildBurstParams('plane', 7);
    expect(spark.gravity).toBeLessThan(0);
    expect(plane.gravity).toBeGreaterThan(0);
    expect(plane.swirl).toBeGreaterThan(0);
    expect(spark.swirl).toBe(0);
  });

  it('LCG 落在 [0,1) 且复现', () => {
    const rng = createLcg(42);
    const first = rng();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(createLcg(42)()).toBe(first);
  });
});
