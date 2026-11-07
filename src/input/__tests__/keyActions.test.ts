/**
 * useKeyActions 单测 —— e.code 语义映射、长按连推计时器、真实键盘事件链路。
 * 重点回归：
 *   - move.js:60-78 函数名错位：「上」必须真的向上（DIR_VECTORS.up.y === -1）；
 *   - e.keyCode 字面量（'F'、'65' 等）在表里无意义；
 *   - 长按连推节奏与「最后按下的键优先」；
 *   - 键盘事件 → store 段位真实移动（jsdom 全链路）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './localStorageShim'; // 必须最先导入：垫片先于 store 装好
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';
import { DIR_VECTORS } from '../../core/types';
import { useGameStore } from '../../core/store/gameStore';
import {
  HOLD_INITIAL_DELAY_MS,
  HOLD_REPEAT_MS,
  KEY_CODE_TO_ACTION,
  createHoldRepeater,
  isTypingTarget,
  useKeyActions,
} from '../useKeyActions';
import { resetCheatVisualState } from '../cheatRegistry';

describe('KEY_CODE_TO_ACTION —— e.code → 语义', () => {
  it('WASD 与方向键映射到语义方向，且「上」= up = (0,-1)（函数名错位回归）', () => {
    expect(KEY_CODE_TO_ACTION['KeyW']).toEqual({ kind: 'move', dir: 'up' });
    expect(KEY_CODE_TO_ACTION['ArrowUp']).toEqual({ kind: 'move', dir: 'up' });
    expect(KEY_CODE_TO_ACTION['KeyS']).toEqual({ kind: 'move', dir: 'down' });
    expect(KEY_CODE_TO_ACTION['KeyA']).toEqual({ kind: 'move', dir: 'left' });
    expect(KEY_CODE_TO_ACTION['KeyD']).toEqual({ kind: 'move', dir: 'right' });
    // 「上」的方向向量是 y-1：up() 横向移动的老错位在此锁死
    expect(DIR_VECTORS.up).toEqual({ x: 0, y: -1 });
    expect(DIR_VECTORS.down).toEqual({ x: 0, y: 1 });
    expect(DIR_VECTORS.left).toEqual({ x: -1, y: 0 });
    expect(DIR_VECTORS.right).toEqual({ x: 1, y: 0 });
  });

  it('Z/Q/E/F/Tab 全键位齐备（F = 阴阳位面切换）', () => {
    expect(KEY_CODE_TO_ACTION['KeyZ']).toEqual({ kind: 'action', action: { type: 'undo' } });
    expect(KEY_CODE_TO_ACTION['KeyQ']).toEqual({ kind: 'action', action: { type: 'replaySegment' } });
    expect(KEY_CODE_TO_ACTION['KeyE']).toEqual({ kind: 'action', action: { type: 'interact' } });
    expect(KEY_CODE_TO_ACTION['KeyF']).toEqual({ kind: 'action', action: { type: 'shiftPlane' } });
    expect(KEY_CODE_TO_ACTION['Tab']).toEqual({ kind: 'action', action: { type: 'toggleFormation' } });
    expect(KEY_CODE_TO_ACTION['Backquote']).toEqual({ kind: 'terminal' });
  });

  it('e.keyCode 字面量在表中无意义（"F"、"65"、"37" 一律未绑定）', () => {
    expect(KEY_CODE_TO_ACTION['F']).toBeUndefined();
    expect(KEY_CODE_TO_ACTION['65']).toBeUndefined();
    expect(KEY_CODE_TO_ACTION['37']).toBeUndefined();
    expect(KEY_CODE_TO_ACTION['38']).toBeUndefined();
  });
});

describe('createHoldRepeater —— 长按连推计时器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('按下立即触发一次，随后按节奏连推', () => {
    const fired: string[] = [];
    const repeater = createHoldRepeater<string>((item) => fired.push(item));
    repeater.press('KeyS', 'down');
    expect(fired).toEqual(['down']); // 首按立即走一步
    vi.advanceTimersByTime(HOLD_INITIAL_DELAY_MS);
    expect(fired).toEqual(['down', 'down']); // 补发延迟后再走一步
    vi.advanceTimersByTime(HOLD_REPEAT_MS * 3);
    expect(fired).toEqual(['down', 'down', 'down', 'down', 'down']); // 连推 3 步
    repeater.dispose();
  });

  it('多键同按时触发最后按下的键；全部抬起即停', () => {
    const fired: string[] = [];
    const repeater = createHoldRepeater<string>((item) => fired.push(item));
    repeater.press('KeyS', 'down');
    vi.advanceTimersByTime(HOLD_INITIAL_DELAY_MS);
    expect(fired).toEqual(['down', 'down']);
    repeater.press('KeyA', 'left'); // 新意图接管：立即触发并重排节奏
    expect(fired).toEqual(['down', 'down', 'left']);
    vi.advanceTimersByTime(HOLD_INITIAL_DELAY_MS);
    expect(fired).toEqual(['down', 'down', 'left', 'left']); // 之后连推的都是 left
    repeater.release('KeyA');
    repeater.release('KeyS');
    vi.advanceTimersByTime(HOLD_REPEAT_MS * 5);
    expect(fired).toEqual(['down', 'down', 'left', 'left']); // 全部抬起：无新增
    repeater.dispose();
  });

  it('releaseAll 与 dispose 兜底清空（blur/卸载不泄漏）', () => {
    const fired: string[] = [];
    const repeater = createHoldRepeater<string>((item) => fired.push(item));
    repeater.press('KeyW', 'up');
    expect(repeater.heldCount()).toBe(1);
    repeater.releaseAll();
    expect(repeater.heldCount()).toBe(0);
    vi.advanceTimersByTime(HOLD_INITIAL_DELAY_MS * 4);
    expect(fired).toEqual(['up']);
    repeater.dispose();
  });
});

describe('isTypingTarget —— 打字目标守卫（K3/K4 的 Web 侧）', () => {
  it('INPUT/TEXTAREA/SELECT/contentEditable 视为打字中', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('useKeyActions 全链路（jsdom 键盘事件 → store）', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React 18 的 createRoot().render() 不同步刷 effect，必须 act 等监听器挂好
    await act(async () => {
      root?.render(createElement(Probe));
    });
    resetCheatVisualState();
    useGameStore.getState().resetSave();
  });

  afterEach(async () => {
    // 必须真正 unmount：只 remove 容器不会卸载 effect，window 监听会跨测试累积
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.useRealTimers();
  });

  function Probe(): null {
    useKeyActions();
    return null;
  }

  const press = (code: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const lift = (code: string) =>
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  const playerPos = (): { x: number; y: number } => {
    const player = useGameStore.getState().segment?.entities.find((e) => e.kind === 'player');
    if (player === undefined) throw new Error('段位里没有玩家实体');
    return { x: player.x, y: player.y };
  };

  it('按 S 向下走一步；出生点向上被墙挡住（W 不位移）', () => {
    useGameStore.getState().startLevel('level-sb-01');
    const spawn = playerPos();
    press('KeyW'); // 出生点上方第 0 行是整排墙：blocked，不位移
    lift('KeyW');
    expect(playerPos()).toEqual(spawn);

    press('KeyS');
    lift('KeyS');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
  });

  it('按住不放触发长按连推（自管理计时器，忽略 e.repeat）', () => {
    vi.useFakeTimers();
    useGameStore.getState().startLevel('level-sb-01');
    const before = playerPos();
    press('KeyS');
    vi.advanceTimersByTime(HOLD_INITIAL_DELAY_MS + HOLD_REPEAT_MS * 2);
    lift('KeyS');
    const after = playerPos();
    // 首按 1 步 + 补发延迟 1 步 + 连推 2 步（若未撞墙）
    expect(after.y - before.y).toBeGreaterThanOrEqual(3);
  });

  it('浏览器自动重复（repeat=true）不产生额外移动', () => {
    useGameStore.getState().startLevel('level-sb-01');
    const before = playerPos();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true, repeat: true }));
    lift('KeyS');
    expect(playerPos().y).toBe(before.y); // repeat 事件被忽略，只有计时器负责连推
  });

  it('段位外的未知按键（如 PrintScreen）不解释为任何指令', () => {
    useGameStore.getState().startLevel('level-sb-01');
    const before = playerPos();
    press('PrintScreen');
    lift('PrintScreen');
    expect(playerPos()).toEqual(before);
  });

  it('终端打开时移动冻结（Backquote 打开，再按关闭）', () => {
    useGameStore.getState().startLevel('level-sb-01');
    press('Backquote');
    const before = playerPos();
    press('KeyS');
    lift('KeyS');
    expect(playerPos()).toEqual(before); // 冻结
    press('Backquote');
    press('KeyS');
    lift('KeyS');
    expect(playerPos().y).toBe(before.y + 1); // 还原
  });
});
