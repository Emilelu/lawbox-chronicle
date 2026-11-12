/**
 * 帷幕界面层 · DeckPanel —— 卡组 / 背包 / 图鉴三页签 + 出货统计曲线入口。
 * ---------------------------------------------------------------------------
 * 诚实原则（K13「谎报清空背包」的对面）：本面板只展示 store 真实持有的东西 ——
 *   卡组 = gacha.owned 实例；背包 = 星石余额 + 当前装备武器；武器图谱/图鉴
 *   是明确标注的全集目录，绝不冒充持有物。
 * 法则卡激活走真实 reducer（applyLawCard → buildPuzzleRuleSet 级联重建 RuleSet）；
 * 角色卡同样可编入卡组（集成期接线：applyLawCard 收录角色卡，战斗开局结算
 * buff，对话分支经 card: 镜像判定）。
 * 出货曲线（BT9「抽卡记录即弃」的归宿）：由 owned 实例的 obtainedAt 现算
 *   稀有度累计曲线（纯函数 buildPullCurve，可独立 vitest），SVG 渲染零依赖。
 */

import { useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { CARDS } from '../../data/gacha';
import { WEAPONS, findEnemy, findWeapon } from '../../data';
import type { CardDef, CardInstance, Rarity } from '../../core/types';
import { tUi } from '../../data/i18n/uiText';
import { rarityColor, rarityStars } from './GachaOverlay';
import { ShopPanel } from './ShopPanel';

/* ------------------------------ 纯逻辑导出 -------------------------------- */

export interface CurvePoint {
  /** 第 n 次获得（按 obtainedAt 升序，1 起） */
  readonly index: number;
  /** 获得时间戳（ms） */
  readonly at: number;
  readonly c2: number;
  readonly c3: number;
  readonly c4: number;
}

export interface PullCurve {
  readonly points: readonly CurvePoint[];
  /** 计入曲线的获得总数（未知 cardId 的脏数据不计） */
  readonly total: number;
}

/**
 * 出货统计曲线：按获得时间升序累计各稀有度张数。
 * 纯函数：不依赖 store / DOM；未知 cardId 静默跳过（坏档容错）。
 */
export function buildPullCurve(owned: readonly CardInstance[], cards: readonly CardDef[]): PullCurve {
  const rarityOf = new Map<string, Rarity>(cards.map((c) => [c.id, c.rarity] as const));
  const sorted = [...owned].sort((a, b) => a.obtainedAt - b.obtainedAt);
  const points: CurvePoint[] = [];
  let c2 = 0;
  let c3 = 0;
  let c4 = 0;
  let index = 0;
  for (const instance of sorted) {
    const rarity = rarityOf.get(instance.cardId);
    if (rarity === undefined) continue;
    index += 1;
    if (rarity === 2) c2 += 1;
    else if (rarity === 3) c3 += 1;
    else c4 += 1;
    points.push({ index, at: instance.obtainedAt, c2, c3, c4 });
  }
  return { points, total: index };
}

/* -------------------------------- 组件 ------------------------------------ */

type DeckTab = 'deck' | 'inventory' | 'codex' | 'shop';

const TAB_BTN: CSSProperties = {
  padding: '6px 16px',
  borderRadius: 999,
  border: '1px solid rgba(124,92,255,0.45)',
  background: 'transparent',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13.5,
  letterSpacing: '0.08em',
};

interface GroupedCard {
  readonly card: CardDef;
  readonly count: number;
  readonly firstUid: string;
}

/** owned 实例按 cardId 归组（重复卡显示 ×n，激活用首个 uid） */
function groupOwned(owned: readonly CardInstance[]): readonly GroupedCard[] {
  const order: GroupedCard[] = [];
  const byId = new Map<string, GroupedCard>();
  for (const instance of owned) {
    const card = CARDS.find((c) => c.id === instance.cardId);
    if (card === undefined) continue;
    const seen = byId.get(card.id);
    if (seen === undefined) {
      const group: GroupedCard = { card, count: 1, firstUid: instance.uid };
      byId.set(card.id, group);
      order.push(group);
    } else {
      byId.set(card.id, { ...seen, count: seen.count + 1 });
    }
  }
  return order;
}

export function DeckPanel() {
  const activePanel = useGameStore((s) => s.activePanel);
  const locale = useGameStore((s) => s.locale);
  const owned = useGameStore((s) => s.gacha.owned);
  const activeLaws = useGameStore((s) => s.gacha.activeLaws);
  const starStones = useGameStore((s) => s.gacha.starStones);
  const totalPulls = useGameStore((s) => s.gacha.totalPulls);
  // A4-10：保底进度唯一真相在 s.pity（gacha 镜像字段已删），UI 直接读这里
  const pullsSinceFourStar = useGameStore((s) => s.pity.pullsSinceFourStar);
  const weaponId = useGameStore((s) => s.player.weaponId);

  const [tab, setTab] = useState<DeckTab>('deck');
  const [statsOpen, setStatsOpen] = useState(false);

  if (activePanel !== 'deck') return null;

  const store = useGameStore.getState;
  const grouped = groupOwned(owned);
  const curve = buildPullCurve(owned, CARDS);
  const equippedWeapon = weaponId !== null ? findWeapon(weaponId) : undefined;

  const cardRow = (group: GroupedCard, isActive: boolean, isOwned: boolean) => (
    <div
      key={group.card.id}
      className="glass"
      style={{
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderColor: rarityColor(group.card.rarity),
        opacity: isOwned ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: rarityColor(group.card.rarity), letterSpacing: '0.12em', fontSize: 13 }}>
          {rarityStars(group.card.rarity)}
        </span>
        <span style={{ fontWeight: 700 }}>{group.card.name}</span>
        <span className="chip" style={{ fontSize: 10.5, padding: '1px 8px' }}>
          {group.card.kind === 'law' ? tUi(locale, 'deck.lawCard') : tUi(locale, 'deck.characterCard')}
        </span>
        {group.count > 1 && (
          <span className="chip" style={{ fontSize: 10.5, padding: '1px 8px' }}>
            ×{group.count}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isOwned && (
          isActive ? (
            <span className="chip" style={{ color: 'var(--neon-cyan)', borderColor: 'rgba(0,229,255,0.5)' }}>
              ✓ {tUi(locale, 'deck.active')}
            </span>
          ) : (
            <button
              className="chip"
              style={{ cursor: 'pointer', color: 'var(--neon-gold)', borderColor: 'rgba(255,207,92,0.55)' }}
              onClick={() => store().applyLawCard(group.firstUid)}
            >
              {tUi(locale, 'ui.activate')}
            </button>
          )
        )}
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{group.card.description}</span>
      {group.card.kind === 'law' && isOwned && !isActive && (
        <span style={{ fontSize: 11.5, color: 'var(--neon-violet)' }}>{tUi(locale, 'deck.lawActivate')}</span>
      )}
      {group.card.kind === 'character' && group.card.buff !== undefined && (
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          {tUi(locale, 'deck.buff')}: {group.card.buff.buffId} +{group.card.buff.value} · {tUi(locale, 'deck.characterHint')}
        </span>
      )}
    </div>
  );

  const allCards = CARDS.map(
    (card): GroupedCard => ({
      card,
      count: owned.filter((o) => o.cardId === card.id).length,
      firstUid: owned.find((o) => o.cardId === card.id)?.uid ?? '',
    }),
  );

  /* 出货统计曲线（SVG 零依赖渲染） */
  const W = 340;
  const H = 120;
  const PAD = 8;
  const maxCount = curve.points.reduce((m, p) => Math.max(m, p.c2, p.c3, p.c4), 1);
  const px = (i: number, total: number) => PAD + (i / Math.max(1, total)) * (W - PAD * 2);
  const py = (c: number) => H - PAD - (c / maxCount) * (H - PAD * 2);
  const line = (pick: (p: CurvePoint) => number): string =>
    curve.points.map((p) => `${px(p.index, curve.total)},${py(pick(p))}`).join(' ');

  return (
    <motion.div
      /* L3：居中位移并入 motion 值 —— CSS transform 会被 motion 的 scale 动画
         整体覆盖（面板向屏幕中心右下溢出，✕ 关闭按钮落到视口外），详见
         LevelSelectPanel 同款注释 */
      initial={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
      animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
      transition={{ duration: 0.2 }}
      className="glass"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        zIndex: 40,
        width: 'min(720px, 94vw)',
        maxHeight: '84vh',
        overflowY: 'auto',
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* 头部：标题 + 持有数 + 关闭 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>{tUi(locale, 'tab.deck')}</h3>
        <span className="chip" style={{ fontSize: 11.5 }}>{tUi(locale, 'deck.ownedCount', { n: owned.length })}</span>
        <span style={{ flex: 1 }} />
        <button className="chip" style={{ cursor: 'pointer' }} onClick={() => store().closeOverlay()}>
          ✕ {tUi(locale, 'ui.close')}
        </button>
      </div>

      {/* 页签 */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['deck', 'inventory', 'codex', 'shop'] as const).map((key) => (
          <button
            key={key}
            style={{
              ...TAB_BTN,
              borderColor: tab === key ? 'var(--neon-cyan)' : undefined,
              color: tab === key ? 'var(--text-primary)' : undefined,
            }}
            onClick={() => setTab(key)}
          >
            {key === 'shop' ? tUi(locale, 'tab.shop') : tUi(locale, `tab.${key}`)}
          </button>
        ))}
      </div>

      {/* 卡组：真实持有实例，法则卡可激活 */}
      {tab === 'deck' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grouped.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{tUi(locale, 'deck.empty')}</p>}
          {grouped.map((group) => cardRow(group, activeLaws.includes(group.card.id), true))}
        </div>
      )}

      {/* 背包：星石 + 当前武器（只报真实持有）；武器图谱是标注过的全集目录 */}
      {tab === 'inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="glass" style={{ padding: '10px 14px', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ color: 'var(--neon-gold)' }}>
              ◈ {tUi(locale, 'deck.stones')} {starStones}
            </span>
            <span style={{ fontSize: 13 }}>
              {tUi(locale, 'combat.weapon')}：
              {equippedWeapon !== undefined ? (
                <b style={{ color: 'var(--neon-gold)' }}>
                  {equippedWeapon.name} +{equippedWeapon.attack}
                </b>
              ) : (
                tUi(locale, 'combat.unarmed')
              )}
            </span>
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tUi(locale, 'deck.weaponChart')}</span>
          {WEAPONS.map((w) => {
            const isEquipped = weaponId === w.id;
            const dropper = w.droppedBy !== undefined ? findEnemy(w.droppedBy) : undefined;
            return (
              <div key={w.id} className="glass" style={{ padding: '9px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ color: isEquipped ? 'var(--neon-gold)' : 'var(--text-primary)' }}>{w.name}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--neon-cyan)' }}>+{w.attack}</span>
                  {isEquipped ? (
                    <span className="chip" style={{ fontSize: 10.5, color: 'var(--neon-gold)' }}>{tUi(locale, 'deck.currentWeapon')}</span>
                  ) : (
                    <span className="chip" style={{ fontSize: 10.5 }}>{tUi(locale, 'deck.notEquipped')}</span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                    {tUi(locale, 'deck.dropFrom')}
                    {dropper !== undefined ? dropper.name : '—'}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{w.description}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 图鉴：全集目录（未持有半透明）+ 出货统计曲线入口 */}
      {tab === 'codex' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="chip"
              style={{ cursor: 'pointer', color: statsOpen ? 'var(--neon-cyan)' : 'var(--text-dim)' }}
              onClick={() => setStatsOpen((v) => !v)}
            >
              📈 {tUi(locale, 'deck.statsEntry')}
            </button>
            <span className="chip" style={{ fontSize: 11 }}>
              {tUi(locale, 'deck.totalPulls')}: {totalPulls}
            </span>
            <span className="chip" style={{ fontSize: 11 }}>
              {tUi(locale, 'deck.sinceFour')}: {pullsSinceFourStar}
            </span>
          </div>

          {statsOpen && (
            <div className="glass" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {curve.points.length === 0 ? (
                <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tUi(locale, 'deck.curveEmpty')}</span>
              ) : (
                <>
                  <svg width={W} height={H} style={{ maxWidth: '100%' }} role="img" aria-label={tUi(locale, 'deck.statsEntry')}>
                    <polyline points={line((p) => p.c2)} fill="none" stroke="var(--text-dim)" strokeWidth={1.6} />
                    <polyline points={line((p) => p.c3)} fill="none" stroke="var(--neon-violet)" strokeWidth={1.8} />
                    <polyline points={line((p) => p.c4)} fill="none" stroke="var(--neon-gold)" strokeWidth={2} />
                  </svg>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-dim)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>━ {tUi(locale, 'deck.curve2')}</span>
                    <span style={{ color: 'var(--neon-violet)' }}>━ {tUi(locale, 'deck.curve3')}</span>
                    <span style={{ color: 'var(--neon-gold)' }}>━ {tUi(locale, 'deck.curve4')}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {allCards.map((group) => cardRow(group, activeLaws.includes(group.card.id), group.count > 0))}
        </div>
      )}

      {/* 祭坛商店：碎片直购未持有法则卡（M4） */}
      {tab === 'shop' && <ShopPanel />}
    </motion.div>
  );
}
