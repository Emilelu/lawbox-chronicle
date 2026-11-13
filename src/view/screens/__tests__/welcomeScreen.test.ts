/**
 * 欢迎页 · pullCardLabel / roll1ButtonLabel 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * 覆盖「最近抽卡」槽位的卡名本地化口径（与 ArchivePanel.pullLabel 一致）：
 * 正式卡查卡表显示卡名（蔡徐坤 / 星光护符），怀旧展品按稀有度标名，
 * 查无此卡回落原始 id。
 * B3-7/B4-9：单抽按钮文案定价与余额分开标注 —— 定价段取 pools 定价常量
 * （与 GachaOverlay「单抽 · 100◈」同口径），余额段经 gacha.balance 键控标注，
 * 持有余额不再拼成价格样式的「（N◈）」。
 * 组件渲染不在此测（无 @testing-library）。
 */

import { describe, expect, it } from 'vitest';
import { pullCardLabel, roll1ButtonLabel } from '../WelcomeScreen';
import { CARDS } from '../../../data/gacha';
import { FORMAL_POOL } from '../../../data/gacha/pools';
import type { GachaPull } from '../../../core/types';

/** 按卡 id 构造最小抽卡记录（rarity 查卡表；未知卡由调用方给定） */
function pull(cardId: string, rarity: GachaPull['rarity'] = 2): GachaPull {
  return { uid: `uid-${cardId}`, cardId, rarity, isNew: false };
}

describe('pullCardLabel · 最近抽卡卡名本地化', () => {
  it('角色卡 card-chr-caixukun 显示「蔡徐坤」，不再剥前缀露出 caixukun', () => {
    expect(pullCardLabel('card-chr-caixukun', 2)).toBe('蔡徐坤');
  });

  it('增益卡 card-buff-starlight-charm 显示「星光护符」，前缀不在旧正则范围也不整串漏出', () => {
    expect(pullCardLabel('card-buff-starlight-charm', 2)).toBe('星光护符');
  });

  it('法则卡同样查表取卡名', () => {
    const lawCard = CARDS.find((c) => c.id.startsWith('card-law-'));
    expect(lawCard).toBeDefined();
    expect(pullCardLabel(lawCard!.id, lawCard!.rarity)).toBe(lawCard!.name);
  });

  it('查无此卡回落原始 id（不替换、不剥前缀）', () => {
    expect(pullCardLabel('card-unknown-future', 2)).toBe('card-unknown-future');
  });

  it('怀旧展品不指向卡表，按稀有度标名（与逐抽记录口径一致）', () => {
    expect(pullCardLabel('nostalgia-star-four', 4)).toBe('怀旧展品·4★');
    expect(pullCardLabel('nostalgia-star-three', 3)).toBe('怀旧展品·3★');
    expect(pullCardLabel('nostalgia-star-two', 2)).toBe('怀旧展品·2★');
  });

  it('显式传入子表：命中则取卡名，未命中回落原 id', () => {
    const subset = CARDS.filter((c) => c.id === 'card-chr-caixukun');
    expect(pullCardLabel('card-chr-caixukun', 2, subset)).toBe('蔡徐坤');
    expect(pullCardLabel('card-buff-starlight-charm', 2, subset)).toBe('card-buff-starlight-charm');
  });
});

describe('最近抽卡槽位拼接 · pulls.map(pullCardLabel).join(" · ")', () => {
  it('混合抽出蔡徐坤与星光护符时，槽位文本为「蔡徐坤 · 星光护符」', () => {
    const pulls = [pull('card-chr-caixukun'), pull('card-buff-starlight-charm')];
    expect(pulls.map((p) => pullCardLabel(p.cardId, p.rarity)).join(' · ')).toBe('蔡徐坤 · 星光护符');
  });

  it('连抽同名卡保留重复项（十连口径：每抽一拍，不去重）', () => {
    const pulls = [pull('card-chr-caixukun'), pull('card-chr-caixukun'), pull('card-buff-starlight-charm')];
    expect(pulls.map((p) => pullCardLabel(p.cardId, p.rarity)).join(' · ')).toBe('蔡徐坤 · 蔡徐坤 · 星光护符');
  });
});

describe('roll1ButtonLabel · 单抽按钮定价与余额分标（B3-7/B4-9）', () => {
  it('定价段取 pools 定价常量（100◈），余额段经 gacha.balance 键控标注', () => {
    const label = roll1ButtonLabel('zh-Hans', 1600);
    expect(label).toBe(`单抽 · ${FORMAL_POOL.pricing.single}◈（当前的星石数 1600◈）`);
    expect(label).toContain(`· ${FORMAL_POOL.pricing.single}◈`);
    expect(label).toContain('（当前的星石数 1600◈）');
  });

  it('余额变化只影响括号内余额段，定价段恒为 pools.pricing.single（余额不再冒充标价）', () => {
    const low = roll1ButtonLabel('zh-Hans', 80);
    const high = roll1ButtonLabel('zh-Hans', 90000);
    expect(low).toContain(`· ${FORMAL_POOL.pricing.single}◈（`);
    expect(high).toContain(`· ${FORMAL_POOL.pricing.single}◈（`);
    expect(low).toContain('（当前的星石数 80◈）');
    expect(high).toContain('（当前的星石数 90000◈）');
  });

  it('非 zh 语种随键控字典本地化（en：Pull ×1 · 100◈（Current star stones 1600◈））', () => {
    expect(roll1ButtonLabel('en', 1600)).toBe(
      `Pull ×1 · ${FORMAL_POOL.pricing.single}◈（Current star stones 1600◈）`,
    );
  });
});
