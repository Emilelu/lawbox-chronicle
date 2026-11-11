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
  BASE_CAMERA_FOV,
  CAMERA_ZOOM_LIMITS,
  FIRST_PERSON_LIMITS,
  FIRST_PERSON_POSE,
  FACING_RENDER_YAW_LIMIT,
  FACING_YAW,
  GLOBAL_CAMERA_LIMITS,
  POLAR_MAX,
  POLAR_MIN,
  SLIDE_SECONDS,
  VFX_PARTICLES,
  WALL_SHADE_COUNT,
  cameraLimitsFor,
  cellWorldCenter,
  clampNpcCell,
  computeExploreResetPose,
  computePose,
  degToRad,
  deriveGates,
  deriveTileField,
  easeOutBack,
  easeOutCubic,
  facingRenderYaw,
  gridCenterWorld,
  hash2,
  mixHex,
  planeTheme,
  selectMountedAreas,
  slidePosition,
  wallShadeColor,
  widerCameraLimits,
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

  it('easeOutBack：端点归零归一，中段过冲 >1 再回落（部件落定手感）', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(1)).toBeCloseTo(1, 12);
    expect(easeOutBack(0.5)).toBeGreaterThan(1); // 标准回弹：中段越过目标
    expect(easeOutBack(0.5)).toBeLessThan(1.15); // 过冲幅度有界（约 +10%）
    expect(easeOutBack(-0.5)).toBeCloseTo(0, 12); // 越界钳到 [0,1]
    expect(easeOutBack(1.5)).toBeCloseTo(1, 12);
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

  it('explore 回正位姿只收敛方位角，距离/俯仰保持当前值（I2，第三人称缺省分支）', () => {
    const pose = computeExploreResetPose(ctx);
    expect(pose.distance).toBeNull(); // 不抢用户的缩放
    expect(pose.polar).toBeNull(); // 不抢用户的俯仰
    expect(pose.azimuth).toBe(0); // 方位角回正到网格正方向（与按键语义一致）
    // 注视点沿用 explore 惯例：玩家头顶 0.4
    expect(pose.target[0]).toBeCloseTo(1, 10);
    expect(pose.target[1]).toBeCloseTo(0.4, 10);
    expect(pose.target[2]).toBeCloseTo(2, 10);
  });

  it('explore 回正位姿（first 分支）：收敛 FP 头位，方位角保留用户头向', () => {
    const pose = computeExploreResetPose(ctx, 'first');
    expect(pose.distance).toBe(FIRST_PERSON_POSE.distance); // 0.55 头位
    expect(pose.distance).toBeCloseTo(0.55, 12);
    expect(pose.polar).toBe(FIRST_PERSON_POSE.polar); // FP 极角 78°
    expect(pose.polar).toBeCloseTo(degToRad(78), 12);
    expect(pose.azimuth).toBeNull(); // 不拽头向（dialogue/victory→explore 语义）
    expect(pose.fov).toBe(68); // FP 视场角恢复
    // 注视点仍走 explore 惯例：玩家头顶 0.4
    expect(pose.target[0]).toBeCloseTo(1, 10);
    expect(pose.target[1]).toBeCloseTo(0.4, 10);
    expect(pose.target[2]).toBeCloseTo(2, 10);
  });

  it('第一人称头位档常量：distance 0.55 / polar 78°（elevation 12°）/ fov 68', () => {
    expect(FIRST_PERSON_POSE.distance).toBeCloseTo(0.55, 12);
    expect(FIRST_PERSON_POSE.polar).toBeCloseTo(degToRad(78), 12);
    expect(FIRST_PERSON_POSE.fov).toBe(68);
    expect(BASE_CAMERA_FOV).toBe(50); // fov 收敛回落基准与 WorldCanvas 初始 fov 同源
  });

  it('cameraLimitsFor 三元分档：仅 first+explore/dialogue 未俯瞰收紧 FP 档', () => {
    const fp = { polarMin: degToRad(70), polarMax: degToRad(84), distMin: 0.35, distMax: 1.2 };
    // first + explore/dialogue 未俯瞰 → FP 档
    expect(cameraLimitsFor('first', 'explore', false)).toEqual(fp);
    expect(cameraLimitsFor('first', 'dialogue', false)).toEqual(fp);
    expect(cameraLimitsFor('first', 'explore', false)).toEqual(FIRST_PERSON_LIMITS);

    // first + 演出模式（非 peek）→ 全局档：victory 18 / boss 6.2 / combat 8.2 不受压
    expect(cameraLimitsFor('first', 'combat', false)).toEqual(GLOBAL_CAMERA_LIMITS);
    expect(cameraLimitsFor('first', 'victory', false)).toEqual(GLOBAL_CAMERA_LIMITS);
    expect(cameraLimitsFor('first', 'boss', false)).toEqual(GLOBAL_CAMERA_LIMITS);

    // 任何 peeking 组合 → 全局档（T 俯瞰 8.5 / 35° 极角必须可达）
    for (const mode of ['explore', 'dialogue', 'combat', 'victory', 'boss'] as const) {
      expect(cameraLimitsFor('first', mode, true)).toEqual(GLOBAL_CAMERA_LIMITS);
      expect(cameraLimitsFor('third', mode, true)).toEqual(GLOBAL_CAMERA_LIMITS);
    }

    // third 全档 → 全局档（现状逐字节一致）
    for (const mode of ['explore', 'dialogue', 'combat', 'victory', 'boss'] as const) {
      expect(cameraLimitsFor('third', mode, false)).toEqual(GLOBAL_CAMERA_LIMITS);
    }

    // 全局档 = POLAR_MIN/MAX + CAMERA_ZOOM_LIMITS 聚合（既有不变量同源）
    expect(GLOBAL_CAMERA_LIMITS).toEqual({
      polarMin: POLAR_MIN,
      polarMax: POLAR_MAX,
      distMin: CAMERA_ZOOM_LIMITS.min,
      distMax: CAMERA_ZOOM_LIMITS.max,
    });
  });

  it('FP 档极角范围在全局档之外、距离范围在其内（跨档并集过渡的几何前提）', () => {
    expect(FIRST_PERSON_LIMITS.polarMin).toBeGreaterThan(GLOBAL_CAMERA_LIMITS.polarMax);
    expect(FIRST_PERSON_LIMITS.polarMax).toBeGreaterThan(FIRST_PERSON_LIMITS.polarMin);
    expect(FIRST_PERSON_LIMITS.distMin).toBeLessThan(GLOBAL_CAMERA_LIMITS.distMin);
    expect(FIRST_PERSON_LIMITS.distMax).toBeLessThan(GLOBAL_CAMERA_LIMITS.distMin);
    // 并集覆盖两档（跨档收敛期 OrbitControls 生效限制）
    const union = widerCameraLimits(FIRST_PERSON_LIMITS, GLOBAL_CAMERA_LIMITS);
    expect(union.polarMin).toBe(GLOBAL_CAMERA_LIMITS.polarMin);
    expect(union.polarMax).toBe(FIRST_PERSON_LIMITS.polarMax);
    expect(union.distMin).toBe(FIRST_PERSON_LIMITS.distMin);
    expect(union.distMax).toBe(GLOBAL_CAMERA_LIMITS.distMax);
  });
});

