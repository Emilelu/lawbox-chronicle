/**
 * 帷幕界面层 · GachaOverlay —— 星愿祭坛全屏抽卡：投币 → 5×2 翻牌 → 稀有度光柱 → 跳过。
 * ---------------------------------------------------------------------------
 * 老缺陷在结构上的归宿：
 *  - Lottery.java:25「当前的星石数：∞」→ 展示 store.gacha.starStones 真实余额（BT6）；
 *  - Lottery.java:26「★KiraKira~★DokiDoki~★」→ GACHA_FLAVOR.banner 原文案保留，
 *    作为横幅与 4★ 星爆的演出台词；
 *  - Lottery.java:36 被注释的 Thread.sleep(500) → 变成真实的翻牌演出节奏
 *    （flipDelays：首张 420ms 起翻、张间 340ms，落在融合计划的 300-800ms 区间）；
 *  - 十连 5×2 排版沿用 Lottery.java:74-79（k==5 换行）的视觉记忆，但逐卡独立
 *    翻开（B3：原版整组一次 roll 的语义由 gacha-engine 逐卡化）。
 * 无常驻定时器：翻牌/星爆全是一次性 setTimeout，随 effect 清理。
 * 概率公示数字全部由 GACHA_CONFIG 现算（B4：pity 进度可视化 + 概率明示）。
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { CARDS, GACHA_CONFIG, GACHA_FLAVOR } from '../../data/gacha';
import type { CardDef, GachaPullResult, Rarity } from '../../core/types';
import { cardName, formatPercent, tUi } from '../../data/i18n/uiText';
import chestImg from '../../assets/imgs/items/chest.png';

/* ------------------------------ 纯逻辑导出 -------------------------------- */

/**
 * 翻牌节奏表（Lottery.java:36 注释掉的 sleep(500) 的真演出化）。
 * 返回每张卡「开始翻开」的毫秒时刻：首张 420ms，之后每张 +340ms；
 * 两相邻值都落在融合计划的 300-800ms 演出区间。
 */
export function flipDelays(count: number): readonly number[] {
  const FIRST_BEAT_MS = 420;
  const STAGGER_MS = 340;
  const beats: number[] = [];
  for (let i = 0; i < count; i++) beats.push(FIRST_BEAT_MS + i * STAGGER_MS);
  return beats;
}

/** 层2硬保底进度：pullsSinceFourStar / hardFourStar，clamp 到 [0,1] */
export function pityProgress(pullsSinceFourStar: number, hardFourStar: number): number {
  if (hardFourStar <= 0) return 0;
  const ratio = pullsSinceFourStar / hardFourStar;
  return Math.max(0, Math.min(1, ratio));
}

/** 批次价格：单抽按单价，十连按 9 折（BT6：单抽 100 / 十连 900） */
export function pullCost(times: 1 | 10, costPerPull: number): number {
  return times === 10 ? Math.round(costPerPull * times * 0.9) : costPerPull;
}

/** 抽不抽得起：星石 ≥ 批次价格 */
export function canPull(starStones: number, times: 1 | 10, costPerPull: number): boolean {
  return starStones >= pullCost(times, costPerPull);
}

/** 稀有度主色（DeckPanel / LawQuickBar 共用，避免三处各写一份色表） */
export function rarityColor(rarity: Rarity): string {
  if (rarity === 4) return 'var(--neon-gold)';
  if (rarity === 3) return 'var(--neon-violet)';
  return 'var(--text-dim)';
}

/** 星级行：原版 stars 数组（Lottery.java:30）的右对齐空格在 HTML 里失去意义，改为居中实星 */
export function rarityStars(rarity: Rarity): string {
  return '★'.repeat(rarity);
}

/**
 * F1：翻牌面准入判定。lastResult 是持久化分片（刷新后仍在），若「有结果就渲染
 * 翻牌面」，重开面板将永远停在旧结果上，单抽/十连主页不可达（同一存档无法二次
 * 抽卡）。正确口径：只有「本次投币刚开出、尚未看过」的结果才进翻牌面；看过的
 * 结果重开一律回投币主页。
 */
