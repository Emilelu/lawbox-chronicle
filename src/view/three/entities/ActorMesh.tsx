/**
 * ActorMesh —— 参数化 NPC / 怪 / BOSS 实体。
 * ---------------------------------------------------------------------------
 * KichikuAdventure 13 段 ASCII art 的 3D 重铸：每段 art 一张「造型皮肤」，
 * 以 ASCII 字符网格声明（'#'=主色 'o'=副色 '+'=点缀，'.'/' '=空），运行期
 * 解析为体素盒合并成单一几何体。皮肤表（长什么样）与朝向表（theme.FACING_YAW）
 * 彻底分离，换肤不改朝向、转向不改皮肤（S5 根治的结构化落点）。
 *
 * CHAR-2 立体化分档：
 *  - 天使①..④：头环（扁 box 环 emissive 0.4）+ 双翼（薄 box 后掠 ±35°），
 *    长袍身保持掩码造型；可选 dissolving prop 播 0.6s「化光点消散」。
 *  - 三小怪：同一掩码 3 层 sprite-stacking（xz 1.0/0.86/0.72 错位）+ 身份
 *    道具（篮球/迷吼tiao/铁桶）merge 进底层 —— 4 draw call 内。
 *  - 作者：西装掩码眼镜横条 + 躺椅（两段 box + 靠背斜板）。
 *  - BOSS：双层掩码堆叠（本体 + 头巾帽檐上层）+ 红头巾 accent 条 + 2 个
 *    半透明分身（同几何绕本体 sin 摆位，仅已有渲染帧更新）+ Edges 描边。
 *  - 全部增强几何进 GEOMETRY_CACHE，键 `actor:<id>:<part>`。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { BufferGeometry, Group, Material, Mesh } from 'three';
import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dir } from '../../../core/types';
import {
  ACTOR_SKIN_CELL,
  BOSS_SCALE,
  facingRenderYaw,
  type PlaneTheme,
  type WorldVec3,
} from '../theme';
import {
  BOSS_CLONE_OFFSET,
  BOSS_CLONE_OPACITY,
  BOSS_CLONE_SCALE,
  BOSS_HOOD_ROWS,
  BOSS_STACK_LAYERS,
  DISSOLVE_SECONDS,
  bossStackTransform,
  cloneOrbitYawAt,
  dissolveAt,
  shadowOpacityAt,
  spriteStackTransform,
  tintedBox,
  tintedGeometry,
  type DissolveState,
} from './charModels';

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
      '.ooooo.',
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
      '..+++++..',
      '.++###++.',
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

/**
 * 缓存优先的几何构建：同 key 首次执行 build，之后命中缓存返回同引用。
 * 造型增强几何（环/翼/道具/躺椅/堆叠/分身）统一经此进 GEOMETRY_CACHE，
 * 键 `actor:<id>:<part>`。
 */
export function cachedGeometry(key: string, build: () => BufferGeometry): BufferGeometry {
  const cached = GEOMETRY_CACHE.get(key);
  if (cached !== undefined) return cached;
  const built = build();
  GEOMETRY_CACHE.set(key, built);
  return built;
}

export function buildVoxelGeometry(cacheKey: string, mask: ArtMask, cellSize: number, palette: readonly [string, string, string]): BufferGeometry {
  return cachedGeometry(cacheKey, () => {
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
    return merged;
  });
}

/* ========================== 造型增强几何（内部） =========================== */

/** 合并失败兜底：返回首个子几何（保证调用方永远拿到可用几何） */
function mergeOrFirst(parts: readonly BufferGeometry[], fallback: BufferGeometry): BufferGeometry {
  if (parts.length === 0) return fallback;
  const merged = mergeGeometries([...parts], false);
  if (merged === null) return parts[0] ?? fallback;
  merged.computeBoundingSphere();
  return merged;
}

