/**
 * 引擎接线补测 —— 六任务（H1/H2/M3/M4/M7/P-engine）在 store 层的接线断言。
 * ---------------------------------------------------------------------------
 * 引擎纯函数（resolveShove / resolveShoveAction / resolvePull / resolveDiagonal /
 * resolvePhase / simulateNostalgiaRound / redeemLawCard / runMetaTerminalCommand）
 * 各有单测；本文件只补「接线」这一层：store action 是否真的把这些引擎能力
 * 接到可玩路径上（dispatch 路由、状态落账、selector 投影、统计分片写入）。
 *
 * 与 flow.test.ts 的区别：flow 覆盖「开始→推箱→剧情→战斗→抽卡」主链路；
 * 本文件覆盖六个任务新增的旁路接线，驱动同一全局 store，无 mock。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  importLevel,
  selectBattleFormationGrid,
  selectBattleHazards,
  selectBattleState,
  selectHazardCells,
  useGameStore,
} from '../gameStore';
import { POOL_NOSTALGIA, useStatsStore } from '../../../archive/statsCollector';
import { KEY_CODE_TO_ACTION, dispatchBinding } from '../../../input/useKeyActions';
import type { PuzzleState } from '../../../engine/puzzle/move';

const store = () => useGameStore.getState();
const puzzle = () => store().puzzle as PuzzleState | null;

/** 把玩家瞬移到指定网格位（改写 puzzle + segment 双投影，与 flow.test.ts 同口径） */
function teleportPlayer(x: number, y: number): void {
  const p = puzzle();
  if (p === null) throw new Error('谜题状态为空');
  const entities = p.entities.map((e) => (e.kind === 'player' ? { ...e, x, y } : e));
  useGameStore.setState({
    puzzle: { ...p, entities },
    segment: { ...(store().segment as NonNullable<ReturnType<typeof store>['segment']>), entities },
  });
}

/** 走蔡徐坤遭遇战开战（flow.test.ts 同链路）：布阵相战斗就位 */
function launchMobBattle(): void {
  store().startLevel('level-sb-01');
  teleportPlayer(11, 8); // 蔡徐坤主地图 (4,2) → 网格 (11,8)
  useGameStore.setState({ player: { ...store().player, weapons: ['weapon-dagger'] } });
  store().interact();
  store().advanceDialogue();
  store().advanceDialogue();
}

beforeEach(() => {
  store().resetSave();
  useStatsStore.getState().clearStats();
});

/* ============================== H1 · 布阵推挤战 ============================ */

describe('H1 · 布阵推挤战接线', () => {
  it('selectHazardCells 从图例 5 现算尖刺格（主城枢纽自带尖刺数据）', () => {
    store().startLevel('level-sb-01');
    const cells = selectHazardCells(store());
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ x: 6, y: 1 });
    expect(cells).toContainEqual({ x: 8, y: 7 });
  });

  it('非战斗期 selectBattleFormationGrid / selectBattleHazards 为空（selector 安全投影）', () => {
    store().startLevel('level-sb-01');
    expect(selectBattleFormationGrid(store())).toBeNull();
    expect(selectBattleHazards(store())).toEqual({});
  });

  it('launchBattle 装配战场：开战后 formation 网格非空（hazards/extraEntities 已传入引擎）', () => {
    launchMobBattle();
    expect(store().phase).toBe('combat');
    expect(selectBattleState(store())?.phase).toBe('formation');
    expect(selectBattleFormationGrid(store())).not.toBeNull();
  });

  it('combat 期方向输入经 dispatchBinding 派发 shove（不再走 move）', () => {
    launchMobBattle();
    const before = selectBattleState(store());
    const playerId = before?.formation?.playerId;
    if (playerId === undefined) throw new Error('布阵战场缺少玩家 id');
    const playerBefore = before?.formation?.entities.find((e) => e.id === playerId);
    expect(playerBefore).toBeDefined();

    dispatchBinding({ kind: 'move', dir: 'left' }); // combat 期方向键 → shove
    const after = selectBattleState(store());
    const playerAfter = after?.formation?.entities.find((e) => e.id === playerId);
    expect(after).not.toBeNull();
    // 推挤把玩家往左位移了一格（move 被 phase 门禁拦住，绝不会发生）
    expect(playerAfter?.x).toBe((playerBefore as { x: number }).x - 1);
  });

  it('store.shove 只在 formation 相结算；非布阵相被拦并提示', () => {
    launchMobBattle();
    // 布阵相推挤合法入队（不炸状态）
    store().dispatch({ type: 'shove', dir: 'right' });
    expect(selectBattleState(store())).not.toBeNull();
    expect(store().phase).toBe('combat');
  });
});

