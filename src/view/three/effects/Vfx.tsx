/**
 * Vfx —— 战斗与抽卡演出粒子层。
 * ---------------------------------------------------------------------------
 * 固定池设计（VFX_SLOTS × VFX_PARTICLES，运行期零分配）：
 *  - anim/spark      → 攻击命中火花 / 格挡护盾尘（blocked）
 *  - anim/gachaBurst → 星爆（4★ 金色大爆，复用「★KiraKira~★DokiDoki~★」的
 *    稀有度金光语义；rarity 决定色阶与体量）
 *  - fx/planeShift   → 位面反转：粒子盘升腾 + 扩散环（全屏色彩反转 overlay 归 UI 层）
 * 动画只在粒子存活的帧 invalidate；池耗尽时覆盖最旧槽位，绝不堆积。
 * 粒子参数由纯函数 buildBurstParams 产出（LCG 确定性种子，vitest 可断言）。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh, Points } from 'three';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, PointsMaterial } from 'three';
import type { Vec2 } from '../../../core/types';
import { bus } from '../../../core/events/bus';
import {
  PLANE_RING_LIFE,
  VFX_DURATIONS,
  VFX_PARTICLES,
  VFX_SLOTS,
  type PlaneTheme,
  type WorldVec3,
  clamp01,
  easeOutCubic,
} from '../theme';

/* ============================ 纯函数：粒子参数 ============================ */

export type VfxKind = 'spark' | 'block' | 'star4' | 'star3' | 'star2' | 'plane';

/** 确定性 LCG（避免每帧 Math.random 的不可复现） */
export function createLcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface BurstParams {
  /** 每粒子初速度（世界单位/秒） */
  readonly velocities: readonly number[];
  /** 重力加速度（y 轴，世界单位/秒²） */
  readonly gravity: number;
  /** 切向旋速（星爆环绕感） */
  readonly swirl: number;
  /** 粒子点尺寸（世界单位） */
  readonly size: number;
  readonly duration: number;
}

const KIND_CONFIG: Readonly<Record<VfxKind, { speedMin: number; speedVar: number; gravity: number; swirl: number; size: number }>> =
  Object.freeze({
    spark: { speedMin: 2.2, speedVar: 2.0, gravity: -6.5, swirl: 0, size: 0.11 },
    block: { speedMin: 1.0, speedVar: 1.2, gravity: -2.5, swirl: 0, size: 0.13 },
    star4: { speedMin: 1.6, speedVar: 2.0, gravity: -0.8, swirl: 1.4, size: 0.2 },
    star3: { speedMin: 1.3, speedVar: 1.6, gravity: -0.8, swirl: 1.2, size: 0.17 },
    star2: { speedMin: 1.1, speedVar: 1.3, gravity: -0.8, swirl: 1.0, size: 0.14 },
    plane: { speedMin: 1.8, speedVar: 1.2, gravity: 0.6, swirl: 2.2, size: 0.14 },
  });

/** 一次爆发的粒子运动参数（纯函数；spark/block 上抛，star 环绕，plane 盘升） */
export function buildBurstParams(kind: VfxKind, seed: number, rng: () => number = createLcg(seed)): BurstParams {
  const config = KIND_CONFIG[kind];
  const velocities: number[] = [];
  for (let i = 0; i < VFX_PARTICLES; i++) {
    const theta = rng() * Math.PI * 2;
    const y = kind === 'plane' ? (rng() - 0.5) * 0.5 : rng() * 0.9 + 0.35;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const speed = config.speedMin + rng() * config.speedVar;
    velocities.push(Math.cos(theta) * r * speed, y * speed, Math.sin(theta) * r * speed);
  }
  return {
    velocities,
    gravity: config.gravity,
    swirl: config.swirl,
    size: config.size,
    duration: VFX_DURATIONS[kind.startsWith('star') ? 'star' : kind] ?? 0.6,
  };
}

/* ================================ 组件 ==================================== */

interface SlotState {
  active: boolean;
  kind: VfxKind;
  start: number;
  origin: [number, number, number];
  params: BurstParams | null;
}

