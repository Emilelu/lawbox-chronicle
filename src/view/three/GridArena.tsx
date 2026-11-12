/**
 * GridArena —— 体素网格竞技场。
 * ---------------------------------------------------------------------------
 * 渲染预算落地：
 *  - 地面 / 墙 / 深渊 / 基座 / 尖刺各用一个 <instancedMesh> 合批，每种材质
 *    恰好 1 draw call（逐实例颜色走 instanceColor，不分批换材质）。
 *  - 分块挂载卸载：主区 + 当前外域常驻（theme.selectMountedAreas），远景块
 *    走合并低模 LOD（mergeGeometries，2 draw calls）。
 *  - 全部尺寸由 theme.CELL 派生，深渊外圈把关卡托成浮空岛。
 * 法则之门由 theme.deriveGates 派生，关卡完成时经 GateMesh 溶解开启。
 * THEME-3 逐关主题：主题经 levelThemes.resolveLevelTheme(levelId, yin) 解析
 * （12 关 accent/fog/sky/双灯/地面墙，mixHex 派生，L9 per-plane 分支）；
 * 墙皮 14 阶按关 accent 重采样；theme.ts:384 的 phaseTiles 装饰通道扩为
 * 按关 deco 格（levelDeco）并入 instancedMesh 合批；每关一座主角装置
 * （heroProp，纯装饰不占格）。
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { InstancedMesh, Matrix4, BufferGeometry } from 'three';
import { BoxGeometry, Color, Matrix4 as M4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AreaId, Grid, Vec2 } from '../../core/types';
import type { HeightMap } from '../../engine/puzzle/grid';
import { LEVELS, findLevel } from '../../data/levels';
import {
  ABYSS_THICKNESS,
  ABYSS_TOP_DROP,
  CELL,
  FLOOR_THICKNESS,
  HEIGHT_STEP,
  PEDESTAL_CAP_HEIGHT,
  PEDESTAL_CAP_RADIUS,
  PEDESTAL_HEIGHT,
  PEDESTAL_INSET,
  PHASE_TILE_HEIGHT,
  PHASE_TILE_LIFT,
  SPIKE_HEIGHT,
  SPIKE_RADIUS,
  WALL_TIER_SCALES,
  WALL_UNIT,
  cellWorldCenter,
  deriveGates,
  deriveTileField,
  gridCenterWorld,
  hash2,
  heightOf,
  selectMountedAreas,
  type PlaneTheme,
  type TileField,
  type WorldVec3,
} from './theme';
import {
  levelDeco,
  levelHeroProp,
  levelWallShadeColor,
  resolveLevelTheme,
  type LevelHeroProp,
} from './levelThemes';
import { GateMesh } from './entities/GateMesh';

/* ============================ 通用：合批实例字段 =========================== */

export interface FieldItem {
  readonly position: WorldVec3;
  readonly scale: WorldVec3;
  readonly color: string;
}

interface InstancedFieldProps {
  readonly items: readonly FieldItem[];
  readonly shape: 'box' | 'cone' | 'cylinder';
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly roughness?: number;
  readonly metalness?: number;
}

const tmpMatrix: Matrix4 = new M4();
const tmpPosition = new Vector3();
const tmpScale = new Vector3();
const tmpColor = new Color();
const IDENTITY_QUATERNION = new Quaternion();

/**
 * 一类几何 + 一份材质 = 1 draw call。items 引用变化时重填矩阵与颜色；
 * frameloop="demand" 下 React 提交自动触发一次重绘，无需手动 invalidate。
 */
function InstancedField({
  items,
  shape,
  emissive = '#000000',
  emissiveIntensity = 0,
  transparent = false,
  opacity = 1,
  roughness = 0.85,
  metalness = 0.1,
}: InstancedFieldProps) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;
      tmpPosition.set(item.position[0], item.position[1], item.position[2]);
      tmpScale.set(item.scale[0], item.scale[1], item.scale[2]);
      tmpMatrix.compose(tmpPosition, IDENTITY_QUATERNION, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      mesh.setColorAt(i, tmpColor.set(item.color));
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }, [items]);

  if (items.length === 0) return null;

  const key = `${shape}:${items.length}`;
  return (
    <instancedMesh
      key={key}
      ref={meshRef}
      args={[undefined, undefined, items.length]}
      frustumCulled={false}
    >
      {shape === 'box' ? (
        <boxGeometry args={[1, 1, 1]} />
      ) : shape === 'cone' ? (
        <coneGeometry args={[1, 1, 5]} />
      ) : (
        <cylinderGeometry args={[1, 1, 1, 16]} />
      )}
      <meshStandardMaterial
        color="#ffffff"
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        transparent={transparent}
        opacity={opacity}
        roughness={roughness}
        metalness={metalness}
      />
    </instancedMesh>
  );
}