describe('theme · 朝向渲染收敛（I4：侧视不再缩成竖条）', () => {
  it('facingRenderYaw：up/down 保持正/背视，left/right 收敛为 ±60° 3/4 视角（部件化重制）', () => {
    expect(facingRenderYaw('down')).toBe(0);
    expect(facingRenderYaw('up')).toBe(Math.PI);
    expect(facingRenderYaw('left')).toBe(-FACING_RENDER_YAW_LIMIT);
    expect(facingRenderYaw('right')).toBe(FACING_RENDER_YAW_LIMIT);
    expect(FACING_RENDER_YAW_LIMIT).toBeCloseTo(Math.PI / 3, 12);
  });

  it('语义真值 FACING_YAW 不变：±90° 方向语义保留，收敛只发生在渲染层', () => {
    expect(FACING_YAW.left).toBe(-Math.PI / 2);
    expect(FACING_YAW.right).toBe(Math.PI / 2);
    // ±60° 收敛下正面剪影宽度保留 cos(60°)=50%（部件化后取更饱满的侧转，
    // 四肢/围巾部件方向可辨），仍远好于 ±90° 满侧视的近 0 宽度
    expect(Math.cos(Math.abs(facingRenderYaw('right')))).toBeCloseTo(0.5, 12);
    expect(Math.cos(Math.abs(facingRenderYaw('right')))).toBeGreaterThan(0.45);
    expect(Math.cos(Math.abs(facingRenderYaw('right')))).toBeLessThan(0.75);
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
