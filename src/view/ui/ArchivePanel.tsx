/**
 * 帷幕界面层 · ArchivePanel —— 档案面板：图鉴 / 成就 / 双池出货曲线 / 逐抽记录。
 * ---------------------------------------------------------------------------
 * 数据全部来自两个已持久化的档案分片（只读消费，本组件零写动作）：
 *   - src/archive/logbook.ts 的 useLogbookStore：图鉴首获/次数、成就解锁时刻；
 *   - src/archive/statsCollector.ts 的 useStatsStore：逐抽历史、双池出货曲线。
 * 曲线纯函数 poolCurve / cumulativeFourStarCurve 在 statsCollector 已有，本组件
 * 只负责把它们画出来（SVG 零依赖，与 DeckPanel 的出货曲线同口径）。
 *
 * 开闭状态不占用 gameStore.activePanel（PanelId 契约在 core/types.ts，不在本模块
 * 地盘内，也不宜为此扩 core）——改用本文件自带的轻量 zustand 分片，HUD 按钮
 * 调 toggle()，面板自身读 open。
 *
 * 怀旧对照（M3）入口就在「双池曲线」页签：一键跑 runNostalgiaGacha()（store
 * 已接好，只写统计分片、不碰正式池），并把怀旧池与正式池累计 4★ 曲线并排。
 */

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { create } from 'zustand';
import { useGameStore } from '../../core/store/gameStore';
import { bus } from '../../core/events/bus';
import { useLogbookStore, type CodexCardEntry } from '../../archive/logbook';
import {
  POOL_NOSTALGIA,
  POOL_OFFICIAL,
  cumulativeFourStarCurve,
  poolCurve,
  useStatsStore,
  type CurvePoint,
  type PoolCurve,
  type PullRecord,
  type StatsState,
} from '../../archive/statsCollector';
import { CARDS } from '../../data/gacha';
import { ACHIEVEMENTS, type AchievementDef } from '../../data/lore/achievements';
import { NOSTALGIA_POOL_INFO, RATE_DISCLOSURE } from '../../data/gacha/pools';
import type { CardDef } from '../../core/types';
import { formatPercent, tUi } from '../../data/i18n/uiText';
import { rarityColor, rarityStars } from './GachaOverlay';

/* ============================== 面板开关分片 =============================== */

export type ArchiveTab = 'codex' | 'achievements' | 'curves' | 'history';

interface ArchivePanelStore {
  readonly open: boolean;
  readonly tab: ArchiveTab;
  toggle(): void;
  close(): void;
  setTab(tab: ArchiveTab): void;
}

