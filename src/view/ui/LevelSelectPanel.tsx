/**
 * 帷幕界面层 · LevelSelectPanel —— 选关面板（P-ui④：兑现原作承诺的「选关界面」）。
 * ---------------------------------------------------------------------------
 * 进度读取参考 cheatRegistry.ts:41-56 的 reached:/cleared: 口径：hasReachedLevel /
 * hasClearedLevel 是同一对纯函数，本组件直接消费，不另造第二套进度真相。
 * 从面板可直接进入「已到达」的关卡（startLevel），未到达的关卡置灰不可点。
 * 入口挂 HUD 右上按钮组（🗺）。
 */

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { create } from 'zustand';
import { useGameStore } from '../../core/store/gameStore';
import { hasClearedLevel, hasReachedLevel } from '../../input/cheatRegistry';
import { LEVELS } from '../../data/levels';
import type { GameState, LevelDef } from '../../core/types';
import { tUi } from '../../data/i18n/uiText';
import { bus } from '../../core/events/bus';

/* ============================== 面板开关分片 =============================== */

interface LevelSelectStore {
  readonly open: boolean;
  toggle(): void;
  close(): void;
}

export const useLevelSelectStore = create<LevelSelectStore>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/* ============================== 纯逻辑导出 ================================ */

export interface LevelRow {
  readonly level: LevelDef;
  readonly reached: boolean;
  readonly cleared: boolean;
}

/** 选关行：LEVELS 全表 × reached/cleared 进度（复用 cheatRegistry 口径） */
export function levelRows(state: GameState): readonly LevelRow[] {
  return LEVELS.map((level) => ({
    level,
    reached: hasReachedLevel(state, level.id),
    cleared: hasClearedLevel(state, level.id),
  }));
}

/* ============================== 组件 ======================================= */

export function LevelSelectPanel() {
  const open = useLevelSelectStore((s) => s.open);
  const close = useLevelSelectStore((s) => s.close);
  const locale = useGameStore((s) => s.locale);
  const state = useGameStore((s) => s);

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
  const rows = levelRows(state);

  const enter = (levelId: string) => {
    store().startLevel(levelId);
    close();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="glass"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 44,
        width: 'min(640px, 94vw)',
        maxHeight: '84vh',
        overflowY: 'auto',
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>选关</h3>
        <span style={{ flex: 1 }} />
        <button className="chip" style={{ cursor: 'pointer' }} onClick={close}>
          ✕ {tUi(locale, 'ui.close')}
        </button>
      </div>

      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        已到达的关卡可直接进入；未到达的关卡置灰（到达进度见 HUD 左上关卡名，通关后对应旗标永久记录）。
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.level.id}
            className="glass"
            style={{
              padding: '9px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              opacity: row.reached ? 1 : 0.5,
            }}
          >
            <span style={{ fontWeight: 700 }}>{row.level.name}</span>
            <span className="chip" style={{ fontSize: 10.5, padding: '1px 8px' }}>{row.level.subtitle}</span>
            <span style={{ flex: 1 }} />
            {row.cleared && (
              <span className="chip" style={{ fontSize: 10.5, color: 'var(--neon-cyan)', borderColor: 'rgba(0,229,255,0.5)' }}>
                ✓ cleared
              </span>
            )}
            {row.reached && !row.cleared && (
              <span className="chip" style={{ fontSize: 10.5 }}>reached</span>
            )}
            {row.reached ? (
              <button className="btn-neon" style={{ padding: '0.4em 1.2em' }} onClick={() => enter(row.level.id)}>
                进入
              </button>
            ) : (
              <span className="chip" style={{ fontSize: 10.5 }}>未到达</span>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
