/**
 * computeSpontaneousPose —— 视角切换/战术俯瞰自发位姿决策的纯函数测试（N2）。
 * ---------------------------------------------------------------------------
 * N2 根因回归：第一人称在 combat/boss/victory（全局档 distMin=3.2）下松开 T，
 * 自发请求若收敛 FP 头位 0.55（< 3.2 不可达），useFrame 每帧
 * clamp(radius, distMin, distMax) 会把收敛钉死在 3.2，完成判据 |distDelta|<0.02
 * 永不满足 → poseActive 悬置 + 每帧 invalidate（S18 静置零渲染被破坏）。
 * 核心不变量：**自发位姿目标必须落在该次请求的目标夹紧档内（可达）**，
 * 且全局档模式下回落该模式既定舞台位（combat 8.2 / boss 6.2 / victory 18）。
 */

import { describe, expect, it } from 'vitest';
import {
  BASE_CAMERA_FOV,
  FIRST_PERSON_LIMITS,
  FIRST_PERSON_POSE,
  GLOBAL_CAMERA_LIMITS,
  cameraLimitsFor,
  computePose,
  computeSpontaneousPose,
  degToRad,
  type PoseContext,
} from '../theme';

const ctx: PoseContext = {
  playerPos: [1, 0, 2],
  focusPos: [4, 0, 5],
  arenaCenter: [0, 0, 0],
};

const STAGE_MODES = ['combat', 'victory', 'boss'] as const;
const FP_MODES = ['explore', 'dialogue'] as const;
const ALL_MODES = ['explore', 'dialogue', 'combat', 'victory', 'boss'] as const;

