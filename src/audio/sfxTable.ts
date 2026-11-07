/**
 * sfxTable —— 语义事件 → 音效 id 的唯一映射表。
 * ---------------------------------------------------------------------------
 * 老仓库从未有过语义映射：SanBPushChest service.js:3-10 的 playSoundEffect()
 * 每次从 20 个 wav 里「随机挑一个」播放 —— 音效与游戏事件毫无因果关系。
 * 本表是新的确定性正典：任何模块想播音效，要么直接发 bus 'sfx/play'（用
 * manifest 的 sfx id），要么发语义演出事件、由 eventSfx() 在此翻译。
 *
 * 与 core/store/gameStore.ts 已发布的裸 id 保持一致（这些 id 是 store 侧的
 * 既有约定，此处收录为语义正典，而不是另起一套）：
 *   - 'sfx-effect-3'  撞墙阻挡（gameStore applyMoveResult）
 *   - 'sfx-effect-2'  空交互（gameStore interact 无事件时）
 *   - 'sfx-effect-10' 关卡完成（gameStore finishLevelSuccessfully）
 *   - 'sfx-effect-16' 法则卡生效（gameStore applyLawCard）
 *
 * 20 个 wav 的实测时长在 0.42s ~ 1.72s（44.1/48kHz，见 manifest 测试），
 * 全量预载成本可忽略 —— 池化预载由此成立（S13：告别首键 go 门槛）。
 */

import type { FxEvent } from '../core/events/bus';

/** 语义键 → manifest 中的 sfx id */
export const SFX = {
  /** UI 确认（按钮/翻牌） */
  uiConfirm: 'sfx-effect-1',
  /** UI 取消 / 空交互 */
  uiCancel: 'sfx-effect-2',
  /** 推箱被阻挡（撞墙） */
  pushBlocked: 'sfx-effect-3',
  /** 推动箱子 */
  chestPush: 'sfx-effect-4',
  /** 玩家移动脚步 */
  playerStep: 'sfx-effect-6',
  /** 战斗火花（命中） */
  combatSpark: 'sfx-effect-7',
  /** 攻击被格挡 */
  combatBlocked: 'sfx-effect-9',
  /** 关卡完成 / 成就解锁的欢庆音 */
  levelComplete: 'sfx-effect-10',
  /** 对话推进 */
  dialogueAdvance: 'sfx-effect-11',
  /** BOSS 入场刻字标题 */
  bossTitle: 'sfx-effect-12',
  /** 暴击震屏 */
  critStrike: 'sfx-effect-13',
  /** 位面切换（阴阳面翻转） */
  planeShift: 'sfx-effect-14',
  /** 抽卡光柱/翻牌 */
  gachaBurst: 'sfx-effect-15',
  /** 法则卡生效 */
  lawApplied: 'sfx-effect-16',
  /** 4★ 稀有出货 */
  gachaRare: 'sfx-effect-17',
  /** 石板落上基座 */
  stoneOnBase: 'sfx-effect-18',
  /** 短促提示（伪系统消息/彩蛋） */
  systemPing: 'sfx-effect-19',
  /** 隐藏彩蛋专用（连点 20 次、META 终端） */
  easterEgg: 'sfx-effect-20',
} as const;

export type SfxKey = keyof typeof SFX;

/** 全量预载清单（id 去重，保持稳定顺序） */
export const PRELOAD_SFX_IDS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.values(SFX))),
);

/** 同一音效的最小重播间隔（ms）：压掉 store 高频发布导致的爆音 */
export const SFX_MIN_INTERVAL_MS: Readonly<Record<SfxKey, number>> = Object.freeze({
  uiConfirm: 40,
  uiCancel: 40,
  pushBlocked: 120,
  chestPush: 90,
  playerStep: 90,
  combatSpark: 80,
  combatBlocked: 80,
  levelComplete: 300,
  dialogueAdvance: 60,
  bossTitle: 500,
  critStrike: 200,
  planeShift: 300,
  gachaBurst: 200,
  lawApplied: 200,
  gachaRare: 300,
  stoneOnBase: 120,
  systemPing: 80,
  easterEgg: 200,
});

/**
 * 演出事件 → 语义音效键。返回 null 表示该事件不配音（如运镜、调试标记）。
 * 纯函数：无副作用，vitest 可穷举断言「每个事件类型都有明确归属」。
 */
export function eventSfx(event: FxEvent): SfxKey | null {
  switch (event.type) {
    case 'anim/blocked':
      return 'pushBlocked';
    case 'anim/goalBurst':
      return 'stoneOnBase';
    case 'anim/spark':
      return event.blocked ? 'combatBlocked' : 'combatSpark';
    case 'anim/screenShake':
      return 'critStrike';
    case 'anim/bossTitle':
      return 'bossTitle';
    case 'anim/gachaBurst':
      return event.rarity >= 4 ? 'gachaRare' : 'gachaBurst';
    case 'fx/planeShift':
      return 'planeShift';
    case 'bgm/play':
    case 'bgm/stop':
    case 'sfx/play':
    case 'anim/slide':
    case 'camera/orbitTo':
    case 'ui/toast':
    case 'debug/mark':
      return null;
    default: {
      const exhaustive: never = event;
      void exhaustive;
      return null;
    }
  }
}
