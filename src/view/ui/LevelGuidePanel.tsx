/**
 * 席卷界面层 · LevelGuidePanel —— 每关攻略面板。
 * ---------------------------------------------------------------------------
 * 内容 = data/levels/levelGuide.buildLevelGuide(levelId)：twist（置顶新机制行）+
 * 机制提示 + 法则门 + 星级线 + 奖励 + 预计算推法序列（与 docs/game-guide.html 同源同真相）。
 * 入口：HUD 左上「💡 攻略」（当前关）与选关面板每行的「💡 攻略」。
 * 定位沿用 L3 教训：居中位移并入 motion 的 x/y 百分比，绝不用 CSS transform。
 * Esc / closeOverlay 经总线统一关闭本面板（A4-3：此前漏订阅 ui/closePanels，
 * 键位表「Esc 关闭浮层」对攻略面板失效）；openFor 打开时广播同事件完成
 * 三分片面板互斥（A4-4，与档案/选关面板互不叠开）。
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import { buildLevelGuide } from '../../data/levels/levelGuide';
import { bus } from '../../core/events/bus';
import { useGameStore } from '../../core/store/gameStore';
import { tUi } from '../../data/i18n/uiText';

/* ============================== 面板开关分片 =============================== */

interface GuidePanelStore {
  readonly open: boolean;
  readonly levelId: string | null;
  openFor(levelId: string): void;
  close(): void;
}

export const useGuidePanelStore = create<GuidePanelStore>()((set) => ({
  open: false,
  levelId: null,
  // A4-4 互斥：先广播 ui/closePanels（关掉档案/选关等其它分片面板），再开自己。
  // 广播同步送达订阅者，本面板即便已开也会先 close 再 set open，终态正确。
  openFor: (levelId) => {
    bus.publish({ type: 'ui/closePanels' });
    set({ open: true, levelId });
  },
  close: () => set({ open: false }),
}));

/* ================================= 组件 ==================================== */

export function LevelGuidePanel() {
  const open = useGuidePanelStore((s) => s.open);
  const levelId = useGuidePanelStore((s) => s.levelId);
  const close = useGuidePanelStore((s) => s.close);
  const locale = useGameStore((s) => s.locale);

  // Esc / closeOverlay 经总线统一关闭本面板（A4-3：与 ArchivePanel 同款订阅）
  useEffect(
    () =>
      bus.subscribe((e) => {
        if (e.type === 'ui/closePanels') close();
      }),
    [close],
  );

  if (!open || levelId === null) return null;

  const guide = buildLevelGuide(levelId);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
        animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
        exit={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
        transition={{ duration: 0.2 }}
        className="glass"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          zIndex: 46,
          width: 'min(600px, 94vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>{tUi(locale, 'guide.entry')} · {guide.name}</h3>
          <span style={{ flex: 1 }} />
          <button className="chip" style={{ cursor: 'pointer' }} onClick={close}>
            ✕ {tUi(locale, 'ui.close')}
          </button>
        </div>

        {/* twist 行置顶（LEVEL_TWISTS 数据层唯一文字源）：显式 normal/word-break 防长句溢出 */}
        {guide.twist !== null && (
          <div
            data-guide-twist=""
            style={{
              border: '1px solid rgba(124, 92, 255, 0.45)',
              borderRadius: 8,
              background: 'rgba(124, 92, 255, 0.08)',
              padding: '7px 10px',
              fontSize: 12.5,
              lineHeight: 1.55,
              color: 'var(--neon-violet)',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            }}
          >
            ✦ {guide.twist}
          </div>
        )}

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{guide.subtitle}</span>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {guide.known && (
            <>
              <span className="chip" style={{ fontSize: 11, color: 'var(--neon-gold)', borderColor: 'rgba(255,207,92,0.5)' }}>
                ★★★ ≤ {guide.stars.three} 步
              </span>
              <span className="chip" style={{ fontSize: 11 }}>
                ★★ ≤ {guide.stars.two} 步
              </span>
            </>
          )}
          <span className="chip" style={{ fontSize: 11, color: 'var(--neon-cyan)', borderColor: 'rgba(0,229,255,0.5)' }}>
            {tUi(locale, 'guide.reward')} {guide.rewardText}
          </span>
        </div>

        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: 1.6 }}>
          {guide.mechanics.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>

        {guide.gateHint !== null && (
          <div className="chip" style={{ fontSize: 11.5, padding: '6px 10px', lineHeight: 1.5 }}>
            🎫 {guide.gateHint}
          </div>
        )}

        {guide.known ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em' }}>
              {tUi(locale, 'guide.pushes', { n: guide.pushes.length })}
            </span>
            <ol
              style={{
                margin: 0,
                paddingLeft: 30,
                paddingRight: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                fontSize: 12.5,
                lineHeight: 1.55,
                maxHeight: '34vh',
                overflowY: 'auto',
              }}
            >
              {guide.pushes.map((p) => (
                <li key={p.index}>
                  <span style={{ color: 'var(--neon-cyan)', fontWeight: 700 }}>{p.arrow}</span>{' '}
                  {p.label}
                  {p.isFall ? <span style={{ color: 'var(--neon-gold)' }}>{tUi(locale, 'guide.fall')}</span> : null}
                </li>
              ))}
            </ol>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{guide.note}</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {guide.mechanics[0]}
            <span style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginTop: 6 }}>{guide.note}</span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
