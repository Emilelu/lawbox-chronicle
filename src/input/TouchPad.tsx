/**
 * TouchPad —— 触屏输入：虚拟十字键 + swipe 手势。
 * ---------------------------------------------------------------------------
 * 源自 SanBPushChest 的触屏玩法（原作只有四个方向键位图，swipe 从未兑现，
 * 见设计文档 ST8：函数名错位/无 swipe → {dx,dy} 语义动作 + swipe 手势）。
 * 与键盘同一条路：一切输入归一为语义 move 进 store，绝无 DOM 直改。
 * 十字键/swipe 的世界移动统一走 dispatchTouchMove 唯一入口 —— 门禁（META
 * 终端/全屏浮层冻结，I3）与相机偏航映射（cameraYawToGridDir）都与键盘
 * dispatchBinding 的 move 分支同源，斜置相机下触屏「▲」= 键盘 W 的网格路。
 *
 * 对话冲突处理（uiRedesign 契约）：DialogueBox 激活（phase==='dialogue'）
 * 时十字键收起为右下角半透明迷你浮窗——对话自带继续/快进按钮，迷你浮窗
 * 点击即推进对话；对话结束自动还原全尺寸。战斗/抽卡/结算/标题阶段不显示。
 *
 * 长按连推复用 useKeyActions 的 createHoldRepeater（键盘触屏同节奏）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Dir } from '../core/types';
import { useGameStore } from '../core/store/gameStore';
import { bus } from '../core/events/bus';
import { cameraYawToGridDir } from '../view/three/theme';
import { useViewStore } from '../view/three/viewStore';
import { createHoldRepeater } from './useKeyActions';
import { isMetaTerminalOpen } from './MetaTerminal';

/** swipe 触发阈值（px）：跨过一次派发一步并重设锚点，可连续滑动连推 */
export const SWIPE_THRESHOLD_PX = 28;

interface Pt {
  readonly x: number;
  readonly y: number;
}

const PAD_DIRECTIONS: readonly { readonly dir: Dir; readonly glyph: string; readonly gridArea: string; readonly label: string }[] = [
  { dir: 'up', glyph: '▲', gridArea: '1 / 2', label: '向上' },
  { dir: 'left', glyph: '◀', gridArea: '2 / 1', label: '向左' },
  { dir: 'right', glyph: '▶', gridArea: '2 / 3', label: '向右' },
  { dir: 'down', glyph: '▼', gridArea: '3 / 2', label: '向下' },
];

function dominantDir(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * 触屏世界移动唯一入口（A1-1/A1-2）：十字键 repeater fire 与 swipe 派发共用，
 * 与键盘 dispatchBinding 的 move 分支完全同语义 ——
 *   1. 门禁：META 终端 / 全屏浮层（卡组/抽卡/设置/手册）打开时世界冻结，
 *      防止浮层后面盲走（I3；键盘侧 useKeyActions.ts:204-205 同款）；
 *   2. 相机映射：方向随相机偏航旋转（cameraYawToGridDir 纯函数），斜置相机下
 *      十字键「▲」与键盘 W 走出同一条网格路，单一映射源在 theme。
 * 模块级函数（不依赖组件状态）：fire 内现取 store，无闭包过期问题，可直接单测。
 */
export function dispatchTouchMove(dir: Dir): void {
  const store = useGameStore.getState();
  if (isMetaTerminalOpen()) return; // 终端开着时世界冻结，防误走
  if (store.activePanel !== 'none') return; // 全屏浮层打开时世界冻结，防盲走（I3）
  if (store.phase !== 'playing' || store.segment === null) return;
  // 画面方向 → 网格方向：camYaw=0 时映射恒等（默认视角语义零变化）
  store.move(cameraYawToGridDir(dir, useViewStore.getState().camYaw));
}

/** 粗指针（触屏）探测：触屏设备默认显示虚拟键，也可在设置里手动开启 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/** 十字键单方向按钮：按住经 repeater 连推，抬起即停 */
function PadButton(props: {
  readonly dir: Dir;
  readonly glyph: string;
  readonly gridArea: string;
  readonly label: string;
  readonly onPress: (dir: Dir) => void;
  readonly onRelease: (dir: Dir) => void;
}) {
  const { dir, glyph, gridArea, label, onPress, onRelease } = props;
  const pressingRef = useRef(false);

  const style: CSSProperties = { gridArea, ...btnBase };

  return (
    <button
      type="button"
      aria-label={label}
      style={style}
      tabIndex={-1}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        pressingRef.current = true;
        onPress(dir);
      }}
      onPointerUp={() => {
        if (!pressingRef.current) return;
        pressingRef.current = false;
        onRelease(dir);
      }}
      onPointerCancel={() => {
        if (!pressingRef.current) return;
        pressingRef.current = false;
        onRelease(dir);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {glyph}
    </button>
  );
}

const btnBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 15,
  color: 'var(--text-primary)',
  background: 'rgba(20, 26, 48, 0.66)',
  border: '1px solid rgba(124, 92, 255, 0.5)',
  borderRadius: 12,
  cursor: 'pointer',
  touchAction: 'none',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
};