/* ============================ 区域块（挂/卸单位） ========================== */

interface ArenaChunkProps {
  readonly grid: Grid;
  readonly area: AreaId;
  readonly yin: boolean;
  /** 本块对应的关卡 id（逐关主题解析；远景主区回落主城关） */
  readonly levelId: string | null;
  /** 引擎海拔层（与 grid 同尺寸；缺省全 0 = 纯平面关） */
  readonly heights?: HeightMap;
  /** 远景低模 LOD（主区在域外时的过场形态） */
  readonly lowDetail: boolean;
  readonly hazardCells: readonly Vec2[];
  readonly complete: boolean;
  /** 墙皮重掷纪元（A2-2 透传链：GridArena → ArenaChunk → FullDetailChunk） */
  readonly wallSkinEpoch: number;
}

/** 单格换算闭包（rows/cols 在派生后固定） */
function makeToWorld(field: TileField, area: AreaId): (x: number, y: number) => WorldVec3 {
  return (x, y) => cellWorldCenter(x, y, field.rows, field.cols, area);
}

/** 远景低模：地板 = 一块整体石板；墙 = 合并凸包（2 draw calls，无逐格细节） */
function LowDetailChunk({ field, area, theme, heights }: {
  field: TileField;
  area: AreaId;
  theme: PlaneTheme;
  heights: HeightMap | undefined;
}) {
  const toWorld = useMemo(() => makeToWorld(field, area), [field, area]);

  const wallGeometry = useMemo<BufferGeometry | null>(() => {
    const boxes: BoxGeometry[] = [];
    for (const wall of field.walls) {
      const tier = WALL_TIER_SCALES[wall.tier] ?? 1;
      const h = WALL_UNIT * tier;
      const surface = heightOf(heights, wall.x, wall.y) * HEIGHT_STEP;
      const totalH = surface + h;
      const [wx, , wz] = toWorld(wall.x, wall.y);
      boxes.push(new BoxGeometry(CELL, totalH, CELL).translate(wx, totalH / 2, wz));
    }
    if (boxes.length === 0) return null;
    const merged = mergeGeometries(boxes, false);
    for (const box of boxes) box.dispose();
    return merged;
  }, [field, toWorld, heights]);

  useEffect(() => () => wallGeometry?.dispose(), [wallGeometry]);

  const center = gridCenterWorld(field.rows, field.cols, area);
  return (
    <group>
      <mesh position={[center[0], -FLOOR_THICKNESS / 2, center[2]]}>
        <boxGeometry args={[field.cols * CELL, FLOOR_THICKNESS, field.rows * CELL]} />
        <meshStandardMaterial color={theme.floor.base} roughness={0.95} metalness={0.05} />
      </mesh>
      {wallGeometry !== null && (
        <mesh geometry={wallGeometry} position={[0, 0, 0]}>
          <meshStandardMaterial color={theme.wall.base} roughness={0.9} metalness={0.1} />
        </mesh>
      )}
    </group>
  );
}

