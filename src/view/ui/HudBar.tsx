/**
 * 帷幕界面层 · HudBar —— 左上状态胶囊 + 右上圆形按钮组 + 全局 toast 栈。
 * ---------------------------------------------------------------------------
 * - 星石胶囊可点击 → openPanel('gacha')：快捷抽卡入口（双通道之一，另一通道
 *   是世界内 3D 星愿祭坛，由 three 模块交互后同样走 openPanel/rollGacha）。
 * - 只读 selector、只 dispatch / 调 store 方法；演出事件经 bus。
 * - 彩虹 notice 的老 bug（SanBPushChest start.js:48-51 常驻 setInterval 染色）
 *   在此结构性规避：toast 栈唯一的定时器是「单条退场」的一次性 setTimeout，
 *   随订阅退订统一清理，绝无常驻 interval。
 * - 文件末尾导出 UiOverlaySuite：集成方一行挂载全部 2D overlay。
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { selectHudModel } from '../../core/store/selectors';
import { LOCALES } from '../../core/types';
import { LOCALE_NAMES, t } from '../../data/i18n';
import { isUiTextKey, tUi } from '../../data/i18n/uiText';
import { bus } from '../../core/events/bus';
import roleAvatar from '../../assets/imgs/roles/role.png';
import { LawQuickBar } from './LawQuickBar';
import { DialogueBox } from './DialogueBox';
import { CombatPanel } from './CombatPanel';
import { DeckPanel } from './DeckPanel';
import { SettingsDrawer } from './SettingsDrawer';
import { GachaOverlay } from './GachaOverlay';
import { ResultModal } from './ResultModal';
import { ArchivePanel, useArchivePanelStore } from './ArchivePanel';
import { LevelSelectPanel, useLevelSelectStore } from './LevelSelectPanel';

/* ------------------------------ toast 栈 --------------------------------- */

interface ToastItem {
  readonly id: number;
  readonly key: string;
}

