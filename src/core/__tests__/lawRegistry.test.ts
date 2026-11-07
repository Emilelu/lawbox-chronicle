/**
 * lawRegistry —— 法则补丁注册表单测。
 */

import { describe, expect, it } from 'vitest';
import {
  BUFF_RANGES,
  DEFAULT_RULE_SET,
  LAW_PATCHES,
  LAW_PATCH_IDS,
  applyPatch,
  applyPatchChain,
  validateBuff,
} from '../lawRegistry';

describe('lawRegistry.applyPatch', () => {
  it('所有注册补丁的 effect 均可通过自身 schema 且可应用', () => {
    for (const id of LAW_PATCH_IDS) {
      const def = LAW_PATCHES[id];
      expect(def, `补丁 ${id} 缺少定义`).toBeTruthy();
      const result = applyPatch(DEFAULT_RULE_SET, id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 纯函数：原 RuleSet 不被修改
        expect(DEFAULT_RULE_SET.pushRange).toBe(1);
        expect(result.ruleSet).not.toBe(DEFAULT_RULE_SET);
      }
    }
  });

  it('wider-push 使 pushRange +1 并夹紧到 [1,3]', () => {
    const r = applyPatch(DEFAULT_RULE_SET, 'wider-push');
    expect(r.ok && r.ruleSet.pushRange).toBe(2);
  });

  it('feather-chest 把箱子质量降到下限 1', () => {
    const r = applyPatch(DEFAULT_RULE_SET, 'feather-chest');
    expect(r.ok && r.ruleSet.chestMass).toBe(1);
  });

  it('未知补丁 id → ok:false（字符串 id 不能绕过注册表）', () => {
    const r = applyPatch(DEFAULT_RULE_SET, 'hax-attack-mul-999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('未知法则补丁');
  });

  it('applyPatchChain：多补丁级联；中途失败即停', () => {
    const okChain = applyPatchChain(DEFAULT_RULE_SET, ['wider-push', 'berserk']);
    expect(okChain.ok && okChain.ruleSet.pushRange).toBe(2);
    expect(okChain.ok && okChain.ruleSet.playerAttackMul).toBeCloseTo(1.5);

    const badChain = applyPatchChain(DEFAULT_RULE_SET, ['wider-push', 'no-such-patch']);
    expect(badChain.ok).toBe(false);
  });

  it('plane-shift 解锁位面切换（F 键契约）', () => {
    const r = applyPatch(DEFAULT_RULE_SET, 'plane-shift');
    expect(r.ok && r.ruleSet.planeShiftEnabled).toBe(true);
  });
});

describe('lawRegistry.validateBuff —— 角色卡数值范围', () => {
  it('范围内 Buff 通过', () => {
    const r = validateBuff({ buffId: 'attackUp', value: 50 });
    expect(r.ok).toBe(true);
  });

  it('越界 Buff 拒绝（外挂数据进不来）', () => {
    expect(validateBuff({ buffId: 'attackUp', value: 99999 }).ok).toBe(false);
    expect(validateBuff({ buffId: 'attackUp', value: 0 }).ok).toBe(false);
    expect(validateBuff({ buffId: 'regenerate', value: -1 }).ok).toBe(false);
    expect(validateBuff({ buffId: 'unknownBuff', value: 5 }).ok).toBe(false);
  });

  it('Buff 范围表自洽：min ≤ max 且为正区间', () => {
    for (const [, range] of Object.entries(BUFF_RANGES)) {
      expect(range.min).toBeLessThanOrEqual(range.max);
    }
  });
});
