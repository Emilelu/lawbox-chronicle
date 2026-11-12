/**
 * 帷幕界面层 · SettingsDrawer —— 设置抽屉：常规 / 音频 / 语言 / 作弊 / 存档 / 规则手册。
 * ---------------------------------------------------------------------------
 * 「规则手册」页签兑现 SanBPushChest README:7 的承诺「游戏规则展示（附弹出
 * 动画）」：条目点击展开（click 而非 hover，架构稿明确要求），展开带
 * framer-motion 弹出动画；内容引用遗产字典 legacy.gameRule 原文 + 新规则词汇。
 * 老缺陷归宿：
 *  - 语言下拉按 locale 键控取值（multiLang.js:160-167 用 selectedIndex 下标
 *    回填语言 —— DOM 顺序一变即错位的根源），7 语种枚举 LOCALES 单一来源；
 *  - 作弊开关是唯一门禁（S9 热键绕过解锁 / ST3 两处注释 UI 的归宿）；
 *  - 存档导出读取 zustand persist 的 'lawbox-chronicle:v1'（gameStore.ts:579），
 *    只导出不导入（防未校验 JSON 直接灌档；导入功能归集成期统一设计）。
 * settings.touchControls / settings.cheatsEnabled 无对应共享动作（GameAction
 * 契约缺口）→ 经 useGameStore.setState 桥接（与 WelcomeScreen 的 visitCount
 * 探针同模式），已在模块 notes 登记待补动作。
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { LOCALES, type LocaleId } from '../../core/types';
import { LOCALE_NAMES } from '../../data/i18n';
import { GACHA_CONFIG } from '../../data/gacha';
import { formatPercent, stripBr, tUi } from '../../data/i18n/uiText';
import { bus } from '../../core/events/bus';
import { useLogbookStore } from '../../archive/logbook';
import { useStatsStore } from '../../archive/statsCollector';

const SAVE_KEY = 'lawbox-chronicle:v1'; // gameStore.ts persist 配置的存储键

type DrawerTab = 'general' | 'audio' | 'language' | 'cheat' | 'save' | 'rulebook';

const TAB_KEYS: readonly DrawerTab[] = ['general', 'audio', 'language', 'cheat', 'save', 'rulebook'];

const TAB_TAB_KEY = {
  general: 'tab.general',
  audio: 'tab.audio',
  language: 'tab.language',
  cheat: 'tab.cheat',
  save: 'tab.save',
  rulebook: 'tab.rulebook',
} as const satisfies Record<DrawerTab, Parameters<typeof tUi>[1]>;

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '9px 0',
  borderBottom: '1px solid rgba(139,147,184,0.14)',
};

function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 46,
        height: 24,
        borderRadius: 999,
        border: `1px solid ${on ? 'rgba(0,229,255,0.65)' : 'rgba(139,147,184,0.4)'}`,
        background: on ? 'rgba(0,229,255,0.18)' : 'rgba(20,26,48,0.6)',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: on ? 'var(--neon-cyan)' : 'var(--text-dim)',
          transition: 'left 0.18s ease, background 0.18s ease',
        }}
      />
    </button>
  );
}

function VolumeSlider({ channel, label }: { channel: 'master' | 'bgm' | 'sfx'; label: string }) {
  const value = useGameStore((s) =>
    channel === 'master' ? s.settings.masterVolume : channel === 'bgm' ? s.settings.bgmVolume : s.settings.sfxVolume,
  );
  return (
    <div style={ROW}>
      <span style={{ width: 88, fontSize: 13.5 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => useGameStore.getState().setVolume(channel, Number(e.target.value))}
        style={{ flex: 1, accentColor: '#7c5cff' }}
      />
      <span style={{ width: 40, textAlign: 'right', fontSize: 12.5, color: 'var(--text-dim)' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

/* ------------------------------ 规则手册页签 ------------------------------- */

type RuleSectionId = 'goal' | 'controls' | 'laws' | 'gacha' | 'combat';

const RULE_SECTIONS: readonly { readonly id: RuleSectionId; readonly titleKey: Parameters<typeof tUi>[1]; readonly bodyKey: Parameters<typeof tUi>[1] }[] = [
  { id: 'goal', titleKey: 'rulebook.sGoal', bodyKey: 'legacy.gameRule' },
  { id: 'controls', titleKey: 'rulebook.sControls', bodyKey: 'rulebook.bControls' },
  { id: 'laws', titleKey: 'rulebook.sLaws', bodyKey: 'rulebook.bLaws' },
  { id: 'gacha', titleKey: 'rulebook.sGacha', bodyKey: 'rulebook.bGacha' },
  { id: 'combat', titleKey: 'rulebook.sCombat', bodyKey: 'rulebook.bCombat' },
];

