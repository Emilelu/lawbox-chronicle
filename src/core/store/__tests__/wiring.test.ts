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
  battleTurnFxEvents,
  CRIT_SHAKE_INTENSITY,
  effectiveTerrain,
  importLevel,
  selectBattleFormationGrid,
  selectBattleHazards,
  selectBattleState,
  selectHazardCells,
  useGameStore,
} from '../gameStore';
import { POOL_NOSTALGIA, useStatsStore } from '../../../archive/statsCollector';
import { selectHudModel } from '../selectors';
import { KEY_CODE_TO_ACTION, dispatchBinding } from '../../../input/useKeyActions';
import { bus, type FxEvent } from '../../../core/events/bus';
import { createRng } from '../../../core/rng';
import { DEFAULT_RULE_SET } from '../../../core/lawRegistry';
import { CRIT_CHANCE, resolveTurn, startBattle, type BattleState } from '../../../engine/combat/turn';
import { createWeaponInstance } from '../../../data/weapons';
import { findEnemy } from '../../../data';
import { desiredBgmFor } from '../../../audio/BGMController';
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

  it('closeOverlay 发布 ui/closePanels（选关/档案面板据此关闭）', () => {
    const received: string[] = [];
    const off = bus.subscribe((e) => {
      if (e.type === 'ui/closePanels') received.push(e.type);
    });
    store().closeOverlay();
    off();
    expect(received).toEqual(['ui/closePanels']);
  });
});

describe('F4 —— HUD 模型按语种解析关卡名/副标题', () => {
  it('selectHudModel.levelName/areaName 随 locale 切换（en 下不再是中文原文）', () => {
    store().startLevel('level-sb-01');
    useGameStore.setState({ locale: 'en' });
    const en = selectHudModel(useGameStore.getState());
    expect(en.levelName).toBe('First-Awaken Garden');
    expect(en.areaName).not.toContain('主城·教学段');
    useGameStore.setState({ locale: 'zh-Hans' });
    const zh = selectHudModel(useGameStore.getState());
    expect(zh.levelName).toBe('初醒箱庭');
  });
});

/* ================== 战斗演出转译（R2 · store→bus→表现层） ================== */

/** 捕获一段动作期间的 bus 事件（退订保证不泄漏到后续断言） */
function captureDuring(run: () => void): readonly FxEvent[] {
  const seen: FxEvent[] = [];
  const off = bus.subscribe((e) => seen.push(e));
  try {
    run();
  } finally {
    off();
  }
  return seen;
}