export interface VfxLayerProps {
  /** 格坐标 → 世界坐标（WorldCanvas 按当前段位区域提供） */
  readonly toWorld: (cell: Vec2) => WorldVec3;
  /** 玩家世界坐标（星爆/位面反转的原点） */
  readonly playerWorld: WorldVec3;
  readonly theme: PlaneTheme;
}

export function VfxLayer({ toWorld, playerWorld, theme }: VfxLayerProps) {
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);

  // 闭包参数走 ref，bus 订阅只挂一次
  const toWorldRef = useRef(toWorld);
  toWorldRef.current = toWorld;
  const playerRef = useRef(playerWorld);
  playerRef.current = playerWorld;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const slots = useMemo<SlotState[]>(
    () => Array.from({ length: VFX_SLOTS }, () => ({ active: false, kind: 'spark' as VfxKind, start: 0, origin: [0, 0, 0], params: null })),
    [],
  );
  const pointsRefs = useRef<(Points | null)[]>(Array.from({ length: VFX_SLOTS }, () => null));
  const claimRef = useRef(0);

  // 每槽固定几何/材质（attrs 动态更新，运行期零分配）
  const buffers = useMemo(
    () =>
      Array.from({ length: VFX_SLOTS }, () => {
        const geometry = new BufferGeometry();
        const positions = new Float32Array(VFX_PARTICLES * 3);
        const colors = new Float32Array(VFX_PARTICLES * 3);
        const posAttr = new BufferAttribute(positions, 3);
        posAttr.setUsage(DynamicDrawUsage);
        geometry.setAttribute('position', posAttr);
        const colorAttr = new BufferAttribute(colors, 3);
        colorAttr.setUsage(DynamicDrawUsage);
        geometry.setAttribute('color', colorAttr);
        geometry.boundingSphere = null;
        const material: PointsMaterial = new PointsMaterial({
          size: 0.12,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          sizeAttenuation: true,
        });
        return { geometry, material };
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const buffer of buffers) {
        buffer.geometry.dispose();
        buffer.material.dispose();
      }
    },
    [buffers],
  );

  const claim = useCallback(
    (kind: VfxKind, origin: WorldVec3, seed: number) => {
    const index = claimRef.current % VFX_SLOTS;
    claimRef.current += 1;
    const slot = slots[index] ?? undefined;
    const buffer = buffers[index];
    const points = pointsRefs.current[index];
    if (slot === undefined || buffer === undefined) return;
    slot.active = true;
    slot.kind = kind;
    slot.start = clock.elapsedTime;
    slot.origin = [origin[0], origin[1], origin[2]];
    slot.params = buildBurstParams(kind, seed);
    buffer.material.size = slot.params.size;

    // 每粒子颜色：主题色 + 明度抖动（4★ 混入白闪）
    const accent = new Color(kind === 'star4' ? themeRef.current.vfx.star4 : kind === 'star3' ? themeRef.current.vfx.star3 : kind === 'star2' ? themeRef.current.vfx.star2 : kind === 'block' ? themeRef.current.vfx.block : kind === 'plane' ? themeRef.current.vfx.plane : themeRef.current.vfx.spark);
    const white = new Color('#ffffff');
    const mixed = new Color();
    const colorAttr = buffer.geometry.getAttribute('color') as BufferAttribute;
    const rng = createLcg(seed ^ 0x9e3779b9);
    for (let i = 0; i < VFX_PARTICLES; i++) {
      mixed.copy(accent).lerp(white, rng() * (kind === 'star4' ? 0.55 : 0.3));
      colorAttr.setXYZ(i, mixed.r, mixed.g, mixed.b);
    }
    colorAttr.needsUpdate = true;

    if (points !== null && points !== undefined) {
      points.visible = true;
      const material = points.material;
      if (material instanceof PointsMaterial) material.size = slot.params.size;
    }
    invalidate();
    },
    [slots, buffers, clock, invalidate],
  );

  // 位面反转扩散环
  const ringRef = useRef<Mesh>(null);
  const ringState = useRef({ active: false, start: 0 });

  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type === 'anim/spark') {
        const [x, y, z] = toWorldRef.current(event.at);
        claim(event.blocked ? 'block' : 'spark', [x, y + 0.5, z], (event.at.x * 31 + event.at.y * 17) | 0);
      } else if (event.type === 'anim/gachaBurst') {
        const p = playerRef.current;
        claim(`star${event.rarity}` as VfxKind, [p[0], p[1] + 1.25, p[2]], (event.rarity * 977 + Date.now() % 4096) | 0);
      } else if (event.type === 'fx/planeShift') {
        const p = playerRef.current;
        claim('plane', [p[0], p[1] + 0.7, p[2]], (Date.now() % 8192) | 0);
        ringState.current = { active: true, start: clock.elapsedTime };
        invalidate();
      }
    });
  }, [claim, clock, invalidate]);

  useFrame(() => {
    let anyActive = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const points = pointsRefs.current[i];
      if (slot === undefined || !slot.active || slot.params === null) continue;
      const buffer = buffers[i];
      if (buffer === undefined || points === null || points === undefined) continue;
      const t = (clock.elapsedTime - slot.start) / slot.params.duration;
      if (points !== null && t >= 1) {
        slot.active = false;
        points.visible = false;
        continue;
      }
      const posAttr = buffer.geometry.getAttribute('position') as BufferAttribute;
      const ease = easeOutCubic(clamp01(t));
      const tau = t * slot.params.duration;
      const swirlAngle = slot.params.swirl * tau;
      for (let p = 0; p < VFX_PARTICLES; p++) {
        const vx = slot.params.velocities[p * 3] ?? 0;
        const vy = slot.params.velocities[p * 3 + 1] ?? 0;
        const vz = slot.params.velocities[p * 3 + 2] ?? 0;
        // 切向旋绕：把径向速度按时间旋转一个小角度（星爆环绕感）
        const cosA = Math.cos(swirlAngle);
        const sinA = Math.sin(swirlAngle);
        const rx = vx * cosA - vz * sinA;
        const rz = vx * sinA + vz * cosA;
        const gy = vy * tau + 0.5 * slot.params.gravity * tau * tau;
        posAttr.setXYZ(
          p,
          slot.origin[0] + rx * ease + rx * (1 - ease) * 0.4,
          slot.origin[1] + gy,
          slot.origin[2] + rz * ease + rz * (1 - ease) * 0.4,
        );
      }
      posAttr.needsUpdate = true;
      anyActive = true;
    }

    if (ringState.current.active) {
      const ring = ringRef.current;
      const t = (clock.elapsedTime - ringState.current.start) / PLANE_RING_LIFE;
      if (ring !== null) {
        if (t >= 1) {
          ring.visible = false;
          ringState.current.active = false;
        } else {
          const eased = easeOutCubic(clamp01(t));
          ring.visible = true;
          ring.scale.setScalar(0.4 + eased * 4.2);
          const material = ring.material;
          if (!Array.isArray(material)) material.opacity = 0.65 * (1 - eased);
        }
      }
      anyActive = true;
    }

    if (anyActive) invalidate(); // 演出进行中才请求下一帧
  });

  return (
    <group>
      {slots.map((_, i) => {
        const buffer = buffers[i];
        if (buffer === undefined) return null;
        return (
          <points
            key={i}
            ref={(points) => {
              pointsRefs.current[i] = points;
            }}
            geometry={buffer.geometry}
            material={buffer.material}
            visible={false}
            frustumCulled={false}
          />
        );
      })}
      {/* 位面反转扩散环（y 随玩家海拔抬升，B2-1：站上 h1 基座格时环根不再
          埋进平台体被 depthTest 剔除 —— 与粒子 origin 的 p[1]+0.7 同源跟随） */}
      <mesh
        ref={ringRef}
        position={[playerWorld[0], playerWorld[1] + 0.05, playerWorld[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <ringGeometry args={[0.7, 0.92, 36]} />
        <meshBasicMaterial
          color={theme.vfx.plane}
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
