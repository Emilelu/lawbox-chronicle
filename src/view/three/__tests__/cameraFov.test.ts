/**
 * N4 回归 —— 战斗/BOSS 视场角回落基准。
 * 病灶：FP（fov 68）进入 combat/boss 后位姿不带 fov 字段，位姿管线「缺省 = 不
 * 收敛」，贴脸 fov 68 残留整个演出，与第三人称（基准 50）观感不一致。
 * 修法：combat/boss 预设显式携带 BASE_CAMERA_FOV（数据层）；CameraRig 位姿请求
 * effect 对未带 fov 的位姿回落基准（消费层兜底，覆盖 victory 等同族场景）。
 */

import { describe, expect, it } from 'vitest';
import {
  BASE_CAMERA_FOV,
  FIRST_PERSON_POSE,
  computeExploreResetPose,
  computePose,
} from '../theme';

describe('theme · N4 战斗/BOSS 视场角回落基准', () => {
  const ctx = {
    playerPos: [1, 0, 2] as const,
    focusPos: [4, 0, 5] as const,
    arenaCenter: [0, 0, 0] as const,
  };

  it('combat/boss 位姿携带基准 fov：FP 残留 68 有了收敛目标 50', () => {
    expect(BASE_CAMERA_FOV).toBe(50); // 与 WorldCanvas Canvas camera 初始 fov 同源
    expect(FIRST_PERSON_POSE.fov).toBe(68); // 残留值（FP 贴脸档）
    expect(FIRST_PERSON_POSE.fov).not.toBe(BASE_CAMERA_FOV);

    const combat = computePose('combat', ctx);
    const boss = computePose('boss', ctx);
    expect(combat.fov).toBe(BASE_CAMERA_FOV); // 字段必须存在，缺省 = 管线不收敛
    expect(boss.fov).toBe(BASE_CAMERA_FOV);
  });

  it('无 fov 预设保持缺省语义（不收敛），FP 回正仍恢复贴脸 68', () => {
    // explore/dialogue/victory 不带 fov：字段缺省语义 = 保持当前 fov 不变
    expect(computePose('explore', ctx).fov).toBeUndefined();
    expect(computePose('dialogue', ctx).fov).toBeUndefined();
    expect(computePose('victory', ctx).fov).toBeUndefined();

    // FP explore 回正恢复贴脸 fov（既有语义不回退；第三人称下由 CameraRig
    // 兜底回落基准 50，而第三人称相机恒为 50，是恒等操作）
    const fpReset = computeExploreResetPose(ctx, 'first');
    expect(fpReset.fov).toBe(FIRST_PERSON_POSE.fov);
    expect(fpReset.fov).toBe(68);
  });
});
