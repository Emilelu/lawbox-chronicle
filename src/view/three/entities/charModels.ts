/**
 * charModels —— 角色建模共享层（CHAR-2）。
 * ---------------------------------------------------------------------------
 * 1) 玩家 5 皮肤按 role1..role5 身份重铸为部件化数据：head/body 掩码 +
 *    部件色板、双臂 box、围巾 3 节链 —— 皮肤表只决定「长什么样」，与朝向
 *    （theme.FACING_YAW）彻底分离（S5 语义延续：条目零旋转/朝向字段）。
 * 2) 程序动画纯函数：squash 滑动拉伸/落定回弹、围巾摆动、天使消散、
 *    小怪 sprite-stacking 层变换、BOSS 分身摆位、接地阴影随高度衰减。
 *    全部可 vitest 直测，不依赖 React 渲染。
 * 3) useSquashSlide：滑动期整组拉伸（y*1.08 / xz*0.95），落定 0.88→1
 *    easeOutBack 0.12s 有限回弹 —— demand frameloop 下只在回弹期 invalidate，
 *    静置零渲染（S18 约定）。
 *
 * 说明：easeOutBack 由 CAM-1 交付在 theme.ts（c1=1.70158 标准过冲系数），
 * 本文件按契约只 import 不重复实现。
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { BufferGeometry, ColorRepresentation, Group } from 'three';
import { BoxGeometry, Color, Float32BufferAttribute } from 'three';
import { bus } from '../../../core/events/bus';
import { SLIDE_SECONDS, clamp01, easeOutBack, easeOutCubic } from '../theme';

/* ============================ 玩家部件皮肤表 =============================== */

/** 单部件掩码 + 三色板（'#'主色 'o'副色 '+'点缀，与 ACTOR_SKINS 同语法） */
export interface PlayerPartMask {
  readonly rows: readonly string[];
  readonly palette: readonly [string, string, string];
}

/**
 * 部件化玩家皮肤（对应 SanBPushChest assets/imgs/roles role1..role5 身份重铸）：
 * 0 眼镜教授（role.png 深西装+镜框横条）/ 1 魔法少女（role2 粉发双马尾+裙摆）/
 * 2 束带健者（role4 发带）/ 3 红头巾舞者（role5 头巾+赤膊主色）/
 * 4 青伤斗士（role3 淤青点缀）。
 */
export interface PlayerSkinDef {
  readonly id: number;
  /** 身份名（渲染调试/测试可读性） */
  readonly label: string;
  readonly head: PlayerPartMask;
  readonly body: PlayerPartMask;
  /** 左右臂（对称双 box）：[宽, 高, 深] 与颜色 */
  readonly arm: { readonly size: readonly [number, number, number]; readonly color: string };
  /** 围巾 3 节链：主色与尾端色 */
  readonly scarf: { readonly color: string; readonly tip: string };
}