export function shouldEnterReveal(lastResult: GachaPullResult | null, alreadySeen: boolean): boolean {
  return lastResult !== null && !alreadySeen;
}

function cardById(cardId: string): CardDef | undefined {
  return CARDS.find((c) => c.id === cardId);
}

/** 已看过的抽卡结果：同一结果重新打开面板时不再重播演出（会话级 UI 状态，非游戏真相） */
const seenResults = new WeakSet<GachaPullResult>();

/* -------------------------------- 组件 ------------------------------------ */

export function GachaOverlay() {
  const activePanel = useGameStore((s) => s.activePanel);
  const phase = useGameStore((s) => s.phase);
  const locale = useGameStore((s) => s.locale);
  const starStones = useGameStore((s) => s.gacha.starStones);
  // A4-10：保底进度唯一真相在 s.pity（gacha 镜像字段已删），进度条直接读这里
  const pullsSinceFourStar = useGameStore((s) => s.pity.pullsSinceFourStar);
  const lastResult = useGameStore((s) => s.gacha.lastResult);

  const [revealed, setRevealed] = useState(0);
  const [burstIndex, setBurstIndex] = useState<number | null>(null);
  // F1：本次投币正在展示的结果（仅新结果进入翻牌面时置位）。注意本组件在
  // UiOverlaySuite 中常驻挂载（不可见时仅返回 null，不卸载）——「组件卸载即
  // 状态消失」并不成立，关闭清空由下方 effect 显式执行：重开面板对「看过的
  // 旧 lastResult」回落投币主页，单抽/十连入口不再被锁死
  const [revealResult, setRevealResult] = useState<GachaPullResult | null>(null);

  const visible = activePanel === 'gacha' || (phase === 'gacha' && activePanel === 'none');

  const store = useGameStore.getState;
  const pulls = revealResult?.pulls ?? [];
  const allRevealed = pulls.length > 0 && revealed >= pulls.length;

  // 翻牌调度：新结果逐张起翻；看过的结果不进翻牌面（F1，重开回投币主页）。
  // 注意：effect 必须无条件调用（Rules of Hooks），隐藏时在内部短路。
  useEffect(() => {
    if (!visible || lastResult === null) return;
    if (!shouldEnterReveal(lastResult, seenResults.has(lastResult))) return;
    seenResults.add(lastResult);
    setRevealResult(lastResult);
    setRevealed(0);
    const timers = flipDelays(lastResult.pulls.length).map((delay, i) =>
      setTimeout(() => setRevealed((n) => Math.max(n, i + 1)), delay),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [visible, lastResult]);

  // F1：面板关闭即清空翻牌会话态。上方准入 effect 只拦「看过的结果再次进入」，
  // 不会清既有 revealResult —— 组件不卸载时重开面板会残留上一次的翻牌面，
  // 投币主页（单抽/十连入口）依旧不可达。这里显式复位，补齐「关闭即消失」。
  useEffect(() => {
    if (visible) return;
    setRevealResult(null);
    setRevealed(0);
    setBurstIndex(null);
  }, [visible]);

  // 稀有度光柱/星爆：翻开 3★ 时紫柱一闪，4★ 时金柱 + KiraKira 星爆
  useEffect(() => {
    if (!visible || revealResult === null || revealed === 0) return;
    const idx = revealed - 1;
    const pull = revealResult.pulls[idx];
    if (pull === undefined || pull.rarity < 3) return;
    setBurstIndex(idx);
    const timer = setTimeout(() => setBurstIndex(null), pull.rarity === 4 ? 1600 : 900);
    return () => clearTimeout(timer);
  }, [visible, revealed, revealResult]);

  if (!visible) return null;

  const skip = () => setRevealed(pulls.length);

  /* ---- 投币面（尚未开抽 / 打开面板即见） ---- */
  const coinScreen = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
      <span className="chip" style={{ color: 'var(--neon-gold)', borderColor: 'rgba(255,207,92,0.55)', fontSize: 14 }}>
        {GACHA_FLAVOR.banner}
      </span>
      <h2 className="neon-text" style={{ fontSize: 30, letterSpacing: '0.2em' }}>
        {tUi(locale, 'gacha.title')}
      </h2>
      {/* Lottery.java:25 的 ∞ 在此换成 store 真实余额（BT6） */}
      <p style={{ color: 'var(--neon-gold)', fontSize: 17, letterSpacing: '0.08em' }}>
        {tUi(locale, 'gacha.balance')}：{starStones} {tUi(locale, 'common.stoneUnit')}
      </p>

      <div style={{ display: 'flex', gap: 14 }}>
        {([1, 10] as const).map((times) => {
          const affordable = canPull(starStones, times, GACHA_CONFIG.costPerPull);
          return (
            <button
              key={times}
              className="btn-neon"
              disabled={!affordable}
              title={affordable ? undefined : tUi(locale, 'gacha.insufficient')}
              onClick={() => store().rollGacha(times)}
            >
              {times === 1 ? tUi(locale, 'gacha.roll1') : tUi(locale, 'gacha.roll10')} ·{' '}
              {pullCost(times, GACHA_CONFIG.costPerPull)}
              {tUi(locale, 'common.stoneUnit')}
            </button>
          );
        })}
      </div>

      {/* 概率公示（B4：数字由 GACHA_CONFIG 现算，不在 UI 硬编码） */}
      <div className="glass" style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 320 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tUi(locale, 'gacha.rates')}</span>
        <span style={{ fontSize: 13 }}>
          {tUi(locale, 'gacha.base')}：4★ {formatPercent(GACHA_CONFIG.baseRates.fourStar)} · 3★{' '}
          {formatPercent(GACHA_CONFIG.baseRates.threeStar)}
        </span>
        {GACHA_CONFIG.everyNthBoost.rates.fourStar > 0 || GACHA_CONFIG.everyNthBoost.rates.threeStar > 0 ? (
          <span style={{ fontSize: 13 }}>
            {tUi(locale, 'gacha.boost', { n: GACHA_CONFIG.everyNthBoost.every })}：4★{' '}
            {formatPercent(GACHA_CONFIG.everyNthBoost.rates.fourStar)} · 3★{' '}
            {formatPercent(GACHA_CONFIG.everyNthBoost.rates.threeStar)}
          </span>
        ) : null}
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tUi(locale, 'gacha.tenBonus')}</span>
      </div>

      {/* 层2硬保底进度条（pity 可视化） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 320 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)' }}>
          <span>{tUi(locale, 'gacha.pity')}</span>
          <span>
            {pullsSinceFourStar}/{GACHA_CONFIG.pity.hardFourStar} {tUi(locale, 'gacha.pityUnit')}
            {pullsSinceFourStar >= GACHA_CONFIG.pity.hardFourStar ? ` · ${tUi(locale, 'gacha.pityMax')}` : ''}
          </span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'rgba(139,147,184,0.25)', overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${pityProgress(pullsSinceFourStar, GACHA_CONFIG.pity.hardFourStar) * 100}%` }}
            transition={{ duration: 0.4 }}
            style={{ height: '100%', background: 'linear-gradient(90deg, var(--neon-violet), var(--neon-gold))' }}
          />
        </div>
      </div>

      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tUi(locale, 'gacha.detail')}</span>
    </div>
  );

  /* ---- 翻牌面 ---- */
  const isTenPull = pulls.length >= 10;
  const revealScreen = (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}>
      <button className="chip" style={{ cursor: 'pointer', position: 'absolute', top: -34, right: 0 }} onClick={skip}>
        ⏭ {tUi(locale, 'ui.skip')}
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isTenPull ? 'repeat(5, minmax(0, 1fr))' : 'repeat(1, 176px)',
          gap: 12,
          width: isTenPull ? 'min(680px, 92vw)' : 'auto',
        }}
      >
        {pulls.map((pull, i) => {
          const card = cardById(pull.cardId);
          const isRevealed = i < revealed;
          const showBurst = burstIndex === i;
          return (
            <div key={pull.uid} style={{ position: 'relative', aspectRatio: '3 / 4.1' }}>
              {/* 稀有度光柱（3★紫 / 4★金，翻开的瞬间亮起） */}
              <AnimatePresence>
                {isRevealed && showBurst && pull.rarity >= 3 && (
                  <motion.div
                    initial={{ opacity: 0, scaleY: 0.3 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: '18%',
                      width: '150%',
                      height: '420%',
                      transform: 'translateX(-50%)',
                      transformOrigin: 'bottom center',
                      background:
                        pull.rarity === 4
                          ? 'linear-gradient(to top, rgba(255,207,92,0.55), rgba(255,207,92,0.06) 72%, transparent)'
                          : 'linear-gradient(to top, rgba(124,92,255,0.5), rgba(124,92,255,0.05) 72%, transparent)',
                      borderRadius: 999,
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                  />
                )}
              </AnimatePresence>

              {isRevealed ? (
                <motion.div
                  initial={{ rotateY: 92, opacity: 0.4 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  transition={{ duration: 0.32, ease: 'easeOut' }}
                  className="glass"
                  style={{
                    position: 'relative',
                    zIndex: 2,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: 6,
                    borderColor: rarityColor(pull.rarity),
                    boxShadow: pull.rarity >= 3 ? `0 0 18px ${pull.rarity === 4 ? 'rgba(255,207,92,0.35)' : 'rgba(124,92,255,0.35)'}` : undefined,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ color: rarityColor(pull.rarity), letterSpacing: '0.18em', fontSize: isTenPull ? 12 : 18 }}>
                    {rarityStars(pull.rarity)}
                  </span>
                  {/* C4：卡名按语种解析（抽卡揭示面此前恒显示数据层中文卡名） */}
                  <span style={{ fontSize: isTenPull ? 12.5 : 15, lineHeight: 1.4 }}>
                    {card !== undefined ? cardName(locale, card) : pull.cardId}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                    {card?.kind === 'law' ? tUi(locale, 'deck.lawCard') : card?.kind === 'character' ? tUi(locale, 'deck.characterCard') : ''}
                  </span>
                  <span
                    className="chip"
                    style={{
                      fontSize: 9.5,
                      padding: '1px 7px',
                      color: pull.isNew ? 'var(--neon-cyan)' : 'var(--text-dim)',
                    }}
                  >
                    {pull.isNew ? tUi(locale, 'gacha.new') : tUi(locale, 'gacha.duplicate')}
                  </span>
                </motion.div>
              ) : (
                <motion.button
                  onClick={() => setRevealed((n) => Math.max(n, i + 1))}
                  className="glass"
                  style={{
                    width: '100%',
                    height: '100%',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  whileHover={{ scale: 1.03 }}
                >
                  <img src={chestImg} alt="?" style={{ width: '52%', opacity: 0.85 }} />
                </motion.button>
              )}

              {/* 4★ 星爆：★KiraKira~★DokiDoki~★（Lottery.java:26 原文案） */}
              <AnimatePresence>
                {isRevealed && showBurst && pull.rarity === 4 && (
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 1.15 }}
                    transition={{ duration: 0.45 }}
                    style={{
                      position: 'absolute',
                      inset: '-40% -70%',
                      zIndex: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        letterSpacing: '0.2em',
                        color: 'var(--neon-gold)',
                        textShadow: '0 0 14px rgba(255,207,92,0.9), 0 0 30px rgba(255,207,92,0.5)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {GACHA_FLAVOR.banner}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn-neon" style={{ padding: '0.5em 1.6em' }} onClick={() => store().closeOverlay()}>
          {tUi(locale, 'ui.continue')}
        </button>
        <button className="chip" style={{ cursor: 'pointer' }} onClick={() => store().openPanel('deck')}>
          {tUi(locale, 'ui.viewDeck')}
        </button>
        {!allRevealed && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tUi(locale, 'gacha.flipHint')}</span>}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'radial-gradient(900px 560px at 50% 12%, rgba(124,92,255,0.16), transparent 65%), rgba(5,8,18,0.82)',
        overflowY: 'auto',
      }}
    >
      {/* F1：新结果进翻牌面；重开面板对看过的旧结果回落投币主页（保住单抽/十连入口） */}
      {revealResult !== null ? revealScreen : coinScreen}
    </motion.div>
  );
}
