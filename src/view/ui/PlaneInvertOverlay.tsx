/**
 * 帷幕界面层 · PlaneInvertOverlay —— 位面切换的全屏色彩反转 overlay（P-ui③）。
 * ---------------------------------------------------------------------------
 * 阴阳位面（shiftPlane）切换时，`segment.planeShifted` 翻转为 true/false。
 * 本组件读该状态，用一层全屏纯白 + mixBlendMode:'difference' 做整屏色彩反转
 * （difference 对白底逐通道取反，即标准反色），经 framer-motion 的 opacity
 * 渐入渐出；pointerEvents:'none' 绝不拦截任何输入。挂载在 App 根部一次即可。
 */

import { motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';

export function PlaneInvertOverlay() {
  const planeShifted = useGameStore((s) => s.segment?.planeShifted ?? false);

  return (
    <motion.div
      initial={false}
      animate={{ opacity: planeShifted ? 1 : 0 }}
      transition={{ duration: 0.45, ease: 'easeInOut' }}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#ffffff',
        mixBlendMode: 'difference',
        pointerEvents: 'none',
      }}
    />
  );
}
