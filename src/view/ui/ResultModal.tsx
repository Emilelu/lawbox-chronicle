/**
 * 帷幕界面层 · ResultModal —— 星级 / 步数 / 掉落结算弹窗。
 * ---------------------------------------------------------------------------
 * S11「终局锁死」的根治形态：
 *  - 背板 pointer-events:none：弹窗开着也不遮挡世界与菜单（菜单永可用）；
 *  - 右上 ✕ / 任意按钮 / dispatch closeOverlay 均可关闭，关闭即回 playing；
 *  - 无全屏暗幕、无强制点击。
 * 文案沿用遗产字典：legacy.levelPassed / legacy.congratulations（原文含 <br>，
 * 展示层经 stripBr 净化为换行）/ legacy.replay（重玩按钮）。
 * 奖励数字不经 UI 口算：星级→星石走 core/formula.starStoneReward（与 store
 * 结算同源，K14「README 与代码不一致」类偏差无处发生）。
 */

import { motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { starStoneReward } from '../../core/formula';
import { CARDS, findLevel } from '../../data';
import type { LevelDef } from '../../core/types';
import { stripBr, tUi } from '../../data/i18n/uiText';
import { rarityColor } from './GachaOverlay';

/* ------------------------------ 纯逻辑导出 -------------------------------- */

export interface ResultSummary {
  readonly levelId: string;
  readonly levelName: string;
  readonly stars: 1 | 2 | 3;
  readonly steps: number;
  /** 三星线（parSteps[0]），用于「三星线 n 步」展示 */
  readonly parThreeStar: number;
  /** store 结算同源：stars × 基础奖励 */
  readonly rewardStones: number;
  /** 关卡奖励的法则卡名（无则 null） */
  readonly lawCardName: string | null;
  readonly lawCardRarity: 2 | 3 | 4 | null;
}

/**
 * 结算摘要（纯函数）：result + 关卡查找器 → 展示模型。
 * 关卡缺失（坏档/未知 levelId）返回 null，由组件走兜底文案。
 */
export function summarizeResult(
  result: { readonly levelId: string; readonly stars: 1 | 2 | 3; readonly steps: number },
  findLevelById: (id: string) => LevelDef | undefined,
): ResultSummary | null {
  const level = findLevelById(result.levelId);
  if (level === undefined) return null;
  const lawCardId = level.reward.lawCardId;
  const lawCard = lawCardId !== undefined ? CARDS.find((c) => c.id === lawCardId) : undefined;
  return {
    levelId: level.id,
    levelName: level.name,
    stars: result.stars,
    steps: result.steps,
    parThreeStar: level.parSteps[0],
    rewardStones: starStoneReward(result.stars, level.reward.starStones),
    lawCardName: lawCard?.name ?? null,
    lawCardRarity: lawCard?.rarity ?? null,
  };
}

/* -------------------------------- 组件 ------------------------------------ */

export function ResultModal() {
  const result = useGameStore((s) => s.result);
  const locale = useGameStore((s) => s.locale);

  if (result === null) return null;

  const store = useGameStore.getState;
  const summary = summarizeResult(result, findLevel);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.86, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20 }}
        className="glass"
        style={{
          pointerEvents: 'auto',
          width: 'min(430px, 92vw)',
          padding: '22px 26px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
          <span className="chip" style={{ fontSize: 11 }}>{tUi(locale, 'result.stars')}</span>
          <span style={{ flex: 1 }} />
          <button
            className="chip"
            style={{ cursor: 'pointer' }}
            onClick={() => store().closeOverlay()}
            title={tUi(locale, 'ui.close')}
          >
            ✕
          </button>
        </div>

        {summary === null ? (
          /* 坏档兜底：未知 levelId 也不锁死，可关可重玩 */
          <>
            <h3 style={{ fontSize: 22 }}>{stripBr(tUi(locale, 'legacy.congratulations')).split('\n')[0]}</h3>
            <button className="btn-neon" onClick={() => store().closeOverlay()}>
              {tUi(locale, 'ui.continue')}
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 34, letterSpacing: '0.3em', color: 'var(--neon-gold)', textShadow: '0 0 18px rgba(255,207,92,0.45)' }}>
              {'★'.repeat(summary.stars)}
            </span>
            <h3 style={{ fontSize: 21, letterSpacing: '0.1em' }}>{tUi(locale, 'legacy.levelPassed')}</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 13.5 }}>{summary.levelName}</p>

            <div style={{ display: 'flex', gap: 22, fontSize: 14 }}>
              <span>
                {tUi(locale, 'result.steps')}：<b>{summary.steps}</b>
              </span>
              <span style={{ color: 'var(--text-dim)' }}>{tUi(locale, 'result.par', { n: summary.parThreeStar })}</span>
            </div>

            <div className="glass" style={{ padding: '9px 18px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>{tUi(locale, 'result.reward')}</span>
              <span style={{ color: 'var(--neon-gold)' }}>◈ +{summary.rewardStones}</span>
              {summary.lawCardName !== null && (
                <span>
                  {tUi(locale, 'result.lawCard')}：
                  <b style={{ color: rarityColor(summary.lawCardRarity ?? 2) }}>{summary.lawCardName}</b>
                </span>
              )}
            </div>

            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
              {stripBr(tUi(locale, 'legacy.congratulations'))}
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
              {/* 重玩 = 真实 reducer：replaySegment 重建段内实体（S2 悬挂引用根治形态） */}
              <button className="btn-neon" onClick={() => store().replaySegment()}>
                ⟲ {tUi(locale, 'legacy.replay')}
              </button>
              <button className="chip" style={{ cursor: 'pointer', padding: '0.6em 1.4em' }} onClick={() => store().closeOverlay()}>
                {tUi(locale, 'ui.continue')} ▸
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
