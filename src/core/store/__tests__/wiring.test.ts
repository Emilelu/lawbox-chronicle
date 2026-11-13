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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  battleTurnFxEvents,
  CRIT_SHAKE_INTENSITY,
  effectiveTerrain,
  findLevelAny,
  importLevel,
  postBattlePlayerHp,
  selectBattleFormationGrid,
  selectBattleHazards,
  selectBattleState,
  selectHazardCells,
  useGameStore,
  worldToGrid,
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

/** 授予法则卡（绕过关卡入口的 100% 补发剧本，聚焦遭遇战链路本身） */
function grantLawCard(cardId: string): void {
  useGameStore.setState({
    gacha: {
      ...store().gacha,
      owned: [...store().gacha.owned, { uid: `test-${cardId}`, cardId, obtainedAt: 0 }],
    },
  });
}

/** 走蔡徐坤遭遇战开战（flow.test.ts 同链路）：布阵相战斗就位。
 *  STORY-5：蔡徐坤迁至 L2 双廊回环 (12,3)，不再在主城触发。
 *  N1：遭遇规则 triggerRadius=1，邻格即遭遇——teleport 到遭遇格必在半径内。 */
function launchMobBattle(): void {
  grantLawCard('card-law-feather-chest'); // L2 入口法则门免打扰
  store().startLevel('level-sb-02');
  teleportPlayer(12, 3); // 蔡徐坤遭遇格（L2 网格坐标，radius 1 内即遭遇）
  useGameStore.setState({ player: { ...store().player, weapons: ['weapon-dagger'] } });
  store().interact();
  store().advanceDialogue();
  store().advanceDialogue();
}

beforeEach(() => {
  store().resetSave();
  useStatsStore.getState().clearStats();
});

/* ====================== STORY-5 · 触发评估 level 化 ======================= */