export const PLAYER_SKINS: readonly PlayerSkinDef[] = Object.freeze([
  {
    id: 0,
    label: '眼镜教授',
    head: {
      rows: ['..ooo..', '..###..', '.o+++o.', '..###..'],
      palette: ['#e8d9c5', '#3d4256', '#20263a'],
    },
    body: {
      rows: ['.o###o.', '..#+#..', '.#####.', '..#.#..', '..#.#..'],
      palette: ['#2e3550', '#e8e6df', '#00b8d9'],
    },
    arm: { size: [0.12, 0.34, 0.12], color: '#2e3550' },
    scarf: { color: '#00b8d9', tip: '#00e5ff' },
  },
  {
    id: 1,
    label: '魔法少女',
    head: {
      rows: ['.ooooo.', 'oo###oo', '.o#+#o.', '..###..'],
      palette: ['#ffe4d6', '#ff9fc0', '#ff3d6e'],
    },
    body: {
      rows: ['.o###o.', '.##+##.', '.o###o.', 'o#####o', '..#.#..'],
      palette: ['#ff5c9e', '#ffe9f4', '#ffcf5c'],
    },
    arm: { size: [0.11, 0.3, 0.11], color: '#ffe9f4' },
    scarf: { color: '#ffcf5c', tip: '#fff3c4' },
  },
  {
    id: 2,
    label: '束带健者',
    head: {
      rows: ['..###..', '.+++++.', '..###..', '..###..'],
      palette: ['#e8c9a8', '#2f2a26', '#e5484d'],
    },
    body: {
      rows: ['.#####.', '.##+##.', '.o###o.', '..#.#..', '..#.#..'],
      palette: ['#e5484d', '#f2f2f2', '#ffcf5c'],
    },
    arm: { size: [0.12, 0.32, 0.12], color: '#e8c9a8' },
    scarf: { color: '#f2f2f2', tip: '#e5484d' },
  },
  {
    id: 3,
    label: '红头巾舞者',
    head: {
      rows: ['..+++..', '.+++++.', '.+###+.', '..###..'],
      palette: ['#d9a06b', '#a32c2c', '#d43d3d'],
    },
    body: {
      rows: ['.o###o.', '.#####.', '.+++++.', '..#.#..', '..#.#..'],
      palette: ['#d9a06b', '#d43d3d', '#ffcf5c'],
    },
    arm: { size: [0.11, 0.32, 0.11], color: '#d9a06b' },
    scarf: { color: '#d43d3d', tip: '#a32c2c' },
  },
  {
    id: 4,
    label: '青伤斗士',
    head: {
      rows: ['..ooo..', '.#####.', '.#+#+#.', '..o#o..'],
      palette: ['#d8b48f', '#241f1c', '#6f7fbf'],
    },
    body: {
      rows: ['.#####.', '.##o##.', '.#####.', '..#.#..', '..#.#..'],
      palette: ['#5a6488', '#3a4258', '#6f7fbf'],
    },
    arm: { size: [0.13, 0.34, 0.13], color: '#5a6488' },
    scarf: { color: '#3a4258', tip: '#6f7fbf' },
  },
]);

/** 皮肤号 → 皮肤定义：越界/缺省一律回退 0 号（纯函数，vitest 直测） */
export function playerSkinById(id: number): PlayerSkinDef {
  const found = PLAYER_SKINS.find((skin) => skin.id === id);
  const fallback = PLAYER_SKINS[0];
  if (found !== undefined) return found;
  if (fallback === undefined) throw new Error('玩家皮肤表为空 —— PLAYER_SKINS 必须至少有一张皮肤');
  return fallback;
}

/* ============================ 顶点色工具（纯） ============================= */

const tmpTintColor = new Color();