/** 近景完整块：逐格合批（每材质 1 draw call）+ 按关装饰格 + 门体 */
function FullDetailChunk({ field, grid, area, theme, levelId, hazardCells, heights, complete, wallSkinEpoch }: {
  field: TileField;
  grid: Grid;
  area: AreaId;
  theme: PlaneTheme;
  /** 当前关 id（FullDetailChunk 只渲染当前关所在块） */
  levelId: string | null;
  hazardCells: readonly Vec2[];
  heights: HeightMap | undefined;
  complete: boolean;
  /** 墙皮重掷纪元（A2-2：cheatRegistry.wallSkinEpoch 透传；0 = 基线 ramp） */
  wallSkinEpoch: number;
}) {
  const toWorld = useMemo(() => makeToWorld(field, area), [field, area]);
  const gates = useMemo(() => deriveGates(grid), [grid]);

  /** 某格地面的世界 Y（海拔顶层） */
  const surfaceAt = (x: number, y: number): number => heightOf(heights, x, y) * HEIGHT_STEP;

  const floorItems = useMemo<FieldItem[]>(
    () =>
      // 地板 + 旗位基座列：旗格同样托起一根实心柱，基座才有高度差可看
      [...field.floors, ...field.goals].map((tile) => {
        const surface = tile.height * HEIGHT_STEP;
        const bottom = Math.min(0, surface - FLOOR_THICKNESS);
        const h = surface - bottom;
        const [wx, , wz] = toWorld(tile.x, tile.y);
        const checker = hash2(tile.x, tile.y) % 2 === 0;
        return {
          position: [wx, bottom + h / 2, wz] as WorldVec3,
          scale: [CELL, h, CELL] as WorldVec3,
          color: checker ? theme.floor.base : theme.floor.alt,
        };
      }),
    [field, toWorld, theme],
  );

  const wallItems = useMemo<FieldItem[]>(
    () =>
      field.walls.map((tile) => {
        const tier = WALL_TIER_SCALES[tile.tier] ?? 1;
        const h = WALL_UNIT * tier;
        const surface = tile.height * HEIGHT_STEP;
        const totalH = surface + h; // 高台墙从地面升起，整柱填实（无悬空）
        const [wx, , wz] = toWorld(tile.x, tile.y);
        // THEME-3：14 阶墙皮按关 accent 重采样（levelThemes 缓存 ramp）；
        // A2-2：wallSkinEpoch 参与确定性重采样 —— 重掷作弊按键后墙皮才真的重排
        return {
          position: [wx, totalH / 2, wz] as WorldVec3,
          scale: [CELL * 0.98, totalH, CELL * 0.98] as WorldVec3,
          color: levelWallShadeColor(theme, tile.shade, wallSkinEpoch),
        };
      }),
    [field, toWorld, theme, wallSkinEpoch],
  );

  const abyssItems = useMemo<FieldItem[]>(
    () =>
      field.abyss.map((tile) => {
        const [wx, , wz] = toWorld(tile.x, tile.y);
        const drop = ABYSS_TOP_DROP + tile.ring * 0.24;
        return {
          position: [wx, -drop - ABYSS_THICKNESS / 2, wz] as WorldVec3,
          scale: [CELL, ABYSS_THICKNESS, CELL] as WorldVec3,
          color: tile.ring === 0 ? theme.abyss.base : theme.abyss.deep,
        };
      }),
    [field, toWorld, theme],
  );

  const pedestalItems = useMemo<FieldItem[]>(
    () =>
      field.goals.map((tile) => {
        const surface = tile.height * HEIGHT_STEP;
        const [wx, , wz] = toWorld(tile.x, tile.y);
        return {
          position: [wx, surface + PEDESTAL_HEIGHT / 2 + 0.002, wz] as WorldVec3,
          scale: [CELL * PEDESTAL_INSET, PEDESTAL_HEIGHT, CELL * PEDESTAL_INSET] as WorldVec3,
          color: theme.goal.pedestal,
        };
      }),
    [field, toWorld, theme],
  );

  const capItems = useMemo<FieldItem[]>(
    () =>
      field.goals.map((tile) => {
        const surface = tile.height * HEIGHT_STEP;
        const [wx, , wz] = toWorld(tile.x, tile.y);
        return {
          position: [wx, surface + PEDESTAL_HEIGHT + PEDESTAL_CAP_HEIGHT / 2 + 0.002, wz] as WorldVec3,
          scale: [PEDESTAL_CAP_RADIUS, PEDESTAL_CAP_HEIGHT, PEDESTAL_CAP_RADIUS] as WorldVec3,
          color: theme.goal.cap,
        };
      }),
    [field, toWorld, theme],
  );

  const phaseItems = useMemo<FieldItem[]>(
    () =>
      field.phaseTiles.map((tile) => {
        const surface = tile.height * HEIGHT_STEP;
        const [wx, , wz] = toWorld(tile.x, tile.y);
        return {
          position: [wx, surface + PHASE_TILE_LIFT + PHASE_TILE_HEIGHT / 2, wz] as WorldVec3,
          scale: [CELL * 0.92, PHASE_TILE_HEIGHT, CELL * 0.92] as WorldVec3,
          color: theme.phase.tile,
        };
      }),
    [field, toWorld, theme],
  );

  // THEME-3：按关装饰格（levelDeco 确定性采样）—— phaseTiles 装饰通道的
  // 逐关扩展，并入 instancedMesh 合批；贴地/矮小不遮玩法格，阴阳两相均可见
  //（关卡识别色在默认阳面也要成立；阴面专属浮空石板仍单独成批保留 yin 语义）
  const deco = useMemo(() => levelDeco(levelId, theme.id === 'yin', field), [levelId, theme, field]);
  const decoItems = useMemo<FieldItem[]>(() => {
    if (deco === null) return [];
    return deco.tiles.map((tile) => {
      const surface = tile.height * HEIGHT_STEP;
      const [wx, , wz] = toWorld(tile.x, tile.y);
      if (deco.kind === 'rune') {
        return {
          position: [wx, surface + 0.017, wz] as WorldVec3,
          scale: [CELL * 0.72, 0.03, CELL * 0.72] as WorldVec3,
          color: deco.color,
        };
      }
      if (deco.kind === 'crystal') {
        return {
          position: [wx, surface + 0.18, wz] as WorldVec3,
          scale: [CELL * 0.16, CELL * 0.36, CELL * 0.16] as WorldVec3,
          color: deco.color,
        };
      }
      return {
        position: [wx, surface + 0.25, wz] as WorldVec3,
        scale: [CELL * 0.09, CELL * 0.5, CELL * 0.09] as WorldVec3,
        color: deco.color,
      };
    });
  }, [deco, toWorld]);

  const spikeItems = useMemo<FieldItem[]>(
    () =>
      hazardCells.map((cell) => {
        const surface = surfaceAt(cell.x, cell.y);
        const [wx, , wz] = toWorld(cell.x, cell.y);
        return {
          position: [wx, surface + SPIKE_HEIGHT / 2, wz] as WorldVec3,
          scale: [SPIKE_RADIUS, SPIKE_HEIGHT, SPIKE_RADIUS] as WorldVec3,
          color: theme.spike.base,
        };
      }),
    [hazardCells, toWorld, theme, heights],
  );

  return (
    <group>
      <InstancedField items={abyssItems} shape="box" roughness={1} />
      <InstancedField items={floorItems} shape="box" roughness={0.92} />
      <InstancedField items={wallItems} shape="box" roughness={0.78} metalness={0.18} />
      <InstancedField items={pedestalItems} shape="box" roughness={0.6} metalness={0.25} />
      <InstancedField
        items={capItems}
        shape="cylinder"
        emissive={theme.goal.cap}
        emissiveIntensity={0.9}
        roughness={0.35}
      />
      {/* 阴面浮空石板：阳面隐藏（状态驱动，无常驻定时器 —— 根治 S18） */}
      <group visible={theme.id === 'yin'}>
        <InstancedField
          items={phaseItems}
          shape="box"
          emissive={theme.phase.tile}
          emissiveIntensity={0.55}
          transparent
          opacity={theme.phase.opacity}
          roughness={0.5}
        />
      </group>
      {/* 按关装饰格（THEME-3）：独立合批（1 draw call），阴阳两相均可见 */}
      <InstancedField
        items={decoItems}
        shape={deco?.kind === 'crystal' ? 'cone' : deco?.kind === 'pillar' ? 'cylinder' : 'box'}
        emissive={deco?.color ?? '#000000'}
        emissiveIntensity={0.4}
        roughness={0.4}
        metalness={0.1}
      />
      <InstancedField items={spikeItems} shape="cone" roughness={0.55} metalness={0.3} />
      {gates.map((gate) => {
        const surface = surfaceAt(gate.x, gate.y);
        const [wx, , wz] = toWorld(gate.x, gate.y);
        return (
          <GateMesh
            key={`${gate.dir}:${gate.x},${gate.y}`}
            position={[wx, surface, wz]}
            dir={gate.dir}
            open={complete}
            theme={theme}
          />
        );
      })}
    </group>
  );
}