describe('battleTurnFxEvents · 战斗回合演出转译（纯函数，R2）', () => {
  /** 纯公式战装配（无 formation：spark 走 (0,0) 占位，视图映射到敌方舞台位） */
  function formulaBattle(baseAttack: number, enemyShield = 0): BattleState {
    const enemy = findEnemy('enemy-caixukun');
    if (enemy === undefined) throw new Error('敌人表缺 enemy-caixukun');
    const formed = startBattle({
      enemy,
      player: { hp: 100, maxHp: 100, baseAttack, defense: 10 },
      ruleSet: DEFAULT_RULE_SET,
      ...(enemyShield > 0 ? { enemyShield } : {}),
    });
    // 确认布阵 → battle 相（attack/item 只在 battle 相合法）
    return resolveTurn(formed, { type: 'startBattle' }, createRng('turn-fx-start'));
  }

  /** 找一个「下一次 chance(CRIT_CHANCE) = want」的确定性种子（mulberry32 同种子同序列） */
  function seedWhereCrit(want: boolean): string {
    for (let i = 0; i < 4096; i++) {
      const seed = `battle-crit-scan:${i}`;
      if (createRng(seed).chance(CRIT_CHANCE) === want) return seed;
    }
    throw new Error('未找到满足暴击条件的种子');
  }

  it('攻击命中 → anim/spark（占位 (0,0)，非 blocked）', () => {
    const prev = formulaBattle(10);
    const next = resolveTurn(prev, { type: 'attack' }, createRng('turn-fx-plain'));
    const events = battleTurnFxEvents(prev, next, { type: 'attack' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'anim/spark', at: { x: 0, y: 0 }, blocked: false });
  });

  it('暴击 → 追加 anim/screenShake（强度 CRIT_SHAKE_INTENSITY）；未暴击 → 不震屏', () => {
    const critSeed = seedWhereCrit(true);
    const prev = formulaBattle(10);
    const next = resolveTurn(prev, { type: 'attack' }, createRng(critSeed));
    // 种子契约自证：本次攻击条目确实暴击（不依赖硬编码种子结果）
    const fresh = next.log.slice(prev.log.length);
    expect(fresh.some((e) => e.actor === 'player' && e.crit)).toBe(true);
    expect(battleTurnFxEvents(prev, next, { type: 'attack' })).toContainEqual({
      type: 'anim/screenShake',
      intensity: CRIT_SHAKE_INTENSITY,
    });

    const calmSeed = seedWhereCrit(false);
    const prev2 = formulaBattle(10);
    const next2 = resolveTurn(prev2, { type: 'attack' }, createRng(calmSeed));
    const events2 = battleTurnFxEvents(prev2, next2, { type: 'attack' });
    expect(events2.some((e) => e.type === 'anim/screenShake')).toBe(false);
    expect(events2.some((e) => e.type === 'anim/spark')).toBe(true);
  });

  it('伤害被敌方护盾全额吸收 → blocked spark（block 护盾尘语义）', () => {
    // raw = 100 - 6(防) = 94 ≤ 盾 233 → 全额吸收，0 点入血（暴击翻倍 188 仍 ≤ 盾）
    const prev = formulaBattle(100, 233);
    const next = resolveTurn(prev, { type: 'attack' }, createRng('turn-fx-blocked'));
    const shieldLost = 233 - next.enemyShield;
    expect([94, 188]).toContain(shieldLost); // 暴击 roll（确定性种子）决定是否翻倍
    expect(next.enemyHp).toBe(next.enemyMaxHp); // 0 点入血
    const spark = battleTurnFxEvents(prev, next, { type: 'attack' }).find((e) => e.type === 'anim/spark');
    expect(spark).toMatchObject({ type: 'anim/spark', blocked: true });
  });

  it('掷爆道具（item）→ anim/spark；非攻击行动 → 无演出事件', () => {
    const enemy = findEnemy('enemy-caixukun');
    if (enemy === undefined) throw new Error('敌人表缺 enemy-caixukun');
    const bomb = createWeaponInstance('weapon-mihotel', 'wi-test-mihotel');
    if (bomb === undefined) throw new Error('武器表缺 weapon-mihotel');
    const formed = startBattle({
      enemy,
      player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
      ruleSet: DEFAULT_RULE_SET,
      availableWeapons: [bomb],
    });
    // 布阵相选武器（K12 真实选择）→ 开打 → 掷爆
    const armed = resolveTurn(formed, { type: 'selectWeapon', uid: 'wi-test-mihotel' }, createRng('turn-fx-arm'));
    const started = resolveTurn(armed, { type: 'startBattle' }, createRng('turn-fx-start'));
    const next = resolveTurn(started, { type: 'item' }, createRng('turn-fx-item'));
    const spark = battleTurnFxEvents(started, next, { type: 'item' }).find((e) => e.type === 'anim/spark');
    expect(spark).toMatchObject({ type: 'anim/spark', blocked: false });
    // selectWeapon/defend 类行动不产生命中演出
    expect(battleTurnFxEvents(formed, armed, { type: 'selectWeapon', uid: 'wi-test-mihotel' })).toEqual([]);
    const defended = resolveTurn(next, { type: 'defend' }, createRng('turn-fx-defend'));
    expect(battleTurnFxEvents(next, defended, { type: 'defend' })).toEqual([]);
  });

  it('布阵期攻击被拒（仅 system 日志，无 player 条目）→ 无演出事件', () => {
    const enemy = findEnemy('enemy-caixukun');
    if (enemy === undefined) throw new Error('敌人表缺 enemy-caixukun');
    const prev = startBattle({
      enemy,
      player: { hp: 100, maxHp: 100, baseAttack: 10, defense: 10 },
      ruleSet: DEFAULT_RULE_SET,
    }); // formation 相（未确认布阵）
    const next = resolveTurn(prev, { type: 'attack' }, createRng('turn-fx-reject'));
    expect(next.log.length).toBeGreaterThan(prev.log.length);
    expect(battleTurnFxEvents(prev, next, { type: 'attack' })).toEqual([]);
  });
});

describe('实机战斗反馈链路（R2 复现路径：郭老师徒手 0 伤害）', () => {
  it('徒手 0 伤害攻击也发 anim/spark（命中格 = 战场敌人实体格）', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(10, 3); // 郭老师 world (3,-3) → 网格 (10,3)
    store().interact();
    store().advanceDialogue();
    store().advanceDialogue();
    expect(selectBattleState(store())?.enemyId).toBe('enemy-guolaoshi');
    store().dispatch({ type: 'toggleFormation' }); // 确认布阵 → battle 相
    const events = captureDuring(() => store().combatAct('attack')); // 徒手 10 攻 vs 12 防 → 0 伤害
    const battle = selectBattleState(store());
    const enemy = battle?.formation?.entities.find((e) => e.id === battle?.enemyId);
    expect(events).toContainEqual({
      type: 'anim/spark',
      at: { x: enemy?.x, y: enemy?.y },
      blocked: false,
    });
  });

  it('selectWeapon（非攻击行动）不发命中演出', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(11, 8); // 蔡徐坤 world (4,2) → 网格 (11,8)
    useGameStore.setState({ player: { ...store().player, weapons: ['weapon-dagger'] } });
    store().interact();
    store().advanceDialogue();
    store().advanceDialogue();
    const events = captureDuring(() => store().selectWeapon('weapon-dagger'));
    expect(events.some((e) => e.type === 'anim/spark' || e.type === 'anim/screenShake')).toBe(false);
  });
});