describe('theme · 自发位姿回落决策（computeSpontaneousPose，N2 根治）', () => {
  it('N2 回归：first + 全局档模式松开 T 回落舞台位，不再收敛不可达的 FP 头位 0.55', () => {
    // combat：回落 8.2/50°/azimuth 0（I1 舞台位），而非被 distMin=3.2 夹死的 0.55
    const combat = computeSpontaneousPose('first', 'combat', false, ctx, false);
    expect(combat).not.toBeNull();
    expect(combat!.distance).toBeCloseTo(8.2, 12);
    expect(combat!.polar).toBeCloseTo(degToRad(50), 12);
    expect(combat!.azimuth).toBe(0); // 战斗期与谜题期同方位（I1）
    expect(combat!.fov).toBe(BASE_CAMERA_FOV); // fov 回基准（N4 同语义）

    // boss / victory：同样回落各自舞台位（6.2/40°、18/28°）
    const boss = computeSpontaneousPose('first', 'boss', false, ctx, false);
    expect(boss!.distance).toBeCloseTo(6.2, 12);
    expect(boss!.polar).toBeCloseTo(degToRad(40), 12);

    const victory = computeSpontaneousPose('first', 'victory', false, ctx, false);
    expect(victory!.distance).toBeCloseTo(18, 12);
    expect(victory!.polar).toBeCloseTo(degToRad(28), 12);

    // 与位姿管线 computePose 同源：distance/polar/azimuth 逐字段一致
    for (const mode of STAGE_MODES) {
      const stage = computePose(mode, ctx);
      const spontaneous = computeSpontaneousPose('first', mode, false, ctx, false);
      expect(spontaneous!.distance).toBe(stage.distance);
      expect(spontaneous!.polar).toBe(stage.polar);
      expect(spontaneous!.azimuth).toBe(stage.azimuth);
    }
  });

  it('first + explore/dialogue（FP 档生效）：收敛 FP 头位，方位角保留用户头向', () => {
    for (const mode of FP_MODES) {
      const pose = computeSpontaneousPose('first', mode, false, ctx, false);
      expect(pose).not.toBeNull();
      expect(pose!.distance).toBe(FIRST_PERSON_POSE.distance); // 0.55 头位
      expect(pose!.polar).toBe(FIRST_PERSON_POSE.polar); // 极角 78°
      expect(pose!.fov).toBe(FIRST_PERSON_POSE.fov); // fov 68
      expect(pose!.azimuth).toBeNull(); // 不拽头向
    }
  });

  it('peeking（T 俯瞰）：任意模式收敛 explore 俯瞰预设 8.5/35°，方位角保留、fov 回基准', () => {
    for (const view of ['first', 'third'] as const) {
      for (const mode of ALL_MODES) {
        const pose = computeSpontaneousPose(view, mode, true, ctx, false);
        expect(pose).not.toBeNull();
        expect(pose!.distance).toBeCloseTo(8.5, 12);
        expect(pose!.polar).toBeCloseTo(degToRad(35), 12);
        expect(pose!.azimuth).toBeNull();
        expect(pose!.fov).toBe(BASE_CAMERA_FOV);
      }
    }
  });

  it('third + 视角确有切换：explore/dialogue 回 explore 预设；全局档模式回落舞台位', () => {
    for (const mode of FP_MODES) {
      const pose = computeSpontaneousPose('third', mode, false, ctx, true);
      expect(pose).not.toBeNull();
      expect(pose!.distance).toBeCloseTo(8.5, 12);
      expect(pose!.polar).toBeCloseTo(degToRad(35), 12); // explore 预设 elevation 55° → 极角 35°
      expect(pose!.azimuth).toBeNull();
      expect(pose!.fov).toBe(BASE_CAMERA_FOV);
    }
    for (const mode of STAGE_MODES) {
      const stage = computePose(mode, ctx);
      const pose = computeSpontaneousPose('third', mode, false, ctx, true);
      expect(pose).not.toBeNull();
      expect(pose!.distance).toBe(stage.distance);
      expect(pose!.polar).toBe(stage.polar);
      expect(pose!.fov).toBe(BASE_CAMERA_FOV);
    }
  });

  it('third 且视角未切换：不发请求（null，explore 常态交还用户全权，现状一致）', () => {
    for (const mode of ALL_MODES) {
      expect(computeSpontaneousPose('third', mode, false, ctx, false)).toBeNull();
    }
  });

  it('N2 核心不变量：一切非 null 自发位姿的 distance/polar 必须落在目标夹紧档内（可达性）', () => {
    // 不可达目标 = useFrame 每帧夹紧把收敛钉在档位边界 → 永不收敛冻结（N2 根因）。
    // 全组合扫描：view × mode × peeking × viewChanged。
    for (const view of ['first', 'third'] as const) {
      for (const mode of ALL_MODES) {
        for (const peeking of [false, true]) {
          for (const viewChanged of [false, true]) {
            const pose = computeSpontaneousPose(view, mode, peeking, ctx, viewChanged);
            if (pose === null) continue;
            const limits = cameraLimitsFor(view, mode, peeking);
            expect(pose.distance ?? 0).toBeGreaterThanOrEqual(limits.distMin);
            expect(pose.distance ?? 0).toBeLessThanOrEqual(limits.distMax);
            expect(pose.polar ?? 0).toBeGreaterThanOrEqual(limits.polarMin);
            expect(pose.polar ?? 0).toBeLessThanOrEqual(limits.polarMax);
          }
        }
      }
    }
  });

  it('分档一致性：FP 回落请求的目标档恰为 FP 档、全局档模式回落请求的目标档恰为全局档', () => {
    // first + explore/dialogue 的回落目标档 = FIRST_PERSON_LIMITS（0.35~1.2 可容 0.55）
    expect(cameraLimitsFor('first', 'explore', false)).toEqual(FIRST_PERSON_LIMITS);
    expect(cameraLimitsFor('first', 'dialogue', false)).toEqual(FIRST_PERSON_LIMITS);
    // first + combat/victory/boss 的回落目标档 = 全局档（8.2/6.2/18 全部可达）
    for (const mode of STAGE_MODES) {
      expect(cameraLimitsFor('first', mode, false)).toEqual(GLOBAL_CAMERA_LIMITS);
    }
  });
});
