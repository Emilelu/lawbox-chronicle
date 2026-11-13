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

  it('third + 视角确有切换：explore 回 explore 预设、dialogue 回 dialogue 设计位（B1-4）；全局档模式回落舞台位', () => {
    // explore：回落 explore 预设 8.5/35°（现状语义保持），方位角保留、fov 回基准
    const explore = computeSpontaneousPose('third', 'explore', false, ctx, true);
    expect(explore).not.toBeNull();
    expect(explore!.distance).toBeCloseTo(8.5, 12);
    expect(explore!.polar).toBeCloseTo(degToRad(35), 12); // explore 预设 elevation 55° → 极角 35°
    expect(explore!.azimuth).toBeNull();
    expect(explore!.fov).toBe(BASE_CAMERA_FOV);
    // dialogue（B1-4）：回落 dialogue 设计位（4.6/俯仰 52°），不再被拽去 explore
    // 俯瞰位 —— 说话者不轮换时位姿管线收不回来，取景拉远会持续整段对话
    const dialogue = computeSpontaneousPose('third', 'dialogue', false, ctx, true);
    const dialogueStage = computePose('dialogue', ctx);
    expect(dialogue).not.toBeNull();
    expect(dialogue!.distance).toBe(dialogueStage.distance);
    expect(dialogue!.polar).toBe(dialogueStage.polar);
    expect(dialogue!.azimuth).toBeNull(); // 方位角保留
    expect(dialogue!.fov).toBe(BASE_CAMERA_FOV); // fov 回基准（T 俯瞰 50 不残留）
    for (const mode of STAGE_MODES) {
      const stage = computePose(mode, ctx);
      const pose = computeSpontaneousPose('third', mode, false, ctx, true);
      expect(pose).not.toBeNull();
      expect(pose!.distance).toBe(stage.distance);
      expect(pose!.polar).toBe(stage.polar);
      expect(pose!.fov).toBe(BASE_CAMERA_FOV);
    }
  });

  it('third + T 松开沿（prevPeeking=true → peeking=false）：按当前 mode 回落既定取景（B1-1）', () => {
    // 根因回归：T 俯瞰沿把相机收敛到 explore 俯瞰预设后，松开不改变 view，
    // 旧行为 viewChanged=false 时 return null → 取景永久停在俯瞰位直到相位切换。
    // 松开沿按当前 mode 回落（与 first 分支不查 viewChanged 同做法）：
    for (const mode of STAGE_MODES) {
      const stage = computePose(mode, ctx);
      const pose = computeSpontaneousPose('third', mode, false, ctx, false, true);
      expect(pose).not.toBeNull();
      expect(pose!.distance).toBe(stage.distance);
      expect(pose!.polar).toBe(stage.polar);
      expect(pose!.fov).toBe(BASE_CAMERA_FOV);
    }
    // combat 方位角归 0（I1 舞台位语义，与 first 松开回落一致）
    expect(computeSpontaneousPose('third', 'combat', false, ctx, false, true)!.azimuth).toBe(0);
    // dialogue：回落 dialogue 设计位（与 B1-4 viewChanged 分支同构）
    const dialogue = computeSpontaneousPose('third', 'dialogue', false, ctx, false, true);
    const dialogueStage = computePose('dialogue', ctx);
    expect(dialogue!.distance).toBe(dialogueStage.distance); // 4.6
    expect(dialogue!.polar).toBe(dialogueStage.polar); // 极角 38°（俯仰 52°）
    // explore：回落 explore 预设（俯瞰预设与 explore 预设同值，语义仍是回落）
    const explore = computeSpontaneousPose('third', 'explore', false, ctx, false, true);
    expect(explore!.distance).toBeCloseTo(8.5, 12);
    expect(explore!.polar).toBeCloseTo(degToRad(35), 12);
    // first 分支不查松开沿：first 松开 T 维持既有舞台位/FP 头位回落（现状不变）
    const firstCombat = computeSpontaneousPose('first', 'combat', false, ctx, false, true);
    expect(firstCombat!.distance).toBeCloseTo(8.2, 12);
  });

  it('third 且视角未切换且非松开沿：不发请求（null，explore 常态交还用户全权，现状一致）', () => {
    for (const mode of ALL_MODES) {
      expect(computeSpontaneousPose('third', mode, false, ctx, false, false)).toBeNull();
      expect(computeSpontaneousPose('third', mode, false, ctx, false)).toBeNull(); // prevPeeking 缺省 false
    }
  });

  it('N2 核心不变量：一切非 null 自发位姿的 distance/polar 必须落在目标夹紧档内（可达性）', () => {
    // 不可达目标 = useFrame 每帧夹紧把收敛钉在档位边界 → 永不收敛冻结（N2 根因）。
    // 全组合扫描：view × mode × peeking × viewChanged × prevPeeking（B1-1 松开沿
    // 与 viewChanged 分支合并后，松开沿产物同样必须可达）。
    for (const view of ['first', 'third'] as const) {
      for (const mode of ALL_MODES) {
        for (const peeking of [false, true]) {
          for (const viewChanged of [false, true]) {
            for (const prevPeeking of [false, true]) {
              const pose = computeSpontaneousPose(view, mode, peeking, ctx, viewChanged, prevPeeking);
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
