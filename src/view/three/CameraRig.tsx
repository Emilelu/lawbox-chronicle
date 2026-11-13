/**
 * CameraRig —— 轨道相机与演出运镜（第一/第三人称分档位姿）。
 * ---------------------------------------------------------------------------
 *  - OrbitControls 极角/距离限制按（viewPreference × cameraMode × peeking）
 *    三元分档（theme.cameraLimitsFor）：仅 first 且未俯瞰的 explore/dialogue
 *    收紧到 FP 头位档，其余一切组合恒为全局档 —— 演出运镜（victory 18 /
 *    boss 6.2 / combat 8.2）与 T 俯瞰 8.5 全部不受压。控件 props 与 useFrame
 *    收敛夹紧同源消费，跨档切换在收敛完成后才换档（并集过渡，不硬切）。
 *  - 注视点持续轻量跟随（等量平移相机，保留用户视角偏移）；对话/战斗/过关/
 *    BOSS 由 computePose 位姿请求驱动自动运镜，收敛后停手交还用户。
 *  - 视角档/战术俯瞰（viewStore）：V 切 first/third、T 按住俯瞰 —— 相机目标
 *    位姿在本组件内部自发请求（theme.computeSpontaneousPose 纯决策），WorldCanvas
 *    的 pose 管线零改动（接缝钉死）。全局档模式（combat/victory/boss）下一切
 *    自发回落都收敛该模式既定舞台位 —— FP 头位 0.55 < 全局档 distMin 3.2 是
 *    不可达目标，曾把收敛冻死在 3.2 且 poseActive 永不释放（N2 根治）。
 *  - fov 按位姿可选字段收敛；位姿未带 fov 时回落基准 BASE_CAMERA_FOV（N4：
 *    FP 贴脸 fov 68 不残留进战斗/BOSS 等演出）。方位角/距离差值超阈值发布进
 *    viewStore（供输入映射与调试句柄），纯数字写、无 invalidate。
 *  - bus 演出事件：camera/orbitTo（外部运镜请求）、anim/screenShake（暴击震屏）、
 *    anim/bossTitle（BOSS 入场轨道运镜 2.6s）。
 *  - 全部动画只在未收敛的帧 invalidate —— 静置零渲染（S18）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MathUtils, Spherical, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { bus } from '../../core/events/bus';
import { useGameStore } from '../../core/store/gameStore';
import { findEnemy } from '../../data/enemies';
import { useViewStore } from './viewStore';
import {
  BASE_CAMERA_FOV,
  BOSS_ORBIT_SECONDS,
  BOSS_ORBIT_SPEED,
  FIRST_PERSON_POSE,
  GLOBAL_CAMERA_LIMITS,
  POLAR_MAX,
  POLAR_MIN,
  SHAKE_DECAY,
  SHAKE_MAX_OFFSET,
  cameraLimitsFor,
  computeSpontaneousPose,
  widerCameraLimits,
  type CameraLimits,
  type CameraMode,
  type CameraPose,
  type PoseContext,
  type WorldVec3,
} from './theme';

export interface CameraRigProps {
  /** 每帧轻量跟随的注视点（玩家/战斗舞台中心） */
  readonly focusWorld: WorldVec3;
  /** 位姿请求（WorldCanvas 用 theme.computePose 现算）；poseId 递增触发 */
  readonly pose: CameraPose | null;
  readonly poseId: number;
  /**
   * 相机模式（THEME-3 的 WorldCanvas 显式传入）。缺省按 gameStore 相位推断
   * （与 WorldCanvas 的 cameraMode 映射一致），保证本窗口单方合入即获得
   * 完整分档行为；THEME-3 合入后以显式 prop 为准。
   */
  readonly cameraMode?: CameraMode;
}

/** 方位角发布阈值（rad）：与上次推送差超过它才写 viewStore（避免每帧写） */
const CAM_YAW_PUSH_EPSILON = 0.02;
/** 距离发布阈值（世界单位）：调试句柄 getCameraDistance 的数值分辨率 */
const CAM_DIST_PUSH_EPSILON = 0.02;

/** 两角的最短弧差（0~π），方位角发布与收敛共用语义 */
function angularGap(a: number, b: number): number {
  return Math.abs(MathUtils.euclideanModulo(a - b + Math.PI, Math.PI * 2) - Math.PI);
}

