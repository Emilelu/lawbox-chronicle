/**
 * PlayerAvatar —— 玩家部件化体素化身（CHAR-2 重制）。
 * ---------------------------------------------------------------------------
 * S5 根治的结构化落点：
 *  - 皮肤表（PLAYER_SKINS，head/body 部件掩码 + 双臂 + 围巾，入 charModels.ts）
 *    只决定「长什么样」；朝向（theme.FACING_YAW / facingRenderYaw）只决定绕 Y
 *    旋转，由 bus 的 anim/slide 事件驱动 —— 换肤与转向互不触碰对方状态。
 * 部件化（CHAR-2）：
 *  - head/body 小掩码 + 左右臂 box + 围巾 3 节链，几何进 GEOMETRY_CACHE
 *    （键 actor:player-<id>:<part>）；torso = head+body+双臂合并 1 mesh，
 *    围巾独立 1 mesh（颈部 pivot 随帧摆动）。
 *  - flatShading 顶点色材质共享 + drei Edges(threshold 30, accent) 描边。
 *  - 渲染预算：torso 1 + Edges 1 + 围巾 1 + 接地阴影盘 1 = 4 draw call。
 * 程序动画（全部有限自终止，demand 下静置零渲染，S18）：
 *  - useSquashSlide：滑动整组拉伸（y*1.08/xz*0.95）、落定 0.88→1 easeOutBack
 *    0.12s 回弹；不做常驻 idle 呼吸。
 *  - 围巾仅在有渲染帧时随帧摆动（不主动请求渲染）。
 * 位移：目标位置来自 store 实体（单一真相源），显示位置按 0.15s lerp 追上；
 * frameloop="demand" 下只在插值未收敛的帧 invalidate。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { BufferGeometry, Group } from 'three';
import { Color, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dir } from '../../../core/types';
import { bus } from '../../../core/events/bus';
import {
  PLAYER_SKIN_CELL,
  SLIDE_SECONDS,
  facingRenderYaw,
  slidePosition,
  type PlaneTheme,
  type WorldVec3,
} from '../theme';
import {
  scarfSwayAt,
  tintedBox,
  useSquashSlide,
  type PlayerSkinDef,
  playerSkinById,
} from './charModels';
import { buildVoxelGeometry, cachedGeometry, GroundShadow, parseArtMask } from './ActorMesh';

/* ============================ 皮肤表与部件几何 ============================= */

// 皮肤表住在 charModels.ts（部件掩码/色板数据层）；此处 re-export 维持既有
// 消费面（worldStage.test / 换肤调用方）不变。
export { PLAYER_SKINS } from './charModels';
export type { PlayerSkinDef } from './charModels';

export interface PlayerParts {
  /** head+body+双臂合并的躯干几何（1 draw call，含 Edges 描边对象） */
  readonly torso: BufferGeometry;
  /** 围巾 3 节链几何（pivot 在颈点，rotation.x 随帧摆动） */
  readonly scarf: BufferGeometry;
  /** 颈点世界高度（body 掩码顶部 = 围巾挂点） */
  readonly neckY: number;
}

/**
 * 玩家部件几何构建（缓存键 actor:player-<id>:torso / :scarf，子件键
 * actor:player-<id>:head / :body 一并入 GEOMETRY_CACHE）。
 */
export function buildPlayerParts(skinId: number): PlayerParts {
  const skin = playerSkinById(skinId);
  const torso = cachedGeometry(`actor:player-${skin.id}:torso`, () => {
    const headMask = parseArtMask(skin.head.rows);
    const bodyMask = parseArtMask(skin.body.rows);
    const headGeo = buildVoxelGeometry(`actor:player-${skin.id}:head`, headMask, PLAYER_SKIN_CELL, skin.head.palette);
    const bodyGeo = buildVoxelGeometry(`actor:player-${skin.id}:body`, bodyMask, PLAYER_SKIN_CELL, skin.body.palette);
    // 头部整体抬升到 body 顶上（部件在掩码表里独立声明，渲染期拼装）
    const headLift = headGeo.clone();
    headLift.translate(0, bodyMask.height * PLAYER_SKIN_CELL, 0);
    // 左右臂：对称双 box，嵌进躯干两侧（微重叠避免侧视缝隙）
    const armSize = skin.arm.size;
    const bodySpanX = (bodyMask.width * PLAYER_SKIN_CELL) / 2;
    const armX = bodySpanX + armSize[0] / 2 - 0.02;
    const armY = bodyMask.height * PLAYER_SKIN_CELL * 0.62;
    const armProto = tintedBox(armSize, skin.arm.color);
    const armL = armProto.clone();
    armL.translate(-armX, armY, 0);
    const armR = armProto.clone();
    armR.translate(armX, armY, 0);
    armProto.dispose();
    const merged = mergeGeometries([headLift, bodyGeo, armL, armR], false);
    if (merged === null) return bodyGeo;
    merged.computeBoundingSphere();
    return merged;
  });
  const scarf = cachedGeometry(`actor:player-${skin.id}:scarf`, () => {
    // 3 节 box 链：节 0 颈环（横贯）、节 1/2 胸前垂链；pivot 在颈点（0,0,0）
    const ring = tintedBox([0.46, 0.09, 0.14], skin.scarf.color);
    ring.translate(0, 0, 0.02);
    const drop1 = tintedBox([0.15, 0.15, 0.055], skin.scarf.color);
    drop1.translate(0.07, -0.12, 0.1);
    const drop2 = tintedBox([0.13, 0.13, 0.05], skin.scarf.tip);
    drop2.translate(0.07, -0.26, 0.12);
    const merged = mergeGeometries([ring, drop1, drop2], false);
    if (merged === null) return ring;
    merged.computeBoundingSphere();
    return merged;
  });
  const neckY = playerSkinById(skin.id).body.rows.length * PLAYER_SKIN_CELL;
  return { torso, scarf, neckY };
}

