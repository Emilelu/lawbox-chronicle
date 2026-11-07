/**
 * CrateMesh —— 法则石板（推箱实体）。
 * ---------------------------------------------------------------------------
 * 位置真相在 store 实体；显示位置按 0.15s lerp 追上（uiRedesign 推箱滑动规格）。
 * 落座基座 → 静态光环常亮；「anim/goalBurst」事件触发一次扩散脉冲后自动熄灭，
 * 全程按需 invalidate —— 静置零渲染（S18 根治约定）。
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { bus } from '../../../core/events/bus';
import {
  CRATE_HEIGHT,
  CRATE_SIZE,
  GOAL_HALO_PULSE,
  GOAL_HALO_RADIUS,
  clamp01,
  easeOutCubic,
  slidePosition,
  type PlaneTheme,
  type WorldVec3,
} from '../theme';

export interface CrateMeshProps {
  readonly entityId: string;
  /** 目标世界坐标（store 实体位置派生） */
  readonly position: WorldVec3;
  /** 是否已落座基座（terrain 3） */
  readonly onGoal: boolean;
  readonly theme: PlaneTheme;
}

export function CrateMesh({ entityId, position, onGoal, theme }: CrateMeshProps) {
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);
  const groupRef = useRef<Group>(null);
  const pulseRef = useRef<Mesh>(null);
  const pulse = useRef({ start: 0, active: false });

  // 滑动 lerp（与 PlayerAvatar 同一套 0.15s 手感；from/to 存 ref，
  // 不读 group.position —— applyProps 在提交期会把它覆盖成新目标值）。
  // y 轴一并插值：箱落（推下高台）时从高处下落而非瞬移，落差肉眼可见。
  const slideRef = useRef({
    fromX: position[0],
    fromY: position[1],
    fromZ: position[2],
    toX: position[0],
    toY: position[1],
    toZ: position[2],
    t: 1,
  });
  useEffect(() => {
    const slide = slideRef.current;
    if (slide.toX === position[0] && slide.toZ === position[2] && slide.toY === position[1]) return;
    const currentX = slide.t < 1 ? slidePosition(slide.fromX, slide.toX, slide.t * 0.15) : slide.toX;
    const currentY = slide.t < 1 ? slidePosition(slide.fromY, slide.toY, slide.t * 0.15) : slide.toY;
    const currentZ = slide.t < 1 ? slidePosition(slide.fromZ, slide.toZ, slide.t * 0.15) : slide.toZ;
    slide.fromX = currentX;
    slide.fromY = currentY;
    slide.fromZ = currentZ;
    slide.toX = position[0];
    slide.toY = position[1];
    slide.toZ = position[2];
    slide.t = 0;
    invalidate();
  }, [position[0], position[1], position[2], invalidate]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (group === null) return;
    const slide = slideRef.current;
    if (slide.t < 1) {
      slide.t = Math.min(1, slide.t + delta / 0.15);
      group.position.x = slidePosition(slide.fromX, slide.toX, slide.t * 0.15);
      group.position.y = slidePosition(slide.fromY, slide.toY, slide.t * 0.15);
      group.position.z = slidePosition(slide.fromZ, slide.toZ, slide.t * 0.15);
      invalidate();
    }

    // 落座光环脉冲
    const ring = pulseRef.current;
    if (ring === null) return;
    if (!pulse.current.active) return;
    const t = (clock.elapsedTime - pulse.current.start) / GOAL_HALO_PULSE;
    if (t >= 1) {
      pulse.current.active = false;
      ring.visible = false;
      return;
    }
    ring.visible = true;
    const eased = easeOutCubic(clamp01(t));
    ring.scale.setScalar(0.35 + eased * 1.5);
    const material = ring.material;
    if (material !== null && !Array.isArray(material)) {
      material.opacity = 0.85 * (1 - eased);
    }
    invalidate();
  });

  // 落座事件 → 一次扩散脉冲（音效由 audio 模块负责，这里只做视觉）
  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type === 'anim/goalBurst' && event.entityId === entityId) {
        pulse.current = { start: clock.elapsedTime, active: true };
        invalidate();
      }
    });
  }, [entityId, clock, invalidate]);

  return (
    <group ref={groupRef} position={[position[0], position[1], position[2]]}>
      {/* 石板主体 + 顶盖（法则刻痕面） */}
      <mesh>
        <boxGeometry args={[CRATE_SIZE, CRATE_HEIGHT, CRATE_SIZE]} />
        <meshStandardMaterial
          color={theme.crate.body}
          roughness={0.55}
          metalness={0.25}
          emissive={onGoal ? theme.goal.halo : '#000000'}
          emissiveIntensity={onGoal ? 0.22 : 0}
        />
      </mesh>
      <mesh position={[0, CRATE_HEIGHT / 2 - CRATE_HEIGHT * 0.09, 0]}>
        <boxGeometry args={[CRATE_SIZE * 0.86, CRATE_HEIGHT * 0.18, CRATE_SIZE * 0.86]} />
        <meshStandardMaterial
          color={theme.crate.top}
          roughness={0.45}
          metalness={0.3}
          emissive={onGoal ? theme.goal.cap : '#000000'}
          emissiveIntensity={onGoal ? 0.3 : 0}
        />
      </mesh>
      {/* 落座静态光环 */}
      {onGoal && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[GOAL_HALO_RADIUS, GOAL_HALO_RADIUS + 0.16, 26]} />
          <meshBasicMaterial color={theme.goal.halo} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      {/* 落座瞬间扩散环（默认隐藏） */}
      <mesh ref={pulseRef} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[GOAL_HALO_RADIUS, GOAL_HALO_RADIUS + 0.12, 26]} />
        <meshBasicMaterial
          color={theme.goal.halo}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