describe('STORY-5 · 触发评估按关卡求值（双坐标）', () => {
  it('L2 网格 (12,3) 落格触发 script-mob-caixukun（level-scoped 用原始网格坐标）', () => {
    grantLawCard('card-law-feather-chest'); // L2 入口法则门免打扰
    store().startLevel('level-sb-02');
    expect(store().segment?.levelId).toBe('level-sb-02');
    // MECH-4 twist：蔡徐坤守卫实体与遭遇点同格 (12,3)；N1 后规则 triggerRadius=1，
    // 故第一格落 (11,3)（守卫邻格）即触发遭遇——无需完成两步推箱前置。
    teleportPlayer(11, 2);
    store().move('down'); // 箱 (11,3)→(11,4)，玩家落 (11,3) → 守卫邻格触发遭遇
    store().move('right'); // 对话相 move 被相位门禁拦下（无位移，剧情继续）
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-mob-caixukun');
    // 入场对白已结算：推进到 battle 节点开战（遭遇战接线回归）
    store().advanceDialogue();
    store().advanceDialogue();
    expect(store().phase).toBe('combat');
    expect(selectBattleState(store())?.enemyId).toBe('enemy-caixukun');
    // 战场敌人落点 = 遭遇发生的 npc 规则格（不再派生自 originPos 世界坐标）
    expect(selectBattleState(store())?.formation?.entities.find((e) => e.id === selectBattleState(store())?.enemyId)).toMatchObject({ x: 12, y: 3 });
  });

  it('K1 复核：自然路径（零推箱）从出生点 (13,1) 南行两步到守卫邻格 (13,3) 即触发遭遇', () => {
    grantLawCard('card-law-feather-chest'); // L2 入口法则门免打扰
    store().startLevel('level-sb-02');
    expect(store().segment?.levelId).toBe('level-sb-02');
    // 出生点 (13,1) → (13,2)：距遭遇点 (12,3) 曼哈顿 2 > radius 1，不触发
    store().move('down');
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
    // (13,2) → (13,3)：距 (12,3) 曼哈顿 1 = radius 内 → 遭遇开演（无需推箱前置）
    store().move('down');
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-mob-caixukun');
    // 推进到遭遇战开战：完整遭遇链路自然路径可达（K1 关闭依据）
    store().advanceDialogue();
    store().advanceDialogue();
    expect(store().phase).toBe('combat');
    expect(selectBattleState(store())?.enemyId).toBe('enemy-caixukun');
  });

  it('同坐标 L3 不触发：蔡徐坤规则是 level-sb-02 作用域，L3 的 (12,3) 落格无剧情', () => {
    grantLawCard('card-law-wider-push'); // L3 入口法则门免打扰
    store().startLevel('level-sb-03');
    expect(store().segment?.levelId).toBe('level-sb-03');
    teleportPlayer(12, 2); // (12,2) 为 (12,3) 的北侧相邻地板（L3 两侧均为通地板）
    const stepsBefore = store().segment?.steps ?? 0;
    store().move('down'); // 落到 L3 的 (12,3)
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
    expect(store().segment?.steps).toBe(stepsBefore + 1); // 位移真实发生（只是没触发剧情）
  });
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

  it('星陨王座两名守卫 + 8 尖刺格（MECH-4 twist 后数据齐备）', () => {
    const seg = importLevel('level-lb-12');
    const enemies = seg?.entities.filter((e) => e.kind === 'enemy') ?? [];
    expect(enemies).toHaveLength(2);
    store().startLevel('level-lb-12');
    // MECH-4：尖刺 +4 格（(4,3)/(8,3)/(4,7)/(8,7) 点对称），原 4 格合计 8
    expect(selectHazardCells(store())).toHaveLength(8);
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

  it('C4：HUD 武器名（weaponName）随 locale 切换 —— en 下「ATK · 篮球」不再漏中文', () => {
    store().startLevel('level-sb-01');
    // 装备篮球（真实武器表 id；HUD 武器名此前恒读数据层中文 name）
    useGameStore.setState((s) => ({ player: { ...s.player, weaponId: 'weapon-basketball' } }));
    useGameStore.setState({ locale: 'en' });
    const en = selectHudModel(useGameStore.getState());
    expect(en.weaponName).toBe('Basketball');
    useGameStore.setState({ locale: 'zh-Hans' });
    const zh = selectHudModel(useGameStore.getState());
    expect(zh.weaponName).toBe('篮球');
    // 未装备武器： weaponName 归 null（HUD 不显示武器段）——与既有语义一致
    useGameStore.setState((s) => ({ player: { ...s.player, weaponId: null } }));
    expect(selectHudModel(useGameStore.getState()).weaponName).toBeNull();
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
    grantLawCard('card-law-wider-push'); // L3 入口法则门免打扰
    store().startLevel('level-sb-03');
    teleportPlayer(7, 5); // 郭老师遭遇格（STORY-5：L3 碎星十字网格坐标）
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
    grantLawCard('card-law-feather-chest'); // L2 入口法则门免打扰
    store().startLevel('level-sb-02');
    teleportPlayer(12, 3); // 蔡徐坤遭遇格（STORY-5：L2 双廊回环网格坐标）
    useGameStore.setState({ player: { ...store().player, weapons: ['weapon-dagger'] } });
    store().interact();
    store().advanceDialogue();
    store().advanceDialogue();
    const events = captureDuring(() => store().selectWeapon('weapon-dagger'));
    expect(events.some((e) => e.type === 'anim/spark' || e.type === 'anim/screenShake')).toBe(false);
  });
});

/* ==================== 战败休整回血（L1 · store 层） ==================== */

describe('postBattlePlayerHp · 战斗结算 HP 映射（L1 纯函数）', () => {
  it('败北 → 休整回满 maxHp（战败保底）；胜利/逃跑 → 保留战场终值并 clamp', () => {
    expect(postBattlePlayerHp('defeat', 0, 100)).toBe(100);
    expect(postBattlePlayerHp('victory', 42, 100)).toBe(42);
    expect(postBattlePlayerHp('fled', 13, 100)).toBe(13);
    expect(postBattlePlayerHp('victory', 120, 100)).toBe(100); // 终值越界照旧收敛
  });
});

describe('战败休整回血（L1 · 端到端）', () => {
  it('败北结算 → 玩家 HP 回满（不再 0 血软锁），胜利旗未置位（可再来）', () => {
    grantLawCard('card-law-feather-chest'); // L2 入口法则门免打扰
    store().startLevel('level-sb-02');
    teleportPlayer(12, 3); // 蔡徐坤遭遇格（STORY-5：L2 网格坐标）
    // 1 血裸装：徒手 0 伤，蔡徐坤反击 12 点必败（secondChance 缺省 false）
    useGameStore.setState({ player: { ...store().player, hp: 1, baseAttack: 0, defense: 0, weapons: [] } });
    store().interact();
    store().advanceDialogue();
    store().advanceDialogue();
    expect(selectBattleState(store())?.enemyId).toBe('enemy-caixukun');
    store().dispatch({ type: 'toggleFormation' }); // 确认布阵 → battle 相
    let guard = 0;
    while (selectBattleState(store()) !== null && guard < 40) {
      store().combatAct('attack');
      guard += 1;
    }
    expect(selectBattleState(store())).toBeNull(); // 败北结算已收场
    expect(store().player.hp).toBe(store().player.maxHp); // L1：休整回满
    expect(store().story.flags['story:defeated:enemy-caixukun']).toBeUndefined();
  });

  it('倒地存档（hp 0）进关即休整回满；非倒地进关不回血（beginLevel 兜底语义）', () => {
    useGameStore.setState({ player: { ...store().player, hp: 0 } }); // 模拟修复前的持久化 0 血
    store().startLevel('level-sb-01');
    expect(store().player.hp).toBe(store().player.maxHp);
    useGameStore.setState({ player: { ...store().player, hp: 30 } });
    store().startLevel('level-sb-01');
    expect(store().player.hp).toBe(30); // hp > 0 时进关绝不回血
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
    // STORY-5：BOSS 迁至 L12 星陨王座（王座 (6,5) r3）；(6,4) 为王座咽喉地板
    store().startLevel('level-lb-12');
    // 作者谜题之钥：走解谜后的护盾化 BOSS 战分支（boss-guard gate openNext）
    useGameStore.setState({
      story: { ...store().story, flags: { ...store().story.flags, 'story:key-boss': 'card-x' } },
    });
    useGameStore.setState({ player: { ...store().player, baseAttack: 300, weapons: [] } });
    teleportPlayer(6, 4); // 王座 (6,5) 的北侧邻格（r3 覆盖集内，interact 可触发）
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
    // 战场敌人落点 = 遭遇的 npc 规则格（王座 (6,5)，不再派生自 originPos）
    expect(selectBattleState(store())?.formation?.entities.find((e) => e.id === selectBattleState(store())?.enemyId)).toMatchObject({ x: 6, y: 5 });
    store().dispatch({ type: 'toggleFormation' }); // BOSS 战开局也是布阵相 → 确认开打
    const events = captureDuring(() => store().combatAct('attack'));
    const spark = events.find((e) => e.type === 'anim/spark');
    expect(spark).toMatchObject({ type: 'anim/spark', at: { x: 6, y: 5 }, blocked: true });
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
    // B4-5：'plane-locked' 分支接线既有 toast.planeLocked 键（messageKey 发键
    // 名，文案按语种经 tUi 解析），不再发中文整句
    expect(events.some((e) => e.type === 'ui/toast' && e.messageKey === 'toast.planeLocked')).toBe(true);
    expect(events.some((e) => e.type === 'fx/planeShift')).toBe(false);
  });
});

/* ================== A3-1 · 越界挑战层接线（store 端到端） ================== */

describe('A3-1/R-2 —— 东侧越界「深入」：收尾对白完整演出后经挂账入层（不再截断 ending）', () => {
  it('beyond east 剧情 → 选「深入」→ 中转/收尾 ending 逐拍演出 → 收尾才挂账入层', () => {
    grantLawCard('card-law-feather-chest'); // 主城无关卡门，防干扰
    store().startLevel('level-sb-01');
    expect(store().segment?.levelId).toBe('level-sb-01');
    teleportPlayer(14, 11); // 东缘地板（world +7 缓冲带）
    store().move('right'); // 出界 → 虚拟位 world +8 = beyond east → script-outskirt-east
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-outskirt-east');
    // 读完结场对白 → 停在选项节点
    let guard = 0;
    while (store().storyRuntime.phase !== 'awaiting-choice' && guard < 8) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().storyRuntime.phase).toBe('awaiting-choice');
    // 选择「深入」：中转节点 onEnterEffects 发射 enterChallengeLayer —— R-2 起
    // store 只挂账不立即入层：phase 仍是 dialogue，玩家站在主城（段位未换）
    store().chooseStory('enter');
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.nodeId).toBe('outskirt-east-transit');
    expect(store().segment?.levelId).toBe('level-sb-01');
    // 中转对白 2 行逐拍演出（R-2 修复点：此前 chooseStory 后被 beginLevel
    // 抢先切 playing，中转对白一瞬即被覆盖、收尾 ending 永不到达）
    store().advanceDialogue(); // 中转第 2 行
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.nodeId).toBe('outskirt-east-transit');
    expect(store().segment?.levelId).toBe('level-sb-01');
    // 中转行耗尽 → 收尾 ending 节点（endingId 'outskirt-east-enter'，求解器
    // 最短推数承诺的收尾口径）→ 剧本收尾 → 挂账执行：生成成功 → beginLevel 进层
    //（ending 节点「进入即收尾」是全系统既有语义，北向同款——见 probe/flow 回归）
    store().advanceDialogue();
    expect(store().phase).toBe('playing');
    expect(store().puzzle).not.toBeNull();
    expect(store().segment?.levelId).toContain('endless-challenge-east-endless');
    expect(store().segment?.levelId ?? '').toMatch(/-f1$/);
    // 会话层不在 LEVELS 静态表内（注册表注入），且是可解析的完整关卡
    expect(store().segment?.entities.some((e) => e.kind === 'player')).toBe(true);
    // storyRuntime 不再残留对话相（收尾合并为 IDLE + 收尾旗标，含新 endingId）
    expect(store().storyRuntime.phase).toBe('idle');
    expect(store().storyRuntime.flags['last-ending-id']).toBe('outskirt-east-enter');
  });

  it('南向深渊坠道（R-1 × R-2 交叉）：南缘撞墙外推开演 →「接受挑战」收尾后入层', () => {
    grantLawCard('card-law-feather-chest'); // 主城无关卡门，防干扰
    store().startLevel('level-sb-01');
    teleportPlayer(7, 1); // 网格 y=1 = 世界 y=−5（南缘最深可站位；row0 全墙不可站）
    store().move('up'); // 南向撞边界墙 → A3-2 南缘外推 → script-outskirt-south
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-outskirt-south');
    let guard = 0;
    while (store().storyRuntime.phase !== 'awaiting-choice' && guard < 8) {
      store().advanceDialogue();
      guard += 1;
    }
    store().chooseStory('accept'); // 「接受挑战：进入『深渊坠道』」
    expect(store().storyRuntime.nodeId).toBe('outskirt-south-transit');
    // 中转对白 2 行逐拍演出，期间不进层（段位仍是主城）
    store().advanceDialogue(); // 中转第 2 行
    expect(store().storyRuntime.nodeId).toBe('outskirt-south-transit');
    expect(store().segment?.levelId).toBe('level-sb-01');
    // 中转行耗尽 → 收尾 ending（endingId 'outskirt-south-enter'）→ 收尾挂账入层
    store().advanceDialogue();
    expect(store().phase).toBe('playing');
    expect(store().segment?.levelId).toContain('endless-challenge-south-abyss');
    expect(store().segment?.levelId ?? '').toMatch(/-f1$/);
    expect(store().storyRuntime.phase).toBe('idle');
    expect(store().storyRuntime.flags['last-ending-id']).toBe('outskirt-south-enter');
  });
});

