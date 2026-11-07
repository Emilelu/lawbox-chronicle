/**
 * CameraRig —— 轨道相机与演出运镜。
 * ---------------------------------------------------------------------------
 *  - OrbitControls 俯仰限制 35°~80°（theme.POLAR_MIN/MAX，双保险：控件角度
 *    夹紧 + 自动位姿夹紧），滚轮缩放限制由 CAMERA_ZOOM_LIMITS 给出。
 *  - 注视点持续轻量跟随（等量平移相机，保留用户视角偏移）；对话/战斗/过关/
 *    BOSS 由 computePose 位姿请求驱动自动运镜，收敛后停手交还用户。
 *  - bus 演出事件：camera/orbitTo（外部运镜请求）、anim/screenShake（暴击震屏）、
 *    anim/bossTitle（BOSS 入场轨道运镜 2.6s）。
 *  - 全部动画只在未收敛的帧 invalidate —— 静置零渲染。
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MathUtils, Spherical, Vector3 } from 'three';
import { bus } from '../../core/events/bus';
import {
  BOSS_ORBIT_SECONDS,
  BOSS_ORBIT_SPEED,
  CAMERA_ZOOM_LIMITS,
  POLAR_MAX,
  POLAR_MIN,
  SHAKE_DECAY,
  SHAKE_MAX_OFFSET,
  type CameraPose,
  type WorldVec3,
} from './theme';

export interface CameraRigProps {
  /** 每帧轻量跟随的注视点（玩家/战斗舞台中心） */
  readonly focusWorld: WorldVec3;
  /** 位姿请求（WorldCanvas 用 theme.computePose 现算）；poseId 递增触发 */
  readonly pose: CameraPose | null;
  readonly poseId: number;
}

export function CameraRig({ focusWorld, pose, poseId }: CameraRigProps) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const clock = useThree((s) => s.clock);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const focusRef = useRef(new Vector3(focusWorld[0], focusWorld[1], focusWorld[2]));
  const poseActiveRef = useRef(false);
  const desiredRef = useRef<CameraPose | null>(null);
  const orbitUntilRef = useRef(-1); // BOSS 轨道运镜截止时刻（clock.elapsedTime 秒）
  const shakeRef = useRef({ intensity: 0, offset: new Vector3() });

  const spherical = useRef(new Spherical());
  const tmpTarget = useRef(new Vector3());
  const tmpOffset = useRef(new Vector3());

  focusRef.current.set(focusWorld[0], focusWorld[1], focusWorld[2]);

  // 位姿请求：poseId 递增即执行一次自动运镜（用户拖拽可取消）
  useEffect(() => {
    if (pose === null) return;
    desiredRef.current = pose;
    poseActiveRef.current = true;
    invalidate();
  }, [poseId, pose, invalidate]);

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
        invalidate();
      } else if (event.type === 'anim/screenShake') {
        shakeRef.current.intensity = Math.min(1, shakeRef.current.intensity + event.intensity);
        invalidate();
      } else if (event.type === 'anim/bossTitle') {
        orbitUntilRef.current = clock.elapsedTime + BOSS_ORBIT_SECONDS;
        invalidate();
      }
    });
  }, [clock, invalidate]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (controls === null) return;
    let need = false;

    // 1) 注视点轻量跟随：target 与相机等量平移，用户视角偏移不丢
    tmpTarget.current.set(focusRef.current.x, focusRef.current.y, focusRef.current.z);
    const follow = tmpTarget.current.sub(controls.target).multiplyScalar(1 - Math.exp(-7 * delta));
    if (follow.lengthSq() > 1e-8) {
      controls.target.add(follow);
      camera.position.add(follow);
      need = true;
    }

    // 2) 自动位姿：球坐标指数收敛（方位角走最短弧）
    const desired = desiredRef.current;
    if (poseActiveRef.current && desired !== null) {
      tmpOffset.current.copy(camera.position).sub(controls.target);
      spherical.current.setFromVector3(tmpOffset.current);
      const k = 1 - Math.exp(-6 * delta);
      let distDelta = desired.distance - spherical.current.radius;
      let phiDelta = desired.polar - spherical.current.phi;
      let thetaDelta = 0;
      if (desired.azimuth !== null) {
        thetaDelta = MathUtils.euclideanModulo(desired.azimuth - spherical.current.theta + Math.PI, Math.PI * 2) - Math.PI;
      }
      spherical.current.radius += distDelta * k;
      spherical.current.phi = MathUtils.clamp(spherical.current.phi + phiDelta * k, POLAR_MIN, POLAR_MAX);
      spherical.current.theta += thetaDelta * k;
      spherical.current.radius = MathUtils.clamp(spherical.current.radius, CAMERA_ZOOM_LIMITS.min, CAMERA_ZOOM_LIMITS.max);
      spherical.current.makeSafe();
      tmpOffset.current.setFromSpherical(spherical.current);
      camera.position.copy(controls.target).add(tmpOffset.current);
      if (Math.abs(distDelta) < 0.02 && Math.abs(phiDelta) < 0.005 && Math.abs(thetaDelta) < 0.005) {
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
      minPolarAngle={POLAR_MIN}
      maxPolarAngle={POLAR_MAX}
      minDistance={CAMERA_ZOOM_LIMITS.min}
      maxDistance={CAMERA_ZOOM_LIMITS.max}
      onStart={() => {
        // 用户接管：取消自动位姿与轨道演出（注视点跟随保留）
        poseActiveRef.current = false;
        orbitUntilRef.current = -1;
      }}
    />
  );
}