/** 天使头环：4 段扁 box 拼方环（emissive 由 matHalo 提供），头顶上方 */
function buildAngelHaloGeometry(): BufferGeometry {
  return cachedGeometry('actor:angel:halo', () => {
    const y = 9 * ACTOR_SKIN_CELL + 0.06;
    const parts: BufferGeometry[] = [];
    for (const z of [-0.225, 0.225]) {
      const bar = tintedBox([0.5, 0.05, 0.05], '#fff6d8');
      bar.translate(0, y, z);
      parts.push(bar);
    }
    for (const x of [-0.225, 0.225]) {
      const bar = tintedBox([0.05, 0.05, 0.5], '#fff6d8');
      bar.translate(x, y, 0);
      parts.push(bar);
    }
    return mergeOrFirst(parts, new BoxGeometry(0.5, 0.05, 0.5));
  });
}

/** 天使双翼：两块薄 box 后掠 ±35°（rotateZ 上扬 + rotateY 收拢），背后两侧 */
function buildAngelWingsGeometry(): BufferGeometry {
  return cachedGeometry('actor:angel:wings', () => {
    const wing = tintedGeometry(new BoxGeometry(0.1, 0.52, 0.26), '#f2f8ff');
    const parts: BufferGeometry[] = [];
    const left = wing.clone();
    left.rotateZ(0.61); // ±35° 上扬
    left.rotateY(0.44); // 后掠收拢
    left.translate(-0.42, 0.72, -0.18);
    parts.push(left);
    const right = wing.clone();
    right.rotateZ(-0.61);
    right.rotateY(-0.44);
    right.translate(0.42, 0.72, -0.18);
    parts.push(right);
    wing.dispose();
    return mergeOrFirst(parts, new BoxGeometry(0.1, 0.52, 0.26));
  });
}

/** 三小怪身份道具：篮球（球体）/ 迷吼tiao（酷似猕猴桃的炸弹：绿球+两根小柱）/ 铁桶 */
function buildMobPropGeometry(skinId: ActorSkinId): BufferGeometry {
  if (skinId === 'caixukun') {
    const ball = tintedGeometry(new SphereGeometry(0.1, 10, 8), '#e8762d');
    ball.translate(0.36, 0.1, 0.18);
    return ball;
  }
  if (skinId === 'guolaoshi') {
    // 迷吼tiao：外观酷似猕猴桃的炸弹 —— 绿球体 + 两根小柱（茎/蒂）
    const body = tintedGeometry(new SphereGeometry(0.09, 10, 8), '#7cb342');
    const post1 = tintedBox([0.026, 0.09, 0.026], '#6d4c41');
    post1.translate(0, 0.1, 0);
    const post2 = tintedBox([0.026, 0.08, 0.026], '#6d4c41');
    post2.rotateZ(0.35);
    post2.translate(0.045, 0.07, 0.01);
    const merged = mergeOrFirst([body, post1, post2], body);
    merged.translate(0.34, 0.09, 0.18);
    return merged;
  }
  const bucket = tintedGeometry(new CylinderGeometry(0.11, 0.13, 0.22, 10), '#8b93a8');
  bucket.translate(0.36, 0.11, 0.16);
  return bucket;
}

/** 作者躺椅：坐面 + 脚凳两段 box + 靠背斜板（accent 青），对应「凭空摆在荒野正中」 */
function buildAuthorChairGeometry(): BufferGeometry {
  return cachedGeometry('actor:author:chair', () => {
    const seat = tintedBox([0.62, 0.08, 0.3], '#3ee6d2');
    seat.translate(0.42, 0.22, 0);
    const stool = tintedBox([0.62, 0.08, 0.3], '#3ee6d2');
    stool.translate(0.42, 0.22, 0.3);
    const back = tintedBox([0.62, 0.52, 0.07], '#3ee6d2');
    back.rotateX(-0.42); // 靠背向后仰
    back.translate(0.42, 0.5, -0.22);
    return mergeOrFirst([seat, stool, back], seat);
  });
}

