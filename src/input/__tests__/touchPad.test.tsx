/**
 * TouchPad 单测 —— 触屏世界移动唯一入口 dispatchTouchMove（A1-1/A1-2）。
 * ---------------------------------------------------------------------------
 * 回归根因：
 *   - A1-1 十字键/swipe 方向不随相机偏航映射：斜置相机（camYaw=π/2）下触屏
 *     「▲」走出世界网格 up，而键盘 W 走画面方向 left —— 两条互相垂直的路。
 *     修复后两入口同过 dispatchTouchMove，方向统一经 theme.cameraYawToGridDir
 *     （camYaw=0 恒等，默认视角语义零变化）。
 *   - A1-2 十字键绕过全屏浮层输入冻结（I3 只覆盖键盘路径）：卡组面板打开时
 *     十字键仍可盲走。修复后触屏与键盘 dispatchBinding 消费同一门禁
 *     （META 终端 + activePanel）。
 * 纪律：所有断言只碰内存 store —— 测试结束 resetSave / camYaw / peeking /
 * 终端态全部归位，「演示不污染存档」同样适用于测试进程。
 * DOM 链路说明：jsdom 25 无 PointerEvent 且无 setPointerCapture —— 合成事件
 * 用 MouseEvent（React 按事件名监听，clientX/clientY 语义一致），capture 打
 * no-op 补丁（与缺陷实机验证同一手段）。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../core/store/gameStore';
import { useViewStore } from '../../view/three/viewStore';
import { isMetaTerminalOpen, setMetaTerminalOpen } from '../MetaTerminal';
import { SWIPE_THRESHOLD_PX, TouchPad, dispatchTouchMove } from '../TouchPad';

// React 18 要求显式声明 act 环境，否则每次 act 都刷告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  useGameStore.getState().resetSave();
  // 十字键默认只在触屏设备显示：测试用设置开关强制显示（手动开启者同款路径）
  useGameStore.setState((s) => ({ settings: { ...s.settings, touchControls: true } }));
  useViewStore.getState().setCamYaw(0);
  useViewStore.getState().setPeeking(false);
  setMetaTerminalOpen(false);
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  // 归位会话态，不跨测试泄漏（与 keyActions.test 同一纪律）
  setMetaTerminalOpen(false);
  useViewStore.getState().setCamYaw(0);
  useViewStore.getState().setPeeking(false);
  useGameStore.getState().resetSave();
});

beforeAll(() => {
  // jsdom 无 setPointerCapture：PadButton/容器按下时打 no-op 补丁
  (HTMLElement.prototype as { setPointerCapture?: (id: number) => void }).setPointerCapture =
    () => {};
});

afterAll(() => {
  delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
});

const playerPos = (): { x: number; y: number } => {
  const player = useGameStore.getState().segment?.entities.find((e) => e.kind === 'player');
  if (player === undefined) throw new Error('段位里没有玩家实体');
  return { x: player.x, y: player.y };
};

/** 进入 level-sb-01 游玩相（出生点上第 0 行整排墙：up 恒 blocked，down 可走） */
function startPlaying(): { x: number; y: number } {
  useGameStore.getState().startLevel('level-sb-01');
  return playerPos();
}

function mountPad(): HTMLElement {
  act(() => {
    root = createRoot(host);
    root!.render(<TouchPad />);
  });
  return host;
}