function RulebookTab() {
  const locale = useGameStore((s) => s.locale);
  const [openId, setOpenId] = useState<RuleSectionId | null>('goal');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
        {tUi(locale, 'rulebook.expandHint')} —— {tUi(locale, 'rulebook.popup')}
      </span>
      {RULE_SECTIONS.map((section) => {
        const open = openId === section.id;
        return (
          <div key={section.id} className="glass" style={{ padding: '0', overflow: 'hidden' }}>
            <button
              onClick={() => setOpenId(open ? null : section.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: open ? 'var(--neon-cyan)' : 'var(--text-primary)',
                fontSize: 14.5,
                letterSpacing: '0.08em',
                padding: '11px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ color: 'var(--neon-violet)' }}>{open ? '▾' : '▸'}</span>
              {tUi(locale, section.titleKey)}
            </button>
            {/* README:7 承诺的「弹出动画」：点击展开，spring 入场 */}
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0, y: -6 }}
                  animate={{ height: 'auto', opacity: 1, y: 0 }}
                  exit={{ height: 0, opacity: 0, y: -6 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  style={{ overflow: 'hidden' }}
                >
                  <p style={{ padding: '2px 16px 13px', fontSize: 13, lineHeight: 1.75, color: 'var(--text-dim)', whiteSpace: 'pre-line' }}>
                    {stripBr(
                      section.bodyKey === 'rulebook.bGacha'
                        ? tUi(locale, 'rulebook.bGacha', { n: GACHA_CONFIG.pity.hardFourStar })
                        : tUi(locale, section.bodyKey),
                    )}
                  </p>
                  {section.id === 'gacha' && (
                    <p style={{ padding: '0 16px 13px', fontSize: 12, color: 'var(--text-dim)' }}>
                      4★ {formatPercent(GACHA_CONFIG.baseRates.fourStar)} · 3★ {formatPercent(GACHA_CONFIG.baseRates.threeStar)} ·{' '}
                      {tUi(locale, 'gacha.boost', { n: GACHA_CONFIG.everyNthBoost.every })}: 4★{' '}
                      {formatPercent(GACHA_CONFIG.everyNthBoost.rates.fourStar)} · 3★{' '}
                      {formatPercent(GACHA_CONFIG.everyNthBoost.rates.threeStar)}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '2px 4px' }}>
        {tUi(locale, 'legacy.hotkeyReplay')} · {tUi(locale, 'legacy.hotkeyFlash')} · {tUi(locale, 'legacy.hotkeyCheat')} ——{' '}
        {tUi(locale, 'common.version')}
      </p>
    </div>
  );
}

/* -------------------------------- 抽屉主体 -------------------------------- */

export function SettingsDrawer() {
  const activePanel = useGameStore((s) => s.activePanel);
  const locale = useGameStore((s) => s.locale);
  const settings = useGameStore((s) => s.settings);

  const [tab, setTab] = useState<DrawerTab>(activePanel === 'rulebook' ? 'rulebook' : 'general');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClearArchive, setConfirmClearArchive] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // 面板身份切换（settings ↔ rulebook）时同步页签
  useEffect(() => {
    if (activePanel === 'settings') setTab('general');
    else if (activePanel === 'rulebook') setTab('rulebook');
  }, [activePanel]);

  if (activePanel !== 'settings' && activePanel !== 'rulebook') return null;

  const store = useGameStore.getState;

  /** 存档导出：persist JSON → 下载文件。只导出不导入（防未校验数据灌档）。 */
  const exportSave = () => {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw === null) {
      setExportNote(tUi(locale, 'settings.noSave'));
      return;
    }
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `lawbox-chronicle-save-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportNote(tUi(locale, 'settings.exportDone'));
    bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
  };

  /**
   * 清空档案（A4-6）：清 logbook 与 stats 两个档案分片（图鉴/成就/关卡纪录/
   * 抽卡历史与曲线），兑现 logbook.ts 头注释「设置面板的『清空档案』才清本片」
   * 的既有承诺 —— 此前该入口从未存在，resetSave 只回主存档分片，玩家清档后
   * 抽卡历史与图鉴成就永久留存。与 resetSave 相互独立（收藏语义 vs 进度语义），
   * 两步确认防误触；清除后广播 toast 明示。
   */
  const clearArchive = () => {
    if (!confirmClearArchive) {
      setConfirmClearArchive(true);
      return;
    }
    useLogbookStore.getState().clearLogbook();
    useStatsStore.getState().clearStats();
    setConfirmClearArchive(false);
    bus.publish({ type: 'ui/toast', messageKey: 'settings.clearArchiveDone' });
    bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-3' });
  };

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="glass"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        width: 'min(430px, 94vw)',
        padding: '20px 22px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        borderRadius: '18px 0 0 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h3 style={{ fontSize: 18, letterSpacing: '0.14em' }}>
          {activePanel === 'rulebook' ? tUi(locale, 'rulebook.title') : tUi(locale, 'tab.general')}
        </h3>
        <span style={{ flex: 1 }} />
        <button className="chip" style={{ cursor: 'pointer' }} onClick={() => store().closeOverlay()}>
          ✕ {tUi(locale, 'ui.close')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TAB_KEYS.map((key) => (
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
            {tUi(locale, TAB_TAB_KEY[key])}
          </button>
        ))}
      </div>

      {/* 常规：触屏虚拟键 */}
      {tab === 'general' && (
        <div>
          <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontSize: 13.5 }}>{tUi(locale, 'settings.touch')}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tUi(locale, 'settings.touchDesc')}</span>
            </div>
            <Switch
              on={settings.touchControls}
              label={tUi(locale, 'settings.touch')}
              onChange={(next) => useGameStore.setState((s) => ({ settings: { ...s.settings, touchControls: next } }))}
            />
          </div>
        </div>
      )}

      {/* 音频：三通道音量 + 静音（BT8 音乐无控制接口的归宿） */}
      {tab === 'audio' && (
        <div>
          <VolumeSlider channel="master" label={tUi(locale, 'settings.master')} />
          <VolumeSlider channel="bgm" label={tUi(locale, 'settings.bgm')} />
          <VolumeSlider channel="sfx" label={tUi(locale, 'settings.sfx')} />
          <div style={ROW}>
            <span style={{ fontSize: 13.5, flex: 1 }}>{tUi(locale, 'settings.mute')}</span>
            <Switch
              on={settings.muted}
              label={tUi(locale, 'settings.mute')}
              onChange={() => store().toggleMute()}
            />
          </div>
        </div>
      )}

      {/* 语言：locale 键控下拉（拒绝对应老 selectedIndex 下标回填的错位 bug） */}
      {tab === 'language' && (
        <div style={ROW}>
          <span style={{ fontSize: 13.5, width: 88 }}>{tUi(locale, 'settings.language')}</span>
          <select
            value={locale}
            aria-label={tUi(locale, 'settings.language')}
            onChange={(e) => store().setLocale(e.target.value as LocaleId)}
            style={{ flex: 1 }}
          >
            {LOCALES.map((id) => (
              <option key={id} value={id}>
                {LOCALE_NAMES[id]}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 作弊：唯一门禁总开关（S9） */}
      {tab === 'cheat' && (
        <div style={ROW}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <span style={{ fontSize: 13.5 }}>{tUi(locale, 'settings.cheat')}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tUi(locale, 'settings.cheatDesc')}</span>
          </div>
          <Switch
            on={settings.cheatsEnabled}
            label={tUi(locale, 'settings.cheat')}
            onChange={(next) => useGameStore.setState((s) => ({ settings: { ...s.settings, cheatsEnabled: next } }))}
          />
        </div>
      )}

      {/* 存档：导出 JSON / 两步确认清空主存档 / 两步确认清空档案分片（A4-6） */}
      {tab === 'save' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn-neon" onClick={exportSave}>
            ⬇ {tUi(locale, 'settings.export')}
          </button>
          <button
            className="chip"
            style={{
              cursor: 'pointer',
              alignSelf: 'flex-start',
              borderColor: confirmReset ? 'var(--neon-rose)' : undefined,
              color: confirmReset ? 'var(--neon-rose)' : undefined,
            }}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              store().resetSave();
              setConfirmReset(false);
            }}
          >
            {confirmReset ? tUi(locale, 'settings.resetConfirm') : `🗑 ${tUi(locale, 'settings.reset')}`}
          </button>
          <button
            className="chip"
            style={{
              cursor: 'pointer',
              alignSelf: 'flex-start',
              borderColor: confirmClearArchive ? 'var(--neon-rose)' : undefined,
              color: confirmClearArchive ? 'var(--neon-rose)' : undefined,
            }}
            onClick={clearArchive}
          >
            {confirmClearArchive ? tUi(locale, 'settings.clearArchiveConfirm') : tUi(locale, 'settings.clearArchive')}
          </button>
          {exportNote !== null && <span style={{ fontSize: 12, color: 'var(--neon-cyan)' }}>{exportNote}</span>}
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tUi(locale, 'settings.save')} · {SAVE_KEY}</span>
        </div>
      )}

      {/* 规则手册：兑现 README:7 */}
      {tab === 'rulebook' && <RulebookTab />}
    </motion.div>
  );
}