/* ==================== BOSS 刻字事件（R3 · store 侧发布契约） ==================== */

describe('BOSS 刻字 anim/bossTitle（R3 store 侧双发布源）', () => {
  /** 走到护盾化 BOSS 战开打：interact 触发剧本 → 推进对白直到 battle 节点开战 */
  function launchBossBattle(events: FxEvent[]): void {
    const off = bus.subscribe((e) => events.push(e));
    try {
      store().interact();
      // boss-meet(2 行) → boss-guard gate（有钥匙）→ boss-battle-launch（3 行，
      // 入场 fx bossTitle）→ boss-battle 节点开战
      let guard = 0;
      while (selectBattleState(store()) === null && guard < 8) {
        store().advanceDialogue();
        guard += 1;
      }
    } finally {
      off();
    }
  }

  function prepareKeyedRun(): void {
    store().startLevel('level-sb-01');
    // 作者谜题之钥：走解谜后的护盾化 BOSS 战分支（boss-guard gate openNext）
    useGameStore.setState({
      story: { ...store().story, flags: { ...store().story.flags, 'story:key-boss': 'card-x' } },
    });
    useGameStore.setState({ player: { ...store().player, baseAttack: 300, weapons: [] } });
    teleportPlayer(2, 11); // 影流之主 world (-5,5) → 网格 (2,11)
  }

  it('剧情 fx 与 launchBattle 各发一次（title 分别为刻字串与 enemy.name）', () => {
    prepareKeyedRun();
    const events: FxEvent[] = [];
    launchBossBattle(events);
    expect(events).toContainEqual({ type: 'anim/bossTitle', enemyId: 'enemy-ylzz', title: '影 流 之 主' });
    expect(events).toContainEqual({ type: 'anim/bossTitle', enemyId: 'enemy-ylzz', title: '影流之主' });
    expect(selectBattleState(store())?.enemyId).toBe('enemy-ylzz');
  });

  it('BOSS 护盾全额吸收（raw 300-233=67 ≤ 盾 233）→ blocked spark（护盾尘）', () => {
    prepareKeyedRun();
    launchBossBattle([]);
    expect(selectBattleState(store())?.enemyId).toBe('enemy-ylzz');
    store().dispatch({ type: 'toggleFormation' }); // BOSS 战开局也是布阵相 → 确认开打
    const events = captureDuring(() => store().combatAct('attack'));
    const spark = events.find((e) => e.type === 'anim/spark');
    expect(spark).toMatchObject({ type: 'anim/spark', at: { x: 2, y: 11 }, blocked: true });
  });
});

/* ==================== 位面切换接线（R6 · store→bus→表现层） ==================== */

describe('F 位面切换全链路（R6 实机验证的存档态接线）', () => {
  it('持「位面通行」站上锚点按 F → planeShifted 翻转 + fx/planeShift + 阴面 BGM + 阴面捷径地形', () => {
    store().startLevel('level-lb-09');
    // 授卡并装备：走真实 applyLawCard 链路（owned → activeLaws → ruleSet 补丁）
    useGameStore.setState({
      gacha: {
        ...store().gacha,
        owned: [...store().gacha.owned, { uid: 'test-plane-shift', cardId: 'card-law-plane-shift', obtainedAt: 0 }],
      },
    });
    store().applyLawCard('test-plane-shift');
    expect(store().gacha.activeLaws).toContain('card-law-plane-shift');
    teleportPlayer(9, 1); // 位面锚点 (9,1)（(5,1) 在两面都是墙皮，实体不可立）
    const events = captureDuring(() => store().shiftPlane());
    expect(store().segment?.planeShifted).toBe(true);
    expect(events).toContainEqual({ type: 'fx/planeShift' });
    expect(events).toContainEqual({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
    // 表现层映射①：BGMController 曲意图（阴面 → Black Rose，BGMController.tsx:54-56）
    expect(desiredBgmFor(store())).toBe('bgm-black-rose');
    // 表现层映射②：PlaneInvertOverlay 读 segment.planeShifted → 全屏反色 overlay
    // 表现层映射③：阴面捷径地形（阳墙 (8,3) → 阴面通路，GridArena 按位面换肤）
    const geometry = puzzle()?.geometry;
    if (geometry === undefined) throw new Error('谜题几何缺失');
    expect(effectiveTerrain(geometry, false)[3]?.[8]).toBe(1);
    expect(effectiveTerrain(geometry, true)[3]?.[8]).toBe(0);
  });

  it('未持「位面通行」按 F → plane-locked 提示，位面不翻转（负路径）', () => {
    store().startLevel('level-lb-09');
    teleportPlayer(9, 1);
    const events = captureDuring(() => store().shiftPlane());
    expect(store().segment?.planeShifted).toBe(false);
    expect(events.some((e) => e.type === 'ui/toast' && e.messageKey.includes('位面未解锁'))).toBe(true);
    expect(events.some((e) => e.type === 'fx/planeShift')).toBe(false);
  });
});
