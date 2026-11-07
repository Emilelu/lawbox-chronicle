/**
 * GateMesh —— 法则之门。
 * ---------------------------------------------------------------------------
 * 每条地图边最长开口处立门（位由 theme.deriveGates 派生）；把法则石板全部
 * 推上基座后门体溶解开启（关卡完成判定驱动，非定时器）。
 * 溶解动画：ShaderMaterial 的 discard 阈值推进，frameloop="demand" 下仅在
 * 动画进行中的帧调用 invalidate，静置零渲染。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, MathUtils, ShaderMaterial } from 'three';
import type { Dir } from '../../../core/types';
import {
  CELL,
  GATE_DISSOLVE_SECONDS,
  GATE_HEIGHT,
  GATE_PILLAR,
  GATE_WIDTH,
  type PlaneTheme,
  type WorldVec3,
  clamp01,
} from '../theme';

export interface GateMeshProps {
  /** 门基座中心（地面高度 y=0） */
  readonly position: WorldVec3;
  /** 朝外方向（决定门面朝向与横梁走向） */
  readonly dir: Dir;
  readonly open: boolean;
  readonly theme: PlaneTheme;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uProgress;
  uniform float uSeed;
  uniform vec3 uPortal;
  uniform vec3 uRim;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 cell = floor(vUv * vec2(14.0, 8.0)) + uSeed;
    float n = hash(cell);
    if (n < uProgress) discard;
    // 溶解边缘：临近阈值的碎片泛出描边色
    float edge = smoothstep(uProgress, uProgress + 0.16, n);
    vec3 color = mix(uRim, uPortal, edge);
    float alpha = mix(0.92, 0.55, edge);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function GateMesh({ position, dir, open, theme }: GateMeshProps) {
  const invalidate = useThree((s) => s.invalidate);
  const progressRef = useRef(open ? 1 : 0);
  const portalColorRef = useRef(new Color(theme.gate.portal));
  const rimColorRef = useRef(new Color(theme.gate.rim));

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uProgress: { value: progressRef.current },
          uSeed: { value: (position[0] * 7.13 + position[2] * 3.71) % 10 },
          uPortal: { value: portalColorRef.current },
          uRim: { value: rimColorRef.current },
        },
      }),
    // 门位不变则材质复用；位面换肤走 uniform 更新，不重建
    [position[0], position[2]],
  );

  useEffect(() => () => material.dispose(), [material]);

  // 位面换肤：颜色写入 uniform（Color 引用即 uniform 值，set 即生效）
  useEffect(() => {
    portalColorRef.current.set(theme.gate.portal);
    rimColorRef.current.set(theme.gate.rim);
    invalidate();
  }, [theme, material, invalidate]);

  const alongX = dir === 'up' || dir === 'down';
  const rotationY = alongX ? 0 : Math.PI / 2;
  const halfSpan = GATE_WIDTH / 2;
  const innerWidth = GATE_WIDTH - GATE_PILLAR * 2;
  const lintelY = GATE_HEIGHT + GATE_PILLAR / 2;

  useFrame((_, delta) => {
    const goal = open ? 1 : 0;
    const current = progressRef.current;
    if (current === goal) return;
    const step = delta / GATE_DISSOLVE_SECONDS;
    const next = MathUtils.clamp(current + Math.sign(goal - current) * step, 0, 1);
    progressRef.current = next;
    const uniform = material.uniforms.uProgress;
    if (uniform !== undefined) uniform.value = clamp01(next);
    invalidate(); // 动画进行中才请求下一帧
  });

  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, rotationY, 0]}>
      {/* 双柱：霓虹描边立柱 */}
      <mesh position={[-halfSpan + GATE_PILLAR / 2, GATE_HEIGHT / 2, 0]}>
        <boxGeometry args={[GATE_PILLAR, GATE_HEIGHT, GATE_PILLAR * 0.8]} />
        <meshStandardMaterial
          color={theme.gate.pillar}
          emissive={theme.gate.rim}
          emissiveIntensity={0.35}
          roughness={0.4}
          metalness={0.35}
        />
      </mesh>
      <mesh position={[halfSpan - GATE_PILLAR / 2, GATE_HEIGHT / 2, 0]}>
        <boxGeometry args={[GATE_PILLAR, GATE_HEIGHT, GATE_PILLAR * 0.8]} />
        <meshStandardMaterial
          color={theme.gate.pillar}
          emissive={theme.gate.rim}
          emissiveIntensity={0.35}
          roughness={0.4}
          metalness={0.35}
        />
      </mesh>
      {/* 横梁 */}
      <mesh position={[0, lintelY, 0]}>
        <boxGeometry args={[GATE_WIDTH, GATE_PILLAR, GATE_PILLAR * 0.8]} />
        <meshStandardMaterial
          color={theme.gate.pillar}
          emissive={theme.gate.portal}
          emissiveIntensity={0.5}
          roughness={0.4}
          metalness={0.35}
        />
      </mesh>
      {/* 位面门户（溶解片） */}
      <mesh position={[0, GATE_HEIGHT / 2, 0]}>
        <planeGeometry args={[innerWidth, GATE_HEIGHT]} />
        <primitive object={material} attach="material" />
      </mesh>
      {/* 门槛（地面基准，提示可通行方向） */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GATE_WIDTH, CELL * 0.34]} />
        <meshStandardMaterial
          color={theme.gate.portal}
          emissive={theme.gate.portal}
          emissiveIntensity={0.6}
          transparent
          opacity={0.55}
        />
      </mesh>
    </group>
  );
}