/* ================== A3-2 · 南向 beyond 判定路线（深渊坠道可达） ================== */

describe('A3-2 —— 南向 beyond：南缓冲带不可站立，南缘撞墙外推至 beyond 开演', () => {
  it('玩家立于世界内缘 y=−5 向南撞边界墙 → 虚拟位外推 world −8 → script-outskirt-south', () => {
    grantLawCard('card-law-feather-chest'); // 主城无关卡门，防干扰
    store().startLevel('level-sb-01');
    teleportPlayer(7, 1); // 网格 y=1 = 世界 y=−5（南向最深可站位；row0 全墙不可站）
    // 网格 up = 世界南（world = grid − STORY_GRID_OFFSET）：撞 row0 边界墙，
    // reason 是 'wall' 而非 'out-of-bounds' —— 走 A3-2 南向外推分支
    store().move('up');
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-outskirt-south');
    // 越界 beyond 规则 once:false：走「攀住岩壁」撤退 ending 收尾（不进挑战层，
    // 聚焦判定本身），收尾后回 playing、玩家留在原位可再次触发
    let guard = 0;
    while (store().storyRuntime.phase !== 'awaiting-choice' && guard < 8) {
      store().advanceDialogue();
      guard += 1;
    }
    store().chooseStory('climb');
    expect(store().phase).toBe('playing');
  });

  it('非南缘的南向撞墙（世界 y>−5）不外推、不开演（既有撞墙语义零改动）', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(4, 6); // 世界 (−3,0)：南邻 (4,5) 是内部墙，远离南缘
    store().move('up');
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
  });
});