export const useArchivePanelStore = create<ArchivePanelStore>()((set) => ({
  open: false,
  tab: 'codex',
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));

/* ============================== 纯逻辑导出 ================================= */

export interface CodexRow {
  readonly card: CardDef;
  readonly obtained: boolean;
  /** 首获时刻（ms）；未获得为 null */
  readonly firstSeenAt: number | null;
  readonly obtainedCount: number;
}

/** 图鉴行：全卡表 × 图鉴分片，未获得补零；按稀有度降序、同稀有度按 id 稳定排序 */
export function codexRows(
  codexCards: Readonly<Record<string, CodexCardEntry>>,
  cards: readonly CardDef[],
): readonly CodexRow[] {
  return cards
    .map((card): CodexRow => {
      const entry = codexCards[card.id];
      return entry === undefined
        ? { card, obtained: false, firstSeenAt: null, obtainedCount: 0 }
        : { card, obtained: true, firstSeenAt: entry.firstSeenAt, obtainedCount: entry.obtainedCount };
    })
    .sort((a, b) => b.card.rarity - a.card.rarity || a.card.id.localeCompare(b.card.id));
}

export interface AchievementRow {
  readonly def: AchievementDef;
  readonly unlocked: boolean;
  readonly unlockedAt: number | null;
  /** 隐藏成就未解锁时显示为「？？？」（secret 语义） */
  readonly displayTitle: string;
}

/** 成就行：解锁时刻并入；secret 未解锁遮罩标题 */
export function achievementRows(achievements: Readonly<Record<string, number>>): readonly AchievementRow[] {
  return ACHIEVEMENTS.map((def) => {
    const unlockedAt = achievements[def.id] ?? null;
    const unlocked = unlockedAt !== null;
    return { def, unlocked, unlockedAt, displayTitle: unlocked || def.secret !== true ? def.title : '？？？' };
  });
}

/** 逐抽记录：最新在前，最多取 limit 条（0/负值 = 空表） */
export function latestPulls(pullHistory: readonly PullRecord[], limit: number): readonly PullRecord[] {
  if (limit <= 0) return [];
  return pullHistory.slice(-limit).reverse();
}

/** 逐抽记录的可读标签：怀旧展品按稀有度标名；正式卡回落到卡名 */
export function pullLabel(record: PullRecord, cards: readonly CardDef[]): string {
  if (record.cardId.startsWith('nostalgia-star-')) {
    return record.rarity === 4 ? '怀旧展品·4★' : record.rarity === 3 ? '怀旧展品·3★' : '怀旧展品·2★';
  }
  return cards.find((c) => c.id === record.cardId)?.name ?? record.cardId;
}

export interface PoolComparison {
  readonly official: PoolCurve;
  readonly nostalgia: PoolCurve;
  readonly officialCurve: readonly CurvePoint[];
  readonly nostalgiaCurve: readonly CurvePoint[];
}

/** 双池对比：正式池 + 怀旧池的汇总与累计 4★ 曲线（复用 statsCollector 纯函数） */
export function poolComparison(state: StatsState): PoolComparison {
  return {
    official: poolCurve(state, POOL_OFFICIAL),
    nostalgia: poolCurve(state, POOL_NOSTALGIA),
    officialCurve: cumulativeFourStarCurve(state, POOL_OFFICIAL),
    nostalgiaCurve: cumulativeFourStarCurve(state, POOL_NOSTALGIA),
  };
}

/**
 * 累计 4★ 率曲线 → SVG polyline points。
 * 横轴按最大累计抽数归一，纵轴按 maxRate（本组曲线观测上限，至少 1）归一。
 * 空曲线返回空串（UI 层渲染空态文案，不画零长度折线）。
 */
export function curvePolyline(
  points: readonly CurvePoint[],
  width: number,
  height: number,
  pad: number,
  maxRate: number,
): string {
  if (points.length === 0) return '';
  const maxPulls = points.reduce((m, p) => Math.max(m, p.pulls), 1);
  const domain = maxRate > 0 ? maxRate : 1;
  const px = (pulls: number) => pad + (pulls / maxPulls) * (width - pad * 2);
  const py = (rate: number) => height - pad - Math.min(1, rate / domain) * (height - pad * 2);
  return points.map((p) => `${px(p.pulls)},${py(p.fourStarRate)}`).join(' ');
}

function formatAt(at: number): string {
  return new Date(at).toLocaleString();
}
function rateText(rate: number | null): string {
  return rate === null ? '—' : formatPercent(rate);
}

/* ============================== 曲线小件 =================================== */

const CURVE_W = 340;
const CURVE_H = 120;
const CURVE_PAD = 8;

/** 逐抽记录最多展示条数（底层分片上限 5000，这里只取最近一段） */
const HISTORY_LIMIT = 80;

interface RateCurveProps {
  readonly official: PoolCurve;
  readonly nostalgia: PoolCurve;
  readonly officialCurve: readonly CurvePoint[];
  readonly nostalgiaCurve: readonly CurvePoint[];
}

function RateCurve({ official, nostalgia, officialCurve, nostalgiaCurve }: RateCurveProps) {
  const maxRate = Math.max(
    0.2,
    ...officialCurve.map((p) => p.fourStarRate),
    ...nostalgiaCurve.map((p) => p.fourStarRate),
  );
  const empty = officialCurve.length === 0 && nostalgiaCurve.length === 0;

  return (
    <div className="glass" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, flexWrap: 'wrap' }}>
        <span>
          <b style={{ color: 'var(--neon-gold)' }}>正式池</b>：{official.pulls} 抽 · 4★ 率 {rateText(official.fourStarRate)} · 3★+ 率{' '}
          {rateText(official.threeStarPlusRate)}
        </span>
        <span>
          <b style={{ color: 'var(--neon-violet)' }}>怀旧池</b>：{nostalgia.pulls} 抽 · 4★ 率 {rateText(nostalgia.fourStarRate)} · 3★+ 率{' '}
          {rateText(nostalgia.threeStarPlusRate)}
        </span>
      </div>
      {empty ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          尚无出货记录 —— 正式池由抽卡自动记录，怀旧池点下方按钮跑一回十连即可生成对照数据。
        </span>
      ) : (
        <svg width={CURVE_W} height={CURVE_H} style={{ maxWidth: '100%' }} role="img" aria-label="双池累计 4★ 出货率曲线">
          <polyline points={curvePolyline(officialCurve, CURVE_W, CURVE_H, CURVE_PAD, maxRate)} fill="none" stroke="var(--neon-gold)" strokeWidth={2} />
          <polyline points={curvePolyline(nostalgiaCurve, CURVE_W, CURVE_H, CURVE_PAD, maxRate)} fill="none" stroke="var(--neon-violet)" strokeWidth={2} />
        </svg>
      )}
      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-dim)' }}>
        <span style={{ color: 'var(--neon-gold)' }}>━ 正式池</span>
        <span style={{ color: 'var(--neon-violet)' }}>━ 怀旧池（对照展品）</span>
      </div>
    </div>
  );
}

