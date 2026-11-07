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
  planeTheme,
  selectMountedAreas,
  wallShadeColor,
  type PlaneTheme,
  type TileField,
  type WorldVec3,
} from './theme';
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
  /** 引擎海拔层（与 grid 同尺寸；缺省全 0 = 纯平面关） */
  readonly heights?: HeightMap;
  /** 远景低模 LOD（主区在域外时的过场形态） */
  readonly lowDetail: boolean;
  readonly hazardCells: readonly Vec2[];
  readonly complete: boolean;
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

/** 近景完整块：逐格合批（每材质 1 draw call）+ 门体 */
function FullDetailChunk({ field, grid, area, theme, hazardCells, heights, complete }: {
  field: TileField;
  grid: Grid;
  area: AreaId;
  theme: PlaneTheme;
  hazardCells: readonly Vec2[];
  heights: HeightMap | undefined;
  complete: boolean;
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
        return {
          position: [wx, totalH / 2, wz] as WorldVec3,
          scale: [CELL * 0.98, totalH, CELL * 0.98] as WorldVec3,
          color: wallShadeColor(theme.id === 'yin', tile.shade),
        };
      }),
    [field, toWorld, theme],
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
  const { grid, area, yin, lowDetail, hazardCells, heights, complete } = props;
  const field = useMemo(() => deriveTileField(grid, heights), [grid, heights]);
  const theme = planeTheme(yin);
  if (lowDetail) return <LowDetailChunk field={field} area={area} theme={theme} heights={heights} />;
  return (
    <FullDetailChunk
      field={field}
      grid={grid}
      area={area}
      theme={theme}
      hazardCells={hazardCells}
      heights={heights}
      complete={complete}
    />
  );
}

/* ================================ 主组件 ================================== */

export interface GridArenaProps {
  /** 当前段位静态地形（selectTerrainGrid / importLevel().terrain） */
  readonly grid: Grid;
  readonly currentArea: AreaId;
  /** 位面状态（store.segment.planeShifted 状态驱动换肤） */
  readonly yin: boolean;
  /** 引擎海拔层（与 grid 同尺寸；缺省全 0 = 纯平面关） */
  readonly heights?: HeightMap;
  /** 尖刺格（terrain 武器扩展字段；engine 数据就绪后传入） */
  readonly hazardCells?: readonly Vec2[];
  /** 关卡完成（全部箱落基座）→ 法则之门溶解开启 */
  readonly complete: boolean;
}

/**
 * 区域分块挂载：主区 + 当前外域常驻，其余外域不挂载（进出时挂/卸）。
 * 主区在域外时以低模 LOD 形态常驻（远景过场合并低模）。
 */
export function GridArena({ grid, currentArea, yin, heights, hazardCells = [], complete }: GridArenaProps) {
  const mounted = selectMountedAreas(currentArea);
  const mainLevel = useMemo(() => findLevel(LEVELS.find((l) => l.area === 'main')?.id ?? ''), []);

  const currentIsMain = currentArea === 'main';
  const showCurrentDomain = mounted.includes(currentArea) && !currentIsMain;

  return (
    <group>
      {mainLevel !== undefined && (
        <ArenaChunk
          grid={currentIsMain ? grid : mainLevel.grid}
          area="main"
          yin={yin}
          lowDetail={!currentIsMain}
          hazardCells={currentIsMain ? hazardCells : []}
          heights={currentIsMain ? heights : undefined}
          complete={currentIsMain && complete}
        />
      )}
      {showCurrentDomain && (
        <ArenaChunk
          grid={grid}
          area={currentArea}
          yin={yin}
          lowDetail={false}
          hazardCells={hazardCells}
          heights={heights}
          complete={complete}
        />
      )}
    </group>
  );
}