/** BOSS 底座：接地阴影盘 + 光环合并（顶点色区分，统一材质动态透明度）。
 *  disc/ring 的创建收进 cachedGeometry 的 build 闭包（与 buildVoxelGeometry
 *  同款写法，B2-2）：缓存命中路径不再每次 BOSS 战挂载新建后被闭包跳过丢弃；
 *  merge 成功后释放两个源几何 —— mergeOrFirst 的兜底路径返回 disc 本体时
 *  不可 dispose，以「合并产物 ≠ disc」判别。导出仅供 B2-2 缓存回归测试。 */
export function buildBossGroundGeometry(accentColor: string): BufferGeometry {
  return cachedGeometry(`actor:ylzz:ground:${accentColor}`, () => {
    const disc = tintedGeometry(
      new CircleGeometry(0.34, 18).rotateX(-Math.PI / 2).translate(0, 0.012, 0),
      '#000000',
    );
    const ring = tintedGeometry(
      new RingGeometry(0.42, 0.56, 28).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      accentColor,
    );
    const merged = mergeOrFirst([disc, ring], disc);
    if (merged !== disc) {
      disc.dispose();
      ring.dispose();
    }
    return merged;
  });
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
  /** 谢幕消散（化光点 0.6s 自终止）：天使/作者等剧情收尾时由外层触发 */
  readonly dissolving?: boolean;
}

const MOB_SKINS: readonly ActorSkinId[] = ['caixukun', 'guolaoshi', 'dygg'];

/** 消散/恢复材质透明度的统一入口（含 JSX 声明的子材质；Edges 线材质一并参与） */
function forEachMaterial(root: Object, visit: (material: Material) => void): void {
  const object = root as Mesh;
  if (object.traverse === undefined) return;
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) visit(material);
  });
}