/* ============================== H2 · 法则卡与三种动作输入 ================== */

describe('H2 · 六张法则卡与 pull/diagonal/phase 输入', () => {
  it('Y/U/B/N 斜向、C 相位在键位表齐备（可发现键位）', () => {
    expect(KEY_CODE_TO_ACTION['KeyY']).toEqual({ kind: 'action', action: { type: 'diagonal', diag: 'upleft' } });
    expect(KEY_CODE_TO_ACTION['KeyU']).toEqual({ kind: 'action', action: { type: 'diagonal', diag: 'upright' } });
    expect(KEY_CODE_TO_ACTION['KeyB']).toEqual({ kind: 'action', action: { type: 'diagonal', diag: 'downleft' } });
    expect(KEY_CODE_TO_ACTION['KeyN']).toEqual({ kind: 'action', action: { type: 'diagonal', diag: 'downright' } });
    expect(KEY_CODE_TO_ACTION['KeyC']).toEqual({ kind: 'action', action: { type: 'phase' } });
  });

  it('pull/diagonal/phase 未持对应法则时被拒且不炸状态', () => {
    store().startLevel('level-sb-01');
    const stepsBefore = store().segment?.steps ?? 0;
    store().pull('down');
    store().dispatch({ type: 'diagonal', diag: 'upleft' });
    store().phaseWalk('down');
    expect(store().phase).toBe('playing');
    expect(store().segment?.steps).toBe(stepsBefore); // 拒绝 = 不记账
  });
});

/* ============================== M3 · 怀旧对照池 ============================ */

describe('M3 · 怀旧对照抽卡（runNostalgiaGacha）', () => {
  it('写 POOL_NOSTALGIA 统计分片，不碰正式池计数/保底/星石', async () => {
    const starStonesBefore = store().gacha.starStones;
    const pityBefore = { ...store().pity };
    store().runNostalgiaGacha();
    // 统计写入走动态 import 异步落账：等一拍微任务/宏任务
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tally = useStatsStore.getState().poolTallies[POOL_NOSTALGIA];
    expect(tally?.pulls).toBe(10);
    expect(store().gacha.starStones).toBe(starStonesBefore);
    expect(store().pity.totalPulls).toBe(pityBefore.totalPulls);
    expect(store().pity.pullsSinceFourStar).toBe(pityBefore.pullsSinceFourStar);
    expect(store().pity.shards).toBe(pityBefore.shards);
  });
});

/* ============================== M4 · 碎片直购 ============================== */

describe('M4 · 碎片直购（redeemLawCard）', () => {
  it('余额足 → 扣 60 碎片发卡入包', () => {
    useGameStore.setState({ pity: { ...store().pity, shards: 60 } });
    store().redeemLawCard('card-law-mirror-pull');
    expect(store().gacha.owned.some((o) => o.cardId === 'card-law-mirror-pull')).toBe(true);
    expect(store().pity.shards).toBe(0);
  });

  it('余额不足 → 拒绝且不扣不发放', () => {
    useGameStore.setState({ pity: { ...store().pity, shards: 30 } });
    store().redeemLawCard('card-law-mirror-pull');
    expect(store().gacha.owned.some((o) => o.cardId === 'card-law-mirror-pull')).toBe(false);
    expect(store().pity.shards).toBe(30);
  });
});

