/**
 * 帷幕界面层 · CombatPanel —— 底部战斗面板：布阵/攻击/技能/道具/逃跑 + 武器点击选择。
 * ---------------------------------------------------------------------------
 * 与共享契约（core/types.ts GameAction）的对接现状：
 *  - 攻击/道具/逃跑 → dispatch combatAct（store combatAct 只在 battle 相结算，
 *    逃跑是真实状态变更 combat:null + phase:'playing'，K2 的值传递空操作在此根治）；
 *  - 布阵 → dispatch toggleFormation（语义见 gameStore 的 toggleFormation case：
 *    战斗中确认布阵开打，无战斗时打开卡组面板）；
 *  - 技能 → 共享契约无 'combatSkill' 动作：按钮以 onSkill prop 为注入点，
 *    缺省行为经 bus 发 ui/toast 提示（见 combat.skillLocked），不伪造动作。
 * 战斗开打与结算均由 store 的 launchBattle / settleBattleEnd 接管：终局在同一次
 * 状态更新里清空 combat，本面板不承担退场（旧的 settled 分支与 endCombat 已删除，
 * 它们因 combat 同步清空而永远不可达）。
 * 武器选择沿 K7 教训：点选前 canEquipWeapon 断言 id 在武器表内，杜绝 off-by-one。
 */

import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { selectBattleState, useGameStore } from '../../core/store/gameStore';
import { bus } from '../../core/events/bus';
import type { CombatState, Dir, WeaponDef } from '../../core/types';
import { WEAPONS, findEnemy, findWeapon } from '../../data';
import { tUi } from '../../data/i18n/uiText';

/* ------------------------------ 纯逻辑导出 -------------------------------- */

/** K7 守卫：只有武器表内存在的 id 可装备（点击列表天然在界内，断言留作双保险） */
export function canEquipWeapon(weaponId: string, weapons: readonly WeaponDef[]): boolean {
  return weapons.some((w) => w.id === weaponId);
}

/* -------------------------------- 组件 ------------------------------------ */

const ACTION_BTN: CSSProperties = {
  flex: '1 1 0',
  minWidth: 64,
  padding: '9px 0',
  borderRadius: 10,
  border: '1px solid rgba(124,92,255,0.5)',
  background: 'rgba(20,26,48,0.6)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13.5,
  letterSpacing: '0.08em',
};

function phaseBadgeColor(phase: CombatState['phase']): string {
  switch (phase) {
    case 'formation':
      return 'var(--neon-cyan)';
    case 'battle':
      return 'var(--neon-rose)';
    case 'victory':
      return 'var(--neon-gold)';
    case 'defeat':
      return 'var(--neon-violet)';
  }
}