function ArenaChunk(props: ArenaChunkProps) {
  const { grid, area, yin, levelId, lowDetail, hazardCells, heights, complete, wallSkinEpoch } = props;
  const field = useMemo(() => deriveTileField(grid, heights), [grid, heights]);
  // THEME-3：位面换肤升级为「位面 × 关卡」双维解析（levelThemes 缓存，引用稳定）
  const theme = resolveLevelTheme(levelId, yin);
  if (lowDetail) return <LowDetailChunk field={field} area={area} theme={theme} heights={heights} />;
  return (
    <FullDetailChunk
      field={field}
      grid={grid}
      area={area}
      theme={theme}
      levelId={levelId}
      hazardCells={hazardCells}
      heights={heights}
      complete={complete}
      wallSkinEpoch={wallSkinEpoch}
    />
  );
}

/* ============================ 主角装置（每关一座） ========================== */

/**
 * 每关一主角装置（THEME-3）：纯装饰地标，不占格、不参与碰撞；1~5 个基本体
 * 组合，主体 prop.color、发光件 prop.accent —— 与门缘/玩家点缀同源识别色。
 */
function HeroPropMesh({ prop, position }: { prop: LevelHeroProp; position: WorldVec3 }) {
  const h = prop.height;
  const body = (extra?: { readonly emissive?: string; readonly intensity?: number }) => (
    <meshStandardMaterial
      color={prop.color}
      emissive={extra?.emissive ?? '#000000'}
      emissiveIntensity={extra?.intensity ?? 0}
      roughness={0.5}
      metalness={0.2}
    />
  );
  const box = (args: [number, number, number]) => <boxGeometry args={args} />;
  const cone = (args: [number, number, number]) => <coneGeometry args={args} />;
  return (
    <group position={position}>
      {prop.kind === 'obelisk' && (
        <>
          <mesh position={[0, h / 2, 0]}>{box([0.34, h, 0.34])}{body()}</mesh>
          <mesh position={[0, h + 0.05, 0]}>{box([0.46, 0.1, 0.46])}{body({ emissive: prop.accent, intensity: 0.7 })}</mesh>
        </>
      )}
      {prop.kind === 'arch' && (
        <>
          <mesh position={[-0.55, h / 2, 0]}>{box([0.22, h, 0.24])}{body()}</mesh>
          <mesh position={[0.55, h / 2, 0]}>{box([0.22, h, 0.24])}{body()}</mesh>
          <mesh position={[0, h + 0.09, 0]}>{box([1.32, 0.18, 0.28])}{body({ emissive: prop.accent, intensity: 0.4 })}</mesh>
        </>
      )}
      {prop.kind === 'lantern-post' && (
        <>
          <mesh position={[0, h / 2, 0]}>{box([0.12, h, 0.12])}{body()}</mesh>
          <mesh position={[0, h + 0.13, 0]}>{box([0.22, 0.26, 0.22])}{body({ emissive: prop.accent, intensity: 1.1 })}</mesh>
        </>
      )}
      {prop.kind === 'crystal' && (
        <>
          <mesh position={[0, h / 2, 0]}>{cone([0.16, h, 5])}{body({ emissive: prop.accent, intensity: 0.5 })}</mesh>
          <mesh position={[0.24, h * 0.27, 0.06]} rotation={[0, 0, -0.18]}>
            {cone([0.1, h * 0.55, 5])}{body({ emissive: prop.accent, intensity: 0.5 })}
          </mesh>
        </>
      )}
      {prop.kind === 'monolith' && (
        <>
          <mesh position={[0, h / 2, 0]} rotation={[0, 0.12, 0.07]}>{box([0.5, h, 0.28])}{body()}</mesh>
          <mesh position={[0.21, h / 2, 0.02]} rotation={[0, 0.12, 0.07]}>
            {box([0.08, h * 0.8, 0.3])}{body({ emissive: prop.accent, intensity: 0.55 })}
          </mesh>
        </>
      )}
      {prop.kind === 'gate-post' && (
        <>
          <mesh position={[0, h / 2, 0]}>{box([0.16, h, 0.16])}{body()}</mesh>
          <mesh position={[0, h * 0.78, 0]}>{box([0.5, 0.1, 0.16])}{body()}</mesh>
          <mesh position={[0, h + 0.08, 0]}>{box([0.12, 0.12, 0.12])}{body({ emissive: prop.accent, intensity: 0.9 })}</mesh>
        </>
      )}
      {prop.kind === 'throne' && (
        <>
          <mesh position={[0, 0.3, 0]}>{box([0.62, 0.14, 0.52])}{body()}</mesh>
          <mesh position={[0, 0.3 + h * 0.28, -0.2]}>{box([0.62, h * 0.56, 0.12])}{body()}</mesh>
          <mesh position={[-0.36, 0.45, 0]}>{box([0.1, 0.3, 0.5])}{body()}</mesh>
          <mesh position={[0.36, 0.45, 0]}>{box([0.1, 0.3, 0.5])}{body()}</mesh>
          <mesh position={[0, 0.3 + h * 0.56 + 0.1, -0.2]}>{box([0.2, 0.2, 0.06])}{body({ emissive: prop.accent, intensity: 0.8 })}</mesh>
        </>
      )}
    </group>
  );
}

