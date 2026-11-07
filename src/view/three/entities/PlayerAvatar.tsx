/**
 * PlayerAvatar —— 玩家体素化身。
 * ---------------------------------------------------------------------------
 * S5 根治的结构化落点：
 *  - 皮肤表（PLAYER_SKINS，ASCII 掩码 + 色板）只决定「长什么样」；
 *  - 朝向（theme.FACING_YAW）只决定绕 Y 旋转，由 bus 的 anim/slide 事件驱动，
 *    换肤与转向互不触碰对方状态（SanBPushChest changeRole 旋转错位不再可能）。
 * 位移：目标位置来自 store 实体（单一真相源），显示位置按 0.15s lerp 追上；
 * frameloop="demand" 下只在插值未收敛的帧 invalidate，静置零渲染。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import type { Dir } from '../../../core/types';
import { bus } from '../../../core/events/bus';
import {
  FACING_YAW,
  PLAYER_SKIN_CELL,
  SLIDE_SECONDS,
  slidePosition,
  type PlaneTheme,
  type WorldVec3,
} from '../theme';
import { buildVoxelGeometry, parseArtMask } from './ActorMesh';

/* ============================== 玩家皮肤表 ================================ */

/**
 * 5 张玩家皮肤（对应 SanBPushChest assets/imgs/roles role1..role5 的重铸）。
 * ASCII 掩码：'#'主色 'o'副色 '+'点缀。与朝向零耦合，替换/新增皮肤不改任何旋转逻辑。
 */
export interface PlayerSkin {
  readonly id: number;
  readonly rows: readonly string[];
  readonly palette: readonly [string, string, string];
}

export const PLAYER_SKINS: readonly PlayerSkin[] = Object.freeze([
  {
    id: 0,
    rows: [
      '..###..',
      '..#o#..',
      '.#####.',
      'o#+++#o',
      '..###..',
      '.o###o.',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#eaf0ff', '#4a559e', '#00e5ff'],
  },
  {
    id: 1,
    rows: [
      '..###..',
      '..#o#..',
      '.#####.',
      'o#+++#o',
      '..###..',
      '.o###o.',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#ffe9c9', '#a4763d', '#ffcf5c'],
  },
  {
    id: 2,
    rows: [
      '..###..',
      '.#####.',
      'o#####o',
      '.o+++o.',
      '..###..',
      '.o###o.',
      '..#.#..',
      '..#.#..',
    ],
    palette: ['#efe6ff', '#6f4bb8', '#ff5c9e'],
  },
  {
    id: 3,
    rows: [
      '..#o#..',
      '..###..',
      '.#####.',
      'o#+++#o',
      '..###..',
      '.#####.',
      '..#.#..',
      '.#...#.',
    ],
    palette: ['#e2fff2', '#2f8f6b', '#ffe27a'],
  },
  {
    id: 4,
    rows: [
      '..#o#..',
      '.o###o.',
      '.#####.',
      'o#+++#o',
      '..###..',
      '.o###o.',
      '..#.#..',
      '.#..#..',
    ],
    palette: ['#ffd9e8', '#b3543f', '#7cf5c8'],
  },
]);

export interface PlayerAvatarProps {
  /** 段位实体 id（importLevel 固定为 player-1；用于过滤 bus 滑动事件） */
  readonly entityId: string;
  /** 目标世界坐标（store 实体位置派生；显示位置向其 lerp） */
  readonly position: WorldVec3;
  readonly facing: Dir;
  /** 皮肤号 0..4（未来换肤作弊/卡牌接入；缺省 0） */
  readonly skinId?: number;
  readonly theme: PlaneTheme;
}

export function PlayerAvatar({ entityId, position, facing: facingProp, skinId = 0, theme }: PlayerAvatarProps) {
  const invalidate = useThree((s) => s.invalidate);
  const groupRef = useRef<Group>(null);
  const [facing, setFacing] = useState<Dir>(facingProp);

  const geometry = useMemo(() => {
    const skin = PLAYER_SKINS[skinId] ?? PLAYER_SKINS.find((s) => s.id === 0);
    if (skin === undefined) throw new Error('玩家皮肤表为空 —— PLAYER_SKINS 必须至少有一张皮肤');
    const mask = parseArtMask(skin.rows);
    return buildVoxelGeometry(`player:${skin.id}`, mask, PLAYER_SKIN_CELL, skin.palette);
  }, [skinId]);

  // 朝向：bus 滑动事件为主驱动；父组件显式传入时同步（两者写同一状态，不交叉污染）
  useEffect(() => {
    setFacing(facingProp);
  }, [facingProp]);

  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type === 'anim/slide' && event.entityId === entityId) {
        setFacing(event.dir);
      }
    });
  }, [entityId]);

  // 滑动 lerp：from/to 存 ref（不能读 group.position —— R3F 提交期 applyProps
  // 会把它覆盖成新目标值，读到起点即目标，滑动会被吞成瞬移）。
  // y 轴一并插值：玩家上下台阶（Δh=1）时平滑升降，落差可见。
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
    if (slide.toX === position[0] && slide.toZ === position[2] && slide.toY === position[1]) return; // 目标未变（无关 store 更新）
    // 中断中的动画从当前插值位置续跑，已完成则从上一目标起滑
    const currentX = slide.t < 1 ? slidePosition(slide.fromX, slide.toX, slide.t * SLIDE_SECONDS) : slide.toX;
    const currentY = slide.t < 1 ? slidePosition(slide.fromY, slide.toY, slide.t * SLIDE_SECONDS) : slide.toY;
    const currentZ = slide.t < 1 ? slidePosition(slide.fromZ, slide.toZ, slide.t * SLIDE_SECONDS) : slide.toZ;
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
    if (slide.t >= 1) return;
    slide.t = Math.min(1, slide.t + delta / SLIDE_SECONDS);
    group.position.x = slidePosition(slide.fromX, slide.toX, slide.t * SLIDE_SECONDS);
    group.position.y = slidePosition(slide.fromY, slide.toY, slide.t * SLIDE_SECONDS);
    group.position.z = slidePosition(slide.fromZ, slide.toZ, slide.t * SLIDE_SECONDS);
    if (slide.t < 1) invalidate(); // 未收敛 → 请求下一帧；收敛后归零渲染
  });

  return (
    <group ref={groupRef} position={[position[0], position[1], position[2]]} rotation={[0, FACING_YAW[facing], 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.66}
          metalness={0.14}
          emissive={theme.player.accent}
          emissiveIntensity={0.1}
        />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} depthWrite={false} />
      </mesh>
    </group>
  );
}