/** bus ui/toast → 顶部居中短消息；messageKey 先查本模块键控字典，再回落 data/i18n 旧字典 */
export function ToastStack() {
  const locale = useGameStore((s) => s.locale);
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);

  useEffect(() => {
    let seq = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = bus.subscribe((event) => {
      if (event.type !== 'ui/toast') return;
      seq += 1;
      const id = seq;
      setToasts((prev) => [...prev.slice(-2), { id, key: event.messageKey }]);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
        timers.delete(timer);
      }, 3200);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const resolve = (key: string): string => {
    if (isUiTextKey(key)) return tUi(locale, key);
    return t(locale, key); // 旧字典（toast.skeletonReady 等），最终回落 key 字面量
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="glass"
            style={{ padding: '8px 18px', fontSize: 13, color: 'var(--text-primary)' }}
          >
            {resolve(item.key)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------- HudBar ---------------------------------- */

function hpColor(ratio: number): string {
  if (ratio > 0.5) return 'var(--neon-cyan)';
  if (ratio > 0.25) return 'var(--neon-gold)';
  return 'var(--neon-rose)';
}

const CIRCLE_BTN: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 17,
  cursor: 'pointer',
  color: 'var(--text-primary)',
  background: 'var(--bg-panel)',
  border: 'var(--neon-border)',
  backdropFilter: 'blur(var(--glass-blur))',
};

export function HudBar() {
  const phase = useGameStore((s) => s.phase);
  const hasSegment = useGameStore((s) => s.segment !== null);
  const hud = useGameStore((s) => selectHudModel(s));
  const locale = useGameStore((s) => s.locale);
  const muted = useGameStore((s) => s.settings.muted);
  const planeShiftEnabled = useGameStore((s) => s.ruleSet.planeShiftEnabled);
  const planeShifted = useGameStore((s) => s.segment?.planeShifted ?? false);

  // 标题页不显示 HUD（segment 在返回标题后仍留存，须同时判 phase）
  if (phase === 'title' || !hasSegment) return null;

  const hpRatio = hud.maxHp > 0 ? Math.max(0, Math.min(1, hud.hp / hud.maxHp)) : 0;
  const store = useGameStore.getState;

  // 语言轮换（SanBPushChest README:30「按 L 轮切」的血统；键控字典使轮换无下标错位风险）
  const cycleLocale = () => {
    const idx = LOCALES.indexOf(locale);
    const next = LOCALES[(idx + 1) % LOCALES.length] ?? 'zh-Hans';
    store().setLocale(next);
  };

  return (
    <>
      {/* ---- 左上状态胶囊 ---- */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', pointerEvents: 'auto' }}>
          <img
            src={roleAvatar}
            alt={hud.levelName}
            style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(0,229,255,0.45)' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)' }}>
              <span>
                {tUi(locale, 'hud.hp')} {hud.hp}/{hud.maxHp}
              </span>
              <span>
                {tUi(locale, 'hud.attack')} {hud.attack}
                {hud.weaponName !== null ? ` · ${hud.weaponName}` : ''}
              </span>
            </div>
            <div style={{ width: 150, height: 6, borderRadius: 3, background: 'rgba(139,147,184,0.25)', overflow: 'hidden' }}>
              <div style={{ width: `${hpRatio * 100}%`, height: '100%', background: hpColor(hpRatio), transition: 'width 0.25s ease' }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="chip" style={{ fontSize: 11, padding: '1px 8px' }} title={hud.areaName}>
                {hud.levelName}
              </span>
              <span className="chip" style={{ fontSize: 11, padding: '1px 8px' }}>
                ◇ {tUi(locale, 'result.steps')} {hud.steps}
              </span>
            </div>
          </div>
          {planeShiftEnabled && (
            <span
              className="chip"
              style={{
                fontSize: 11,
                borderColor: planeShifted ? 'rgba(124,92,255,0.7)' : 'rgba(0,229,255,0.5)',
                color: planeShifted ? 'var(--neon-violet)' : 'var(--neon-cyan)',
              }}
              title={tUi(locale, 'hud.planeLabel')}
            >
              {planeShifted ? tUi(locale, 'hud.planeYin') : tUi(locale, 'hud.planeYang')}
            </span>
          )}
        </div>

        {/* 星石胶囊：快捷抽卡入口（点按不经过祭坛运镜，直接翻牌） */}
        <button
          className="glass"
          onClick={() => store().openPanel('gacha')}
          title={tUi(locale, 'hud.quickGacha')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            cursor: 'pointer',
            color: 'var(--neon-gold)',
            fontSize: 14,
            letterSpacing: '0.06em',
          }}
        >
          ◈ {hud.starStones}
        </button>

        {/* 触屏友好的撤销/重玩快捷键（键盘侧由输入层承担 Z/Q） */}
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
          <button className="chip" style={{ cursor: 'pointer' }} onClick={() => store().undo()} title="Z">
            ↩ {tUi(locale, 'hud.undo')}
          </button>
          <button className="chip" style={{ cursor: 'pointer' }} onClick={() => store().replaySegment()} title="Q">
            ⟲ {tUi(locale, 'hud.replay')}
          </button>
        </div>
      </div>

      {/* ---- 右上圆形按钮组：卡组 / 规则手册 / 设置 / 静音 / 语言 ---- */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 20,
          display: 'flex',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        <button style={CIRCLE_BTN} onClick={() => store().openPanel('deck')} title={tUi(locale, 'tab.deck')}>
          🃏
        </button>
        <button style={CIRCLE_BTN} onClick={() => useLevelSelectStore.getState().toggle()} title="选关">
          🗺
        </button>
        <button style={CIRCLE_BTN} onClick={() => useArchivePanelStore.getState().toggle()} title="档案">
          📖
        </button>
        <button style={CIRCLE_BTN} onClick={() => store().openPanel('rulebook')} title={tUi(locale, 'tab.rulebook')}>
          📜
        </button>
        <button style={CIRCLE_BTN} onClick={() => store().openPanel('settings')} title={tUi(locale, 'tab.general')}>
          ⚙
        </button>
        <button style={CIRCLE_BTN} onClick={() => store().toggleMute()} title={tUi(locale, 'settings.mute')}>
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          style={CIRCLE_BTN}
          onClick={cycleLocale}
          title={`${tUi(locale, 'settings.language')}: ${LOCALE_NAMES[locale]}`}
        >
          🌐
        </button>
      </div>
    </>
  );
}

/* -------------------------- 全套 overlay 汇编 ----------------------------- */

/**
 * 集成出口：把帷幕界面层 8 个组件 + toast 栈一次挂齐。
 * 每个组件都自持开闭条件（store/selector 驱动），不满足时渲染 null，
 * 集成方只需 <UiOverlaySuite /> 一行。
 */
export function UiOverlaySuite() {
  return (
    <>
      <HudBar />
      <LawQuickBar />
      <DialogueBox />
      <CombatPanel />
      <DeckPanel />
      <SettingsDrawer />
      <GachaOverlay />
      <ResultModal />
      <ArchivePanel />
      <LevelSelectPanel />
      <ToastStack />
    </>
  );
}
