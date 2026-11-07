/**
 * 帷幕界面层 · ShopPanel 纯逻辑单测 —— shopLawItems（祭坛商店可购清单）。
 */

import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../../core/types';
import { shopLawItems } from '../ShopPanel';

const CARDS: readonly CardDef[] = [
  { id: 'law-a', kind: 'law', name: '法则A', rarity: 4, description: '' },
  { id: 'chr-b', kind: 'character', name: '角色B', rarity: 3, description: '' },
  { id: 'law-c', kind: 'law', name: '法则C', rarity: 2, description: '' },
];

describe('shopLawItems · 祭坛商店清单', () => {
  it('只列法则卡，角色卡不参与碎片直购', () => {
    const items = shopLawItems(CARDS, new Set(), 100, 60);
    expect(items.map((i) => i.card.id)).toEqual(['law-a', 'law-c']);
  });

  it('持有 / 可负担标注正确', () => {
    const items = shopLawItems(CARDS, new Set(['law-a']), 30, 60);
    const a = items.find((i) => i.card.id === 'law-a');
    const c = items.find((i) => i.card.id === 'law-c');
    expect(a?.owned).toBe(true);
    expect(c?.owned).toBe(false);
    expect(c?.affordable).toBe(false); // 30 < 60
  });

  it('碎片充足则未持有卡可负担', () => {
    const items = shopLawItems(CARDS, new Set(), 120, 60);
    expect(items.every((i) => i.affordable === true)).toBe(true);
  });
});