/* ================================ 主组件 ================================== */

export interface GridArenaProps {
  /** 当前段位静态地形（selectTerrainGrid / importLevel().terrain） */
  readonly grid: Grid;
  readonly currentArea: AreaId;
  /** 位面状态（store.segment.planeShifted 状态驱动换肤） */
  readonly yin: boolean;
  /** 当前关卡 id（THEME-3 逐关主题/装饰/主角装置；null = 标题页兜底） */
  readonly levelId?: string | null;
  /** 引擎海拔层（与 grid 同尺寸；缺省全 0 = 纯平面关） */
  readonly heights?: HeightMap;
  /** 尖刺格（terrain 武器扩展字段；engine 数据就绪后传入） */
  readonly hazardCells?: readonly Vec2[];
  /** 关卡完成（全部箱落基座）→ 法则之门溶解开启 */
  readonly complete: boolean;
  /** 墙皮重掷纪元（A2-2：cheatRegistry.wallSkinEpoch；0 = 基线 ramp，缺省不改观感） */
  readonly wallSkinEpoch?: number;
}

/**
 * 区域分块挂载：主区 + 当前外域常驻，其余外域不挂载（进出时挂/卸）。
 * 主区在域外时以低模 LOD 形态常驻（远景过场合并低模）。
 */