/** 给任意几何上单色顶点色（合并多色几何的前提：属性集合对齐 position/normal/uv/color） */
export function tintedGeometry<T extends BufferGeometry>(geometry: T, color: ColorRepresentation): T {
  tmpTintColor.set(color);
  const count = geometry.attributes.position?.count ?? 0;
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    colors[v * 3] = tmpTintColor.r;
    colors[v * 3 + 1] = tmpTintColor.g;
    colors[v * 3 + 2] = tmpTintColor.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** 快捷构建带顶点色的 box（尺寸 [x,y,z]） */
export function tintedBox(size: readonly [number, number, number], color: ColorRepresentation): BoxGeometry {
  return tintedGeometry(new BoxGeometry(size[0], size[1], size[2]), color);
}

/* ========================= squash 滑动拉伸 / 落定回弹 ======================= */

/** 落定回弹时长（s）：滑动收敛那一刻起 0.12s 内完成 0.88→1 回弹 */
export const SQUASH_LAND_SECONDS = 0.12;

/** squash 形变规格：滑动拉伸（y 拉长 xz 收窄）与落定挤压起点（y 压扁 xz 鼓出） */
export const SQUASH_STRETCH = Object.freeze({
  slideY: 1.08,
  slideXZ: 0.95,
  landY: 0.88,
  landXZ: 1.08,
} as const);

/**
 * squash 缩放采样（纯函数）：sliding=true 时恒定拉伸；false 时按落定经过
 * 时间从 (0.88, 1.08) 以 easeOutBack（theme.ts，CAM-1 交付）回弹到 (1, 1)，
 * 过冲段轻微反向弹性。
 */
export function squashScaleAt(sliding: boolean, landElapsedSeconds: number): { y: number; xz: number } {
  if (sliding) return { y: SQUASH_STRETCH.slideY, xz: SQUASH_STRETCH.slideXZ };
  const k = easeOutBack(landElapsedSeconds / SQUASH_LAND_SECONDS);
  return {
    y: SQUASH_STRETCH.landY + (1 - SQUASH_STRETCH.landY) * k,
    xz: SQUASH_STRETCH.landXZ + (1 - SQUASH_STRETCH.landXZ) * k,
  };
}

/** 围巾摆动规格：绕颈部 pivot 的 sin 前后摆（幅度 rad / 角速度 rad/s） */
export const SCARF_SWAY_AMPLITUDE = 0.16;
export const SCARF_SWAY_SPEED = 2.4;

/** 围巾摆动角（纯函数）：仅在有渲染帧时被采样（不主动请求渲染，S18） */
export function scarfSwayAt(elapsedSeconds: number): number {
  return Math.sin(elapsedSeconds * SCARF_SWAY_SPEED) * SCARF_SWAY_AMPLITUDE;
}

/* ============================== 消散（谢幕） =============================== */

/** 化光点消散时长（s）：自终止有限动画，结束即归零渲染 */
export const DISSOLVE_SECONDS = 0.6;
/** 消散上浮高度（世界单位） */
export const DISSOLVE_RISE = 0.55;

export interface DissolveState {
  readonly opacity: number;
  readonly rise: number;
  readonly scale: number;
}

/**
 * 消散采样（纯函数）：progress 0→1，透明度平方衰减（先亮后加速散尽）、
 * 上浮 easeOut、整体收缩到 55% —— 「化光点」的视觉分解。
 */
export function dissolveAt(progress01: number): DissolveState {
  const p = clamp01(progress01);
  const eased = easeOutCubic(p);
  const fade = 1 - p;
  return { opacity: fade * fade, rise: eased * DISSOLVE_RISE, scale: 1 - 0.45 * eased };
}

/* ====================== 三小怪 sprite-stacking（伪 3D 厚度） ================ */

/** 堆叠层 xz 缩放序列（底大顶小，形成轮廓渐变的伪 3D 厚度） */
export const SPRITE_STACK_SCALES = Object.freeze([1, 0.86, 0.72] as const);
/** 层间纵向间隔（世界单位） */
export const SPRITE_STACK_GAP = 0.07;
/** 层间 z 向错位步进（侧视时露出厚度感） */
export const SPRITE_STACK_Z_STEP = 0.03;

export interface StackTransform {
  readonly scale: number;
  readonly y: number;
  readonly z: number;
}

/** 层号 → 堆叠变换（纯函数；层号越界钳制到 [0, 层数-1]） */
export function spriteStackTransform(layer: number): StackTransform {
  const i = Math.max(0, Math.min(SPRITE_STACK_SCALES.length - 1, Math.round(layer)));
  const scale = SPRITE_STACK_SCALES[i] ?? 1;
  return { scale, y: i * SPRITE_STACK_GAP, z: i * SPRITE_STACK_Z_STEP };
}

/* ============================ BOSS 双层堆叠 / 分身 ========================= */

/** BOSS 斗篷层：本体完整掩码 + 头巾帽檐上层（yRatio 相对本体掩码高度） */
export const BOSS_STACK_LAYERS = Object.freeze([
  { scale: 1, yRatio: 0 },
  { scale: 0.78, yRatio: 1.0 },
] as const);
/** 斗篷上层（帽檐段）取掩码顶部的行数：头顶续出一截窄帽 → 高个斗篷 */
export const BOSS_HOOD_ROWS = 4;

/** BOSS 层号 → 堆叠变换（纯函数；y 按本体掩码高度比例换算） */
export function bossStackTransform(layer: number, baseHeight: number): { scale: number; y: number } {
  const i = Math.max(0, Math.min(BOSS_STACK_LAYERS.length - 1, Math.round(layer)));
  const def = BOSS_STACK_LAYERS[i] ?? { scale: 1, yRatio: 0 };
  return { scale: def.scale, y: def.yRatio * baseHeight };
}

export const BOSS_CLONE_COUNT = 2;
/** 分身透明度（半透明呼应「分身成了三个」） */
export const BOSS_CLONE_OPACITY = 0.35;
/** 分身中心距本体水平偏移（世界单位） */
export const BOSS_CLONE_OFFSET = 0.46;
/** 分身相对本体的缩小率 */
export const BOSS_CLONE_SCALE = 0.85;
/** 分身绕本体 sin 摆位：幅度（rad）/ 角速度（rad/s） */
export const BOSS_CLONE_SWAY_AMPLITUDE = 0.32;
export const BOSS_CLONE_SWAY_SPEED = 0.9;

/** BOSS 分身公转角（纯函数）：仅已有渲染帧采样，不主动请求渲染 */
export function cloneOrbitYawAt(elapsedSeconds: number): number {
  return Math.sin(elapsedSeconds * BOSS_CLONE_SWAY_SPEED) * BOSS_CLONE_SWAY_AMPLITUDE;
}

/* ============================ 接地阴影（高度衰减） ========================= */

export const SHADOW_BASE_OPACITY = 0.3;
/** 离地高度达到该值（世界单位 ≈ HEIGHT_STEP×2）阴影盘完全淡出 */
export const SHADOW_FADE_HEIGHT = 1.2;

/** 接地阴影盘透明度（纯函数）：随离地高度线性衰减，2 层高差后隐去 */
export function shadowOpacityAt(worldY: number): number {
  if (worldY <= 0) return SHADOW_BASE_OPACITY;
  if (worldY >= SHADOW_FADE_HEIGHT) return 0;
  return SHADOW_BASE_OPACITY * (1 - worldY / SHADOW_FADE_HEIGHT);
}

/* ========================= useSquashSlide（单动画 hook） ==================== */

export interface SquashSlideHandle {
  /** 滑动 lerp 收敛帧由 PlayerAvatar 调用：从拉伸态切入 0.12s 落定回弹 */
  readonly land: (nowSeconds: number) => void;
}

type SquashPhase = 'idle' | 'slide' | 'land';

/**
 * 玩家 squash 动画状态机：anim/slide 事件切入拉伸态 → land() 切入回弹态 →
 * 0.12s 自终止复位。scale 直接写入 group（整组形变，部件结构无关）。
 * land 丢失时按滑动时长 1.6 倍兜底转入回弹（防御异常路径卡死拉伸态）。
 */
export function useSquashSlide(entityId: string, groupRef: RefObject<Group | null>): SquashSlideHandle {
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({ phase: 'idle' as SquashPhase, startedAt: -1, landAt: 0 });

  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type === 'anim/slide' && event.entityId === entityId) {
        state.current.phase = 'slide';
        state.current.startedAt = -1; // 首个渲染帧记录起点
      }
    });
  }, [entityId]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (group === null) return;
    const s = state.current;
    if (s.phase === 'idle') return;
    if (s.phase === 'slide') {
      if (s.startedAt < 0) s.startedAt = clock.elapsedTime;
      const scale = squashScaleAt(true, 0);
      group.scale.set(scale.xz, scale.y, scale.xz);
      if (clock.elapsedTime - s.startedAt > SLIDE_SECONDS * 1.6) {
        s.phase = 'land';
        s.landAt = clock.elapsedTime;
      }
      return;
    }
    const elapsed = clock.elapsedTime - s.landAt;
    const scale = squashScaleAt(false, elapsed);
    group.scale.set(scale.xz, scale.y, scale.xz);
    if (elapsed >= SQUASH_LAND_SECONDS) {
      s.phase = 'idle';
      group.scale.set(1, 1, 1);
      return; // 自终止：复位后不再 invalidate
    }
    invalidate(); // 回弹期请求下一帧
  });

  return {
    land: (nowSeconds: number) => {
      const s = state.current;
      if (s.phase === 'slide') {
        s.phase = 'land';
        s.landAt = nowSeconds;
      }
    },
  };
}
