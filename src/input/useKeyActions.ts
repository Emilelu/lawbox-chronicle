/**
 * useKeyActions —— 键盘输入归一化（输入层唯一键盘事件源）。
 * ---------------------------------------------------------------------------
 * 根治清单：
 *   - e.keyCode 字面量退场：全部按 e.code 建表（KeyW/ArrowUp/…），一张
 *     KEY_CODE_TO_ACTION 语义映射表可见可测；K3/K4 的「未知输入被当移动」
 *     在结构上不可能——表里没有的 code 直接忽略。
 *   - move.js:60-78 函数名错位退场：不再有 up() 却横向移动的四函数，方向
 *     语义由 core/types 的 DIR_VECTORS 单点定义，回归测试锁死「上=up」。
 *   - 长按连推：自管理按压计时器（首按立即走一步，随后按节奏连推），
 *     浏览器自动重复（e.repeat）一律忽略，blur/卸载兜底释放，无泄漏。
 *   - S14 根治：这里没有任何 try/catch 吞异常；异常直接抛给
 *     ErrorBoundary 上屏告警（老 SanBPushChest「这根本就不是问题!」终结）。
 *   - K3：exit/未知输入永远走 META 终端回显，绝不被解释成移动。
 *   - I3：全屏浮层（卡组/抽卡/设置/手册）打开时世界冻结 —— 移动/推挤、
 *     撤销/重玩/位面切换、法则动作与 E 交互统一过 activePanel 门禁，
 *     与 META 终端「终端开着时世界冻结」同一语义（Esc 关浮层后恢复）；
 *     触屏入口（TouchPad.dispatchTouchMove）消费同一门禁与相机映射。
 */

import { useEffect } from 'react';
import type { DiagDir, Dir, GameAction } from '../core/types';
import { useGameStore } from '../core/store/gameStore';
import { cameraYawToDiagDir, cameraYawToGridDir } from '../view/three/theme';
import { useViewStore } from '../view/three/viewStore';
import { executeCheat, HOTKEY_CHEATS } from './cheatRegistry';
import { isMetaTerminalOpen, toggleMetaTerminal } from './MetaTerminal';

/* ============================ e.code → 语义绑定 ============================ */

export type KeyBinding =
  | { readonly kind: 'move'; readonly dir: Dir }
  | { readonly kind: 'action'; readonly action: GameAction }
  | { readonly kind: 'cheat'; readonly cheatId: string }
  | { readonly kind: 'view' }
  | { readonly kind: 'terminal' };

/**
 * 全键位表：WASD/方向键移动（combat 布阵期 = 推挤；Shift+方向 = 拉箱）、
 * Y/U/B/N 斜向推挤（roguelike 对角惯例）、C 相位穿行（沿最近移动方向）、
 * Z 撤销、Q 重玩本段、E 交互、F 阴阳位面切换、Tab 切布阵模式；
 * V 第一/第三人称视角切换（viewStore，任意相位可用）、
 * M 静音、Enter/Space 推进对话、Esc 关闭浮层（S11）。
 * KeyT（战术俯瞰）是按住语义，不走绑定表 —— 在 onKeyDown/KeyUp 直接写
 * viewStore.peeking（CameraRig 内部自发位姿消费）。
 * 作弊热键（K/[/]/R/G）经 HOTKEY_CHEATS 同表共存，但执行必过 CheatRegistry
 * （KeyV 原绑墙皮重掷，已让位给视角切换，墙皮重掷改绑 KeyG）。
 * 注意键名全部是 e.code：'F'、'65' 这类 e.keyCode 字面量在本表无意义。
 */
