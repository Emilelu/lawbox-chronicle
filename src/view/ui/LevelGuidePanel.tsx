/**
 * 席卷界面层 · LevelGuidePanel —— 每关攻略面板。
 * ---------------------------------------------------------------------------
 * 内容 = data/levels/levelGuide.buildLevelGuide(levelId)：机制提示 + 法则门 +
 * 星级线 + 奖励 + 预计算推法序列（与 docs/game-guide.html 同源同真相）。
 * 入口：HUD 左上「💡 攻略」（当前关）与选关面板每行的「💡 攻略」。
 * 定位沿用 L3 教训：居中位移并入 motion 的 x/y 百分比，绝不用 CSS transform。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import { buildLevelGuide } from '../../data/levels/levelGuide';

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
  openFor: (levelId) => set({ open: true, levelId }),
  close: () => set({ open: false }),
}));

/* ================================= 组件 ==================================== */

export function LevelGuidePanel() {
  const open = useGuidePanelStore((s) => s.open);
  const levelId = useGuidePanelStore((s) => s.levelId);
  const close = useGuidePanelStore((s) => s.close);

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
          <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>💡 攻略 · {guide.name}</h3>
          <span style={{ flex: 1 }} />
          <button className="chip" style={{ cursor: 'pointer' }} onClick={close}>
            ✕ 关闭
          </button>
        </div>

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
            奖励 {guide.rewardText}
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
              参考推法（{guide.pushes.length} 推）
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
                  {p.isFall ? <span style={{ color: 'var(--neon-gold)' }}>（坠落）</span> : null}
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