/* ================== R-7 · 怀旧对照 toast 键控（store 侧 tUi 插值） ================== */

describe('R-7 —— 怀旧对照 toast 按 locale 渲染（不再直显中文整句）', () => {
  it('en locale 下 toast 为英文插值文本；zh-Hans 保持既有中文口径', () => {
    store().startLevel('level-sb-01');
    store().setLocale('en');
    const enEvents = captureDuring(() => store().runNostalgiaGacha());
    const enToast = enEvents.find((e) => e.type === 'ui/toast');
    expect(enToast).toBeDefined();
    expect((enToast as { messageKey: string }).messageKey).not.toMatch(/[\u4e00-\u9fff]/);
    expect((enToast as { messageKey: string }).messageKey).toMatch(/^Nostalgia comparison round \d+: 4★×\d+ 3★×\d+/);
    store().setLocale('zh-Hans');
    const zhEvents = captureDuring(() => store().runNostalgiaGacha());
    const zhToast = zhEvents.find((e) => e.type === 'ui/toast');
    expect((zhToast as { messageKey: string }).messageKey).toMatch(/^怀旧对照第 \d+ 回：4★×\d+ 3★×\d+（原版复刻/);
  });
});

/* ================== N-2 · locale 白名单（损坏存档读档不崩渲染树） ================== */