/* ================================ 组件 ==================================== */

export interface PlayerAvatarProps {
  /** 段位实体 id（importLevel 固定为 player-1；用于过滤 bus 滑动事件） */
  readonly entityId: string;
  /** 目标世界坐标（store 实体位置派生；显示位置向其 lerp） */
  readonly position: WorldVec3;
  readonly facing: Dir;
  /** 皮肤号 0..4（换肤作弊/卡牌接入；越界自动回退 0） */
  readonly skinId?: number;
  readonly theme: PlaneTheme;
}

export function PlayerAvatar({ entityId, position, facing: facingProp, skinId = 0, theme }: PlayerAvatarProps) {
  const invalidate = useThree((s) => s.invalidate);
  const groupRef = useRef<Group>(null);
  const scarfRef = useRef<Group>(null);
  const [facing, setFacing] = useState<Dir>(facingProp);
  const squash = useSquashSlide(entityId, groupRef);

  const skin: PlayerSkinDef = playerSkinById(skinId);
  const parts = useMemo(() => buildPlayerParts(skin.id), [skin.id]);

  // torso 与围巾共享单材质实例（1 次状态切换渲染两个部件）
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.66,
        metalness: 0.14,
        emissive: new Color(theme.player.accent),
        emissiveIntensity: 0.1,
      }),
    // 材质只创建一次；主题换色走下方 effect
    [],
  );
  useEffect(() => {
    material.emissive.set(theme.player.accent);
  }, [material, theme.player.accent]);
  useEffect(() => () => material.dispose(), [material]);

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

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (group === null) return;
    const slide = slideRef.current;
    if (slide.t >= 1) {
      // 无滑动帧：围巾只随已有渲染帧摆动（不请求渲染），squash 由其自终止
      if (scarfRef.current !== null) scarfRef.current.rotation.x = scarfSwayAt(state.clock.elapsedTime);
      return;
    }
    slide.t = Math.min(1, slide.t + delta / SLIDE_SECONDS);
    group.position.x = slidePosition(slide.fromX, slide.toX, slide.t * SLIDE_SECONDS);
    group.position.y = slidePosition(slide.fromY, slide.toY, slide.t * SLIDE_SECONDS);
    group.position.z = slidePosition(slide.fromZ, slide.toZ, slide.t * SLIDE_SECONDS);
    if (scarfRef.current !== null) scarfRef.current.rotation.x = scarfSwayAt(state.clock.elapsedTime);
    if (slide.t >= 1) {
      squash.land(state.clock.elapsedTime); // 滑动收敛 → 切入落定回弹（0.12s 自终止）
    } else {
      invalidate(); // 未收敛 → 请求下一帧；收敛后归零渲染
    }
  });

  return (
    // 渲染走 facingRenderYaw 的 3/4 收敛：左右移动不再侧对相机缩成竖条（I4）；
    // 部件化后侧视剪影由 CAM-1 的 ±60° 收敛保底（theme.FACING_RENDER_YAW_LIMIT）
    <group ref={groupRef} position={[position[0], position[1], position[2]]} rotation={[0, facingRenderYaw(facing), 0]}>
      {/* torso：head+body+双臂合并（draw call 1）+ 部件接缝描边（draw call 2） */}
      <mesh geometry={parts.torso} material={material}>
        <Edges threshold={30} color={theme.player.accent} />
      </mesh>
      {/* 围巾：颈部 pivot 摆动（draw call 3） */}
      <group ref={scarfRef} position={[0, parts.neckY, 0]}>
        <mesh geometry={parts.scarf} material={material} />
      </group>
      {/* 接地阴影盘：opacity 随离地高度衰减（draw call 4） */}
      <GroundShadow worldY={position[1]} radius={0.3} />
    </group>
  );
}
