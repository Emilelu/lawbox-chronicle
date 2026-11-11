/**
 * 集成流程冒烟 —— 「开始 → 游玩（冒险+推箱+抽卡）→ 胜负结算 → 再来」全链路。
 * ---------------------------------------------------------------------------
 * 直接驱动全局 store（引擎纯函数的真实接线，无 mock）：
 *   1. startLevel → 谜题引擎状态 + segment 投影同步；
 *   2. move → 实体位移（puzzle-engine 接管）；
 *   3. interact → 剧情解释器开演（天使教学 → 发匕首+角色卡+双写旗）；
 *      谢幕落格回踩 → 光羽 tile 触发（level-scoped 双坐标求值回归）；
 *   4. 踩上小怪坐标（STORY-5：蔡徐坤在 L2 (12,3)）→ 遭遇战 → 布阵选武器 →
 *      开打 → 胜利 → defeat 旗标 + 星石 + 战斗收尾回世界；
 *   5. rollGacha → performGacha 正式池 + 三层保底计数器 + 翻牌相；
 *   6. applyLawCard → 法则卡改写 RuleSet（羽箱 mass-1）/角色卡编入卡组；
 *   7. 法则门槛关（sb-02）缺卡 → 100% 补发剧本覆盖入场；
 *   8. undo / replaySegment / shiftPlane 守卫不炸。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../core/store/gameStore';
import type { PuzzleState } from '../engine/puzzle/move';
import type { BattleState } from '../engine/combat/turn';

const store = () => useGameStore.getState();
const puzzle = () => store().puzzle as PuzzleState | null;
const battle = () => store().battle as BattleState | null;

const playerPos = (): { x: number; y: number } => {
  const player = store().segment?.entities.find((e) => e.kind === 'player');
  if (player === undefined) throw new Error('段位里没有玩家实体');
  return { x: player.x, y: player.y };
};

/** 把玩家瞬移到指定网格位（走故事坐标换算后的落点） */
const teleportPlayer = (x: number, y: number): void => {
  const p = puzzle();
  if (p === null) throw new Error('谜题状态为空');
  const entities = p.entities.map((e) => (e.kind === 'player' ? { ...e, x, y } : e));
  useGameStore.setState({
    puzzle: { ...p, entities },
    segment: { ...(store().segment as NonNullable<ReturnType<typeof store>['segment']>), entities },
  });
};

beforeEach(() => {
  store().resetSave();
});

describe('流程冒烟 · 开始与推箱', () => {
  it('startLevel：谜题引擎接管，segment 投影同步，出生点即位', () => {
    store().startLevel('level-sb-01');
    expect(store().phase).toBe('playing');
    expect(puzzle()).not.toBeNull();
    expect(puzzle()?.entities.some((e) => e.kind === 'player')).toBe(true);
    expect(store().segment?.levelId).toBe('level-sb-01');
    expect(store().segment?.entities.length).toBe(puzzle()?.entities.length);
    expect(store().combat).toBeNull();
  });

  it('move：向下走一步（与 keyActions 回归同一语义），撤销可回滚', () => {
    store().startLevel('level-sb-01');
    const spawn = playerPos();
    store().move('up'); // 出生点上方第 0 行整排墙：blocked
    expect(playerPos()).toEqual(spawn);
    store().move('down');
    expect(playerPos()).toEqual({ x: spawn.x, y: spawn.y + 1 });
    expect(store().segment?.steps).toBeGreaterThan(0);
    store().undo();
    expect(playerPos()).toEqual(spawn);
    store().replaySegment();
    expect(store().segment?.steps).toBe(0);
  });
});