export function GridArena({ grid, currentArea, yin, levelId, heights, hazardCells = [], complete, wallSkinEpoch = 0 }: GridArenaProps) {
  const mounted = selectMountedAreas(currentArea);
  const mainLevel = useMemo(() => findLevel(LEVELS.find((l) => l.area === 'main')?.id ?? ''), []);

  const currentIsMain = currentArea === 'main';
  const showCurrentDomain = mounted.includes(currentArea) && !currentIsMain;
  // 远景主区低模回落主城关主题；当前块用当前关主题
  const mainLevelId = currentIsMain ? (levelId ?? null) : (mainLevel?.id ?? null);

  // THEME-3：每关一主角装置 —— 表坐标钳到当前关网格的地板格，落在当前关所在块
  const heroProp = useMemo(
    () => levelHeroProp(levelId ?? null, yin, grid),
    [levelId, yin, grid],
  );
  const heroPropPosition = useMemo<WorldVec3 | null>(() => {
    if (heroProp === null) return null;
    const [wx, , wz] = cellWorldCenter(heroProp.cell.x, heroProp.cell.y, grid.length, grid[0]?.length ?? 0, currentArea);
    return [wx, heightOf(heights, heroProp.cell.x, heroProp.cell.y) * HEIGHT_STEP, wz];
  }, [heroProp, grid, currentArea, heights]);

  return (
    <group>
      {mainLevel !== undefined && (
        <ArenaChunk
          grid={currentIsMain ? grid : mainLevel.grid}
          area="main"
          yin={yin}
          levelId={mainLevelId}
          lowDetail={!currentIsMain}
          hazardCells={currentIsMain ? hazardCells : []}
          heights={currentIsMain ? heights : undefined}
          complete={currentIsMain && complete}
          wallSkinEpoch={wallSkinEpoch}
        />
      )}
      {showCurrentDomain && (
        <ArenaChunk
          grid={grid}
          area={currentArea}
          yin={yin}
          levelId={levelId ?? null}
          lowDetail={false}
          hazardCells={hazardCells}
          heights={heights}
          complete={complete}
          wallSkinEpoch={wallSkinEpoch}
        />
      )}
      {heroProp !== null && heroPropPosition !== null && <HeroPropMesh prop={heroProp} position={heroPropPosition} />}
    </group>
  );
}