export function CameraRig({ focusWorld, pose, poseId, cameraMode: cameraModeProp }: CameraRigProps) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const clock = useThree((s) => s.clock);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // ---- 视角档（viewStore 订阅）：只选 viewPreference/peeking 两个低频值；
  //      camYaw/camDistance 高频写不订阅，避免每帧重渲染（发布走 getState） ----
  const viewPreference = useViewStore((s) => s.viewPreference);
  const peeking = useViewStore((s) => s.peeking);

  // ---- 相机模式：prop 优先，缺省按 gameStore 相位推断（只读，零 store 改动） ----
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const combatEnemyId = useGameStore((s) => s.combat?.enemyId ?? null);
  const enemyIsBoss = combatEnemyId !== null && findEnemy(combatEnemyId)?.boss === true;
  const cameraMode: CameraMode =
    cameraModeProp ??
    (result !== null
      ? 'victory'
      : phase === 'dialogue'
        ? 'dialogue'
        : phase === 'combat'
          ? enemyIsBoss
            ? 'boss'
            : 'combat'
          : 'explore');

  // 第一人称头位收敛是否生效：仅 first && 未俯瞰 && explore/dialogue 两族
  const fpActive = viewPreference === 'first' && !peeking && (cameraMode === 'explore' || cameraMode === 'dialogue');
  // 目标夹紧档（渲染期派生；收敛期间 OrbitControls 实际生效档见 propLimits）
  const targetLimits = cameraLimitsFor(viewPreference, cameraMode, peeking);

  const focusRef = useRef(new Vector3(focusWorld[0], focusWorld[1], focusWorld[2]));
  const poseActiveRef = useRef(false);
  const desiredRef = useRef<CameraPose | null>(null);
  const orbitUntilRef = useRef(-1); // BOSS 轨道运镜截止时刻（clock.elapsedTime 秒）
  const shakeRef = useRef({ intensity: 0, offset: new Vector3() });

  const spherical = useRef(new Spherical());
  const tmpTarget = useRef(new Vector3());
  const tmpOffset = useRef(new Vector3());

  // 渲染期同步到 ref：useFrame 与位姿 effect 永远读到最新一帧的派生值
  focusRef.current.set(focusWorld[0], focusWorld[1], focusWorld[2]);
  const fpActiveRef = useRef(fpActive);
  fpActiveRef.current = fpActive;
  const targetLimitsRef = useRef(targetLimits);
  targetLimitsRef.current = targetLimits;
  const viewPrefRef = useRef(viewPreference);
  viewPrefRef.current = viewPreference;
  const peekingRef = useRef(peeking);
  peekingRef.current = peeking;

  // OrbitControls 实际生效档：挂载即全局档（与既有第三人称行为逐字节一致）；
  // 跨档收敛期间放宽到并集，收敛完成后才切到目标档 —— update() 的半径硬夹紧
  // 不打断 FP↔third 的平滑运镜
  const [propLimits, setPropLimits] = useState<CameraLimits>(GLOBAL_CAMERA_LIMITS);
  const propLimitsRef = useRef<CameraLimits>(GLOBAL_CAMERA_LIMITS);
  propLimitsRef.current = propLimits;
  const applyPropLimits = useCallback((limits: CameraLimits) => {
    if (limits === propLimitsRef.current) return; // 单例引用相同 = 同档，不重渲染
    propLimitsRef.current = limits;
    setPropLimits(limits);
  }, []);

  // 方位角/距离发布：与上次推送差超阈值才写（纯数字，无 invalidate，S18 不破）
  const lastYawRef = useRef(0);
  const lastDistRef = useRef(0);

  // 位姿请求：poseId 递增即执行一次自动运镜（用户拖拽可取消）。
  // 第一人称（未俯瞰）下收到的任何位姿请求都压回 FP 头位档（距离/俯仰/fov），
  // 方位角沿用请求方语义 —— combat→explore 回正的 azimuth=0、dialogue→explore
  // 的保留头向，均由请求方（computeExploreResetPose 的 viewPreference 分支）决定。
  useEffect(() => {
    if (pose === null) return;
    if (fpActiveRef.current) {
      desiredRef.current = {
        ...pose,
        distance: FIRST_PERSON_POSE.distance,
        polar: FIRST_PERSON_POSE.polar,
        fov: FIRST_PERSON_POSE.fov,
      };
    } else {
      // fov 透传（N4）：位姿自带 fov（combat/boss 预设、FP 回正/俯瞰请求）按
      // 请求方语义消费；位姿未带 fov 时回落第三人称基准 BASE_CAMERA_FOV ——
      // FP 贴脸 fov 68 残留不得带进战斗/BOSS/过关演出与 explore 回正，视场角
      // 与第三人称观感一致。第三人称下相机 fov 恒为基准 50，回落是恒等操作。
      desiredRef.current = { ...pose, fov: pose.fov ?? BASE_CAMERA_FOV };
    }
    poseActiveRef.current = true;
    // 收敛期间放宽夹紧到并集：目标位姿必须在当前生效档 ∪ 目标档内可达
    applyPropLimits(widerCameraLimits(propLimitsRef.current, targetLimitsRef.current));
    invalidate();
  }, [poseId, pose, invalidate, applyPropLimits]);

  // 视角切换 / 战术俯瞰的自发位姿请求（不依赖 WorldCanvas 的 pose 管线）。
  // 目标位姿由 theme.computeSpontaneousPose 纯函数决策（N2 根治）：目标夹紧档
  // 内可达 —— explore/dialogue 回 FP 头位（first），combat/victory/boss（全局
  // 档）回落该模式既定舞台位（FP 头位 0.55 < 全局档 distMin 3.2 是不可达目标，
  // 曾把收敛钉死在 3.2 且 poseActive 永不释放）。third 视角挂载与非松开沿不
  // 发请求 —— explore 常态交还用户全权；「third 松开 T」（B1-1）按当前 mode
  // 回落既定取景：prevPeekRef 在读取后才更新，松开沿（true→false）作为
  // prevPeeking 传入纯函数决策。
  const prevViewRef = useRef(viewPreference);
  const prevPeekRef = useRef(peeking);
  useEffect(() => {
    const viewChanged = prevViewRef.current !== viewPreference;
    const prevPeeking = prevPeekRef.current; // 先读上一次值再更新（松开沿识别）
    prevViewRef.current = viewPreference;
    prevPeekRef.current = peeking;
    const head = focusRef.current;
    const ctx: PoseContext = {
      playerPos: [head.x, head.y, head.z],
      focusPos: [head.x, head.y, head.z],
      arenaCenter: [head.x, head.y, head.z],
    };
    const desired = computeSpontaneousPose(viewPreference, cameraMode, peeking, ctx, viewChanged, prevPeeking);
    if (desired === null) return;
    desiredRef.current = desired;
    poseActiveRef.current = true;
    // 收敛期间放宽夹紧到并集：目标位姿必须在当前生效档 ∪ 目标档内可达
    applyPropLimits(widerCameraLimits(propLimitsRef.current, targetLimitsRef.current));
    invalidate();
  }, [viewPreference, peeking, invalidate, applyPropLimits, cameraMode]);

  // bus 演出事件：外部运镜请求 / 暴击震屏 / BOSS 入场轨道
  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type === 'camera/orbitTo') {
        desiredRef.current = {
          target: [event.target.x, focusRef.current.y, event.target.y],
          distance: desiredRef.current?.distance ?? 8.5,
          polar: MathUtils.clamp(MathUtils.degToRad(90 - event.pitch), POLAR_MIN, POLAR_MAX),
          azimuth: null,
        };
        poseActiveRef.current = true;
        applyPropLimits(widerCameraLimits(propLimitsRef.current, targetLimitsRef.current));
        invalidate();
      } else if (event.type === 'anim/screenShake') {
        shakeRef.current.intensity = Math.min(1, shakeRef.current.intensity + event.intensity);
        invalidate();
      } else if (event.type === 'anim/bossTitle') {
        orbitUntilRef.current = clock.elapsedTime + BOSS_ORBIT_SECONDS;
        invalidate();
      }
    });
  }, [clock, invalidate, applyPropLimits]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (controls === null) return;
    let need = false;

    // 收敛期夹紧用「目标档 ∪ 生效档」并集（跨档平滑）；静置夹紧用目标档
    const limits = poseActiveRef.current
      ? widerCameraLimits(targetLimitsRef.current, propLimitsRef.current)
      : targetLimitsRef.current;

    // 1) 注视点轻量跟随：target 与相机等量平移，用户视角偏移不丢
    tmpTarget.current.set(focusRef.current.x, focusRef.current.y, focusRef.current.z);
    const follow = tmpTarget.current.sub(controls.target).multiplyScalar(1 - Math.exp(-7 * delta));
    if (follow.lengthSq() > 1e-8) {
      controls.target.add(follow);
      camera.position.add(follow);
      need = true;
    }

    // 2) 自动位姿：球坐标指数收敛（方位角走最短弧）
    //    distance/polar 为 null = 保持当前值（delta 0）——explore 回正位姿
    //    只收敛方位角，不抢用户的缩放与俯仰（I2）
    const desired = desiredRef.current;
    if (poseActiveRef.current && desired !== null) {
      tmpOffset.current.copy(camera.position).sub(controls.target);
      spherical.current.setFromVector3(tmpOffset.current);
      const k = 1 - Math.exp(-6 * delta);
      const distDelta = desired.distance !== null ? desired.distance - spherical.current.radius : 0;
      const phiDelta = desired.polar !== null ? desired.polar - spherical.current.phi : 0;
      let thetaDelta = 0;
      if (desired.azimuth !== null) {
        thetaDelta = MathUtils.euclideanModulo(desired.azimuth - spherical.current.theta + Math.PI, Math.PI * 2) - Math.PI;
      }
      const persp = camera as PerspectiveCamera;
      const fovDelta = desired.fov !== undefined ? desired.fov - persp.fov : 0;
      spherical.current.radius += distDelta * k;
      spherical.current.phi = MathUtils.clamp(spherical.current.phi + phiDelta * k, limits.polarMin, limits.polarMax);
      spherical.current.theta += thetaDelta * k;
      spherical.current.radius = MathUtils.clamp(spherical.current.radius, limits.distMin, limits.distMax);
      spherical.current.makeSafe();
      tmpOffset.current.setFromSpherical(spherical.current);
      camera.position.copy(controls.target).add(tmpOffset.current);
      // fov 收敛：|Δ|>0.01 才 updateProjectionMatrix（沿 need 管线请求下一帧）
      if (desired.fov !== undefined && Math.abs(fovDelta) > 0.01) {
        persp.fov += fovDelta * k;
        persp.updateProjectionMatrix();
      }
      const fovSettled = desired.fov === undefined || Math.abs(fovDelta) < 0.05;
      if (Math.abs(distDelta) < 0.02 && Math.abs(phiDelta) < 0.005 && Math.abs(thetaDelta) < 0.005 && fovSettled) {
        poseActiveRef.current = false; // 收敛：交还用户，停止请求帧
      }
      need = true;
    }

    // 3) BOSS 入场轨道运镜（限时，用户抓取即失效）
    if (clock.elapsedTime < orbitUntilRef.current) {
      tmpOffset.current.copy(camera.position).sub(controls.target);
      spherical.current.setFromVector3(tmpOffset.current);
      spherical.current.theta += BOSS_ORBIT_SPEED * delta;
      spherical.current.makeSafe();
      tmpOffset.current.setFromSpherical(spherical.current);
      camera.position.copy(controls.target).add(tmpOffset.current);
      need = true;
    }

    // 4) 暴击震屏：先抹掉上帧偏移再施加新偏移（不漂移轨道状态）
    if (shakeRef.current.intensity > 0.004) {
      const s = shakeRef.current;
      camera.position.sub(s.offset);
      const amplitude = SHAKE_MAX_OFFSET * s.intensity;
      s.offset.set(
        (Math.random() - 0.5) * 2 * amplitude,
        (Math.random() - 0.5) * 2 * amplitude * 0.6,
        (Math.random() - 0.5) * 2 * amplitude,
      );
      camera.position.add(s.offset);
      s.intensity *= Math.exp(-SHAKE_DECAY * delta);
      need = true;
    } else if (shakeRef.current.offset.lengthSq() > 0) {
      camera.position.sub(shakeRef.current.offset);
      shakeRef.current.offset.set(0, 0, 0);
      need = true;
    }

    // 5) 相机偏航/距离发布：差值超阈值才写 viewStore（输入映射与调试句柄的
    //    数据源；纯数字写，无 invalidate —— 静置零渲染不破坏）
    const yaw = controls.getAzimuthalAngle();
    if (angularGap(yaw, lastYawRef.current) > CAM_YAW_PUSH_EPSILON) {
      lastYawRef.current = yaw;
      useViewStore.getState().setCamYaw(yaw);
    }
    const dist = controls.getDistance();
    if (Math.abs(dist - lastDistRef.current) > CAM_DIST_PUSH_EPSILON) {
      lastDistRef.current = dist;
      useViewStore.getState().setCamDistance(dist);
    }

    // 6) 分档换档时机：收敛完成（或用户拖拽取消）后才把生效档切到目标档 ——
    //    此刻相机已落在目标档范围内，OrbitControls 硬夹紧不产生任何瞬移
    if (!poseActiveRef.current && targetLimitsRef.current !== propLimitsRef.current) {
      applyPropLimits(targetLimitsRef.current);
    }

    if (need) {
      controls.update();
      invalidate(); // 仍有未完成的镜头运动 → 请求下一帧
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      enablePan={false}
      minPolarAngle={propLimits.polarMin}
      maxPolarAngle={propLimits.polarMax}
      minDistance={propLimits.distMin}
      maxDistance={propLimits.distMax}
      onStart={() => {
        // 用户接管：取消自动位姿与轨道演出（注视点跟随保留）；
        // 生效档在下一渲染帧切到目标档（见 useFrame 第 6 步）
        poseActiveRef.current = false;
        orbitUntilRef.current = -1;
      }}
    />
  );
}