describe('流程冒烟 · 剧情（解释器接线）', () => {
  it('踩上天使坐标交互 → 剧本开演 → 读完发匕首+角色卡+双写旗 → 收尾；回踩同格触发光羽', () => {
    store().startLevel('level-sb-01');
    // 导航天使①：STORY-5 留主城 L1 网格 (8,6)（= 原版出生地 (1,0) 的重化格）
    teleportPlayer(8, 6);
    store().interact();
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-angel-1');
    // 入场效果已结算：匕首入包 + 角色卡入卡组 + 双写旗（评审⑤：per-angel + 全局）
    expect(store().player.weapons).toContain('weapon-dagger');
    expect(store().gacha.owned.some((o) => o.cardId === 'card-chr-angel-1')).toBe(true);
    expect(store().story.flags['story:angel-met-1']).toBe(true);
    // 读完对白（10+ 行）直到剧本收尾
    let guard = 0;
    while (store().phase === 'dialogue' && guard < 40) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
    expect(store().story.flags['story:angels-met']).toBe('angel-1');
    // 谢幕原地光羽（tile 触发）：跨到东侧地板 (9,6) 再回踩 (8,6) 制造落格动作
    teleportPlayer(9, 6);
    store().move('left');
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-angel-lightfeather-1');
    guard = 0;
    while (store().phase === 'dialogue' && guard < 20) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
    expect(store().story.flags['story:feather-1']).toBe(true);
  });

  it('踩上小怪坐标 → 遭遇战 → 布阵选武器开打 → 胜利置旗回世界（STORY-5：蔡徐坤居 L2）', () => {
    // 授予 L2 入口法则卡（免 100% 补发剧本打扰，聚焦遭遇战链路）
    useGameStore.setState({
      gacha: {
        ...store().gacha,
        owned: [...store().gacha.owned, { uid: 't-feather', cardId: 'card-law-feather-chest', obtainedAt: 0 }],
      },
    });
    store().startLevel('level-sb-02');
    // 蔡徐坤：STORY-5 迁至 L2 双廊回环网格 (12,3)（radius 0 踩上即遭遇）；
    // 先发匕首（模拟天使教学已完成）
    teleportPlayer(12, 3);
    useGameStore.setState({ player: { ...store().player, weapons: ['weapon-dagger'] } });
    store().interact();
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-mob-caixukun');
    // 对白两行 → battle 节点开战
    store().advanceDialogue();
    store().advanceDialogue();
    expect(store().phase).toBe('combat');
    expect(battle()).not.toBeNull();
    expect(battle()?.enemyId).toBe('enemy-caixukun');
    // 布阵：真实选择匕首实例（K12）→ 开打
    store().selectWeapon('weapon-dagger');
    expect(battle()?.weapon?.defId).toBe('weapon-dagger');
    store().dispatch({ type: 'toggleFormation' }); // 确认布阵 → startBattle
    expect(battle()?.phase).toBe('battle');
    // 攻击至胜负分晓（蔡徐坤 28HP，匕首 30 攻 vs 6 防 → 两刀内）
    let guard = 0;
    while (battle() !== null && guard < 40) {
      store().combatAct('attack');
      guard += 1;
    }
    expect(battle()).toBeNull();
    // 胜利分支：战旗 + 星石入账 + 剧本续演到 ending
    expect(store().story.flags['story:defeated:enemy-caixukun']).toBe(true);
    expect(store().gacha.starStones).toBeGreaterThanOrEqual(1600 + 300 - 5);
    guard = 0;
    while (store().phase === 'dialogue' && guard < 20) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
  });
});

describe('流程冒烟 · 抽卡与法则', () => {
  it('rollGacha：正式池扣费出货，计数器与 lastResult 同步，翻牌相激活', () => {
    const stonesBefore = store().gacha.starStones;
    store().rollGacha(1);
    expect(store().phase).toBe('gacha');
    expect(store().gacha.lastResult?.pulls).toHaveLength(1);
    expect(store().gacha.starStones).toBe(stonesBefore - 100);
    expect(store().pity.totalPulls).toBe(1);
    expect(store().gacha.totalPulls).toBe(1);
  });

  it('applyLawCard：法则卡改写 RuleSet；角色卡编入卡组', () => {
    useGameStore.setState({
      gacha: {
        ...store().gacha,
        owned: [
          { uid: 't-law', cardId: 'card-law-feather-chest', obtainedAt: 1 },
          { uid: 't-chr', cardId: 'card-chr-angel-1', obtainedAt: 2 },
        ],
      },
    });
    store().applyLawCard('t-law');
    expect(store().ruleSet.chestMass).toBe(1); // 羽箱：质量 -1
    expect(store().gacha.activeLaws).toContain('card-law-feather-chest');
    store().applyLawCard('t-chr');
    expect(store().gacha.activeLaws).toContain('card-chr-angel-1');
  });

  it('shiftPlane 未解锁时被拒（不炸状态）', () => {
    store().startLevel('level-sb-01');
    const before = playerPos();
    store().shiftPlane();
    expect(store().phase).toBe('playing');
    expect(store().segment?.planeShifted ?? false).toBe(false);
    expect(playerPos()).toEqual(before);
  });
});

describe('流程冒烟 · 法则门槛与再战', () => {
  it('sb-02 缺羽箱卡 → 先入场 + 100% 补发剧本覆盖，收尾即开玩', () => {
    store().startLevel('level-sb-02');
    expect(store().segment?.levelId).toBe('level-sb-02');
    expect(store().storyRuntime.scriptId).toBe('script-gate-feather-chest');
    expect(store().gacha.owned.some((o) => o.cardId === 'card-law-feather-chest')).toBe(true);
    let guard = 0;
    while (store().phase === 'dialogue' && guard < 20) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
  });

  it('再来一局：结算后 replaySegment 重建段位（S2 悬挂引用根治形态）', () => {
    store().startLevel('level-sb-01');
    store().move('down');
    const moved = playerPos();
    // 模拟结算：直接断言 replay 会重建到出生点（全量重导入，无跨段引用）
    store().replaySegment();
    expect(store().segment?.steps).toBe(0);
    expect(playerPos().x).toBe(moved.x); // x 由出生点决定（13），y 回到出生行
    expect(playerPos().y).toBe(1);
  });
});