export function ActorMesh({ skin: skinId, kind, position, facing = 'down', theme, dissolving = false }: ActorMeshProps) {
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);
  const skin = ACTOR_SKINS[skinId];
  const innerRef = useRef<Group>(null);
  const clonesRef = useRef<Group>(null);

  const isAngel = skinId.startsWith('angel-');
  const isMob = MOB_SKINS.includes(skinId);
  const isBossFight = kind === 'boss' && skinId === 'ylzz';
  const isYlzz = skinId === 'ylzz';
  const isAuthor = skinId === 'author';

  const baseGeometry = useMemo(
    () => buildVoxelGeometry(`actor:${skinId}`, parseArtMask(skin.rows), ACTOR_SKIN_CELL, skin.palette),
    [skinId, skin.rows, skin.palette],
  );

  const scale = kind === 'boss' ? BOSS_SCALE : 1;
  const accentColor =
    kind === 'boss' ? theme.actor.boss : kind === 'enemy' ? theme.actor.enemy : theme.actor.npc;
  const emissiveIntensity = kind === 'boss' ? 0.32 : kind === 'altar' ? 0.4 : 0.12;

  // 主体材质：单实例共享（本体/堆叠层/翼/躺椅），emissive 随 kind/theme 同步
  const matMain = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.72, metalness: 0.12 }),
    [],
  );
  useEffect(() => {
    matMain.emissive.set(accentColor);
    matMain.emissiveIntensity = emissiveIntensity;
  }, [matMain, accentColor, emissiveIntensity]);

  // 天使头环：emissive 0.4 常亮
  const matHalo = useMemo(
    () => new MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffcf5c', emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.2 }),
    [],
  );
  useEffect(() => {
    matHalo.emissive.set(accentColor);
  }, [matHalo, accentColor]);

  // BOSS 分身：半透明同几何（depthWrite 关闭避免透明排序闪烁）
  const matClone = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: BOSS_CLONE_OPACITY, depthWrite: false, roughness: 0.72, metalness: 0.12 }),
    [],
  );
  useEffect(() => {
    matClone.emissive.set(accentColor);
    matClone.emissiveIntensity = emissiveIntensity;
    matClone.opacity = BOSS_CLONE_OPACITY;
  }, [matClone, accentColor, emissiveIntensity]);

  // BOSS 底座：盘+环合并，透明度随离地高度衰减
  const matGround = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }),
    [],
  );

  // 作者躺椅：独立材质实例 —— 消散只作用于本体（inner group），躺椅在
  // 「谜题成功后躺椅留存、本体消散」语义下不能被消散材质污染
  const matChair = useMemo(
    () => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.1 }),
    [],
  );

  useEffect(() => {
    const main = matMain;
    const halo = matHalo;
    const clone = matClone;
    const ground = matGround;
    const chair = matChair;
    return () => {
      main.dispose();
      halo.dispose();
      clone.dispose();
      ground.dispose();
      chair.dispose();
    };
  }, [matMain, matHalo, matClone, matGround, matChair]);

  /* ---- 造型增强几何（全部进 GEOMETRY_CACHE，键 actor:<id>:<part>） ---- */

  const haloGeometry = useMemo(() => (isAngel ? buildAngelHaloGeometry() : null), [isAngel]);
  const wingsGeometry = useMemo(() => (isAngel ? buildAngelWingsGeometry() : null), [isAngel]);

  const mobStack0 = useMemo(() => {
    if (!isMob) return null;
    return cachedGeometry(`actor:${skinId}:stack0`, () =>
      mergeOrFirst([baseGeometry.clone(), buildMobPropGeometry(skinId)], baseGeometry),
    );
  }, [isMob, skinId, baseGeometry]);

  const stackedGeometry = useMemo(() => {
    if (!isYlzz) return baseGeometry;
    return cachedGeometry(`actor:${skinId}:stacked`, () => {
      const baseHeight = skin.rows.length * ACTOR_SKIN_CELL;
      const parts: BufferGeometry[] = [];
      // 层 0：完整本体；层 1：掩码顶部帽檐段缩小上移（斗篷头顶续出 → 高个）
      for (let layer = 0; layer < BOSS_STACK_LAYERS.length; layer++) {
        const t = bossStackTransform(layer, baseHeight);
        if (layer === 0) {
          parts.push(baseGeometry.clone());
          continue;
        }
        const hoodRows = skin.rows.slice(0, Math.min(BOSS_HOOD_ROWS, skin.rows.length));
        const hood = buildVoxelGeometry(`actor:${skinId}:hood`, parseArtMask(hoodRows), ACTOR_SKIN_CELL, skin.palette);
        const part = hood.clone();
        part.scale(t.scale, t.scale, t.scale);
        part.translate(0, t.y, 0);
        parts.push(part);
      }
      return mergeOrFirst(parts, baseGeometry);
    });
  }, [isYlzz, skinId, skin.rows, skin.palette, baseGeometry]);

  const clonesGeometry = useMemo(() => {
    if (!isBossFight) return null;
    return cachedGeometry(`actor:${skinId}:clones`, () => {
      const parts: BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const part = baseGeometry.clone();
        part.scale(BOSS_CLONE_SCALE, BOSS_CLONE_SCALE, BOSS_CLONE_SCALE);
        part.translate(side * BOSS_CLONE_OFFSET, 0, 0);
        parts.push(part);
      }
      return mergeOrFirst(parts, baseGeometry);
    });
  }, [isBossFight, skinId, baseGeometry]);

  const groundGeometry = useMemo(
    () => (isBossFight ? buildBossGroundGeometry(accentColor) : null),
    [isBossFight, accentColor],
  );

  useEffect(() => {
    if (groundGeometry !== null) {
      matGround.opacity = shadowOpacityAt(position[1]);
    }
  }, [matGround, groundGeometry, position[1]]);

  /* ---- 消散（0.6s 自终止）+ BOSS 分身摆位（仅已有渲染帧更新） ---- */

  const dissolve = useRef({ active: false, start: 0, done: false });

  useEffect(() => {
    const inner = innerRef.current;
    if (inner === null) return;
    if (!dissolving) {
      // 复位：材质回基线、几何回原位
      dissolve.current.active = false;
      dissolve.current.done = false;
      inner.visible = true;
      inner.scale.setScalar(1);
      inner.position.y = 0;
      forEachMaterial(inner, (material) => {
        if (material.userData.__baseOpacity !== undefined) {
          material.opacity = material.userData.__baseOpacity as number;
          material.transparent = material.userData.__baseTransparent as boolean;
        }
      });
      invalidate();
      return;
    }
    dissolve.current = { active: true, start: clock.elapsedTime, done: false };
    invalidate();
  }, [dissolving, invalidate, clock]);

  useFrame(({ clock }) => {
    // BOSS 分身绕本体 sin 摆位：读帧不请求渲染（demand 下只在已有渲染帧生效）
    if (clonesRef.current !== null) {
      clonesRef.current.rotation.y = cloneOrbitYawAt(clock.elapsedTime);
    }
    const inner = innerRef.current;
    if (inner === null || !dissolve.current.active || dissolve.current.done) return;
    const t = (clock.elapsedTime - dissolve.current.start) / DISSOLVE_SECONDS;
    if (t >= 1) {
      dissolve.current.done = true;
      inner.visible = false;
      return; // 自终止：不再 invalidate
    }
    const state: DissolveState = dissolveAt(t);
    inner.scale.setScalar(state.scale);
    inner.position.y = state.rise;
    forEachMaterial(inner, (material) => {
      if (material.userData.__baseOpacity === undefined) {
        material.userData.__baseOpacity = material.opacity;
        material.userData.__baseTransparent = material.transparent;
      }
      material.transparent = true;
      material.opacity = (material.userData.__baseOpacity as number) * state.opacity;
    });
    invalidate();
  });

  const chairGeometry = useMemo(() => (isAuthor ? buildAuthorChairGeometry() : null), [isAuthor]);

  return (
    // 渲染走 facingRenderYaw 的 3/4 收敛：left/right 转满 ±90° 会把单片体素
    // 模型压成近 1px 竖条（I4）；部件化后侧视剪影由 CAM-1 的 ±60° 收敛保底
    <group position={[position[0], position[1], position[2]]} rotation={[0, facingRenderYaw(facing), 0]} scale={[scale, scale, scale]}>
      <group ref={innerRef}>
        {isMob && mobStack0 !== null ? (
          // 三小怪 sprite-stacking：同掩码 3 层（xz 1.0/0.86/0.72 错位）+ 底层并身份道具
          [0, 1, 2].map((layer) => {
            const t = spriteStackTransform(layer);
            return (
              <mesh
                key={layer}
                geometry={layer === 0 ? mobStack0 : baseGeometry}
                material={matMain}
                position={[0, t.y, t.z]}
                scale={[t.scale, 1, t.scale]}
              />
            );
          })
        ) : isBossFight ? (
          <>
            <mesh geometry={stackedGeometry} material={matMain}>
              <Edges threshold={30} color={accentColor} />
            </mesh>
            <group ref={clonesRef}>
              <mesh geometry={clonesGeometry ?? baseGeometry} material={matClone} />
            </group>
          </>
        ) : (
          <mesh geometry={stackedGeometry} material={matMain} />
        )}
        {isAngel && haloGeometry !== null && <mesh geometry={haloGeometry} material={matHalo} />}
        {isAngel && wingsGeometry !== null && <mesh geometry={wingsGeometry} material={matMain} />}
        {isBossFight && groundGeometry !== null ? (
          <mesh geometry={groundGeometry} material={matGround} />
        ) : (
          <GroundShadow worldY={position[1]} radius={0.34} />
        )}
      </group>
      {/* 躺椅在消散作用域之外：本体化光消散时躺椅留存（谜题后日谈语义） */}
      {isAuthor && chairGeometry !== null && <mesh geometry={chairGeometry} material={matChair} />}
    </group>
  );
}

/* ============================== 公共子组件 ================================= */

/** 高度衰减的接地阴影盘（ActorMesh/PlayerAvatar 共用；opacity 随离地高度线性衰减） */
export function GroundShadow({ worldY, radius = 0.34 }: { worldY: number; radius?: number }) {
  const opacity = shadowOpacityAt(worldY);
  if (opacity <= 0) return null;
  return (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 18]} />
      <meshBasicMaterial color="#000000" transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}