export const KEY_CODE_TO_ACTION: Readonly<Record<string, KeyBinding>> = Object.freeze({
  KeyW: { kind: 'move', dir: 'up' },
  ArrowUp: { kind: 'move', dir: 'up' },
  KeyS: { kind: 'move', dir: 'down' },
  ArrowDown: { kind: 'move', dir: 'down' },
  KeyA: { kind: 'move', dir: 'left' },
  ArrowLeft: { kind: 'move', dir: 'left' },
  KeyD: { kind: 'move', dir: 'right' },
  ArrowRight: { kind: 'move', dir: 'right' },

  // 斜向推挤（法则卡「斜向推挤」解锁后生效）：Y↖ U↗ B↙ N↘
  KeyY: { kind: 'action', action: { type: 'diagonal', diag: 'upleft' } },
  KeyU: { kind: 'action', action: { type: 'diagonal', diag: 'upright' } },
  KeyB: { kind: 'action', action: { type: 'diagonal', diag: 'downleft' } },
  KeyN: { kind: 'action', action: { type: 'diagonal', diag: 'downright' } },
  // 相位穿行（法则卡「相位穿行」解锁后生效）：C = 沿最近一次移动方向穿行
  KeyC: { kind: 'action', action: { type: 'phase' } },

  KeyZ: { kind: 'action', action: { type: 'undo' } },
  KeyQ: { kind: 'action', action: { type: 'replaySegment' } },
  KeyE: { kind: 'action', action: { type: 'interact' } },
  KeyF: { kind: 'action', action: { type: 'shiftPlane' } },
  Tab: { kind: 'action', action: { type: 'toggleFormation' } },
  KeyM: { kind: 'action', action: { type: 'toggleMute' } },
  // 视角切换（第一/第三人称）：独立 KeyBinding 变体，任意相位可用，
  // 只碰 viewStore 不碰 gameStore（core GameAction 无此动作，不污染语义层）
  KeyV: { kind: 'view' },
  Enter: { kind: 'action', action: { type: 'advanceDialogue' } },
  Space: { kind: 'action', action: { type: 'advanceDialogue' } },
  Escape: { kind: 'action', action: { type: 'closeOverlay' } },

  Backquote: { kind: 'terminal' },
});

/** 长按连推节奏（毫秒）：首按立即生效，随后按 repeatMs 连推 */
export const HOLD_INITIAL_DELAY_MS = 220;
export const HOLD_REPEAT_MS = 110;

/** 键盘入口的作弊热键表（commands.ts 纯数据 → cheatRegistry 汇总，e.code → 作弊 id） */
const CHEAT_HOTKEYS: Readonly<Record<string, string>> = HOTKEY_CHEATS;

/* ============================= 长按连推计时器 ============================== */

export interface HoldRepeaterOptions {
  readonly initialDelayMs?: number;
  readonly repeatMs?: number;
}

export interface HoldRepeater<T> {
  /** 按下：立即触发一次，并排定连推节奏 */
  readonly press: (id: string, item: T) => void;
  /** 抬起其中一个；其余仍按住时节奏继续取最新 */
  readonly release: (id: string) => void;
  /** 全部抬起（窗口失焦/卸载兜底） */
  readonly releaseAll: () => void;
  /** 卸载：清掉计时器 */
  readonly dispose: () => void;
  readonly heldCount: () => number;
}

/**
 * 通用按住连发器（键盘长按连推与触屏十字键共用，DOM 无关可单测）。
 * 多键同按时永远触发「最后按下的那个」（连推方向跟随最新意图）。
 */
export function createHoldRepeater<T>(fire: (item: T) => void, options: HoldRepeaterOptions = {}): HoldRepeater<T> {
  const initialDelayMs = options.initialDelayMs ?? HOLD_INITIAL_DELAY_MS;
  const repeatMs = options.repeatMs ?? HOLD_REPEAT_MS;
  const held = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const latest = (): T | undefined => {
    const items = [...held.values()];
    return items[items.length - 1];
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      const item = latest();
      if (item === undefined) return;
      fire(item);
      schedule(repeatMs);
    }, delayMs);
  };

  return {
    press(id, item) {
      held.set(id, item);
      fire(item);
      schedule(initialDelayMs);
    },
    release(id) {
      if (!held.delete(id)) return;
      if (held.size === 0) clearTimer();
      // 仍有其他按住的键：不重排计时，下一次触发自动取最新意图
    },
    releaseAll() {
      held.clear();
      clearTimer();
    },
    dispose() {
      held.clear();
      clearTimer();
    },
    heldCount: () => held.size,
  };
}

/* ============================== 派发与门禁 ================================ */