export function CombatPanel({ onSkill }: { onSkill?: () => void }) {
  const combat = useGameStore((s) => s.combat);
  const phase = useGameStore((s) => s.phase);
  const locale = useGameStore((s) => s.locale);
  const enemyHp = combat?.enemyHp ?? 0;
  const enemyShield = useGameStore((s) => selectBattleState(s)?.enemyShield ?? 0);
  const [weaponFlash, setWeaponFlash] = useState<string | null>(null);

  if (combat === null || phase !== 'combat') return null;

  const enemy = findEnemy(combat.enemyId);
  const store = useGameStore.getState;
  const hpRatio = combat.enemyMaxHp > 0 ? Math.max(0, enemyHp / combat.enemyMaxHp) : 0;
  const isBattle = combat.phase === 'battle';
  const isFormation = combat.phase === 'formation';
  const weapon = combat.equippedWeaponId !== null ? findWeapon(combat.equippedWeaponId) : undefined;

  const equip = (weaponId: string) => {
    if (!canEquipWeapon(weaponId, WEAPONS)) return; // K7：越界/未知 id 直接拒绝
    store().selectWeapon(weaponId);
    setWeaponFlash(weaponId);
  };

  const skill = () => {
    if (onSkill !== undefined) {
      onSkill();
      return;
    }
    bus.publish({ type: 'ui/toast', messageKey: 'toast.skillPending' });
  };

  const recentLog = combat.log.slice(-5);

  return (
    <motion.div
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.26, ease: 'easeOut' }}
      className="glass"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: '14px 22px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* 敌方条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.14em' }}>{tUi(locale, 'combat.title')}</span>
        <span
          className="chip"
          style={{ color: phaseBadgeColor(combat.phase), borderColor: 'currentColor', fontSize: 12 }}
        >
          {combat.phase === 'formation'
            ? tUi(locale, 'combat.formation')
            : combat.phase === 'battle'
              ? tUi(locale, 'combat.battle')
              : combat.phase === 'victory'
                ? tUi(locale, 'combat.victory')
                : tUi(locale, 'combat.defeat')}
        </span>
        <span style={{ fontSize: 13.5 }}>{enemy?.name ?? combat.enemyId}</span>
        <div style={{ width: 200, height: 7, borderRadius: 4, background: 'rgba(139,147,184,0.25)', overflow: 'hidden' }}>
          <div style={{ width: `${hpRatio * 100}%`, height: '100%', background: 'var(--neon-rose)', transition: 'width 0.3s ease' }} />
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          {enemyHp}/{combat.enemyMaxHp} · {tUi(locale, 'combat.turn', { n: combat.turn })}
          {enemyShield > 0 ? ` · ${tUi(locale, 'combat.enemyShield', { n: enemyShield })}` : ''}
          {enemy !== undefined && enemy.boss ? ` · ${tUi(locale, 'combat.shoveImmune')}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {combat.phase === 'formation' ? tUi(locale, 'combat.formationHint') : tUi(locale, 'combat.battleHint')}
        </span>
      </div>

      {/* 五动作 + 武器选择（K7：点击选武器，index/uid 均经断言） */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <button style={ACTION_BTN} onClick={() => store().dispatch({ type: 'toggleFormation' })}>
            ⬡ {tUi(locale, 'combat.formation')}
          </button>
          <button style={ACTION_BTN} disabled={!isBattle} onClick={() => store().combatAct('attack')}>
            ⚔ {tUi(locale, 'combat.attack')}
          </button>
          <button style={ACTION_BTN} disabled={!isBattle} onClick={skill} title={tUi(locale, 'combat.skillLocked')}>
            ✦ {tUi(locale, 'combat.skill')}
          </button>
          <button style={ACTION_BTN} disabled={!isBattle} onClick={() => store().combatAct('item')}>
            ⚗ {tUi(locale, 'combat.item')}
          </button>
          <button style={{ ...ACTION_BTN, borderColor: 'rgba(255,92,158,0.55)' }} onClick={() => store().combatAct('flee')}>
            🏃 {tUi(locale, 'combat.flee')}
          </button>
          {/* 布阵期推挤入口（H1）：四个方向的按钮 + 战场提示；方向键/WASD 同效 */}
          {isFormation && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 2, alignContent: 'stretch' }}>
              {([[null, 'up', null], ['left', null, 'right'], [null, 'down', null]] as const).flatMap(
                (row, ri) =>
                  row.map((dir, ci) => {
                    const key = `${ri}-${ci}`;
                    if (dir === null) return <span key={key} />;
                    const d = dir as Dir;
                    const glyph: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };
                    return (
                      <button
                        key={key}
                        style={{
                          borderRadius: 8,
                          border: '1px solid rgba(124,92,255,0.5)',
                          background: 'rgba(20,26,48,0.6)',
                          color: 'var(--neon-cyan)',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: 0,
                        }}
                        onClick={() => store().dispatch({ type: 'shove', dir: d })}
                      >
                        {glyph[d]}
                      </button>
                    );
                  }),
              )}
            </div>
          )}
          {isFormation && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center', maxWidth: 280 }}>
              {tUi(locale, 'combat.shoveHint')}
            </span>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {WEAPONS.map((w) => {
              const equipped = combat.equippedWeaponId === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => equip(w.id)}
                  title={`${w.name} · +${w.attack} — ${w.description}`}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    fontSize: 12,
                    borderColor: equipped ? 'var(--neon-gold)' : weaponFlash === w.id ? 'var(--neon-cyan)' : undefined,
                    color: equipped ? 'var(--neon-gold)' : 'var(--text-dim)',
                  }}
                >
                  {equipped ? '✓ ' : ''}
                  {w.name} +{w.attack}
                </button>
              );
            })}
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {tUi(locale, 'combat.weapon')}: {weapon !== undefined ? tUi(locale, 'combat.equipped') : tUi(locale, 'combat.unarmed')}
            </span>
          </div>
        </div>

      {/* 战报 + 伤害浮层 */}
      {recentLog.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 76, overflowY: 'auto' }}>
          <AnimatePresence initial={false}>
            {recentLog.map((entry, i) => (
              <motion.div
                key={`${entry.turn}-${i}-${entry.text}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                style={{
                  fontSize: 12,
                  color: entry.actor === 'player' ? 'var(--text-primary)' : 'var(--neon-rose)',
                  display: 'flex',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--text-dim)' }}>T{entry.turn}</span>
                <span>{entry.text}</span>
                {entry.damage > 0 && (
                  <span style={{ color: entry.crit ? 'var(--neon-gold)' : 'var(--text-dim)' }}>
                    −{entry.damage}
                    {entry.crit ? ' !' : ''}
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
