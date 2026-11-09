/**
 * ActorMesh —— 参数化 NPC / 怪 / BOSS 实体。
 * ---------------------------------------------------------------------------
 * KichikuAdventure 13 段 ASCII art 的 3D 重铸：每段 art 一张「造型皮肤」，
 * 以 ASCII 字符网格声明（'#'=主色 'o'=副色 '+'=点缀，'.'/' '=空），运行期
 * 解析为体素盒合并成单一几何体 —— 每个角色恰好 1 draw call（含多色，走
 * 顶点色）。皮肤表（长什么样）与朝向表（theme.FACING_YAW）彻底分离，
 * 换肤不改朝向、转向不改皮肤（S5 根治的结构化落点）。
 */

import { useMemo } from 'react';
import type { BufferGeometry } from 'three';
import { BoxGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dir } from '../../../core/types';
import {
  ACTOR_SKIN_CELL,
  BOSS_SCALE,
  facingRenderYaw,
  type PlaneTheme,
  type WorldVec3,
} from '../theme';

/* ============================ ASCII 造型皮肤表 ============================ */

export type ActorSkinId =
  | 'angel-1'
  | 'angel-2'
  | 'angel-3'
  | 'angel-4'
  | 'author'
  | 'caixukun'
  | 'guolaoshi'
  | 'dygg'
  | 'ylzz'
  | 'altar-keeper'
  | 'gate-wisp'
  | 'star-merchant'
  | 'shadow-echo';

export interface ActorSkin {
  readonly id: ActorSkinId;
  readonly rows: readonly string[];
  /** [主色, 副色, 点缀] —— ASCII 字符 #/o/+ 依次取色 */
  readonly palette: readonly [string, string, string];
}

