/**
 * AltarMesh —— 世界内「星愿祭坛」实体。
 * ---------------------------------------------------------------------------
 * 主城段位内 altar 实体（EntityKind 'altar'）的 3D 造型：圆台基座 + 立柱 +
 * 悬浮的金色星晶（octahedron，四角星切面即祭坛星愿意象）。星晶点缀走
 * theme.goal 金/紫双主题，位面换肤时随 PlaneTheme 一起变化；无定时器、
 * 无纹理 —— 静置零渲染（S18 约定）。
 */

import { DoubleSide } from 'three';
import type { PlaneTheme, WorldVec3 } from '../theme';

export interface AltarMeshProps {
  readonly position: WorldVec3;
  readonly theme: PlaneTheme;
}

export function AltarMesh({ position, theme }: AltarMeshProps) {
  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* 圆台基座 */}
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.46, 0.54, 0.18, 24]} />
        <meshStandardMaterial color={theme.goal.pedestal} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* 立柱 */}
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.14, 0.2, 0.28, 16]} />
        <meshStandardMaterial color={theme.wall.base} roughness={0.55} metalness={0.2} />
      </mesh>
      {/* 星晶（octahedron 四角星切面） */}
      <mesh position={[0, 0.62, 0]}>
        <octahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial
          color={theme.goal.cap}
          emissive={theme.goal.halo}
          emissiveIntensity={0.85}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      {/* 地面星愿光环 */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.6, 28]} />
        <meshBasicMaterial color={theme.goal.halo} transparent opacity={0.55} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}