/** 正在往输入框/终端里打字时，键盘事件绝不落进游戏（K3/K4 的 Web 侧守卫） */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable === true
  );
}

/* ====================== 相机相对方向（映射 helper） ======================== */

/**
 * 输入方向 → 网格方向：按相机偏航旋转（theme.cameraYawToGridDir 纯函数）。
 * camYaw 由 CameraRig 发布进 viewStore；第三人称方位角 0 时映射恒等 ——
 * 存档/攻略箭头/预计算解路零影响。
 */
function mappedDir(dir: Dir): Dir {
  return cameraYawToGridDir(dir, useViewStore.getState().camYaw);
}

/** 斜向意图（Y/U/B/N）随相机偏航旋转后再 snap 到最近斜向 */
function mappedDiag(diag: DiagDir): DiagDir {
  return cameraYawToDiagDir(diag, useViewStore.getState().camYaw);
}

/** 按当前阶段把语义绑定派发进 store；表外一律不解释（K3） */
export function dispatchBinding(binding: KeyBinding): void {
  // 视角切换最前置：任意相位可用（与静音/关浮层同语义），只碰 viewStore
  // 不碰 gameStore —— 终端/浮层/对话/标题页都不拦截
  if (binding.kind === 'view') {
    useViewStore.getState().toggle();
    return;
  }
  const store = useGameStore.getState();
  if (binding.kind === 'move') {
    if (isMetaTerminalOpen()) return; // 终端开着时世界冻结，防误走
    if (store.activePanel !== 'none') return; // 全屏浮层（卡组/抽卡/设置/手册）打开时世界同样冻结，防盲走（I3）
    if (store.phase === 'dialogue') return; // 对话中移动键无效（推进走 Enter/Space/E）
    if (store.segment === null) return; // 标题页等无段位：移动是无操作
    if (store.phase === 'combat') {
      // 布阵推挤战：combat 期方向键 = 推挤敌人方块（引擎只在 formation 相结算）；
      // 方向随相机偏航映射（斜置相机下 W = 画面上的网格方向）
      store.dispatch({ type: 'shove', dir: mappedDir(binding.dir) });
      return;
    }
    store.dispatch({ type: 'move', dir: mappedDir(binding.dir) });
    return;
  }
  if (binding.kind === 'cheat') {
    executeCheat(binding.cheatId, 'keyboard');
    return;
  }
  if (binding.kind === 'terminal') {
    // 解锁门禁在 MetaTerminal 模块态单点落实（未解锁 no-op + toast，C2-L2）：
    // 这里保持无条件转发，不另设第二真相源
    toggleMetaTerminal();
    return;
  }
  // kind === 'action'
  switch (binding.action.type) {
    case 'undo':
    case 'replaySegment':
    case 'shiftPlane':
      if (isMetaTerminalOpen()) return;
      if (store.activePanel !== 'none') return; // 浮层后面不盲改世界状态（I3，与终端同语义）
      if (store.phase === 'playing' || store.phase === 'result' || store.phase === 'combat') {
        store.dispatch(binding.action);
      }
      return;
    case 'toggleFormation':
      // Tab 双语义：战斗中=确认布阵；无战斗=打开卡组面板。不做浮层门禁 ——
      // 卡组面板开着时 Tab 语义本就是「再开卡组」，保持原行为不收窄。
      if (isMetaTerminalOpen()) return;
      if (store.phase === 'playing' || store.phase === 'result' || store.phase === 'combat') {
        store.dispatch(binding.action);
      }
      return;
    case 'pull':
    case 'diagonal':
    case 'phase': {
      // 法则动作只在游玩相生效（未持对应法则卡时 store 侧 toast 明示）
      if (isMetaTerminalOpen()) return;
      if (store.activePanel !== 'none') return; // 浮层打开时不改世界（I3）
      if (store.phase !== 'playing') return;
      if (binding.action.type === 'diagonal') {
        // 斜向意图随相机偏航旋转后再 snap（Y/U/B/N 的相机相对版）；
        // pull 的映射在 Shift+方向构造点完成（pull 动作唯一出生点），此处不再
        // 二次旋转，防双重映射
        store.dispatch({ type: 'diagonal', diag: mappedDiag(binding.action.diag) });
        return;
      }
      store.dispatch(binding.action);
      return;
    }
    case 'interact':
      if (isMetaTerminalOpen()) return;
      if (store.activePanel !== 'none') return; // 浮层打开时不触发世界交互（I3）
      if (store.phase === 'dialogue') store.dispatch({ type: 'advanceDialogue' });
      else if (store.phase === 'playing') store.dispatch(binding.action);
      return;
    case 'advanceDialogue':
      if (store.phase === 'dialogue') store.dispatch(binding.action);
      return;
    case 'toggleMute':
    case 'closeOverlay':
      // S11：静音与关闭浮层永可用，菜单/终局永不锁死
      store.dispatch(binding.action);
      return;
    default:
      return;
  }
}