/* ============================== 面板主体 =================================== */

export function ArchivePanel() {
  const open = useArchivePanelStore((s) => s.open);
  const tab = useArchivePanelStore((s) => s.tab);
  const setTab = useArchivePanelStore((s) => s.setTab);
  const close = useArchivePanelStore((s) => s.close);

  const locale = useGameStore((s) => s.locale);
  const codexCards = useLogbookStore((s) => s.codexCards);
  const achievements = useLogbookStore((s) => s.achievements);
  const stats = useStatsStore((s) => s);

  // Esc / closeOverlay 经总线统一关闭本面板（键位表承诺「Esc 关闭浮层」）
  useEffect(
    () =>
      bus.subscribe((e) => {
        if (e.type === 'ui/closePanels') close();
      }),
    [close],
  );

  if (!open) return null;

  const store = useGameStore.getState;
  const rows = codexRows(codexCards, CARDS);
  const achRows = achievementRows(achievements);
  const comparison = poolComparison(stats);
  const history = latestPulls(stats.pullHistory, HISTORY_LIMIT);
  const unlockedCount = achRows.filter((r) => r.unlocked).length;

  const tabKeys: readonly ArchiveTab[] = ['codex', 'achievements', 'curves', 'history'];
  const tabLabel: Record<ArchiveTab, string> = {
    codex: '图鉴',
    achievements: '成就',
    curves: '双池曲线',
    history: '逐抽记录',
  };

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
        zIndex: 45,
        width: 'min(760px, 94vw)',
        maxHeight: '84vh',
        overflowY: 'auto',
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>档案</h3>
        <span className="chip" style={{ fontSize: 11.5 }}>
          图鉴 {Object.keys(codexCards).length}/{CARDS.length} · 成就 {unlockedCount}/{achRows.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="chip" style={{ cursor: 'pointer' }} onClick={close}>
          ✕ {tUi(locale, 'ui.close')}
        </button>
      </div>

      {/* 页签 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabKeys.map((key) => (
          <button
            key={key}
            className="chip"
            style={{
              cursor: 'pointer',
              borderColor: tab === key ? 'var(--neon-cyan)' : undefined,
              color: tab === key ? 'var(--text-primary)' : undefined,
            }}
            onClick={() => setTab(key)}
          >
            {tabLabel[key]}
          </button>
        ))}
      </div>

      {/* 图鉴：首获 / 获得次数 */}
      {tab === 'codex' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>全卡表目录 —— 首获时刻与累计获得次数（未获得显示为暗色）。</span>
          {rows.map((row) => (
            <div
              key={row.card.id}
              className="glass"
              style={{
                padding: '9px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                borderColor: rarityColor(row.card.rarity),
                opacity: row.obtained ? 1 : 0.5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: rarityColor(row.card.rarity), letterSpacing: '0.12em', fontSize: 12 }}>
                  {rarityStars(row.card.rarity)}
                </span>
                <span style={{ fontWeight: 700 }}>{row.card.name}</span>
                <span className="chip" style={{ fontSize: 10.5, padding: '1px 8px' }}>
                  {row.card.kind === 'law' ? tUi(locale, 'deck.lawCard') : tUi(locale, 'deck.characterCard')}
                </span>
                <span style={{ flex: 1 }} />
                {row.obtained ? (
                  <span style={{ fontSize: 11.5, color: 'var(--neon-cyan)' }}>
                    首获 {formatAt(row.firstSeenAt ?? 0)} · 获得 {row.obtainedCount} 次
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>未获得</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{row.card.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* 成就列表 */}
      {tab === 'achievements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>成就（{unlockedCount}/{achRows.length}）—— 隐藏成就解锁前显示为「？？？」。</span>
          {achRows.map((row) => (
            <div key={row.def.id} className="glass" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4, opacity: row.unlocked ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: row.unlocked ? 'var(--neon-gold)' : 'var(--text-primary)' }}>{row.displayTitle}</span>
                <span style={{ flex: 1 }} />
                {row.unlocked ? (
                  <span className="chip" style={{ fontSize: 10.5, color: 'var(--neon-cyan)', borderColor: 'rgba(0,229,255,0.5)' }}>
                    ✓ 已解锁 · {formatAt(row.unlockedAt ?? 0)}
                  </span>
                ) : (
                  <span className="chip" style={{ fontSize: 10.5 }}>{row.def.secret === true ? '隐藏成就' : '未解锁'}</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {row.unlocked || row.def.secret !== true ? row.def.description : '继续探索，谜底自会揭晓。'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 双池出货曲线 + 怀旧对照入口（M3） */}
      {tab === 'curves' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RateCurve
            official={comparison.official}
            nostalgia={comparison.nostalgia}
            officialCurve={comparison.officialCurve}
            nostalgiaCurve={comparison.nostalgiaCurve}
          />
          <div className="glass" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-neon" style={{ padding: '0.5em 1.4em' }} onClick={() => store().runNostalgiaGacha()}>
                🎰 跑一回怀旧对照十连
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>不消耗星石、不产出可用卡，只更新怀旧池实测曲线。</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--neon-violet)' }}>
              {NOSTALGIA_POOL_INFO.name} —— 这是原作 {NOSTALGIA_POOL_INFO.source} 行为的对照展品，仅供概率对照。
            </span>
            {RATE_DISCLOSURE.nostalgia.lines.map((line) => (
              <span key={line} style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                · {line}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 逐抽记录列表 */}
      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            逐抽记录（最新 {history.length} 条；最多保留 5000 条，超出自动裁剪最旧）。
          </span>
          {history.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>尚无逐抽记录 —— 去星愿祭坛抽几发试试。</span>
          ) : (
            history.map((record) => {
              const label = pullLabel(record, CARDS);
              return (
                <div key={record.uid} className="glass" style={{ padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="chip" style={{ fontSize: 10.5, padding: '1px 8px' }}>
                    #{record.pullIndex}
                  </span>
                  <span className="chip" style={{ fontSize: 10.5, color: record.poolId === POOL_NOSTALGIA ? 'var(--neon-violet)' : 'var(--neon-cyan)' }}>
                    {record.poolId === POOL_NOSTALGIA ? '怀旧池' : '正式池'}
                  </span>
                  <span style={{ color: rarityColor(record.rarity), letterSpacing: '0.12em', fontSize: 12 }}>{rarityStars(record.rarity)}</span>
                  <span style={{ fontSize: 13 }}>{label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{formatAt(record.at)}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </motion.div>
  );
}
