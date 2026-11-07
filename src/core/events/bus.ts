/**
 * 类型化事件总线 —— 跨层演出的唯一通道。
 * ---------------------------------------------------------------------------
 * 视图层（three/ui）与 store 之间的非状态副作用（音效、运镜、粒子、震屏）
 * 走这里解耦：store dispatch 只改状态并发事件，视图订阅渲染。
 * 零 React 依赖、零 DOM 依赖，可在 vitest 中直接断言。
 */

import type { Dir, Rarity, Vec2 } from '../types';

export type FxEvent =
  /* 音频（audio-engine 订阅；howler 生命周期挂 React，卸载即停） */
  | { readonly type: 'bgm/play'; readonly bgmId: string }
  | { readonly type: 'bgm/stop' }
  | { readonly type: 'sfx/play'; readonly sfxId: string }
  /* 推箱演出 */
  | { readonly type: 'anim/slide'; readonly entityId: string; readonly from: Vec2; readonly to: Vec2; readonly dir: Dir }
  | { readonly type: 'anim/blocked'; readonly reason: string }
  | { readonly type: 'anim/goalBurst'; readonly entityId: string }
  /* 战斗演出 */
  | { readonly type: 'anim/spark'; readonly at: Vec2; readonly blocked: boolean }
  | { readonly type: 'anim/screenShake'; readonly intensity: number }
  | { readonly type: 'anim/bossTitle'; readonly enemyId: string; readonly title: string }
  /* 抽卡演出 */
  | { readonly type: 'anim/gachaBurst'; readonly rarity: Rarity }
  /* 世界演出 */
  | { readonly type: 'fx/planeShift' }
  | { readonly type: 'camera/orbitTo'; readonly target: Vec2; readonly pitch: number }
  | { readonly type: 'ui/toast'; readonly messageKey: string }
  | { readonly type: 'ui/closePanels' }
  | { readonly type: 'debug/mark'; readonly label: string };

export type FxHandler = (event: FxEvent) => void;

export interface EventBus {
  readonly publish: (event: FxEvent) => void;
  /** 返回退订函数 */
  readonly subscribe: (handler: FxHandler) => () => void;
  /** 测试辅助：清空全部订阅 */
  readonly reset: () => void;
  readonly subscriberCount: () => number;
}

export function createBus(): EventBus {
  const handlers = new Set<FxHandler>();
  return {
    publish(event) {
      for (const handler of handlers) handler(event);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    reset() {
      handlers.clear();
    },
    subscriberCount: () => handlers.size,
  };
}

/** 全局单例：视图模块从这里 import，store/引擎也用它广播 */
export const bus: EventBus = createBus();
