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
  REPLAY_CONFIRM_MS,
  createHoldRepeater,
  dispatchBinding,
  isTypingTarget,
  useKeyActions,
} from '../useKeyActions';
import { isMetaTerminalOpen, setMetaTerminalOpen } from '../MetaTerminal';
import { CHEAT_SKIN_COUNT, HOTKEY_CHEATS, getVisualState, resetCheatVisualState } from '../cheatRegistry';
import { bus } from '../../core/events/bus';
import { useViewStore } from '../../view/three/viewStore';

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

  it('KeyV 绑定视角切换（独立 view 变体，GameAction 零改动）；热键表同步换防', () => {
    expect(KEY_CODE_TO_ACTION['KeyV']).toEqual({ kind: 'view' });
    // KeyV 原绑 cheat-wall-shuffle 已让位：热键表里 KeyV 必须退场
    expect(HOTKEY_CHEATS['KeyV']).toBeUndefined();
    // 墙皮重掷改绑 KeyG；皮肤轮换 KeyR 不受影响
    expect(HOTKEY_CHEATS['KeyG']).toBe('cheat-wall-shuffle');
    expect(HOTKEY_CHEATS['KeyR']).toBe('cheat-skin-next');
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
    // 视角档分片是模块级 store：每个用例前归位默认值，不跨测试泄漏
    useViewStore.getState().setViewPreference('first');
    useViewStore.getState().setPeeking(false);
    useViewStore.getState().setCamYaw(0);
    useViewStore.getState().setCamDistance(0);
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
    setMetaTerminalOpen(false); // 终端是模块态：兜底关闭，不跨测试泄漏（关闭永远放行）
    useViewStore.getState().setPeeking(false); // KeyT 按住态兜底释放
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

  const chestCount = (): number =>
    useGameStore.getState().segment?.entities.filter((e) => e.kind === 'chest').length ?? 0;

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
    // C2-L2 后热键有解锁门禁：先写解锁旗标（BOSS 结局明示解锁的同款路径）
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, 'meta:terminal-unlocked': true } },
    }));
    press('Backquote');
    expect(isMetaTerminalOpen()).toBe(true); // 已解锁：终端真的打开
    const before = playerPos();
    press('KeyS');
    lift('KeyS');
    expect(playerPos()).toEqual(before); // 冻结
    press('Backquote');
    expect(isMetaTerminalOpen()).toBe(false);
    press('KeyS');
    lift('KeyS');
    expect(playerPos().y).toBe(before.y + 1); // 还原
  });

  it('C2-L2：终端未解锁时按 Backquote 无效果，玩法键不被吞（隐形终端回归）', () => {
    useGameStore.getState().startLevel('level-sb-01'); // 新存档未通关、无解锁旗标
    press('Backquote');
    lift('Backquote');
    expect(isMetaTerminalOpen()).toBe(false); // 没有随之产生的「隐形终端」
    const before = playerPos();
    press('KeyS');
    lift('KeyS');
    expect(playerPos().y).toBe(before.y + 1); // 移动照常生效，输入不再被静默吞掉
  });

  it('全屏浮层（抽卡面板）打开时移动冻结，关闭后恢复（I3）', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    const spawn = playerPos();
    store.openPanel('gacha'); // 星愿祭坛/星石胶囊同款全屏浮层
    press('KeyS');
    lift('KeyS');
    press('ArrowDown');
    lift('ArrowDown');
    expect(playerPos()).toEqual(spawn); // 浮层后面盲走一格的 I3 场景在此锁死
    expect(useGameStore.getState().activePanel).toBe('gacha'); // 浮层没被移动键误关
    store.closeOverlay();
    press('KeyS');
    lift('KeyS');
    expect(playerPos().y).toBe(spawn.y + 1); // Esc 关浮层后世界解冻
  });

  it('全屏浮层打开时撤销/位面切换/法则动作/交互全部冻结（I3）', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    press('KeyS');
    lift('KeyS'); // 先走一步，制造可撤销的历史
    const stepsAfterMove = useGameStore.getState().segment?.steps;
    store.openPanel('deck');
    press('KeyZ'); // 撤销
    lift('KeyZ');
    press('KeyF'); // 位面切换
    lift('KeyF');
    press('KeyC'); // 相位穿行（法则动作）
    lift('KeyC');
    press('KeyE'); // 世界交互
    lift('KeyE');
    expect(useGameStore.getState().segment?.steps).toBe(stepsAfterMove); // 撤销未生效
    expect(useGameStore.getState().activePanel).toBe('deck'); // 浮层未被 E/F 顶掉
    expect(useGameStore.getState().segment?.planeShifted).toBe(false);
    // 关闭浮层后 Z 恢复生效：步数回滚
    store.closeOverlay();
    press('KeyZ');
    lift('KeyZ');
    expect(useGameStore.getState().segment?.steps).toBe((stepsAfterMove ?? 1) - 1);
  });

  it('KeyV 切换第一/第三人称视角：任意相位可用（无段位也可切），只碰 viewStore', () => {
    // 标题页（无段位）下即可切换 —— 与静音/关浮层同语义，不进任何门禁
    press('KeyV');
    lift('KeyV');
    expect(useViewStore.getState().viewPreference).toBe('third');
    press('KeyV');
    lift('KeyV');
    expect(useViewStore.getState().viewPreference).toBe('first');
    // 游玩相同样可切，且不影响玩家位置
    useGameStore.getState().startLevel('level-sb-01');
    const before = playerPos();
    press('KeyV');
    lift('KeyV');
    expect(useViewStore.getState().viewPreference).toBe('third');
    expect(playerPos()).toEqual(before);
  });

  it('KeyV 不再触发任何作弊：作弊开关全开时墙皮纪元也不动，只有视角切换生效', () => {
    useGameStore.setState((s) => ({ settings: { ...s.settings, cheatsEnabled: true } }));
    const epochBefore = getVisualState().wallSkinEpoch;
    press('KeyV');
    lift('KeyV');
    expect(getVisualState().wallSkinEpoch).toBe(epochBefore); // 墙皮重掷未被 KeyV 触发
    expect(useViewStore.getState().viewPreference).toBe('third'); // 视角切换生效
    // 反向：KeyG 才是墙皮重掷的热键（同开关全开下纪元 +1）
    useViewStore.getState().setViewPreference('first');
    press('KeyG');
    lift('KeyG');
    expect(getVisualState().wallSkinEpoch).toBe(epochBefore + 1);
    expect(useViewStore.getState().viewPreference).toBe('first'); // KeyG 不碰视角
  });

  it('KeyT 按住进入战术俯瞰（viewStore.peeking=true）、松开回落（keyup=false）', () => {
    press('KeyT');
    expect(useViewStore.getState().peeking).toBe(true);
    // 按住期间浏览器自动重复（repeat=true）不破坏按住态（守卫跳过，状态保持 true）
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true, repeat: true }));
    expect(useViewStore.getState().peeking).toBe(true);
    lift('KeyT');
    expect(useViewStore.getState().peeking).toBe(false);
  });

  it('A1-4：KeyT 按住中窗口失焦（keyup 永不到达）→ blur 兜底释放俯瞰，不再永久粘滞', () => {
    press('KeyT');
    expect(useViewStore.getState().peeking).toBe(true);
    // 真实 alt-tab/点别的窗口的时序：blur 事件后 keyup 永远不会到达
    window.dispatchEvent(new Event('blur'));
    // 修复前 peeking 保持 true：相机收敛俯瞰位后粘滞，第三人称/头位档夹紧全部失效
    expect(useViewStore.getState().peeking).toBe(false);
    // 失焦恢复后松开 T 的 keyup 迟到：不破坏已释放的按住态（幂等）
    lift('KeyT');
    expect(useViewStore.getState().peeking).toBe(false);
  });

  it('A1-6：浏览器自动重复的 Tab/方向键在派发忽略前也阻止默认行为（焦点逃逸回归）', () => {
    // 合成 KeyboardEvent 无默认行为，preventDefault 的调用与否用 spy 断言：
    // 修复前 repeat 拍在 preventDefault 之前提前 return，OS/浏览器默认焦点遍历
    // 每拍都会把焦点移出游戏到 HUD 按钮
    const prevent = vi.spyOn(Event.prototype, 'preventDefault');
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true, repeat: true }));
      expect(prevent).toHaveBeenCalled(); // repeat 拍也拦默认行为
      prevent.mockClear();
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, repeat: true }),
      );
      expect(prevent).toHaveBeenCalled(); // 方向键 repeat 拍同理（滚动防呆）
    } finally {
      prevent.mockRestore();
    }
  });

  it('移动方向随相机偏航映射：camYaw=π/2 时按 W 向左、按 A 向下，与 mapInputDir 一致', () => {
    // 基准：camYaw=0 映射恒等，S = 网格 down（出生点向下可走，既有用例已证）
    useGameStore.getState().startLevel('level-sb-01');
    const spawn = playerPos();
    press('KeyS');
    lift('KeyS');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
    // 相机斜置 π/2（相机转到 +X 侧）：W(up)→left、A(left)→down（验收②样例）
    useViewStore.getState().setCamYaw(Math.PI / 2);
    useGameStore.getState().startLevel('level-sb-01'); // 回出生点重测
    const spawn2 = playerPos();
    press('KeyW');
    lift('KeyW');
    expect(playerPos()).toEqual({ x: spawn2.x - 1, y: spawn2.y }); // W = 网格 left
    press('KeyA');
    lift('KeyA');
    expect(playerPos()).toEqual({ x: spawn2.x - 1, y: spawn2.y + 1 }); // A = 网格 down
    // camYaw 归 0 后 W 回到恒等映射（up = 网格 up）：从 (12,2) 走回 (12,1)
    useViewStore.getState().setCamYaw(0);
    press('KeyW');
    lift('KeyW');
    expect(playerPos()).toEqual({ x: spawn2.x - 1, y: spawn2.y });
  });

  it('dispatchBinding({kind:"view"}) 直调同样切换视角（binding 变体本身可单测）', () => {
    dispatchBinding({ kind: 'view' });
    expect(useViewStore.getState().viewPreference).toBe('third');
    dispatchBinding({ kind: 'view' });
    expect(useViewStore.getState().viewPreference).toBe('first');
  });

  // ---- B1-2 / B1-5 / B1-6 回归（追加在 describe 尾部：B1-6 的双拍确认计时是
  // 模块级状态，压轴执行避免未消费的时间戳跨用例泄漏） ----

  it('B1-2：全屏浮层开着时 K/]/[ 热键冻结（不盲改浮层后的世界），R/G 纯视觉放行', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    useGameStore.setState((s) => ({ settings: { ...s.settings, cheatsEnabled: true } }));
    const chestsBefore = chestCount();
    expect(chestsBefore).toBeGreaterThan(0);
    store.openPanel('deck');
    press('KeyK'); // 消箱热键
    lift('KeyK');
    press('BracketRight'); // 跳下一关
    lift('BracketRight');
    press('BracketLeft'); // 跳上一关
    lift('BracketLeft');
    expect(chestCount()).toBe(chestsBefore); // 箱子没被浮层后面的热键消掉
    expect(useGameStore.getState().segment?.levelId).toBe('level-sb-01'); // 关卡没被偷跳
    expect(useGameStore.getState().activePanel).toBe('deck'); // 浮层也没被顶掉
    // 纯视觉类白名单（B1-2）：皮肤/墙皮只碰 cheatRegistry 的 visualState，浮层下放行
    const skinBefore = getVisualState().skinIndex;
    const epochBefore = getVisualState().wallSkinEpoch;
    press('KeyR');
    lift('KeyR');
    press('KeyG');
    lift('KeyG');
    expect(getVisualState().skinIndex).toBe((skinBefore + 1) % CHEAT_SKIN_COUNT);
    expect(getVisualState().wallSkinEpoch).toBe(epochBefore + 1);
    expect(useGameStore.getState().activePanel).toBe('deck');
    // 关浮层后同一热键恢复生效：门禁只拦冻结窗口，不收窄功能
    store.closeOverlay();
    press('KeyK');
    lift('KeyK');
    expect(chestCount()).toBe(chestsBefore - 1);
  });

  it('B1-2：META 终端开着时改世界状态的热键同样冻结；Esc 先关终端（B1-5）后热键恢复', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    useGameStore.setState((s) => ({ settings: { ...s.settings, cheatsEnabled: true } }));
    // 终端解锁旗标（BOSS 结局明示解锁的同款路径）
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, 'meta:terminal-unlocked': true } },
    }));
    press('Backquote');
    expect(isMetaTerminalOpen()).toBe(true);
    const chestsBefore = chestCount();
    press('KeyK');
    lift('KeyK');
    expect(chestCount()).toBe(chestsBefore); // 终端开着：消箱热键冻结
    // B1-5：焦点不在终端输入框（window 级 keydown）时 Esc 的第一职责是关终端
    press('Escape');
    lift('Escape');
    expect(isMetaTerminalOpen()).toBe(false);
    press('KeyK');
    lift('KeyK');
    expect(chestCount()).toBe(chestsBefore - 1); // 终端关了：热键恢复生效
  });

  it('B1-5：终端没开时 Esc 照旧关闭全屏浮层（closeOverlay 语义不收窄）', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    store.openPanel('deck');
    press('Escape');
    lift('Escape');
    expect(useGameStore.getState().activePanel).toBe('none');
  });

  it('B1-6：Q 重玩本段双拍确认——首拍只提示，窗口内第二拍才重建段位', () => {
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    press('KeyS');
    lift('KeyS'); // 先走一步，制造可丢失的进度（steps>0）
    expect(useGameStore.getState().segment?.steps ?? 0).toBeGreaterThan(0);
    const segmentBefore = useGameStore.getState().segment;
    const toasts: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === 'ui/toast') toasts.push(event.messageKey);
    });
    try {
      press('KeyQ');
      lift('KeyQ');
      expect(useGameStore.getState().segment).toBe(segmentBefore); // 首拍不执行
      expect(toasts).toEqual(['toast.replayConfirm']); // 只提示
      press('KeyQ'); // 窗口内第二拍
      lift('KeyQ');
      expect(useGameStore.getState().segment).not.toBe(segmentBefore); // 段位重建
      expect(useGameStore.getState().segment?.steps).toBe(0); // 步数清零
      expect(toasts).toEqual(['toast.replayConfirm']); // 执行拍不再提示
    } finally {
      unsubscribe();
    }
  });

  it('B1-6：确认窗口过期需重新双拍；连推进行中 Q 被完全忽略（不提示不计数）', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.startLevel('level-sb-01');
    press('KeyS');
    lift('KeyS'); // steps=1
    const toasts: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === 'ui/toast') toasts.push(event.messageKey);
    });
    try {
      press('KeyQ');
      lift('KeyQ');
      expect(toasts).toEqual(['toast.replayConfirm']); // 首拍提示
      vi.advanceTimersByTime(REPLAY_CONFIRM_MS + 1); // 确认窗口过期
      press('KeyQ');
      lift('KeyQ');
      expect(useGameStore.getState().segment?.steps).toBe(1); // 过期后第二拍不执行
      expect(toasts).toEqual(['toast.replayConfirm', 'toast.replayConfirm']); // 重新提示
      // 连推进行中（S 还按着，repeater.heldCount()>0）：Q 直接忽略，连提示都不发
      press('KeyS'); // 连推首步，steps+1
      press('KeyQ');
      lift('KeyQ');
      expect(useGameStore.getState().segment?.steps).toBe(2); // 连推在走，Q 未生效
      expect(toasts).toEqual(['toast.replayConfirm', 'toast.replayConfirm']); // 无新增提示
      lift('KeyS');
    } finally {
      unsubscribe();
    }
  });
});