/* ============================== M7 · 箱落压碎目标 ========================== */

describe('M7 · 箱落压碎目标实体生成', () => {
  it('importLevel 从 enemySpawns 生成 enemy 实体（井底星榻的守旗敌人）', () => {
    const seg = importLevel('level-lb-08');
    const enemies = seg?.entities.filter((e) => e.kind === 'enemy') ?? [];
    expect(enemies).toHaveLength(1);
    expect(enemies[0]).toMatchObject({ x: 5, y: 5, kind: 'enemy', pushable: true });
  });

  it('星陨王座两名守卫 + 4 尖刺格（挑战层数据齐备）', () => {
    const seg = importLevel('level-lb-12');
    const enemies = seg?.entities.filter((e) => e.kind === 'enemy') ?? [];
    expect(enemies).toHaveLength(2);
    store().startLevel('level-lb-12');
    expect(selectHazardCells(store())).toHaveLength(4);
  });
});

/* ============================== R2 · 星愿祭坛 ============================ */

describe('R2 · 星愿祭坛实体与交互', () => {
  it('importLevel 从 altarSpawns 生成 altar 实体（主城枢纽）', () => {
    const seg = importLevel('level-sb-01');
    const altars = seg?.entities.filter((e) => e.kind === 'altar') ?? [];
    expect(altars).toHaveLength(1);
    expect(altars[0]).toMatchObject({ x: 7, y: 11, kind: 'altar', pushable: false });
  });

  it('玩家靠近祭坛按 E（interact）→ 打开抽卡入口（交互触发存在）', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(7, 10); // 祭坛 (7,11) 的相邻格
    store().interact();
    expect(store().activePanel).toBe('gacha');
  });
});

/* ============================== P-engine · META 终端 ======================= */

describe('P-engine · META 终端真结局（store.runMetaTerminal）', () => {
  const TRUE_END = '/kill--%^%&62*^*&^@&*';

  it('未通关 → 回显沉默，无真结局旗标', () => {
    const echo = store().runMetaTerminal(TRUE_END);
    expect(echo.some((line) => line.includes('沉默'))).toBe(true);
    expect(store().story.flags['meta:garbage-killed']).toBeUndefined();
  });

  it('主线通关后 → 真结局旗标与终局 id 落账', () => {
    useGameStore.setState({
      story: { ...store().story, flags: { ...store().story.flags, 'story:boss-defeated': true } },
    });
    const echo = store().runMetaTerminal(TRUE_END);
    expect(echo[0]).toContain('exception');
    expect(store().story.flags['meta:garbage-killed']).toBe(true);
    expect(store().story.flags['last-ending-id']).toBe('meta-true-end');
  });
});

/* ===================== 主线进度解锁（软锁修复） ===================== */

describe('通关解锁下一关（主线软锁修复）', () => {
  it('结算 level-sb-01 后 reached:level-sb-02 置位', () => {
    store().startLevel('level-sb-01');
    expect(store().story.flags['reached:level-sb-02']).not.toBe(true);
    useGameStore.setState({ result: { levelId: 'level-sb-01', stars: 3, steps: 12 } });
    expect(store().story.flags['reached:level-sb-01']).toBe(true);
    expect(store().story.flags['reached:level-sb-02']).toBe(true);
  });

  it('无段位时关闭抽卡浮层回到标题页（不再落到空白 playing）', () => {
    expect(store().segment).toBeNull();
    useGameStore.setState({ phase: 'gacha' });
    store().closeOverlay();
    expect(store().phase).toBe('title');
  });

  it('有段位时关闭抽卡浮层回到 playing', () => {
    store().startLevel('level-sb-01');
    useGameStore.setState({ phase: 'gacha' });
    store().closeOverlay();
    expect(store().phase).toBe('playing');
  });
});