/* ================================ Hook ==================================== */

/**
 * 全局键盘输入 hook。在 App 根部挂载一次即可：
 *   useKeyActions();
 * 事件挂 window，卸载时全部移除；无任何全局可变残留。
 */
export function useKeyActions(): void {
  useEffect(() => {
    const repeater = createHoldRepeater<string>((code) => {
      const binding = KEY_CODE_TO_ACTION[code];
      if (binding !== undefined && binding.kind === 'move') dispatchBinding(binding);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return; // 终端/表单打字优先
      if (event.isComposing) return; // 中文输入法组字期不碰游戏
      if (event.code === 'KeyT') {
        // 战术俯瞰：按住即写 peeking（CameraRig 内部自发 explore 俯瞰位姿），
        // 松开的 keyup 写回 false —— 按住语义，不进绑定表、不走连推计时器；
        // 必须排在「未知输入」守卫之前（KeyT 不在绑定表内）
        if (!event.repeat) useViewStore.getState().setPeeking(true);
        return;
      }
      const binding = KEY_CODE_TO_ACTION[event.code];
      const cheatId = CHEAT_HOTKEYS[event.code];
      if (binding === undefined && cheatId === undefined) return; // 未知输入：不解释成任何游戏指令（K3/K4）
      // 先拦默认行为再决定是否派发指令（A1-6）：浏览器自动重复（repeat=true）的
      // Tab/Space/方向键同样必须 preventDefault —— 否则长按 Tab 的每一拍都会把
      // 焦点移出游戏到 HUD 按钮（焦点逃逸），Space 长按可滚动页面
      if (event.code === 'Tab' || event.code === 'Space' || event.code.startsWith('Arrow')) {
        event.preventDefault();
      }
      if (event.repeat) return; // 连推由自管理计时器负责，浏览器自动重复忽略
      if (binding === undefined) {
        // 未被玩法键占用的 code 才轮到作弊热键（K/[/]/R/G）；
        // 即便如此仍必过 CheatRegistry 的解锁谓词（S9：热键无特权）
        if (cheatId !== undefined) executeCheat(cheatId, 'keyboard');
        return;
      }
      if (binding.kind === 'move') {
        // Shift+方向 = 镜像拉箱（法则卡解锁后生效）：离散动作，不走连推计时器；
        // 方向随相机偏航映射（pull 动作的唯一出生点，dispatchBinding 不再二次映射）
        if (event.shiftKey) {
          dispatchBinding({ kind: 'action', action: { type: 'pull', dir: mappedDir(binding.dir) } });
          return;
        }
        // 移动键：首步与连推统一由 repeater 触发（press 内立即走一步），
        // 否则一次 keydown 会被派发两次 —— 单一触发源是硬约束
        repeater.press(event.code, event.code);
        return;
      }
      dispatchBinding(binding);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyT') {
        useViewStore.getState().setPeeking(false); // 松开回落：CameraRig 自发回 FP/third 位姿
        return;
      }
      repeater.release(event.code);
    };

    const onBlur = () => {
      repeater.releaseAll(); // 切窗/失焦兜底，杜绝「回过神来角色还在走」
      // KeyT 按住态一并释放（A1-4）：失焦时 keyup 永不到达，peeking 不释放会让
      // 战术俯瞰永久粘滞（切窗回来画面锁死在俯瞰位）
      useViewStore.getState().setPeeking(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      repeater.dispose();
    };
  }, []);
}
