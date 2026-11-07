/**
 * 游玩占位页 —— 骨架期证明「welcome → startLevel → 段位状态」链路可用。
 * three 场景 / HUD / 战斗面板等待 view 模块接入；此处仅回显 store 状态。
 */

import { useGameStore } from '../../core/store/gameStore';
import { selectActiveLawChips, selectHudModel } from '../../core/store/selectors';
import { t } from '../../data/i18n';
import { bus } from '../../core/events/bus';

export function PlayingPlaceholder() {
  const locale = useGameStore((s) => s.locale);
  const hud = useGameStore((s) => selectHudModel(s));
  const lawChips = useGameStore((s) => selectActiveLawChips(s));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        textAlign: 'center',
      }}
    >
      <h2 className="neon-text" style={{ fontSize: 30, letterSpacing: '0.2em' }}>
        {hud.levelName}
      </h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{hud.areaName}</p>
      <div className="glass" style={{ padding: '16px 28px', display: 'flex', gap: 26 }}>
        <span>HP {hud.hp}/{hud.maxHp}</span>
        <span>ATK {hud.attack}{hud.weaponName !== null ? `（${hud.weaponName}）` : ''}</span>
        <span>{t(locale, 'hud.steps')} {hud.steps}</span>
        <span>{t(locale, 'hud.starStones')} {hud.starStones}◈</span>
      </div>
      {lawChips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {lawChips.map((chip) => (
            <span key={chip.cardId} className="chip" style={{ borderColor: 'rgba(255,207,92,0.5)' }}>
              {chip.name}（{chip.description}）
            </span>
          ))}
        </div>
      )}
      <p style={{ color: 'var(--text-dim)', fontSize: 13, maxWidth: 560 }}>
        {t(locale, 'welcome.modules')}
      </p>
      <button className="btn-neon" onClick={() => useGameStore.getState().backToTitle()}>
        ← {t(locale, 'panel.settings') === '设置' ? '返回标题' : 'Title'}
      </button>
      <button className="chip" style={{ cursor: 'pointer' }} onClick={() => bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-5' })}>
        SFX probe
      </button>
    </div>
  );
}