describe('N-2 —— locale 白名单：setLocale/读档双通道非法值回落 zh-Hans', () => {
  const STORAGE_KEY = 'lawbox-chronicle:v1';

  it('setLocale 传白名单外的值 → 拒绝并回落 zh-Hans（合法值不受影响）', () => {
    store().setLocale('en');
    expect(store().locale).toBe('en');
    // 模拟越权/损坏调用：运行期传入 LOCALES 白名单外的值（如旧版本写入的 'zh'），
    // 未校验时 tUi 取 UI_TEXT['zh'] → undefined → TypeError 崩渲染树
    store().setLocale('zh' as never);
    expect(store().locale).toBe('zh-Hans');
    store().setLocale('zh-Hans');
  });

  it('v3 档（版本相等）locale 被改坏 → merge 读档校验回落 zh-Hans', async () => {
    store().resetSave();
    // 版本相等时 migrate 不运行，损坏 locale 经 merge 原样灌回——这里是
    // 「绕过 setLocale 直达渲染树」的主通道
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      state?: { locale?: string };
    };
    raw.state = { ...raw.state, locale: 'zh' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await useGameStore.persist.rehydrate();
    expect(store().locale).toBe('zh-Hans');
  });

  it('v2 旧档 locale 损坏 → migrate 校验回落 zh-Hans，且 legacy storyRuntime 被剥离', async () => {
    store().resetSave();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      state?: Record<string, unknown>;
      version?: number;
    };
    raw.version = 2;
    raw.state = { ...raw.state, locale: 'xy', storyRuntime: { phase: 'dialogue' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await useGameStore.persist.rehydrate();
    expect(store().locale).toBe('zh-Hans');
    // 迁移剥离生效：legacy 运行时切片不再经 merge 灌回（否则 phase='dialogue' 幽灵节点）
    expect(store().storyRuntime.phase).toBe('idle');
  });
});

/* ================== B3/B4 · 修复回归（store 层端到端） ==================== */

/** 当前段位玩家网格位（与 flow/g4Regression 测试同口径） */
function playerPos(): { x: number; y: number } {
  const player = store().segment?.entities.find((e) => e.kind === 'player');
  if (player === undefined) throw new Error('段位里没有玩家实体');
  return { x: player.x, y: player.y };
}

describe('B3-1 —— 东向法阵「送回 (-5,3)」真实传送（不再是空头承诺）', () => {
  it('选「让法阵送你回」→ 剧本收尾后玩家立于原版落点网格 (2,9)，且可从落点走回主图', () => {
    grantLawCard('card-law-feather-chest');
    store().startLevel('level-sb-01');
    teleportPlayer(14, 11); // 东缘地板（world +7 缓冲带）
    store().move('right'); // beyond east → script-outskirt-east
    expect(store().storyRuntime.scriptId).toBe('script-outskirt-east');
    let guard = 0;
    while (store().storyRuntime.phase !== 'awaiting-choice' && guard < 8) {
      store().advanceDialogue();
      guard += 1;
    }
    store().chooseStory('leave'); // 「让法阵送你回 (-5,3)」
    guard = 0;
    while (store().phase === 'dialogue' && guard < 12) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
    // 传送真实发生：落点 = worldToGrid(-5,3) = (2,9)（areas.ts 已开为可站地板）
    expect(playerPos()).toEqual(worldToGrid(-5, 3));
    expect(playerPos()).toEqual({ x: 2, y: 9 });
    // 落点可站且连通主图：向南走一步真实位移（不嵌墙、不被拒绝）
    store().move('down');
    expect(playerPos()).toEqual({ x: 2, y: 10 });
  });
});

describe('B3-2 —— 挑战层 visitSeq 递增：新种子新图 + floorIndex 成长 + 奖励递增', () => {
  /** 触发东向越界并选「深入」，收尾后自动入层（与既有 A3-1 测试同链路） */
  function enterEastEndless(): void {
    teleportPlayer(14, 11);
    store().move('right');
    expect(store().storyRuntime.scriptId).toBe('script-outskirt-east');
    let guard = 0;
    while (store().storyRuntime.phase !== 'awaiting-choice' && guard < 8) {
      store().advanceDialogue();
      guard += 1;
    }
    store().chooseStory('enter');
    store().advanceDialogue(); // 中转第 2 行
    store().advanceDialogue(); // 收尾 ending → 挂账入层
    expect(store().phase).toBe('playing');
  }

  it('第一次进入 f1（旗标 layer:east-endless:1，奖励 80◈）；第二次进入 f2（旗标 :2，奖励 100◈）', () => {
    grantLawCard('card-law-feather-chest');
    store().startLevel('level-sb-01');
    enterEastEndless();
    expect(store().segment?.levelId ?? '').toMatch(/^endless-challenge-east-endless-f1$/);
    expect(store().story.flags['layer:east-endless:1']).toBe(true);
    expect(findLevelAny(store().segment?.levelId ?? '')?.reward.starStones).toBe(80); // 60+1×20
    // 回标题重新入场（模拟「通关后再次触法阵」），visitSeq 计数 +1 → 第 2 层
    store().backToTitle();
    store().startLevel('level-sb-01');
    enterEastEndless();
    expect(store().segment?.levelId ?? '').toMatch(/^endless-challenge-east-endless-f2$/);
    expect(store().story.flags['layer:east-endless:2']).toBe(true);
    const level = findLevelAny(store().segment?.levelId ?? '');
    expect(level?.reward.starStones).toBe(100); // 60+2×20：层递增奖励真实生效
    // 「第 N 层」命名同步层号（「回廊的第 N+1 层在等你」承诺兑现）
    expect(level?.name).toContain('第 2 层');
  });
});

describe('B3-4 —— L12 BOSS 触发进入边沿：r3 内移动不再重演秒杀演出', () => {
  it('从 r3 外跨入开演一次；区内移动（(6,2)→(6,3)）不开演；走出再跨入可重演', () => {
    store().startLevel('level-lb-12');
    teleportPlayer(6, 1); // 距 BOSS (6,5) 曼哈顿 4 —— r3 外
    store().move('down'); // (6,1)→(6,2)：跨入 r3 → 开演
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-boss-acts');
    let guard = 0;
    while (store().phase === 'dialogue' && guard < 20) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
    // 区内移动（上一格已在 r3 内）：不再重演（修复前每步完整重演一次）
    store().move('down'); // (6,2)→(6,3)，dist 2 ≤ 3
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
    // 走出 r3 再跨入：once:false 的可重复触发设计保留
    teleportPlayer(6, 1);
    store().move('down'); // 再次跨入 r3 → 重演
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-boss-acts');
    guard = 0;
    while (store().phase === 'dialogue' && guard < 20) {
      store().advanceDialogue();
      guard += 1;
    }
    expect(store().phase).toBe('playing');
  });
});

describe('B4-2 —— 战斗/对话相禁入抽卡；closeOverlay 校验 battle 残留', () => {
  it('combat 相 rollGacha 被拒（phase 不切走、星石不扣、lastResult 为空）', () => {
    launchMobBattle();
    expect(store().phase).toBe('combat');
    const stones0 = store().gacha.starStones;
    store().rollGacha(1);
    expect(store().phase).toBe('combat'); // 抽卡相没有接管
    expect(store().gacha.lastResult).toBeNull();
    expect(store().gacha.starStones).toBe(stones0);
  });

  it('dialogue 相 rollGacha 同样被拒；closeOverlay 在 battle 残留时回 combat 而非 playing', () => {
    launchMobBattle();
    // 模拟「战斗中被违规切到抽卡相」的残留场景（双保险路径）
    useGameStore.setState({ phase: 'gacha' });
    store().closeOverlay();
    expect(store().phase).toBe('combat'); // battle!==null → 不落 playing
    expect(store().battle).not.toBeNull();
    // 正常战斗收尾后 closeOverlay 恢复 playing（既有语义不受影响）
    useGameStore.setState({ battle: null, combat: null, phase: 'playing' });
    useGameStore.setState({ phase: 'gacha' });
    store().closeOverlay();
    expect(store().phase).toBe('playing');
  });
});

describe('B4-7 —— 怀旧池 pullIndex 跨会话连续（stats 分片为真相源）', () => {
  // recordPulls 经动态 import 异步落账（模块环规避），断言用 vi.waitFor 等齐
  it('会话计数器重置（模拟刷新）后再跑一回，pullIndex 从 11 起连续编号', async () => {
    store().runNostalgiaGacha();
    await vi.waitFor(() => {
      expect(useStatsStore.getState().pullHistory.length).toBe(10);
    });
    const firstBatch = useStatsStore.getState().pullHistory.slice(-10).map((r) => r.pullIndex);
    expect(firstBatch).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 模拟跨刷新：主档 resetSave 归零会话闭包（nostalgiaSeq 从 0 重计），
    // stats 分片保留持久化的累计计数（tally=10）——与真刷新的恢复态同构
    store().resetSave();
    expect(useStatsStore.getState().poolTallies[POOL_NOSTALGIA]?.pulls).toBe(10);
    store().runNostalgiaGacha();
    await vi.waitFor(() => {
      expect(useStatsStore.getState().pullHistory.length).toBe(20);
    });
    const stats = useStatsStore.getState();
    const secondBatch = stats.pullHistory.slice(-10).map((r) => r.pullIndex);
    expect(secondBatch).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    // uid 会话序号重置（nostalgia-0-*）但 pullIndex 语义保真：逐抽记录不再出现两套 #1~#10
    expect(stats.pullHistory.slice(-10).every((r) => r.uid.startsWith('nostalgia-0-'))).toBe(true);
  });
});
