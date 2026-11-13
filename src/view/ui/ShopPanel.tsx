/**
 * 帷幕界面层 · ShopPanel —— 祭坛商店（碎片直购法则卡，M4）。
 * ---------------------------------------------------------------------------
 * 只读消费 gameStore.pity.shards（碎片余额，随 pity 计数器持久化）与
 * gacha.owned（持有判定）；购买经 gameStore.redeemLawCard(cardId) —— 引擎
 * 纯函数（engine/gacha/pity.ts redeemLawCard）校验余额/合法性/已持有后，
 * store 侧落账入包并广播 ui/toast 成功/失败回执（本组件不再自行弹窗，
 * 顶部 toast 栈就是反馈通道）。
 *
 * 售价不硬编码：取 FORMAL_POOL.pity.redeemCost（60 碎片，pools.ts 单一真相源）。
 */

import { useGameStore } from '../../core/store/gameStore';
import { CARDS } from '../../data/gacha';
import { FORMAL_POOL } from '../../data/gacha/pools';
import type { CardDef } from '../../core/types';
import { cardName } from '../../data/i18n/uiText';
import { rarityColor, rarityStars } from './GachaOverlay';

/* ============================== 纯逻辑导出 ================================ */

export interface ShopLawItem {
  readonly card: CardDef;
  readonly owned: boolean;
  readonly affordable: boolean;
}

/**
 * 祭坛商店可购清单：只列法则卡（角色卡不参与碎片直购），附持有/可负担标注。
 * 排序：稀有度降序、同稀有度按 id 稳定。
 */
export function shopLawItems(
  cards: readonly CardDef[],
  ownedIds: ReadonlySet<string>,
  shards: number,
  redeemCost: number,
): readonly ShopLawItem[] {
  return cards
    .filter((c) => c.kind === 'law')
    .map((card) => ({ card, owned: ownedIds.has(card.id), affordable: shards >= redeemCost }))
    .sort((a, b) => b.card.rarity - a.card.rarity || a.card.id.localeCompare(b.card.id));
}

/* ============================== 组件 ======================================= */

export function ShopPanel() {
  const shards = useGameStore((s) => s.pity.shards);
  const owned = useGameStore((s) => s.gacha.owned);
  const locale = useGameStore((s) => s.locale);
  const ownedIds = new Set(owned.map((o) => o.cardId));
  const redeemCost = FORMAL_POOL.pity.redeemCost;
  const items = shopLawItems(CARDS, ownedIds, shards, redeemCost);
  const store = useGameStore.getState;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="glass" style={{ padding: '10px 14px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--neon-gold)', fontSize: 15 }}>
          🪙 碎片余额 {shards}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          每张未持有法则卡 {redeemCost} 碎片直购；重复法则卡自动转碎片。成功/失败回执见顶部提示。
        </span>
      </div>
      {items.map((item) => (
        <div
          key={item.card.id}
          className="glass"
          style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4, borderColor: rarityColor(item.card.rarity), opacity: item.owned ? 0.55 : 1 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: rarityColor(item.card.rarity), letterSpacing: '0.12em', fontSize: 12 }}>{rarityStars(item.card.rarity)}</span>
            <span style={{ fontWeight: 700 }}>{cardName(locale, item.card)}</span>
            <span style={{ flex: 1 }} />
            {item.owned ? (
              <span className="chip" style={{ fontSize: 10.5, color: 'var(--neon-cyan)', borderColor: 'rgba(0,229,255,0.5)' }}>✓ 已持有</span>
            ) : (
              <button
                className="chip"
                disabled={!item.affordable}
                style={{
                  cursor: item.affordable ? 'pointer' : 'not-allowed',
                  color: item.affordable ? 'var(--neon-gold)' : 'var(--text-dim)',
                  borderColor: item.affordable ? 'rgba(255,207,92,0.55)' : undefined,
                }}
                onClick={() => store().redeemLawCard(item.card.id)}
              >
                {item.affordable ? `兑换 ${redeemCost} 碎片` : '碎片不足'}
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{item.card.description}</span>
        </div>
      ))}
    </div>
  );
}