/** 13 段 ASCII art 造型皮肤（原型：KichikuAdventure Game.java 各场景 art） */
export const ACTOR_SKINS: Readonly<Record<ActorSkinId, ActorSkin>> = Object.freeze({
  'angel-1': {
    id: 'angel-1',
    rows: [
      '..+++..',
      '..###..',
      '.#####.',
      'o#####o',
      '..###..',
      '.o###o.',
      '..#o#..',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#eaf6ff', '#7c5cff', '#ffcf5c'],
  },
  'angel-2': {
    id: 'angel-2',
    rows: [
      '.+...+.',
      '..###..',
      '.o###o.',
      '.o###o.',
      '..###..',
      '.#####.',
      '..o#o..',
      '..#.#..',
      '.#...#.',
    ],
    palette: ['#ffe9f4', '#ff5c9e', '#00e5ff'],
  },
  'angel-3': {
    id: 'angel-3',
    rows: [
      '..+++..',
      '..###..',
      'o#####o',
      'o#####o',
      '..###..',
      '.o###o.',
      '..###..',
      '.o###o.',
      '.o...o.',
    ],
    palette: ['#f2ffd9', '#4ac97e', '#ffcf5c'],
  },
  'angel-4': {
    id: 'angel-4',
    rows: [
      '.+.+.+.',
      '.+++++.',
      '..###..',
      '.#####.',
      'o#####o',
      '..###..',
      '..###..',
      '..###..',
      '.oo.oo.',
    ],
    palette: ['#fff3d9', '#7c5cff', '#ffcf5c'],
  },
  author: {
    id: 'author',
    rows: [
      '..###..',
      '.#####.',
      '.#o#o#.',
      '..###..',
      '.#####.',
      'oo###oo',
      'o+++++o',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#3a3f5c', '#1d2033', '#00e5ff'],
  },
  caixukun: {
    id: 'caixukun',
    rows: [
      '.++++..',
      '.++++..',
      '..###..',
      '.#####.',
      'o##+##o',
      '..###..',
      '..#.#..',
      '..#.#..',
      '.oo.oo.',
    ],
    palette: ['#ffe9b8', '#3d4a8f', '#ff8c42'],
  },
  guolaoshi: {
    id: 'guolaoshi',
    rows: [
      '..###..',
      '.#####.',
      '#######',
      '#######',
      '.o###o.',
      '..###..',
      '..ooo..',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#ffd9c2', '#b3543f', '#f2e2c4'],
  },
  dygg: {
    id: 'dygg',
    rows: [
      '....+++',
      '..##+++',
      '.o###..',
      '.#####.',
      '.o###o.',
      '..###..',
      '..#o#..',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#d9fff2', '#2f8f6b', '#ffe27a'],
  },
  ylzz: {
    id: 'ylzz',
    rows: [
      '..#####..',
      '.#######.',
      '.##+++##.',
      '.#######.',
      '#########',
      '#########',
      '.#######.',
      '.oo###oo.',
      '..#####..',
      '.oo...oo.',
    ],
    palette: ['#2a1030', '#12060f', '#ff5c9e'],
  },
  'altar-keeper': {
    id: 'altar-keeper',
    rows: [
      '..+++..',
      '.#####.',
      '..###..',
      '.#####.',
      'o#####o',
      '..###..',
      '.o###o.',
      '.o.#.o.',
      'oo...oo',
    ],
    palette: ['#cfd6ea', '#464f96', '#7cf5c8'],
  },
  'gate-wisp': {
    id: 'gate-wisp',
    rows: [
      '..###..',
      '.#o#o#.',
      '.#####.',
      '.#####.',
      '.#####.',
      '.o###o.',
      '..#o#..',
      '..o.o..',
      '...o...',
    ],
    palette: ['#bde9ff', '#2a3162', '#7c5cff'],
  },
  'star-merchant': {
    id: 'star-merchant',
    rows: [
      '..###..',
      '.ooooo.',
      '..#o#..',
      '.#####.',
      'o#####o',
      'o#+++#o',
      '..###..',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#ffe2b8', '#6f4bb8', '#ffcf5c'],
  },
  'shadow-echo': {
    id: 'shadow-echo',
    rows: [
      '.#.#.#.',
      '#######',
      '#o###o#',
      '.#####.',
      '#######',
      '#o###o#',
      '.#####.',
      '.#.#.#.',
      '..o.o..',
    ],
    palette: ['#4a4560', '#171322', '#8f7cff'],
  },
});

/** 说话者 id → 皮肤（剧情事件 NPC 落位用；story 说话者表的键一一对应） */
export const SPEAKER_SKINS: Readonly<Record<string, ActorSkinId>> = Object.freeze({
  'npc-angel-1': 'angel-1',
  'npc-angel-2': 'angel-2',
  'npc-angel-3': 'angel-3',
  'npc-angel-4': 'angel-4',
  'npc-author': 'author',
  // 集成期：三小怪 + BOSS 的世界内造型（遭遇战触发规则的世界内实体渲染）
  'npc-caixukun': 'caixukun',
  'npc-guolaoshi': 'guolaoshi',
  'npc-dygg': 'dygg',
  'npc-ylzz': 'ylzz',
});

/* ======================== ASCII 掩码 → 体素几何（纯） ====================== */

export interface MaskCell {
  readonly x: number;
  /** 自顶向下的行号（世界 Y 由 buildVoxelGeometry 翻转） */
  readonly row: number;
  readonly colorIndex: 0 | 1 | 2;
}

export interface ArtMask {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly MaskCell[];
}

const CELL_CHARS: Readonly<Record<string, 0 | 1 | 2>> = Object.freeze({
  '#': 0,
  o: 1,
  '+': 2,
});

/** 解析 ASCII art 掩码（纯函数，vitest 直测） */
export function parseArtMask(rows: readonly string[]): ArtMask {
  const height = rows.length;
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  const cells: MaskCell[] = [];
  for (let row = 0; row < height; row++) {
    const text = rows[row] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = text.charAt(x);
      const colorIndex = CELL_CHARS[ch];
      if (colorIndex !== undefined) cells.push({ x, row, colorIndex });
    }
  }
  return { width, height, cells };
}

/* ======================= 几何构建与缓存（1 draw call） ===================== */

const tmpCellColor = new Color();

/**
 * 掩码 → 合并体素几何（顶点色多色调，单材质单网格）。
 * 模块级缓存：同一皮肤全 App 生命周期复用（13 皮肤 + 玩家 5 皮肤，体积可忽略）。
 */
const GEOMETRY_CACHE = new Map<string, BufferGeometry>();

export function buildVoxelGeometry(cacheKey: string, mask: ArtMask, cellSize: number, palette: readonly [string, string, string]): BufferGeometry {
  const cached = GEOMETRY_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const boxes: BoxGeometry[] = [];
  for (const cell of mask.cells) {
    const wx = (cell.x - (mask.width - 1) / 2) * cellSize;
    const wy = (mask.height - 1 - cell.row) * cellSize + cellSize / 2; // 行 0 在顶
    const box = new BoxGeometry(cellSize, cellSize, cellSize * 0.72);
    box.translate(wx, wy, 0);
    tmpCellColor.set(palette[cell.colorIndex] ?? palette[0] ?? '#ffffff');
    const vertexCount = box.attributes.position?.count ?? 0;
    const colors = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      colors[v * 3] = tmpCellColor.r;
      colors[v * 3 + 1] = tmpCellColor.g;
      colors[v * 3 + 2] = tmpCellColor.b;
    }
    box.setAttribute('color', new Float32BufferAttribute(colors, 3));
    boxes.push(box);
  }
  if (boxes.length === 0) return new BoxGeometry(cellSize, cellSize, cellSize);
  const merged = mergeGeometries(boxes, false);
  for (const box of boxes) box.dispose();
  if (merged === null) return new BoxGeometry(cellSize, cellSize, cellSize);
  merged.computeBoundingSphere();
  GEOMETRY_CACHE.set(cacheKey, merged);
  return merged;
}

/* ================================ 组件 ==================================== */

export type ActorKind = 'npc' | 'enemy' | 'boss' | 'altar';

export interface ActorMeshProps {
  readonly skin: ActorSkinId;
  readonly kind: ActorKind;
  readonly position: WorldVec3;
  /** 朝向（与皮肤分离；缺省朝南/镜头） */
  readonly facing?: Dir;
  /** 位面主题（点缀色/emissive 随位面换肤） */
  readonly theme: PlaneTheme;
}

export function ActorMesh({ skin: skinId, kind, position, facing = 'down', theme }: ActorMeshProps) {
  const skin = ACTOR_SKINS[skinId];
  const geometry = useMemo(() => {
    const mask = parseArtMask(skin.rows);
    return buildVoxelGeometry(`actor:${skinId}`, mask, ACTOR_SKIN_CELL, skin.palette);
  }, [skinId]);

  const scale = kind === 'boss' ? BOSS_SCALE : 1;
  const accentColor =
    kind === 'boss' ? theme.actor.boss : kind === 'enemy' ? theme.actor.enemy : theme.actor.npc;
  const emissiveIntensity = kind === 'boss' ? 0.32 : kind === 'altar' ? 0.4 : 0.12;

  return (
    // 渲染走 facingRenderYaw 的 3/4 收敛：left/right 转满 ±90° 会把单片体素
    // 模型压成近 1px 竖条（I4），±45° 保留约 71% 正面剪影
    <group position={[position[0], position[1], position[2]]} rotation={[0, facingRenderYaw(facing), 0]} scale={[scale, scale, scale]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.72} metalness={0.12} emissive={accentColor} emissiveIntensity={emissiveIntensity} />
      </mesh>
      {/* 接地阴影盘 */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.34, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      {/* BOSS 底座光环 */}
      {kind === 'boss' && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.56, 28]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.5} depthWrite={false} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