/**
 * 虚拟十字键 + swipe。挂载在游玩视图根部即可，可见性自管理：
 *   <TouchPad />
 * 可见性规则：playing → 全尺寸十字键（左下）；dialogue → 右下迷你浮窗；
 * combat（布阵面板接管底部）/ gacha / result / title → 不显示。
 * 手动开关：settings.touchControls=true 强制显示；触屏设备自动显示。
 */
export function TouchPad() {
  const phase = useGameStore((s) => s.phase);
  const touchControls = useGameStore((s) => s.settings.touchControls);
  const coarse = useCoarsePointer();

  // 长按连推：fire 走 dispatchTouchMove 唯一入口（门禁 + 相机映射与键盘同路）
  const repeater = useMemo(() => createHoldRepeater<Dir>((dir) => dispatchTouchMove(dir)), []);
  useEffect(() => () => repeater.dispose(), [repeater]);

  // swipe 状态：锚点即最近一次派发位置，跨过阈值连推
  const anchorRef = useRef<Pt | null>(null);

  if (phase === 'title' || phase === 'gacha' || phase === 'result' || phase === 'combat') {
    return null;
  }
  if (!touchControls && !coarse) return null;

  if (phase === 'dialogue') {
    // 对话激活：收起为右下角半透明迷你浮窗，点击即推进对话
    return (
      <button
        type="button"
        aria-label="推进对话"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => useGameStore.getState().dispatch({ type: 'advanceDialogue' })}
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          width: 56,
          height: 56,
          zIndex: 40,
          opacity: 0.55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: 'var(--text-dim)',
          background: 'rgba(20, 26, 48, 0.55)',
          border: '1px solid rgba(124, 92, 255, 0.4)',
          borderRadius: 999,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        ▶ 继续
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 24,
        bottom: 24,
        width: 168,
        height: 168,
        zIndex: 40,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 4,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onPointerDown={(e) => {
        // 按钮区外的环/中格作为 swipe 起手面
        if (e.target instanceof Element && e.target.closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        anchorRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const anchor = anchorRef.current;
        if (anchor === null) return;
        const dx = e.clientX - anchor.x;
        const dy = e.clientY - anchor.y;
        if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) return;
        const dir = dominantDir(dx, dy);
        if (dir !== null) dispatchTouchMove(dir); // swipe 主轴方向同过唯一入口（门禁 + 相机映射）
        anchorRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        anchorRef.current = null;
      }}
      onPointerCancel={() => {
        anchorRef.current = null;
      }}
      onLostPointerCapture={() => {
        anchorRef.current = null;
      }}
    >
      {PAD_DIRECTIONS.map((item) => (
        <PadButton
          key={item.dir}
          dir={item.dir}
          glyph={item.glyph}
          gridArea={item.gridArea}
          label={item.label}
          onPress={(dir) => {
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-1' });
            repeater.press(dir, dir);
          }}
          onRelease={(dir) => repeater.release(dir)}
        />
      ))}
      {/* 中格：swipe 起手面（视觉提示滑动可用） */}
      <div
        aria-hidden
        style={{
          gridArea: '2 / 2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          letterSpacing: '0.1em',
          color: 'rgba(139, 147, 184, 0.7)',
          border: '1px dashed rgba(124, 92, 255, 0.3)',
          borderRadius: 12,
          pointerEvents: 'none',
        }}
      >
        swipe
      </div>
    </div>
  );
}
