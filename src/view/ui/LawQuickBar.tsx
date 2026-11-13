/**
 * 帷幕界面层 · LawQuickBar —— 右侧竖向「法则快捷栏」：实时展示已激活法则卡的规则芯片。
 * ---------------------------------------------------------------------------
 * 数据来自 selectActiveLawChips（selector 由激活卡牌 → lawRegistry 现算），
 * 本组件零私有规则数据 —— UI 不摸引擎内部。
 * 芯片颜色按稀有度（复用 GachaOverlay.rarityColor），点击展开完整规则描述
 * （状态驱动，无 hover-only 信息、无常驻定时器）。
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { selectActiveLawChips } from '../../core/store/selectors';
import { lawPatchName, tUi } from '../../data/i18n/uiText';
import { rarityColor, rarityStars } from './GachaOverlay';

export function LawQuickBar() {
  const phase = useGameStore((s) => s.phase);
  const locale = useGameStore((s) => s.locale);
  const chips = useGameStore((s) => selectActiveLawChips(s));

  const [expanded, setExpanded] = useState<readonly string[]>([]);

  // 标题页 / 无法则时不占位（空态文案只在游玩相显示）
  if (phase === 'title' || chips.length === 0) return null;

  const toggle = (cardId: string) =>
    setExpanded((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]));

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        top: 64,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      <span className="chip" style={{ fontSize: 11, pointerEvents: 'auto' }}>
        ⚖ {tUi(locale, 'lawbar.title')} · {chips.length}
      </span>
      <AnimatePresence initial={false}>
        {chips.map((chip) => {
          const open = expanded.includes(chip.cardId);
          return (
            <motion.button
              key={chip.cardId}
              layout
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2 }}
              onClick={() => toggle(chip.cardId)}
              className="glass"
              title={chip.description}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                maxWidth: 240,
                padding: open ? '8px 12px' : '6px 12px',
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                borderColor: rarityColor(chip.rarity),
              }}
            >
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 10.5, color: rarityColor(chip.rarity) }}>{rarityStars(chip.rarity)}</span>
                {/* C4：法则补丁名按语种解析（chip.name 是 lawRegistry 数据层中文） */}
                <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{lawPatchName(locale, chip)}</span>
              </span>
              {open && <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{chip.description}</span>}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