const padButton = (pad: HTMLElement, label: string): HTMLButtonElement => {
  const btn = [...pad.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
  expect(btn, `十字键「${label}」未挂载`).toBeDefined();
  return btn as HTMLButtonElement;
};

describe('dispatchTouchMove —— 触屏世界移动唯一入口（repeater fire 与 swipe 共用）', () => {
  it('camYaw=0 映射恒等：触屏「向下」= 网格 down（默认视角语义零变化）', () => {
    const spawn = startPlaying();
    dispatchTouchMove('down');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
  });

  it('A1-1：camYaw=π/2 时触屏「▲」与键盘 W 同路 —— 网格 left（x-1）', () => {
    startPlaying();
    useViewStore.getState().setCamYaw(Math.PI / 2);
    const spawn = playerPos();
    dispatchTouchMove('up');
    // 修复前走世界网格 up（出生点上墙 blocked 不动/开阔地 y-1），与键盘 W 垂直
    expect(playerPos()).toEqual({ x: spawn.x - 1, y: spawn.y });
  });

  it('A1-1：camYaw 归 0 后映射回恒等（相机回正语义同步恢复）', () => {
    startPlaying();
    useViewStore.getState().setCamYaw(Math.PI / 2);
    const afterUp = playerPos();
    dispatchTouchMove('up'); // → left
    expect(playerPos().x).toBe(afterUp.x - 1);
    useViewStore.getState().setCamYaw(0);
    dispatchTouchMove('down'); // → 网格 down（恒等）
    expect(playerPos()).toEqual({ x: afterUp.x - 1, y: afterUp.y + 1 });
  });

  it('A1-2：全屏浮层（卡组面板）打开时触屏移动冻结，关闭后解冻（I3 与键盘同款）', () => {
    const spawn = startPlaying();
    useGameStore.getState().openPanel('deck');
    expect(useGameStore.getState().activePanel).toBe('deck');
    dispatchTouchMove('down');
    // 修复前浮层后盲走一格
    expect(playerPos()).toEqual(spawn);
    useGameStore.getState().closeOverlay();
    dispatchTouchMove('down');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
  });

  it('A1-2：META 终端打开时触屏移动冻结（与键盘同一门禁语义）', () => {
    const spawn = startPlaying();
    // C2-L2 解锁门禁：setMetaTerminalOpen(true) 对未解锁存档是 no-op + toast，
    // 先写解锁旗标（BOSS 结局明示解锁的同款路径）再开终端
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, 'meta:terminal-unlocked': true } },
    }));
    setMetaTerminalOpen(true);
    expect(useGameStore.getState().segment !== null && isMetaTerminalOpen()).toBe(true);
    dispatchTouchMove('down');
    expect(playerPos()).toEqual(spawn);
    setMetaTerminalOpen(false);
    dispatchTouchMove('down');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
  });

  it('无段位（标题页）触屏移动是无操作（与键盘 segment===null 守卫一致）', () => {
    expect(useGameStore.getState().segment).toBeNull();
    expect(() => dispatchTouchMove('down')).not.toThrow();
    expect(useGameStore.getState().segment).toBeNull();
  });
});

describe('TouchPad DOM 链路 —— 十字键/swipe 全链路与键盘同路', () => {
  it('十字键「▲」按下即走一步：camYaw=π/2 时走网格 left（A1-1 经 repeater.fire 全链路）', () => {
    startPlaying();
    useViewStore.getState().setCamYaw(Math.PI / 2);
    const spawn = playerPos();
    const pad = mountPad();
    const upBtn = padButton(pad, '向上');
    act(() => {
      upBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      upBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    // repeater.press 内同步 fire 一步 → dispatchTouchMove → 相机映射后的 store.move
    expect(playerPos()).toEqual({ x: spawn.x - 1, y: spawn.y });
  });

  it('A1-2 全链路：浮层打开时十字键仍显示（触屏可见性规则未收窄）但按下世界冻结', () => {
    const spawn = startPlaying();
    useGameStore.getState().openPanel('deck');
    const pad = mountPad();
    const upBtn = padButton(pad, '向上');
    const downBtn = padButton(pad, '向下'); // 出生点上方第 0 行是墙：解冻断言用「向下」（必可走）
    act(() => {
      downBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      downBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(playerPos()).toEqual(spawn); // 盲走在唯一入口被拦
    useGameStore.getState().closeOverlay();
    act(() => {
      downBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      downBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 }); // Esc 关浮层后解冻
    // 「向上」按钮在浮层开时同样被拦（出生点上墙 blocked 本就不动，此处只锁门禁不锁位移）
    useGameStore.getState().openPanel('deck');
    act(() => {
      upBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      upBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
  });

  it('swipe 连推同过唯一入口：camYaw=π/2 向上滑 = 网格 left（A1-1 swipe 主轴同理）', () => {
    startPlaying();
    useViewStore.getState().setCamYaw(Math.PI / 2);
    const spawn = playerPos();
    const pad = mountPad();
    // TouchPad 根容器：position:fixed 的 grid div（swipe 起手面 = 非按钮区域）
    const grid = [...pad.children].find(
      (el) => el instanceof HTMLElement && el.style.position === 'fixed',
    );
    expect(grid, 'TouchPad 根容器未挂载').toBeDefined();
    act(() => {
      (grid as HTMLElement).dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 200 }),
      );
      (grid as HTMLElement).dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 100,
          clientY: 200 - SWIPE_THRESHOLD_PX - 5, // 向上滑过阈值 → dominantDir('up')
        }),
      );
    });
    expect(playerPos()).toEqual({ x: spawn.x - 1, y: spawn.y });
  });
});
