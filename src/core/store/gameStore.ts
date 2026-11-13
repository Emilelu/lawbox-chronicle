/**
 * 唯一 zustand store —— 单一真相源 + 四引擎接线（集成期重写）。
 * ---------------------------------------------------------------------------
 * 架构：action → 引擎纯函数 → 新状态 → 投影同步 → 视图。
 *   - 推箱：engine/puzzle（createPuzzleState/applyPuzzleMove/undoPuzzle）持有
 *     `puzzle` 状态；`segment` 是它的投影视图（entities/steps/planeShifted/
 *     history），全部旧读点（WorldCanvas/HudBar/cheatRegistry/测试）零改动。
 *   - 战斗：engine/combat（startBattle/resolveTurn/settleBattle）持有 `battle`；
 *     `combat` 是 toCoreCombatState 投影，CombatPanel/WorldCanvas/statsCollector
 *     继续读旧形状。combat 永远只在 battle 写入的同一 set() 里重算 —— 单向
 *     投影，不是第二真相源。
 *   - 剧情：engine/story 解释器持有 `storyRuntime`；效果（发卡/武器/旗标/
 *     开战/终局/传送）在本文件统一落账。story.flags 同时是作弊谓词、触发评估
 *     与持久化旗标的唯一真相；storyRuntime.flags 只是解释器会话草稿（写旗双写
 *     落账），触发/META 评估经 triggerFlagView 以真相源为准（N3 单一真相源）：
 *     草稿残留的旧旗不再遮蔽真相，只清 story.flags 单侧即生效。
 *   - 抽卡：engine/gacha performGacha（正式池 + 三层保底 + 碎片）写
 *     `gacha` 与 `pity`（三层独立计数器，随存档持久化）。
 *
 * 世界坐标约定：Kichiku 主地图（±5）重化为「初醒箱庭」（level-sb-01，15×13）
 * 的网格空间 —— STORY_GRID_OFFSET=(7,6)。剧情触发按规则作用域双坐标求值
 * （STORY-5 分布）：level-scoped 规则（when.levelId 已声明）在该关自身网格上
 * 用玩家原始网格坐标求值；缺省 levelId 的旧规则（主城羽毛/越界彩蛋）只在
 * 主线枢纽关卡（HUB_LEVEL_ID）上经 gridToWorld 世界坐标求值，向后兼容。
 * 越界 beyond 事件由「边界外一步被拒」的出界动作触发（保持 HUB-only）。
 *
 * 演出副作用（音效/震屏/运镜）一律经 core/events/bus 广播，不进状态。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  DiagDir,
  Dir,
  GachaPull,
  GameAction,
  GameState,
  Grid,
  GridEntity,
  LocaleId,
  PanelId,
  TerrainCell,
  Vec2,
} from '../types';
import { DIAG_VECTORS, DIR_VECTORS, LOCALES, SPIKE_CELL } from '../types';
import { DEFAULT_RULE_SET } from '../lawRegistry';
import { bus, type FxEvent } from '../events/bus';
import { createRng } from '../rng';
import { starRating, starStoneReward, clampHp } from '../formula';
import { findEnemy, findLevel } from '../../data';
import { createWeaponInstance } from '../../data/weapons';
import { CARDS, GACHA_FLAVOR } from '../../data/gacha';
import { tUi, type UiTextKey } from '../../data/i18n/uiText';
import { FORMAL_POOL, NOSTALGIA_PARAMS, gachaCost } from '../../data/gacha/pools';
import { ALL_SCRIPTS, STORY_SOLVERS, ALL_TRIGGER_RULES } from '../../data/storyScripts';
import { runMetaTerminalCommand } from '../../data/story/hiddenGame';
import { generateEndlessFloor, floorAsLevel } from '../../data/levels/endless';
import {
  classifyPosition,
  checkLevelEntryDeck,
  isOutskirtsTransition,
  MAIN_MAP_HALF_EXTENT,
  positionalRuleLevelId,
  queryTrigger,
  type TriggerContext,
  type TriggerRule,
} from '../../engine/story/triggers';
import {
  IDLE_STORY_RUNTIME,
  advanceStory,
  chooseStory,
  currentLines,
  resolveBattleResult,
  startStory,
  submitStoryInput,
  visibleChoices,
  type BattleTuning,
  type ChallengeLayerId,
  type StoryEffect,
  type StoryRuntimeState,
  type StoryScriptDef,
} from '../../engine/story/interpreter';
import {
  applyPuzzleMove,
  createPuzzleState,
  grantPhaseCharges,
  type PuzzleAction,
  type PuzzleFx,
  type PuzzleState,
} from '../../engine/puzzle/move';
import { undoPuzzle } from '../../engine/puzzle/undo';
import { parseLevelGeometry, type Level3D } from '../../engine/puzzle/grid';
import { buildPuzzleRuleSet, DEFAULT_PUZZLE_RULE_SET, type PuzzleRuleSet } from '../../engine/puzzle/rules';
import {
  isBattleOver,
  resolveTurn,
  settleBattle,
  startBattle,
  toCoreCombatState,
  type BattleAction,
  type BattleConfig,
  type BattleState,
} from '../../engine/combat/turn';
import { performGacha, simulateNostalgiaRound, type NostalgiaStar } from '../../engine/gacha/roller';
import { EMPTY_PITY_COUNTERS, redeemLawCard as redeemLawCardEngine, type PityCounters } from '../../engine/gacha/pity';
import { cellKey, type HazardKind, type HazardMap } from '../../engine/combat/shove';

void GACHA_FLAVOR; // 文案经 GachaOverlay 消费，此处仅确保打包收录

/* ============================ 关卡导入（纯） =============================== */

export interface ImportedSegment {
  /** 静态地形：出生点格 2/4 归 0（实体坐标才是唯一真相） */
  readonly terrain: Grid;
  readonly entities: readonly GridEntity[];
}

/** 会话生成的关卡（无尽回廊/挑战层）注册表：不进 LEVELS 数据表，进程内可查 */
const sessionLevels = new Map<string, Level3D>();

/** 注册一个会话生成关卡（enterChallengeLayer 时调用；幂等按 id 覆盖） */
export function registerSessionLevel(level: Level3D): void {
  sessionLevels.set(level.id, level);
}

/**
 * 静态表 + 会话生成关卡注册表的合并查询（B3-3 导出）。
 * 挑战层等会话关卡只进 sessionLevels（不进 LEVELS 数据表），此前本函数
 * 模块私有，导致 selectors 的 HUD 关卡名与 ResultModal 结算摘要走静态
 * findLevel 查不到会话关卡 —— HUD 显示 '—'、结算退化为坏档兜底分支。
 * 导出后 selectors/ResultModal 统一走本查询，会话关卡吃到完整结算。
 */
export function findLevelAny(levelId: string): Level3D | undefined {
  const staticLevel = findLevel(levelId);
  if (staticLevel !== undefined) return staticLevel as Level3D;
  return sessionLevels.get(levelId);
}

/** 把 LevelDef 的图例网格导入为「地形 + 实体」两层（纯函数，测试与旧读点用） */
export function importLevel(levelId: string): ImportedSegment | undefined {
  const level = findLevelAny(levelId);
  if (level === undefined) return undefined;
  const terrainRows: TerrainCell[][] = [];
  const entities: GridEntity[] = [];
  let chestSeq = 0;
  level.grid.forEach((row, y) => {
    const terrainRow: TerrainCell[] = [];
    row.forEach((cell, x) => {
      if (cell === 2) {
        entities.push({ id: 'player-1', kind: 'player', x, y, mass: Infinity, pushable: false });
        terrainRow.push(0);
      } else if (cell === 4) {
        chestSeq += 1;
        entities.push({ id: `chest-${chestSeq}`, kind: 'chest', x, y, mass: 2, pushable: true });
        terrainRow.push(0);
      } else {
        terrainRow.push(cell); // 5 = 尖刺格：静态地形保留（战斗布阵 hazard 的数据来源）
      }
    });
    terrainRows.push(terrainRow);
  });
  // 敌人出生点（Level3D.enemySpawns 数据扩展）：与 createPuzzleState 的实体派生同参同 id
  const enemySpawns = (level as Level3D).enemySpawns ?? [];
  enemySpawns.forEach((pos, i) => {
    entities.push({ id: `enemy-${i + 1}`, kind: 'enemy', x: pos.x, y: pos.y, mass: 1, pushable: true });
  });
  // 祭坛出生点（Level3D.altarSpawns 数据扩展）：不可推建筑实体，与 createPuzzleState 的实体派生同参同 id
  const altarSpawns = (level as Level3D).altarSpawns ?? [];
  altarSpawns.forEach((pos, i) => {
    entities.push({ id: `altar-${i + 1}`, kind: 'altar', x: pos.x, y: pos.y, mass: 0, pushable: false });
  });
  return { terrain: terrainRows, entities };
}

/* ========================== 主地图世界坐标约定 ============================= */

/** 主线枢纽关卡：Kichiku ±5 主地图的重化箱庭（剧情 NPC/越界触发宿主） */
export const HUB_LEVEL_ID = 'level-sb-01';

/** Kichiku 主地图坐标 → 15×13 网格坐标 的平移量（网格中心 7,6） */
export const STORY_GRID_OFFSET = { x: 7, y: 6 } as const;

/** 网格坐标 → 主地图世界坐标（越界分类/触发查询的统一口径） */
export function gridToWorld(x: number, y: number): Vec2 {
  return { x: x - STORY_GRID_OFFSET.x, y: y - STORY_GRID_OFFSET.y };
}

/** 主地图世界坐标 → 网格坐标 */
export function worldToGrid(x: number, y: number): Vec2 {
  return { x: x + STORY_GRID_OFFSET.x, y: y + STORY_GRID_OFFSET.y };
}

/* ============================== 多语言白名单 =============================== */

/**
 * N-2：locale 运行期判别（LOCALES 白名单，core/types.ts 现成常量）。
 * 损坏存档会把白名单外的值（如 'zh'）经 persist 原样灌回内存——tUi 取
 * UI_TEXT[locale] 直接 TypeError 崩渲染树。三条通道（setLocale / migrate /
 * merge 读档）统一走本守卫：非法值一律回落 'zh-Hans'，绝不进渲染树。
 */
function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/* ============================== 初始状态 ================================== */

const initialState: GameState = {
  phase: 'title',
  locale: 'zh-Hans',
  activePanel: 'none',
  settings: {
    masterVolume: 0.8,
    bgmVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    cheatsEnabled: false,
    touchControls: false,
  },
  player: { name: '冒险者', maxHp: 100, hp: 100, baseAttack: 10, defense: 10, weaponId: null, weapons: [] },
  segment: null,
  ruleSet: DEFAULT_RULE_SET,
  gacha: {
    starStones: 1600,
    totalPulls: 0,
    owned: [],
    activeLaws: [],
    lastResult: null,
  },
  combat: null,
  story: { activeEventId: null, lineIndex: 0, seenEventIds: [], flags: {} },
  result: null,
  puzzle: null,
  battle: null,
  pity: EMPTY_PITY_COUNTERS,
  storyRuntime: IDLE_STORY_RUNTIME,
};

/** 背包武器实例工厂：def id + 序号 → 战斗期 WeaponInstance（K8 实例自带 stats） */
function createWeaponInstanceOf(defId: string, uid: string) {
  return createWeaponInstance(defId, uid);
}

/* ============================== Store 类型 ================================ */

export interface GameStore extends GameState {
  readonly visitCount: number;

  startLevel(levelId: string): void;
  backToTitle(): void;
  dispatch(action: GameAction): void;
  move(dir: Dir): void;
  /** 布阵推挤战：combat 期方向输入的结算入口（仅 formation 相生效） */
  shove(dir: Dir): void;
  /** 镜像拉箱（法则卡解锁后可用）：玩家后退一格，箱子跟进 */
  pull(dir: Dir): void;
  /** 斜向推挤（法则卡解锁后可用）：沿对角线推箱 */
  diagonal(diag: DiagDir): void;
  /** 相位穿行（法则卡解锁后可用）：dir 缺省时沿最近一次移动方向 */
  phaseWalk(dir?: Dir): void;
  undo(): void;
  replaySegment(): void;
  interact(targetId?: string): void;
  shiftPlane(): void;
  selectWeapon(weaponId: string): void;
  combatAct(act: 'attack' | 'defend' | 'item' | 'flee'): void;
  rollGacha(times: 1 | 10): void;
  /** 怀旧对照抽卡（M3）：跑一回 Lottery.java 原版十连，只写统计分片 */
  runNostalgiaGacha(): void;
  /** 碎片直购（M4）：60 碎片兑换任一未持有法则卡 */
  redeemLawCard(cardId: string): void;
  /** META 终端真结局通道（P-engine）：先于普通作弊匹配，返回终端回显行 */
  runMetaTerminal(raw: string): readonly string[];
  applyLawCard(uid: string): void;
  advanceDialogue(): void;
  chooseStory(choiceId: string): void;
  submitStoryInput(text: string): void;
  setLocale(locale: LocaleId): void;
  setVolume(channel: 'master' | 'bgm' | 'sfx', value: number): void;
  toggleMute(): void;
  openPanel(panel: PanelId): void;
  closeOverlay(): void;
  /** 作弊/系统通道：从当前段位移除一个箱子（cheatRegistry 唯一调用方） */
  removeChestById(chestId: string): boolean;
  resetSave(): void;
}

/* ============================ 投影同步（私有） ============================= */

function segmentOf(puzzle: PuzzleState, levelId: string): GameState['segment'] {
  return {
    levelId,
    entities: puzzle.entities,
    steps: puzzle.steps,
    // PuzzleSnapshot 结构兼容 SegmentSnapshot（entities + steps 超集）
    history: puzzle.history,
    planeShifted: puzzle.planeShifted,
  };
}

/* ======================== 战斗演出转译（纯函数） ============================ */

/** 暴击震屏强度（量级对照 publishPuzzleFx 压碎 0.7 / 引爆 0.6 的既有先例） */
export const CRIT_SHAKE_INTENSITY = 0.5;

/**
 * 战斗回合 → 演出事件（纯函数，vitest 可断言，R2）。
 * ---------------------------------------------------------------------------
 * 玩家攻击/掷爆回合 → 敌方位 anim/spark 粒子爆发（Vfx 已实现订阅渲染）：
 *  - at：布阵战场的敌人实体格；纯公式战无战场时为 (0,0) 占位
 *    （视图层约定 WorldCanvas.vfxToWorld：combat 期 spark 一律映射到敌方舞台位）；
 *  - blocked：本次伤害被敌方护盾全额吸收（0 点入血且盾被扣减）→ block 护盾尘；
 * 暴击（日志 hit.crit）→ anim/screenShake 震屏（CameraRig 暴击震屏消费）。
 * 引擎 turn.ts 保持纯函数不发布事件；此处按日志差分转译
 * （对照 publishPuzzleFx 既有先例）。非攻击行动（selectWeapon/defend/shove…）
 * 与日志无新增的回合不产出事件。
 */
export function battleTurnFxEvents(prev: BattleState, next: BattleState, action: BattleAction): readonly FxEvent[] {
  // 只有玩家攻击类行动产生命中演出
  if (action.type !== 'attack' && action.type !== 'item') return [];
  // 日志为追加语义（LOG_LIMIT 裁剪的极端长战漏一拍演出，不影响状态正确性）
  if (next.log.length <= prev.log.length) return [];
  const fresh = next.log.slice(prev.log.length);
  const hit = fresh.find((entry) => entry.actor === 'player');
  if (hit === undefined) return [];
  const enemyCell = next.formation?.entities.find((e) => e.id === next.enemyId);
  const at = enemyCell !== undefined ? { x: enemyCell.x, y: enemyCell.y } : { x: 0, y: 0 };
  // 敌方护盾本次被扣减且 0 点入血 → 判定「被挡下」（Vfx 的 block 粒子语义）
  const shieldLost = Math.max(0, prev.enemyShield - next.enemyShield);
  const events: FxEvent[] = [{ type: 'anim/spark', at, blocked: hit.damage === 0 && shieldLost > 0 }];
  if (hit.crit) events.push({ type: 'anim/screenShake', intensity: CRIT_SHAKE_INTENSITY });
  return events;
}

/* ======================== 战斗结算 HP 映射（纯函数） ======================== */

/**
 * 战斗结算后的玩家 HP（纯函数，L1）：败北 = 兑现「回去休整后再来」的承诺——
 * HP 恢复到 maxHp（战败保底），杜绝「0 血再战必在首次反击即死」的主线软锁
 * （小怪胜利旗是作者谜题三前置旗、进而解锁 BOSS 第二幕的必要条件）；
 * 胜利/逃跑保留战场终值（经 clampHp 收敛到 [0, maxHp]）。
 * 注意 K1/K16 的「伤害恒 max(0,·)/防御永不回血」约束只作用于战斗公式层
 * （effects.computeDamage/applyHp 的局内通道），局外休整结算不属其管辖。
 */
export function postBattlePlayerHp(
  outcome: 'victory' | 'defeat' | 'fled' | 'ongoing',
  hpFinal: number,
  maxHp: number,
): number {
  if (outcome === 'defeat') return maxHp;
  return clampHp(hpFinal, maxHp);
}

/* ======================== 逃跑落位写回（A1-3，纯函数） ======================= */

/**
 * 逃跑结算的世界层写回（纯函数，A1-3 / 上一轮 K2 的分层矛盾收口）。
 * ---------------------------------------------------------------------------
 * effects.computeFlee 的契约是「逃跑=真实位移」：玩家在布阵战场 formation 内
 * 被 BFS 挪到最近安全格；但 settleBattle 报告不含位置字段，结算若不回写，
 * 世界层的玩家仍站在怪物旁 —— 引擎声称位移、世界原地不动。本函数把 formation
 * 里的玩家落位投影回世界实体层：找到 formation 玩家 → 覆盖世界玩家坐标；
 * 找不到（异常战场）原样返回。纯函数：vitest 直接断言写回结果。
 */
export function applyFleeDisplacement(
  worldEntities: readonly GridEntity[],
  formationEntities: readonly GridEntity[],
  playerId: string,
): readonly GridEntity[] {
  const fled = formationEntities.find((e) => e.id === playerId);
  if (fled === undefined) return worldEntities;
  return worldEntities.map((e) => (e.kind === 'player' ? { ...e, x: fled.x, y: fled.y } : e));
}

/* ======================== 触发旗标视图（N3 单一真相源） ====================== */

/**
 * 触发评估 / META 终端 / 剧本收尾合并共用的旗标视图 —— 单一真相源收敛（N3 修法）。
 * ---------------------------------------------------------------------------
 * story.flags 是持久化旗标的唯一真相（触发 requireFlag/unlessFlag、终端指令、
 * 作弊谓词、WorldCanvas 均直接读它）；storyRuntime.flags 只是解释器会话草稿，
 * 由 writeFlag 与真相源双写同步，其「独有键」仅剩 grantCard 的 card:<id> 持卡
 * 镜像（卡片真相由 gacha.owned 承载，镜像经本函数照常并入收尾合并与评估视图）。
 * 视图 = card 镜像在前、story.flags 后展开覆盖：草稿副本里残留的旧旗（含
 * story+storyRuntime 双落盘时代的 defeated 旗）从此不再遮蔽真相源 —— 运维/测试
 * 只清 story.flags 单侧，unlessFlag 抑制即解除（重踩可再触发遭遇）；收尾合并
 * 场景下「真相源已删除的键」也不会被草稿旧旗复活。
 * 纯函数：测试可直接断言「真相源优先 + 只放行 card 镜像」两条不变量。
 */
export function triggerFlagView(
  storyFlags: Readonly<Record<string, boolean | number | string>>,
  runtimeFlags: Readonly<Record<string, boolean | number | string>>,
): Record<string, boolean | number | string> {
  const cardMirrors: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(runtimeFlags)) {
    if (key.startsWith('card:')) cardMirrors[key] = value;
  }
  return { ...cardMirrors, ...storyFlags };
}

/* ================================ 创建 ==================================== */

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      /* --------------------- 段位会话编号（B4-1） -------------------------- */
      /**
       * 「段位会话」= 一次 beginLevel（含 startLevel/replaySegment/挑战层入层）
       * 的完整生命周期。finishLevelSuccessfully 发奖前把当前会话标记为已结算，
       * 同会话内 undo 回 playing 后重新达标（Z/HUD ↩ 循环）不再重复发放星石
       * 与相位充能 —— 堵住「结算面板撤销 → 走一步 → 再结算」的无限刷币漏洞。
       * 重玩（replaySegment/startLevel → beginLevel）开启新会话，重新结算的
       * 既有语义不变。会话变量不落盘：刷新即作废，与「中断=未结算」一致
       *（undo 后刷新重进即重新发奖，同 A4-1/R-2 会话变量语义）。
       */
      let levelSessionSeq = 0;
      let currentLevelSession = 0;
      let rewardedLevelSession = -1;

      /* ------------------------- 派生：谜题规则集 ------------------------- */
      const puzzleRulesOf = (): PuzzleRuleSet => {
        const state = get();
        const patchIds = state.gacha.activeLaws
          .map((cardId) => CARDS.find((c) => c.id === cardId)?.lawPatchId)
          .filter((id): id is string => id !== undefined);
        const built = buildPuzzleRuleSet(DEFAULT_RULE_SET, patchIds);
        return built.ok ? built.ruleSet : DEFAULT_PUZZLE_RULE_SET;
      };

      const puzzleOf = (): PuzzleState | null => get().puzzle as PuzzleState | null;
      const battleOf = (): BattleState | null => get().battle as BattleState | null;

      /* --------------------------- 演出转译 ------------------------------- */
      const publishPuzzleFx = (fx: readonly PuzzleFx[], dir: Dir): void => {
        for (const effect of fx) {
          switch (effect.type) {
            case 'slide':
              bus.publish({
                type: 'anim/slide',
                entityId: effect.entityId,
                from: effect.from,
                to: effect.to,
                dir,
              });
              break;
            case 'pull':
              bus.publish({ type: 'anim/slide', entityId: effect.chestId, from: effect.from, to: effect.to, dir });
              break;
            case 'fall':
              bus.publish({ type: 'anim/slide', entityId: effect.entityId, from: effect.from, to: effect.to, dir });
              if (effect.crushed.length > 0) bus.publish({ type: 'anim/screenShake', intensity: 0.7 });
              break;
            case 'phase':
              bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-2' });
              break;
            case 'detonation':
              bus.publish({ type: 'anim/screenShake', intensity: 0.6 });
              bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-13' });
              break;
            case 'planeShift':
              bus.publish({ type: 'fx/planeShift' });
              bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
              break;
            case 'solved':
              break; // 达标结算在 move 主流程处理
          }
        }
      };

      /* --------------------------- 关卡完成 ------------------------------- */
      const finishLevelSuccessfully = (puzzle: PuzzleState): void => {
        const state = get();
        const segment = state.segment;
        if (segment === null) return;
        const level = findLevelAny(segment.levelId);
        if (level === undefined) return;
        // B4-1：同一段位会话只发一次奖励。undo 回 playing 后重新达标（键盘 Z
        // 在 result 相放行、HUD ↩ 直接调 undo）此前会再次走本函数全额入账，
        // 「undo → 走一步」循环可无限刷星石与相位充能。已在当前会话结算过时
        // 只更新结算面板（phase/result 照常显示），星石/法则卡/充能零重复入账。
        const alreadyRewarded = rewardedLevelSession === currentLevelSession;
        rewardedLevelSession = currentLevelSession;
        const stars = starRating(puzzle.steps, level.parSteps);
        const gain = alreadyRewarded ? 0 : starStoneReward(stars, level.reward.starStones);
        const owned =
          !alreadyRewarded &&
          level.reward.lawCardId !== undefined && !state.gacha.owned.some((o) => o.cardId === level.reward.lawCardId)
            ? [...state.gacha.owned, { uid: `reward-${level.reward.lawCardId}`, cardId: level.reward.lawCardId, obtainedAt: Date.now() }]
            : state.gacha.owned;
        // 相位穿行评分奖励（grantPhaseCharges 接线）：3★ +2 / 2★ +1 / 1★ +0，
        // 从结算面板撤销回局（undo 允许）时奖励充能仍真实可用；B4-1 起同会话
        // 重复达标不再重复发放充能（充能与星石同批次入账，同一防刷口径）。
        const chargeBonus = alreadyRewarded ? 0 : stars >= 3 ? 2 : stars === 2 ? 1 : 0;
        const chargedPuzzle = chargeBonus > 0 ? grantPhaseCharges(puzzle, chargeBonus) : puzzle;
        set({
          phase: 'result',
          result: { levelId: level.id, stars, steps: Math.ceil(puzzle.steps) },
          ...(chargeBonus > 0
            ? { puzzle: chargedPuzzle, segment: segmentOf(chargedPuzzle, level.id) }
            : {}),
          gacha: { ...state.gacha, starStones: state.gacha.starStones + gain, owned },
        });
        bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-10' });
      };

      /* --------------------------- 剧情效果落账 --------------------------- */
      const applyStoryEffects = (effects: readonly StoryEffect[]): void => {
        if (effects.length === 0) return;
        const state = get();
        let player = state.player;
        let gacha = state.gacha;
        let flags = { ...state.story.flags };
        const runtimeFlags: Record<string, boolean | number | string> = { ...state.storyRuntime.flags };

        /**
         * 旗标落账（N3 双写纪律）：story.flags 是持久化真相源；storyRuntime.flags
         * 是解释器会话草稿（gate/choice 节点直接读它评估），必须同步落一份。
         * 触发/META 评估经 triggerFlagView 以真相源为准 —— 草稿残留不遮蔽真相。
         */
        const writeFlag = (key: string, value: boolean | number | string): void => {
          flags = { ...flags, [key]: value };
          runtimeFlags[key] = value;
        };

        for (const eff of effects) {
          switch (eff.kind) {
            case 'grantWeapon': {
              const weapons = player.weapons ?? [];
              const nextWeapons = weapons.includes(eff.weaponId) ? weapons : [...weapons, eff.weaponId];
              player = { ...player, weapons: nextWeapons, weaponId: eff.weaponId };
              break;
            }
            case 'unequipWeapon':
              player = { ...player, weaponId: null };
              break;
            case 'grantCard': {
              if (!gacha.owned.some((o) => o.cardId === eff.cardId)) {
                gacha = {
                  ...gacha,
                  owned: [...gacha.owned, { uid: `story-${eff.cardId}`, cardId: eff.cardId, obtainedAt: Date.now() }],
                };
              }
              runtimeFlags[`card:${eff.cardId}`] = true;
              break;
            }
            case 'grantStarStones':
              gacha = { ...gacha, starStones: gacha.starStones + eff.amount };
              break;
            case 'setFlag':
              writeFlag(eff.key, eff.value);
              break;
            case 'clearFlagsWithPrefix': {
              const kept: Record<string, boolean | number | string> = {};
              for (const [k, v] of Object.entries(flags)) if (!k.startsWith(eff.prefix)) kept[k] = v;
              flags = kept;
              for (const k of Object.keys(runtimeFlags)) if (k.startsWith(eff.prefix)) delete runtimeFlags[k];
              break;
            }
            case 'setEnemyAttack':
              writeFlag(`enemyAtk:${eff.enemyId}`, eff.value);
              break;
            case 'startBattle':
              launchBattle(eff.enemyId, eff.tuning);
              break;
            case 'showEnding':
              if (eff.unlocksMetaTerminal === true) writeFlag('meta:terminal-unlocked', true);
              writeFlag('last-ending-id', eff.endingId);
              if (eff.achievementId !== undefined) {
                const achievementId = eff.achievementId;
                // 动态引入避免 gameStore ↔ logbook 的模块环（logbook 装载即订阅本 store）
                void import('../../archive/logbook')
                  .then((m) => {
                    try {
                      m.useLogbookStore.getState().unlockAchievement(achievementId);
                    } catch {
                      /* 未知成就 id：logbook 抛 RangeError，剧情侧不因成就崩剧本 */
                    }
                  })
                  // A4-9：绝不静默 —— 动态加载失败要让控制台可见（S14 纪律）
                  .catch((e: unknown) => console.error('[logbook] 动态加载失败，成就未入册', e));
              }
              break;
            case 'teleport': {
              const puzzle = puzzleOf();
              if (puzzle !== null) {
                const target = worldToGrid(eff.x, eff.y);
                const moved: PuzzleState = {
                  ...puzzle,
                  entities: puzzle.entities.map((e) =>
                    e.kind === 'player' ? { ...e, x: target.x, y: target.y } : e,
                  ),
                };
                set({ puzzle: moved, segment: segmentOf(moved, get().segment?.levelId ?? '') });
              }
              break;
            }
            case 'enterScript':
              startStoryScript(eff.scriptId, eff.entryNodeId);
              break;
            case 'exitScript':
              // 由 closeStoryRuntime 统一处理（此处仅兜底）
              break;
            case 'enterChallengeLayer':
              // R-2：不立即入层 —— beginLevel 会截断正在演出的剧本。挂账待收尾
              //（closeStoryRuntime）统一执行，中转对白与收尾 ending 先完整演出。
              pendingChallengeLayer = eff.layerId;
              break;
            case 'openMetaTerminal':
              writeFlag('meta:terminal-unlocked', true);
              // B4-5：键控 toast（toast.metaTerminalUnlocked，7 语种），不再直显中文整句
              bus.publish({ type: 'ui/toast', messageKey: 'toast.metaTerminalUnlocked' });
              break;
            case 'showHint':
              bus.publish({ type: 'ui/toast', messageKey: eff.text });
              break;
            case 'fx':
              switch (eff.request.fx) {
                case 'sfx':
                  bus.publish({ type: 'sfx/play', sfxId: eff.request.sfxId });
                  break;
                case 'bgmStop':
                  bus.publish({ type: 'bgm/stop' });
                  break;
                case 'screenShake':
                  bus.publish({ type: 'anim/screenShake', intensity: eff.request.intensity });
                  break;
                case 'bossTitle':
                  bus.publish({ type: 'anim/bossTitle', enemyId: eff.request.enemyId, title: eff.request.title });
                  break;
              }
              break;
          }
        }

        set({ player, gacha, story: { ...state.story, flags }, storyRuntime: { ...state.storyRuntime, flags: runtimeFlags } });
      };

      /* --------------------------- 剧本推进 ------------------------------- */

      /**
       * 待落盘的触发封印（A4-1）。once 触发命中时不再立即写入 seenEventIds，
       * 只在本会话变量挂账，待剧本正常收尾（closeStoryRuntime）才落盘。
       * 根因：markTriggerSeen 先于 startStoryScript 执行，而 seenEventIds 随
       * story 持久化 —— 玩家在对话中刷新页面时触发已被封印、storyRuntime 却被
       * 重置，once 规则从此永不重触发（天使① / 作者谜题一旦中断即主线软锁）。
       * 封印延迟到收尾后，「演完才封印」；中断的剧本保持未封印，重走原坐标
       * 即可再次开演。会话变量不落盘：刷新即作废，与「中断=未触发」语义一致。
       */
      let pendingSeenTriggerId: string | null = null;

      /**
       * 待入层的挑战层挂账（R-2）。outskirts 三剧本的中转（transit）节点经
       * onEnterEffects 发射 {kind:'enterChallengeLayer', layerId}，此前 store
       * 收到即 beginLevel —— beginLevel 抢先把 phase 切到 playing，中转对白与
       * 收尾 ending 被截断（「深入无尽回廊」等收尾承诺文案不再演出），且
       * applyStoryEffects 循环末尾的 set 会用开演时的快照把 storyRuntime 覆盖回
       * 对话相（rtPhase=dialogue 残留、last-ending-id 停在旧值）。现在效果只
       * 挂账，待剧本正常收尾（closeStoryRuntime）后再入层：transit → ending
       * 收尾对白完整演出，收尾即生成挑战层并接管画面；生成失败时 toast 提示、
       * phase 已回 playing，玩家留在原地可再触发重试。挂账是会话变量不落盘，
       * 中断路径（beginLevel/backToTitle/resetSave/startStoryScript）统一作废，
       * 与 A4-1「中断=未触发」同语义。
       */
      let pendingChallengeLayer: ChallengeLayerId | null = null;

      const startStoryScript = (scriptId: string, entryNodeId?: string): void => {
        const state = get();
        // R-2：新剧本开演即视为旧剧本中断 —— 未入层的挂账作废（演出覆盖之下
        // 不存在「欠着的入层」，对齐 A4-1「中断=未触发」语义）
        pendingChallengeLayer = null;
        // 运行时旗标种子：持久化旗标 + 持卡镜像（解释器的 requireCard/gate 用）
        const seededFlags: Record<string, boolean | number | string> = { ...state.story.flags };
        for (const owned of state.gacha.owned) seededFlags[`card:${owned.cardId}`] = true;
        const runtime: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: seededFlags };
        const step = startStory(ALL_SCRIPTS, scriptId, runtime, entryNodeId);
        if (step.error !== undefined) {
          bus.publish({ type: 'debug/mark', label: `story-error:${step.error}` });
          // 剧本没演成：本次触发的封印账目作废（未演出的剧本不该封印触发）
          pendingSeenTriggerId = null;
        }
        const phase: GameState['phase'] = 'dialogue';
        set({ phase, storyRuntime: step.state });
        applyStoryEffects(step.effects);
        // 开战效果把 phase 切到 combat；否则停在对话
        if (get().battle === null) set({ phase });
      };

      const closeStoryRuntime = (): void => {
        const state = get();
        const runtime = state.storyRuntime;
        const lastEnding = runtime.flags['last-ending-id'];
        // A4-1：剧本正常收尾才落盘触发封印（见 pendingSeenTriggerId 注释）
        const pendingSeen = pendingSeenTriggerId;
        pendingSeenTriggerId = null;
        const story =
          pendingSeen !== null && !state.story.seenEventIds.includes(pendingSeen)
            ? { ...state.story, seenEventIds: [...state.story.seenEventIds, pendingSeen] }
            : state.story;
        set({
          // N3：runtime→story 的收尾合并收敛为「只并入 card: 镜像」（该合并对
          // 真相源的唯一独有贡献；setFlag 类效果已经 writeFlag 实时双写进真相）。
          // 原并集合并无法表达「真相源已删除键」——会话草稿里的陈旧旗（如外部
          // 只清了 story.flags 单侧的 defeated 旗）会经收尾合并复活回真相源；
          // triggerFlagView 以真相源优先即根治，非 card 的草稿残留一律丢弃。
          storyRuntime: { ...IDLE_STORY_RUNTIME, flags: { ...story.flags } },
          story,
        });
        // R-2：挂账在此取出（无论后续走哪条收尾分支都不残留，防止迟到入层
        // 误打到下一个剧本头上）——北向路由与 phase 恢复之后再执行入层
        const pendingChallenge = pendingChallengeLayer;
        pendingChallengeLayer = null;
        if (lastEnding === 'outskirt-north-transit') {
          startStoryScript('script-hidden-game');
          return;
        }
        set({ phase: 'playing' });
        // R-2：剧本完整收尾后才入层。生成成功 → beginLevel 接管画面（phase
        // 同为 playing，幂等）；生成失败 → toast 提示，phase 已回 playing，
        // 玩家留在原地，再次触发即可重试（ending 收尾对白已承诺该口径）。
        if (pendingChallenge !== null) enterChallengeLayer(pendingChallenge);
      };

      /* --------------------------- 战斗装配 ------------------------------- */
      let battleSeq = 0;
      let nostalgiaSeq = 0;

      /**
       * 布阵战地形武器装配（纯）：尖刺格（图例 5）→ 'spike'；
       * BOSS 战在敌人四周一圈注入 'abyss'（推挤斩杀分身的深渊环，分身生成
       * 与实体入场都会避开渊格；玩家自身被 resolveShove 守卫 0 拒绝踏入）。
       */
      const battleHazardsFor = (terrain: Grid, enemyCell: Vec2, boss: boolean): HazardMap => {
        const hazards: Record<string, HazardKind> = {};
        terrain.forEach((row, y) => {
          row.forEach((cell, x) => {
            if (cell === SPIKE_CELL) hazards[cellKey(x, y)] = 'spike';
          });
        });
        if (boss) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const x = enemyCell.x + dx;
              const y = enemyCell.y + dy;
              const cell = terrain[y]?.[x];
              if (cell === undefined || cell === 1) continue; // 墙/界外不放渊
              hazards[cellKey(x, y)] = 'abyss';
            }
          }
        }
        return hazards;
      };

      /**
       * 战场敌人落点（STORY-5）：敌人实体的布阵位 = 遭遇发生的 npc 触发规则格
       * （当前正在演出的剧本 → 触发规则表反查；level-scoped 规则为该关网格坐标，
       * 主城旧规则经 worldToGrid 世界坐标）。查不到触发规则（无 npc 前置的剧本）
       * 时回退玩家所在格 —— 踩上即遭遇的既有语义。
       * enemies.originPos 自 STORY-5 起降级为图鉴字段，不再参与任何运行时求值。
       */
      const encounterCellOf = (scriptId: string | null, playerCell: Vec2, levelId: string): Vec2 => {
        const rule = ALL_TRIGGER_RULES.find((r) => r.scriptId === scriptId && r.when.kind === 'npc');
        if (rule === undefined || rule.when.kind !== 'npc') return playerCell;
        const ruleLevel = positionalRuleLevelId(rule);
        if (ruleLevel === undefined) return worldToGrid(rule.when.x, rule.when.y);
        return ruleLevel === levelId ? { x: rule.when.x, y: rule.when.y } : playerCell;
      };

      const launchBattle = (enemyId: string, tuning: BattleTuning): void => {
        const state = get();
        const enemy = findEnemy(enemyId);
        const puzzle = puzzleOf();
        if (enemy === undefined || puzzle === null) return;

        const flags = state.story.flags;
        const override = flags[`enemyAtk:${enemyId}`];
        // 角色卡 buff：activeLaws 中的角色卡逐条传入（逐卡过注册表校验）
        const buffs: { buffId: string; value: number }[] = [];
        for (const cardId of state.gacha.activeLaws) {
          const card = CARDS.find((c) => c.id === cardId);
          if (card !== undefined && card.kind === 'character' && card.buff !== undefined) {
            buffs.push(card.buff);
          }
        }

        const weapons = (state.player.weapons ?? []).filter(
          (defId, i, arr) => arr.indexOf(defId) === i,
        );
        const availableWeapons = weapons
          .map((defId, i) => createWeaponInstanceOf(defId, `wi-${defId}-${i}`))
          .filter((w) => w !== undefined);

        const playerEntity = puzzle.entities.find((e) => e.kind === 'player');
        const playerCell: Vec2 = playerEntity !== undefined ? { x: playerEntity.x, y: playerEntity.y } : { x: 0, y: 0 };
        const enemyGrid = encounterCellOf(state.storyRuntime.scriptId, playerCell, state.segment?.levelId ?? '');

        // ---- 布阵战场装配（H1）：尖刺 + BOSS 深渊环 + 战场箱子（箱落攻击弹药） ----
        const hazards = battleHazardsFor(puzzle.geometry.terrain, enemyGrid, enemy.boss);
        const occupiedByActor = (x: number, y: number): boolean =>
          (playerEntity !== undefined && playerEntity.x === x && playerEntity.y === y) ||
          (enemyGrid.x === x && enemyGrid.y === y);
        const extraEntities = puzzle.entities.filter(
          (e) =>
            e.kind === 'chest' && !occupiedByActor(e.x, e.y) && hazards[cellKey(e.x, e.y)] === undefined,
        );

        const config: BattleConfig = {
          enemy,
          player: {
            hp: state.player.hp,
            maxHp: state.player.maxHp,
            baseAttack: state.player.baseAttack,
            defense: state.player.defense,
          },
          ruleSet: state.ruleSet,
          buffs,
          enemyAttackOverride: typeof override === 'number' ? override : undefined,
          // BOSS 护盾真实接线：tuning.shield → 引擎 enemyShield（弱点命中即击破）
          enemyShield: typeof tuning.shield === 'number' ? Math.max(0, Math.round(tuning.shield)) : undefined,
          formation: {
            grid: puzzle.geometry.terrain,
            hazards,
            playerPos: playerEntity !== undefined ? { x: playerEntity.x, y: playerEntity.y } : { x: 0, y: 0 },
            enemyPos: enemyGrid,
            extraEntities,
          },
          availableWeapons,
        };
        battleSeq += 1;
        const battle = startBattle(config);
        // tuning 契约映射：shield → config.enemyShield（本次真实接线）；
        // weakness（克星武器 ×2 = BOSS_WEAKNESS_MULTIPLIER）与分身（initialClones +
        // 阶段 cloneDouble + 引擎 K10 封顶 64 = shadowCap）由档案层 ENEMY_COMBAT_PROFILES 等效承载
        set({ battle, combat: toCoreCombatState(battle), phase: 'combat' });
        if (enemy.boss) bus.publish({ type: 'anim/bossTitle', enemyId, title: enemy.name });
      };

      /** 战斗推进：入队 → 引擎内部清空队列（resolveTurn）→ 演出转译 → 投影 + 终局处理 */
      const runBattleAction = (action: BattleAction): void => {
        const state = get();
        const battle = battleOf();
        if (battle === null || isBattleOver(battle.phase)) return;
        const rng = createRng(`battle:${battle.enemyId}:${battleSeq}:${battle.turn}:${battle.queue.length}`);
        const next = resolveTurn(battle, action, rng);
        for (const event of battleTurnFxEvents(battle, next, action)) bus.publish(event);
        set({ battle: next, combat: toCoreCombatState(next), player: { ...state.player, hp: clampHp(next.playerHp, state.player.maxHp) } });
        if (isBattleOver(next.phase)) settleBattleEnd(next);
      };

      const settleBattleEnd = (battle: BattleState): void => {
        const report = settleBattle(battle);
        const state = get();
        // L1：败北走 postBattlePlayerHp 的休整回满（战败保底），其余 outcome 保留终值
        let player = {
          ...state.player,
          hp: postBattlePlayerHp(report.outcome, report.playerHpFinal, report.playerMaxHp),
        };

        // A1-3：逃跑=真实位移（computeFlee 在 formation 内挪玩家），结算时把
        // 布阵战场的玩家落位写回世界层（puzzle 引擎态 + segment 投影同 set 同步），
        // 消除「引擎声称位移、世界原地不动」的分层矛盾。仅搬运玩家实体：敌人/
        // 箱子是世界实体的战斗投影，保持世界层其余状态不变。
        let worldPatch: { puzzle: PuzzleState; segment: GameState['segment'] } | null = null;
        if (report.outcome === 'fled' && battle.formation !== null) {
          const puzzle = puzzleOf();
          if (puzzle !== null) {
            const entities = applyFleeDisplacement(
              puzzle.entities,
              battle.formation.entities,
              battle.formation.playerId,
            );
            if (entities !== puzzle.entities) {
              const moved: PuzzleState = { ...puzzle, entities };
              worldPatch = { puzzle: moved, segment: segmentOf(moved, state.segment?.levelId ?? '') };
            }
          }
        }

        if (report.outcome === 'victory') {
          // 掉落武器入包（自动装备 —— 原版语义）
          if (report.dropWeaponId !== null) {
            const weapons = player.weapons ?? [];
            player = {
              ...player,
              weapons: weapons.includes(report.dropWeaponId) ? weapons : [...weapons, report.dropWeaponId],
              weaponId: report.dropWeaponId,
            };
          }
          bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-10' });
        }

        if (state.storyRuntime.phase === 'awaiting-battle') {
          const step = resolveBattleResult(ALL_SCRIPTS, state.storyRuntime, report.outcome === 'victory');
          set({ battle: null, combat: null, player, storyRuntime: step.state, ...(worldPatch ?? {}) });
          applyStoryEffects(step.effects);
          // 剧本续演（win/lose 分支都是对话或 ending 节点）——留在对话相渲染
          if (get().battle === null) set({ phase: 'dialogue' });
          return;
        }

        set({ battle: null, combat: null, player, phase: 'playing', ...(worldPatch ?? {}) });
      };

      /* --------------------------- 挑战层入场 ----------------------------- */
      const enterChallengeLayer = (layerId: string): void => {
        const state = get();
        // B3-2：visitSeq = story.flags 里 layer:<id>:* 前缀的旗标计数 + 1（写点
        // 在下方入层成功处）。层号同时驱动三件事：runSeed 分层种子（每次进入
        // 都是新生成的图，不再是固定 f1）、floorIndex（endless.ts 的尺寸/箱数/
        // 拉箱强度成长曲线与「第 N 层」命名）、递增奖励（60+floorIndex×20◈）。
        const visitSeq = Object.keys(state.story.flags).filter((k) => k.startsWith(`layer:${layerId}:`)).length + 1;
        const runSeed = `challenge-${layerId}`;
        const levelId = `endless-${runSeed}-f${visitSeq}`;
        // 无尽回廊生成器（逆向拉箱构造性可解 + 内置求解器校验）按层种子生成
        const generated = generateEndlessFloor(runSeed, visitSeq);
        if (!generated.ok) {
          // B4-5：失败详情是 endless 生成器的内部诊断（中文），转为 console 上报
          // 与 debug 标记；toast 走键控主句（toast.challengeGenFailed，7 语种）
          console.warn(`[challenge] ${generated.error}`);
          bus.publish({ type: 'debug/mark', label: `challenge-gen-error:${generated.error}` });
          bus.publish({ type: 'ui/toast', messageKey: 'toast.challengeGenFailed' });
          return;
        }
        const level = { ...floorAsLevel(generated.floor), area: 'domain-3' as const, subtitle: `挑战层 · ${layerId}` };
        registerSessionLevel(level);
        beginLevel(levelId);
        // B3-2：写层递增旗标（visitSeq 的唯一写点）。此前 layer:<id>:* 前缀全仓
        // 只有读取（visitSeq 计数）无任何写点 → 计数恒 0、visitSeq 恒 1，三挑战
        // 层退化为固定 f1 图、奖励恒 80◈，与「第 N+1 层在等你」的承诺不符。
        // 入层成功后按本次 visitSeq 落旗，下次进入计数 +1：生成参数与奖励随
        // 层数真实成长。旗标进 story.flags 真相源，随存档持久化。
        if (get().segment?.levelId === levelId) {
          const cur = get();
          set({ story: { ...cur.story, flags: { ...cur.story.flags, [`layer:${layerId}:${visitSeq}`]: true } } });
        }
      };

      /* --------------------------- 关卡启动 ------------------------------- */
      const beginLevel = (levelId: string): void => {
        const state = get();
        // B4-1：开启新的段位会话 —— 后续 finishLevelSuccessfully 的「同会话只
        // 发一次奖励」以此为界（换关/重玩都会开启新会话，重新结算语义不变）
        levelSessionSeq += 1;
        currentLevelSession = levelSessionSeq;
        rewardedLevelSession = -1;
        // 换关即作废未收尾剧本的封印账目（剧本被 beginLevel 重置为中断态，
        // 与 A4-1「演完才封印」语义一致：中断的触发保持可重触发）
        pendingSeenTriggerId = null;
        // R-2：换关同样作废未入层的挑战层挂账（本函数被 closeStoryRuntime 的
        // 正常入层路径调用时，挂账已取出并清空，此处清的是中断路径）
        pendingChallengeLayer = null;
        const level = findLevelAny(levelId);
        if (level === undefined) return;
        const parsed = parseLevelGeometry(level);
        if (!parsed.ok) {
          bus.publish({ type: 'debug/mark', label: `level-parse-error:${parsed.error}` });
          return;
        }
        const rules = puzzleRulesOf();
        const puzzle = createPuzzleState(parsed.geometry, rules);
        // L1 兜底：修复前的存档可能把 hp 0 持久化（HP 不随关卡重置）。进关即视为
        // 「休整」完成——倒地状态下回满，保证 HP 永不跨局持久为 0（重玩/重进/
        // 重开任一途径都能从 0 血恢复）；非倒地（hp > 0）不做任何回血。
        const restedPlayer =
          state.player.hp <= 0 ? { ...state.player, hp: state.player.maxHp } : state.player;
        set({
          phase: 'playing',
          activePanel: 'none',
          result: null,
          combat: null,
          battle: null,
          player: restedPlayer,
          puzzle,
          segment: segmentOf(puzzle, levelId),
          storyRuntime: state.storyRuntime.phase === 'idle' ? state.storyRuntime : { ...IDLE_STORY_RUNTIME, flags: { ...state.storyRuntime.flags } },
        });
        // 进入任意关卡时统一收起外部面板（选关/档案分片经总线关闭）
        bus.publish({ type: 'ui/closePanels' });
        bus.publish({ type: 'bgm/play', bgmId: 'bgm-sanb' });
      };

      /* --------------------------- 剧情触发评估 --------------------------- */

      /** 触发查询上下文的公共切片（旗标/已见事件；坐标按作用域分别注入） */
      type TriggerCtxBase = Pick<TriggerContext, 'flags' | 'seenEventIds'>;

      /**
       * 位置类规则（npc/tile）的双坐标求值（STORY-5 分布）：
       *  - level-scoped 规则（when.levelId 已声明）：x/y 是该关自身网格坐标，
       *    用玩家「原始网格坐标」求值，且只在对应关卡命中；
       *  - 旧规则（缺省 levelId）：x/y 是主城世界坐标，只在主城枢纽经
       *    gridToWorld 世界坐标求值（向后兼容既有触发表）。
       * 两套命中按 ALL_TRIGGER_RULES 表序取先（数据顺序即优先级，无隐式穿透；
       * 主城内两套并存：天使① npc/光羽① 的表序先于既有主城羽毛 tile）。
       */
      const queryPositionalTrigger = (
        levelId: string,
        grid: Vec2,
        world: Vec2,
        ctxBase: TriggerCtxBase,
        kinds: 'npc' | 'npc+tile',
      ): TriggerRule | null => {
        const positional = ALL_TRIGGER_RULES.filter((r) =>
          kinds === 'npc' ? r.when.kind === 'npc' : r.when.kind === 'npc' || r.when.kind === 'tile',
        );
        const scopedRules = positional.filter((r) => positionalRuleLevelId(r) === levelId);
        const hubRules = positional.filter((r) => positionalRuleLevelId(r) === undefined);
        const scopedHit = queryTrigger(scopedRules, { x: grid.x, y: grid.y, ...ctxBase });
        const hubHit =
          levelId === HUB_LEVEL_ID
            ? queryTrigger(hubRules, { x: world.x, y: world.y, ...ctxBase })
            : null;
        if (scopedHit === null || hubHit === null) return scopedHit ?? hubHit;
        return ALL_TRIGGER_RULES.indexOf(scopedHit) <= ALL_TRIGGER_RULES.indexOf(hubHit)
          ? scopedHit
          : hubHit;
      };

      const evaluateTriggersAfterMove = (prevWorld: Vec2, currWorld: Vec2): void => {
        const state = get();
        const segment = state.segment;
        if (segment === null) return;
        const levelId = segment.levelId;
        const ctxBase: TriggerCtxBase = {
          flags: triggerFlagView(state.story.flags, state.storyRuntime.flags),
          seenEventIds: state.story.seenEventIds,
        };
        // level-scoped 规则用玩家原始网格坐标（gridToWorld 的逆映射，与
        // applyPuzzleAction :847/:888 的世界坐标口径互补 —— 双坐标并存）
        const grid = worldToGrid(currWorld.x, currWorld.y);
        // npc/tile 类规则：落地即查（小怪 radius 0 = 踩上即遭遇）
        const hit = queryPositionalTrigger(levelId, grid, currWorld, ctxBase, 'npc+tile');
        if (hit !== null) {
          // B3-4：npc 半径规则的「进入边沿」语义 —— 上一格已在触发半径内
          //（区内移动）不再开演。常驻半径（L12 BOSS r3 覆盖整个圣坛解谜区）
          // 曾使 once:false 规则区内每步完整重演秒杀演出，解谜收尾被反复打断；
          // 边沿语义仿 isOutskirtsTransition（triggers.ts:160）的「跨入那一刻才
          // 触发」，且不封印 seenEventIds —— 走出半径再跨入仍会开演，E 交互
          // 主动重看也不受限，once:false 的可重复触发设计保留、无软锁路径。
          // 半径 0（踩上即遭遇）不受影响：上一格距离必 >0，恒为进入边沿。
          if (hit.when.kind === 'npc') {
            const radius = hit.when.radius ?? 1;
            const ruleLevel = positionalRuleLevelId(hit);
            const prevDist =
              ruleLevel === undefined
                ? Math.abs(hit.when.x - prevWorld.x) + Math.abs(hit.when.y - prevWorld.y) // 主城旧规则：世界坐标
                : Math.abs(hit.when.x - worldToGrid(prevWorld.x, prevWorld.y).x) +
                  Math.abs(hit.when.y - worldToGrid(prevWorld.x, prevWorld.y).y); // 关级规则：网格坐标
            if (prevDist <= radius) return;
          }
          markTriggerSeen(hit);
          startStoryScript(hit.scriptId);
          return;
        }
        // 越界缓冲带：边沿触发（从 inside 跨入 buffer 的那一刻）；outskirts 保持 HUB-only
        if (levelId !== HUB_LEVEL_ID) return;
        const prevZone = classifyPosition(prevWorld.x, prevWorld.y);
        const currZone = classifyPosition(currWorld.x, currWorld.y);
        for (const dir of ['north', 'south', 'east', 'west'] as const) {
          if (isOutskirtsTransition(prevZone, currZone, dir, 'buffer')) {
            const rule = queryTrigger(
              ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'outskirts'),
              { x: currWorld.x, y: currWorld.y, ...ctxBase },
            );
            if (rule !== null) {
              markTriggerSeen(rule);
              startStoryScript(rule.scriptId);
            }
            return;
          }
        }
      };

      const markTriggerSeen = (rule: TriggerRule): void => {
        // A4-1：封印延迟 —— once 规则命中只挂账（pendingSeenTriggerId），剧本
        // 正常收尾才写 seenEventIds。once:false 的规则（小怪/BOSS 遭遇）不封印。
        if (rule.once === false) return;
        pendingSeenTriggerId = rule.id;
      };

      /* --------------------------- 推箱主流程 ----------------------------- */

      /**
       * 法则动作被拒时的玩家提示（move 不弹 toast —— 撞墙是高频操作）。
       * B4-5：中文整句迁入 uiText 键（toast.lawLocked 等六条，7 语种），此处
       * 只存键名 —— messageKey 发键名，HudBar 的 resolveToastText 经 tUi 按语
       * 种解析，非中文语种不再直显简中整句。
       */
      const PUZZLE_BLOCK_TOAST_KEYS: Partial<Record<PuzzleAction['type'] | string, UiTextKey>> = {
        'law-locked': 'toast.lawLocked',
        'no-chest': 'toast.noChest',
        'no-charge': 'toast.noCharge',
        'landed-occupied': 'toast.landedOccupied',
        'goal-locked': 'toast.goalLocked',
        cliff: 'toast.cliff',
      };

      /**
       * 从撤销栈推断最近一次移动方向（C 键相位穿行的方向来源）。
       * history 尾切片 = 上一次动作前状态；玩家位移差即方向；无位移返回 null。
       */
      const lastMoveDirOf = (puzzle: PuzzleState): Dir | null => {
        const prev = puzzle.history[puzzle.history.length - 1];
        if (prev === undefined) return null;
        const prevPlayer = prev.entities.find((e) => e.kind === 'player');
        const currPlayer = puzzle.entities.find((e) => e.kind === 'player');
        if (prevPlayer === undefined || currPlayer === undefined) return null;
        const dx = currPlayer.x - prevPlayer.x;
        const dy = currPlayer.y - prevPlayer.y;
        for (const [dir, v] of Object.entries(DIR_VECTORS)) {
          if (v.x === dx && v.y === dy) return dir as Dir;
        }
        return null;
      };

      /**
       * 通用谜题动作执行（move/pull/diagonal/phase 共用）：
       * 结算 → 演出转译 → 投影同步 → 触发评估 → 达标结算。
       * allowOutskirts 仅 move 开启（越界 beyond 事件是「走路」语义）；
       * toastOnBlock 仅法则动作开启（撞墙高频，不弹 toast）。
       */
      const applyPuzzleAction = (action: PuzzleAction, fxDir: Dir, allowOutskirts: boolean, toastOnBlock: boolean): void => {
        const state = get();
        const puzzle = puzzleOf();
        if (puzzle === null || state.phase !== 'playing') return;
        const player = puzzle.entities.find((e) => e.kind === 'player');
        if (player === undefined) return;
        const prevWorld = gridToWorld(player.x, player.y);

        const result = applyPuzzleMove(puzzle, puzzleRulesOf(), action);

        if (!result.ok) {
          bus.publish({ type: 'anim/blocked', reason: result.reason });
          bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-3' });
          // 出界 + 主图枢纽 → 越界 beyond 事件的入场判定（玩家不位移，剧情开演）。
          // A3-2 南向判定路线：南缓冲带（world −6/−7）受「网格 row0 全墙 + 网格
          // 非负索引」双重限制不可站立（areas.ts 数据补行不可行），玩家最深立于
          // 世界内缘 y=−5，南向被拒是「撞上边界墙」（reason 'wall'，而非
          // 'out-of-bounds'），单步虚拟位最深只到 −6（buffer）——beyond（≥|8|）
          // 结构性不可达，script-outskirt-south（深渊坠道）沦为死内容。故玩家
          // 立于南缘被墙拒绝时，从虚拟位沿被拒方向逐格外推、穿过不可站的缓冲带
          // 到 beyond 再求值；北/西/东三向的被拒虚拟位本就直达 beyond，不进
          // 外推分支，「先 buffer 警示、再 beyond」的两段式既有语义零改动。
          // 「立于南缘」必须是主图内（classifyPosition inside，|x|≤5）：南缘行
          // 的东西两端延伸进东/西缓冲带（如出生点 (13,1) = 世界 (6,−5) 是东
          // 缓冲带），从缓冲带格子上南向撞墙不承载「主图南缘越界」语义，不外推
          //（否则出生点按 W 就误开 script-outskirt-south 并冻结后续移动）。
          const southEdgeRejected =
            result.reason === 'wall' &&
            fxDir === 'up' && // 网格 up 即世界南（world = grid − STORY_GRID_OFFSET，−y 向）
            prevWorld.y === -MAIN_MAP_HALF_EXTENT &&
            classifyPosition(prevWorld.x, prevWorld.y).kind === 'inside';
          if (
            allowOutskirts &&
            (result.reason === 'out-of-bounds' || southEdgeRejected) &&
            state.segment?.levelId === HUB_LEVEL_ID
          ) {
            const step = DIR_VECTORS[fxDir];
            let beyond = { x: prevWorld.x + step.x, y: prevWorld.y + step.y };
            let zone = classifyPosition(beyond.x, beyond.y);
            // 仅「南缘被墙拒」外推：南缓冲带深度 2（|6|~|7|），至多两步即达
            // beyond；循环上限防御非正交步进的病态输入，不影响既有方向。
            if (southEdgeRejected && zone.kind === 'buffer') {
              for (let i = 0; zone.kind === 'buffer' && i < 4; i++) {
                beyond = { x: beyond.x + step.x, y: beyond.y + step.y };
                zone = classifyPosition(beyond.x, beyond.y);
              }
            }
            if (zone.kind === 'beyond') {
              const rule = queryTrigger(
                ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'outskirts'),
                {
                  x: beyond.x,
                  y: beyond.y,
                  flags: triggerFlagView(state.story.flags, state.storyRuntime.flags),
                  seenEventIds: state.story.seenEventIds,
                },
              );
              if (rule !== null && rule.when.kind === 'outskirts' && rule.when.zone === 'beyond' && rule.when.dir === zone.dir) {
                markTriggerSeen(rule);
                startStoryScript(rule.scriptId);
              }
            }
          }
          const toastKey = toastOnBlock ? PUZZLE_BLOCK_TOAST_KEYS[result.reason] : undefined;
          if (toastKey !== undefined) bus.publish({ type: 'ui/toast', messageKey: toastKey });
          return;
        }

        publishPuzzleFx(result.fx, fxDir);
        const solvedNow = result.fx.some((f) => f.type === 'solved');
        const nextSegment = segmentOf(result.state, state.segment?.levelId ?? '');
        set({ puzzle: result.state, segment: nextSegment, ruleSet: puzzleRulesOf() });

        const nextPuzzle = result.state;
        const nextPlayer = nextPuzzle.entities.find((e) => e.kind === 'player');
        // 结算即场景边界：达标那一拍不评估剧情触发（startStoryScript/结算面板
        // 会互相覆盖 phase，剧本会被悬空）。once:false 的规则下一拍重触发；
        // once:true 的规则保持待发（同格后续落格仍会命中），无任何软锁路径。
        if (nextPlayer !== undefined && !solvedNow) {
          evaluateTriggersAfterMove(prevWorld, gridToWorld(nextPlayer.x, nextPlayer.y));
        }
        if (solvedNow) {
          for (const chest of nextPuzzle.entities.filter((e) => e.kind === 'chest')) {
            bus.publish({ type: 'anim/goalBurst', entityId: chest.id });
          }
          finishLevelSuccessfully(nextPuzzle);
        }
      };

      const applyMove = (dir: Dir): void => {
        applyPuzzleAction({ type: 'move', dir }, dir, true, false);
      };

      return {
        ...initialState,
        visitCount: 0,

        startLevel(levelId) {
          // 先入场；法则门槛关卡缺卡 → 100% 补发剧本作为覆盖对话（收尾即开玩）。
          // 不延迟入场：段位就位让 reached:<id> 旗标/选关谓词立即成立（S10）。
          beginLevel(levelId);
          const ownedIds = get().gacha.owned.map((o) => o.cardId);
          const entry = checkLevelEntryDeck(levelId, ownedIds);
          if (!entry.ok) startStoryScript(entry.makeUpScriptId);
        },

        backToTitle() {
          // 回标题即清空一局的世界状态：segment/result 不清会让标题页继续渲染
          // 旧关卡与旧结算（closeOverlay 的 title 回退也依赖 segment===null）
          // A4-1：未收尾剧本的封印账目一并作废（回标题=中断）
          pendingSeenTriggerId = null;
          // R-2：未入层的挑战层挂账同上（回标题=中断）
          pendingChallengeLayer = null;
          set({
            phase: 'title',
            activePanel: 'none',
            segment: null,
            puzzle: null,
            result: null,
            combat: null,
            battle: null,
            storyRuntime: { ...IDLE_STORY_RUNTIME, flags: { ...get().story.flags } },
          });
        },

        dispatch(action) {
          const s = get();
          switch (action.type) {
            case 'move':
              s.move(action.dir);
              break;
            case 'shove':
              s.shove(action.dir);
              break;
            case 'pull':
              s.pull(action.dir);
              break;
            case 'diagonal':
              s.diagonal(action.diag);
              break;
            case 'phase':
              s.phaseWalk(action.dir);
              break;
            case 'undo':
              s.undo();
              break;
            case 'replaySegment':
              s.replaySegment();
              break;
            case 'interact':
              s.interact(action.targetId);
              break;
            case 'shiftPlane':
              s.shiftPlane();
              break;
            case 'selectWeapon':
              s.selectWeapon(action.weaponId);
              break;
            case 'combatAct':
              s.combatAct(action.act);
              break;
            case 'rollGacha':
              s.rollGacha(action.times);
              break;
            case 'applyLawCard':
              s.applyLawCard(action.uid);
              break;
            case 'advanceDialogue':
              s.advanceDialogue();
              break;
            case 'skipDialogue':
              s.advanceDialogue();
              break;
            case 'chooseStory':
              s.chooseStory(action.choiceId);
              break;
            case 'submitStoryInput':
              s.submitStoryInput(action.text);
              break;
            case 'setLocale':
              s.setLocale(action.locale);
              break;
            case 'setVolume':
              s.setVolume(action.channel, action.value);
              break;
            case 'toggleMute':
              s.toggleMute();
              break;
            case 'openPanel':
              s.openPanel(action.panel);
              break;
            case 'toggleFormation':
              // 战斗布阵相 → 确认布阵开打（CombatPanel 的「布阵」按钮/Tab 键）；
              // 无战斗 → 打开卡组面板（骨架期语义保留）
              if (s.battle !== null) {
                const battle = battleOf();
                if (battle !== null && battle.phase === 'formation') {
                  runBattleAction({ type: 'startBattle' });
                  break;
                }
                bus.publish({ type: 'ui/toast', messageKey: 'toast.formationOver' });
                break;
              }
              s.openPanel('deck');
              break;
            case 'closeOverlay':
              s.closeOverlay();
              break;
            default: {
              const exhaustive: never = action;
              void exhaustive;
            }
          }
        },

        move(dir) {
          applyMove(dir);
        },

        shove(dir) {
          const battle = battleOf();
          if (battle === null) return;
          if (battle.phase !== 'formation') {
            bus.publish({ type: 'ui/toast', messageKey: 'toast.shoveBattleOnly' });
            return;
          }
          runBattleAction({ type: 'shove', dir });
        },

        pull(dir) {
          applyPuzzleAction({ type: 'pull', dir }, dir, false, true);
        },

        diagonal(diag) {
          // 演出方向取斜向向量的主轴（anim/slide 的 dir 元数据；from/to 才是权威）
          const v = DIAG_VECTORS[diag];
          const fxDir: Dir = Math.abs(v.x) >= Math.abs(v.y) ? (v.x >= 0 ? 'right' : 'left') : v.y >= 0 ? 'down' : 'up';
          applyPuzzleAction({ type: 'diagonal', diag }, fxDir, false, true);
        },

        phaseWalk(dir) {
          const puzzle = puzzleOf();
          if (puzzle === null) return;
          let actDir = dir;
          if (actDir === undefined) {
            // C 键约定：沿最近一次移动方向继续（可穿墙）；无方向可依时明示引导
            const inferred = lastMoveDirOf(puzzle);
            if (inferred === null) {
              bus.publish({ type: 'ui/toast', messageKey: 'toast.phaseWalkNeedDir' });
              return;
            }
            actDir = inferred;
          }
          applyPuzzleAction({ type: 'phase', dir: actDir }, actDir, false, true);
        },

        undo() {
          const state = get();
          const puzzle = puzzleOf();
          if (puzzle === null) return;
          const undone = undoPuzzle(puzzle);
          if (undone === puzzle) return;
          set({
            phase: state.phase === 'result' ? 'playing' : state.phase,
            result: null,
            puzzle: undone,
            segment: segmentOf(undone, state.segment?.levelId ?? ''),
          });
        },

        replaySegment() {
          const state = get();
          const segment = state.segment;
          if (segment === null) return;
          beginLevel(segment.levelId);
        },

        interact(_targetId) {
          const state = get();
          if (state.phase !== 'playing') return;
          const player = (state.segment?.entities ?? []).find((e) => e.kind === 'player');
          if (player === undefined) return;
          // 世界内星愿祭坛：玩家曼哈顿距离 ≤1 → 走 store.openPanel 打开抽卡入口
          //（与 HUD 星石胶囊同一入口，不旁路面板状态机）
          const nearAltar = (state.segment?.entities ?? []).some(
            (e) => e.kind === 'altar' && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1,
          );
          if (nearAltar) {
            state.openPanel('gacha');
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
            return;
          }
          const levelId = state.segment?.levelId ?? '';
          const world = gridToWorld(player.x, player.y);
          const ctxBase: TriggerCtxBase = {
            flags: triggerFlagView(state.story.flags, state.storyRuntime.flags),
            seenEventIds: state.story.seenEventIds,
          };
          // E 交互与移动触发共用同一套关级作用域过滤（STORY-5）：level-scoped 用
          // 网格坐标、主城旧规则用世界坐标；只查 npc 规则（曼哈顿 ≤1，含踩上 radius 0）
          const rule = queryPositionalTrigger(levelId, { x: player.x, y: player.y }, world, ctxBase, 'npc');
          if (rule === null) {
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-2' });
            return;
          }
          markTriggerSeen(rule);
          startStoryScript(rule.scriptId);
        },

        shiftPlane() {
          const state = get();
          const puzzle = puzzleOf();
          if (puzzle === null || state.phase !== 'playing') return;
          const result = applyPuzzleMove(puzzle, puzzleRulesOf(), { type: 'shiftPlane' });
          if (!result.ok) {
            // B4-5：位面 toast 全部键控（7 语种）。'plane-locked' 接线既有
            // toast.planeLocked 键（此前键已存在却未引用，双真相源口径收口）；
            // no-anchor/embedded/兜底为本次新增键。
            const toastKeyByReason: Partial<Record<string, UiTextKey>> = {
              'plane-locked': 'toast.planeLocked',
              'no-anchor': 'toast.planeNoAnchor',
              embedded: 'toast.planeEmbedded',
            };
            bus.publish({ type: 'ui/toast', messageKey: toastKeyByReason[result.reason] ?? 'toast.planeShiftFailed' });
            return;
          }
          publishPuzzleFx(result.fx, 'up');
          set({ puzzle: result.state, segment: segmentOf(result.state, state.segment?.levelId ?? '') });
        },

        selectWeapon(weaponId) {
          const battle = battleOf();
          if (battle === null) return;
          // def id → availableWeapons 里的实例 uid（K12：只选真实存在的实例）
          const instance = battle.availableWeapons.find((w) => w.defId === weaponId);
          if (instance === undefined) {
            // B4-5：带参数句子经 tUi 按 locale 插值后以成品文本发布（bus 单通道，
            // 与 toast.nostalgiaRound 同一先例）；weaponId 是语言中立 id
            bus.publish({
              type: 'ui/toast',
              messageKey: tUi(get().locale, 'toast.weaponNotInBag', { weaponId }),
            });
            return;
          }
          runBattleAction({ type: 'selectWeapon', uid: instance.uid });
        },

        combatAct(act) {
          const battle = battleOf();
          if (battle === null) return;
          if (act === 'flee') {
            runBattleAction({ type: 'flee' });
            return;
          }
          runBattleAction({ type: act });
        },

        rollGacha(times) {
          const state = get();
          // B4-2：战斗/对话相禁入抽卡 —— 抽卡会把 phase 切到 'gacha'，而
          // closeOverlay 只把 gacha 相回 playing，battle/formation 残留后世界层
          // 与布阵战斗同时活跃（状态机破坏）。store 层门禁覆盖键盘+HUD+祭坛
          // 全部入口；面板本身仍可开（看卡组/背包），只是抽卡动作被拒。
          if (state.phase === 'combat' || state.phase === 'dialogue') {
            bus.publish({ type: 'ui/toast', messageKey: 'toast.gachaLocked' });
            return;
          }
          const cost = gachaCost(times);
          if (state.gacha.starStones < cost) {
            bus.publish({ type: 'ui/toast', messageKey: 'toast.gachaPlaceholder' });
            return;
          }
          const rng = createRng(`gacha:${state.pity.totalPulls}:${state.gacha.starStones}`);
          const outcome = performGacha({
            pool: FORMAL_POOL,
            rng,
            counters: state.pity,
            ownedCardIds: new Set(state.gacha.owned.map((o) => o.cardId)),
            times,
          });
          const best = outcome.pulls.reduce((m, p) => (p.rarity > m ? p.rarity : m), 2 as 2 | 3 | 4);
          bus.publish({ type: 'anim/gachaBurst', rarity: best });
          bus.publish({ type: 'bgm/play', bgmId: 'bgm-bandori' });
          const pity: PityCounters = outcome.countersAfter;
          // A4-10：pity 是保底计数唯一真相（types.ts），UI 进度条直接读 s.pity ——
          // 不再手工镜像 pullsSinceFourStar 进 gacha（双字段靠双写维持一致性的根源）
          set({
            phase: 'gacha',
            pity,
            gacha: {
              ...state.gacha,
              starStones: state.gacha.starStones - cost,
              totalPulls: pity.totalPulls,
              owned: [
                ...state.gacha.owned,
                ...outcome.pulls.map((p) => ({ uid: p.uid, cardId: p.cardId, obtainedAt: Date.now() })),
              ],
              lastResult: {
                pulls: outcome.pulls,
                boostedTenPull: outcome.boostedTenPull,
                pityTriggered: outcome.triggers.includes('hard-four-star')
                  ? 'hard-four-star'
                  : outcome.triggers.includes('per-ten')
                    ? 'per-ten'
                    : 'none',
              },
            },
          });
        },

        runNostalgiaGacha() {
          const state = get();
          // 怀旧对照池（M3）：Lottery.java:40-46 原版行为复刻，一回 = 十张。
          // 只写统计分片（POOL_NOSTALGIA），绝不触碰正式池计数、保底与星石。
          const rng = createRng(`nostalgia:${nostalgiaSeq}:${state.pity.totalPulls}`);
          const stars: readonly NostalgiaStar[] = simulateNostalgiaRound(NOSTALGIA_PARAMS, rng, nostalgiaSeq);
          const pulls: readonly GachaPull[] = stars.map((star, i) => ({
            uid: `nostalgia-${nostalgiaSeq}-${i}`,
            // 对照展品不产出可用卡：cardId 仅作统计分桶标签，不指向卡表
            cardId: `nostalgia-star-${star}`,
            rarity: star === 'four' ? 4 : star === 'three' ? 3 : 2,
            isNew: false,
          }));
          const round = nostalgiaSeq;
          nostalgiaSeq += 1;
          const fourCount = stars.filter((s) => s === 'four').length;
          const threeCount = stars.filter((s) => s === 'three').length;
          // 统计分片动态引入（避免 gameStore ↔ statsCollector 的模块环，与 logbook 同策略）
          void import('../../archive/statsCollector')
            .then((m) => {
              // B4-7：pullIndex 真相源回读 —— 起始编号取 stats 分片 POOL_NOSTALGIA
              // 计数（随存档持久化），不再用会话闭包计数器 nostalgiaPullsTotal。
              // 此前跨刷新 pullIndex 重新从 1 计，档案「逐抽记录」出现两套 #1~#10，
              // 违背 statsCollector.ts:41-42「跨批次连续」承诺。动态回调里同步读
              // poolTallies 是安全的：recordPulls 的 set 同步落账，上一批已计入。
              const stats = m.useStatsStore.getState();
              const startIndex = stats.poolTallies[m.POOL_NOSTALGIA]?.pulls ?? 0;
              m.useStatsStore.getState().recordPulls(m.POOL_NOSTALGIA, pulls, startIndex);
            })
            // A4-9：绝不静默 —— 动态加载失败要让控制台可见（S14 纪律）
            .catch((e: unknown) => console.error('[statsCollector] 动态加载失败，怀旧池本回未记档', e));
          bus.publish({
            type: 'ui/toast',
            // R-7：中文整句拼串改为 uiText 键控（toast.nostalgiaRound，7 语种）。
            // bus 的 ui/toast 事件只有 messageKey 单通道（bus.ts:29），HudBar 的
            // resolveToastText 调 tUi 也不传 vars —— 插值参数机制无法穿透展示层，
            // 故在 store 侧经 tUi 按 locale 完成插值（vars 即 tUi 的参数机制），
            // messageKey 携带成品文本；展示层对非键 messageKey 走旧字典回落、
            // 缺键回落字面量，成品文本原样上屏，非中文语种不再显示中文整句。
            messageKey: tUi(get().locale, 'toast.nostalgiaRound', {
              n: round + 1,
              four: fourCount,
              three: threeCount,
            }),
          });
        },

        redeemLawCard(cardId) {
          const state = get();
          // B4-5：玩家可见的失败原因先在本层预校验并走 uiText 键控（7 语种）——
          // 引擎 redeemLawCardEngine 的 error 是中文整句，不进玩家 toast 通道
          //（引擎校验原样保留：预校验与引擎同谓词同源，理论不可达时走兜底键）。
          const locale = state.locale;
          const reject = (messageKey: string): void => {
            bus.publish({ type: 'ui/toast', messageKey });
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-3' });
          };
          const card = CARDS.find((c) => c.id === cardId);
          if (card === undefined) {
            reject(tUi(locale, 'toast.redeemUnknownCard', { cardId }));
            return;
          }
          if (card.kind !== 'law') {
            reject(tUi(locale, 'toast.redeemNotLawCard', { name: card.name }));
            return;
          }
          if (state.gacha.owned.some((o) => o.cardId === cardId)) {
            reject(tUi(locale, 'toast.redeemAlreadyOwned', { name: card.name }));
            return;
          }
          if (state.pity.shards < FORMAL_POOL.pity.redeemCost) {
            reject(
              tUi(locale, 'toast.redeemShortShards', { need: FORMAL_POOL.pity.redeemCost, have: state.pity.shards }),
            );
            return;
          }
          // 校验（余额/合法性/已持有）在引擎纯函数 redeemLawCard：60 碎片直购任一未持有法则卡
          const outcome = redeemLawCardEngine({
            counters: state.pity,
            cardId,
            ownedCardIds: new Set(state.gacha.owned.map((o) => o.cardId)),
            lawCards: CARDS,
            redeemCost: FORMAL_POOL.pity.redeemCost,
          });
          if (!outcome.ok) {
            // 预校验已覆盖全部已知拒绝路径；引擎仍拒绝（内部校验兜底）不直显中文整句
            console.warn(`[gacha] 碎片直购被引擎拒绝：${outcome.error}`);
            reject('toast.redeemFailed');
            return;
          }
          const lawCard = CARDS.find((c) => c.id === outcome.cardId);
          set({
            pity: outcome.counters,
            gacha: {
              ...state.gacha,
              owned: [
                ...state.gacha.owned,
                { uid: `redeem-${outcome.cardId}`, cardId: outcome.cardId, obtainedAt: Date.now() },
              ],
            },
          });
          bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
          bus.publish({
            type: 'ui/toast',
            // B4-5：成功 toast 键控插值（toast.redeemSuccess，卡名按内容语言事实源）
            messageKey: tUi(get().locale, 'toast.redeemSuccess', {
              name: lawCard?.name ?? outcome.cardId,
              cost: FORMAL_POOL.pity.redeemCost,
            }),
          });
        },

        runMetaTerminal(raw) {
          const state = get();
          const outcome = runMetaTerminalCommand({
            raw,
            flags: triggerFlagView(state.story.flags, state.storyRuntime.flags),
          });
          for (const eff of outcome.effects) {
            if (eff.kind === 'setFlag') {
              const cur = get();
              set({ story: { ...cur.story, flags: { ...cur.story.flags, [eff.key]: eff.value } } });
            } else if (eff.kind === 'showEnding') {
              const cur = get();
              set({ story: { ...cur.story, flags: { ...cur.story.flags, 'last-ending-id': eff.endingId } } });
              // A4-5：真结局 toast 键控（toast.trueEnding），7 语种不再直显中文句
              bus.publish({ type: 'ui/toast', messageKey: 'toast.trueEnding' });
              if (eff.achievementId !== undefined) {
                const achievementId = eff.achievementId;
                // 动态引入避免 gameStore ↔ logbook 的模块环（同 applyStoryEffects 策略）
                void import('../../archive/logbook')
                  .then((m) => {
                    try {
                      m.useLogbookStore.getState().unlockAchievement(achievementId);
                    } catch {
                      /* 未知成就 id：logbook 抛 RangeError，终端侧不因成就崩终端 */
                    }
                  })
                  // A4-9：绝不静默 —— 动态加载失败要让控制台可见（S14 纪律）
                  .catch((e: unknown) => console.error('[logbook] 动态加载失败，成就未入册', e));
              }
            }
          }
          return outcome.echo;
        },

        applyLawCard(uid) {
          const state = get();
          const instance = state.gacha.owned.find((o) => o.uid === uid);
          if (instance === undefined || state.gacha.activeLaws.includes(instance.cardId)) return;
          const card = CARDS.find((c) => c.id === instance.cardId);
          if (card === undefined) return;

          if (card.kind === 'character') {
            // 角色卡：编入卡组（战斗开局结算 buff，对话分支经 card: 镜像判定）
            set({ gacha: { ...state.gacha, activeLaws: [...state.gacha.activeLaws, card.id] } });
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
            // B4-5：键控插值 toast（toast.cardEnrolled，7 语种；卡名保留中文属内容语言决策）
            bus.publish({ type: 'ui/toast', messageKey: tUi(get().locale, 'toast.cardEnrolled', { name: card.name }) });
            return;
          }

          if (card.lawPatchId === undefined) return;
          const patchIds = state.gacha.activeLaws
            .map((cardId) => CARDS.find((c) => c.id === cardId)?.lawPatchId)
            .filter((id): id is string => id !== undefined);
          const rebuilt = buildPuzzleRuleSet(DEFAULT_RULE_SET, [...patchIds, card.lawPatchId]);
          if (!rebuilt.ok) {
            // B4-5：rebuilt.error 是 lawRegistry 的内部诊断（未知补丁 id 等，数据
            // bug 路径）——转 console 上报，toast 走通用键控句不直显中文整句
            console.warn(`[law] 法则补丁应用失败：${rebuilt.error}`);
            bus.publish({ type: 'ui/toast', messageKey: 'toast.actionFailed' });
            return;
          }
          set({
            ruleSet: rebuilt.ruleSet,
            gacha: { ...state.gacha, activeLaws: [...state.gacha.activeLaws, card.id] },
          });
          bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
        },

        advanceDialogue() {
          const state = get();
          const runtime = state.storyRuntime;
          if (state.phase !== 'dialogue') return;

          // 结局节点：收尾（效果在进入节点时已结算）
          if (runtime.phase === 'finished' && runtime.scriptId !== null) {
            closeStoryRuntime();
            return;
          }

          const step = advanceStory(ALL_SCRIPTS, runtime);
          if (step.error !== undefined) {
            bus.publish({ type: 'debug/mark', label: `story-advance:${step.error}` });
            return;
          }
          set({ storyRuntime: step.state });
          applyStoryEffects(step.effects);
          // 剧本自然完结（dialogue 无 next）→ exitScript 效果由 closeStoryRuntime 处理
          if (step.state.phase === 'finished') {
            closeStoryRuntime();
          }
        },

        chooseStory(choiceId) {
          const state = get();
          if (state.phase !== 'dialogue') return;
          const step = chooseStory(ALL_SCRIPTS, state.storyRuntime, choiceId);
          if (step.error !== undefined) {
            bus.publish({ type: 'debug/mark', label: `story-choice:${step.error}` });
            return;
          }
          set({ storyRuntime: step.state });
          applyStoryEffects(step.effects);
          if (step.state.phase === 'finished') closeStoryRuntime();
        },

        submitStoryInput(text) {
          const state = get();
          if (state.phase !== 'dialogue') return;
          const step = submitStoryInput(ALL_SCRIPTS, state.storyRuntime, text, { solvers: STORY_SOLVERS });
          if (step.error !== undefined) {
            bus.publish({ type: 'debug/mark', label: `story-input:${step.error}` });
            return;
          }
          set({ storyRuntime: step.state });
          applyStoryEffects(step.effects);
          if (step.state.phase === 'finished') closeStoryRuntime();
        },

        setLocale(locale) {
          // N-2：白名单校验 —— 非法值（越权调用/损坏数据传入白名单外的 locale）
          // 拒绝并回落 'zh-Hans'，不让 UI_TEXT[locale] 在渲染树拿到 undefined。
          if (!isLocaleId(locale)) {
            set({ locale: 'zh-Hans' });
            return;
          }
          set({ locale });
        },

        setVolume(channel, value) {
          const settings = get().settings;
          const clamped = Math.max(0, Math.min(1, value));
          const next = { ...settings };
          if (channel === 'master') next.masterVolume = clamped;
          else if (channel === 'bgm') next.bgmVolume = clamped;
          else next.sfxVolume = clamped;
          set({ settings: next });
        },

        toggleMute() {
          const settings = get().settings;
          set({ settings: { ...settings, muted: !settings.muted } });
        },

        openPanel(panel) {
          // A4-4 面板互斥的另一半：打开 deck/gacha/settings/rulebook 任一主面板
          // 时，广播关闭三个独立分片面板（档案/选关/攻略）——它们的 open 在各自
          // 分片 store 里，openPanel 的单值互斥（PanelId）覆盖不到；反向互斥由
          // 分片面板自己的 open 动作广播 closePanels + closeOverlay 完成。
          bus.publish({ type: 'ui/closePanels' });
          set({ activePanel: panel });
        },

        closeOverlay() {
          const state = get();
          // 终局/抽卡/设置 overlay 全部可关闭且不锁控制（根治 S11）
          // 无段位（标题页单抽）时回到标题，而不是落到没有世界的 playing 空白页；
          // B4-2 双保险：battle 残留（战斗中被违规切走的会话态）时回 'combat'
          // 而非 'playing' —— 世界层不得在战斗活跃时回到推箱相
          const fallbackPhase =
            state.segment === null ? 'title' : state.battle !== null ? 'combat' : 'playing';
          if (state.result !== null) set({ result: null, phase: fallbackPhase });
          if (state.phase === 'gacha') set({ phase: fallbackPhase });
          if (state.activePanel !== 'none') set({ activePanel: 'none' });
          // 选关/档案面板的开关在各自分片里：经总线通知它们一起关闭（Esc 语义一致）
          bus.publish({ type: 'ui/closePanels' });
        },

        removeChestById(chestId) {
          const state = get();
          const puzzle = puzzleOf();
          if (puzzle === null) return false;
          const victim = puzzle.entities.find((e) => e.id === chestId);
          if (victim === undefined) return false;
          const next: PuzzleState = {
            ...puzzle,
            entities: puzzle.entities.filter((e) => e.id !== chestId),
            // 快照入撤销栈：消除也可 Z 回滚
            history: [
              ...puzzle.history.slice(-(200 - 1)),
              {
                entities: puzzle.entities,
                steps: puzzle.steps,
                pushes: puzzle.pushes,
                phaseCharges: puzzle.phaseCharges,
                detonationsLeft: puzzle.detonationsLeft,
                planeShifted: puzzle.planeShifted,
              },
            ],
          };
          set({ puzzle: next, segment: segmentOf(next, state.segment?.levelId ?? '') });
          return true;
        },

        resetSave() {
          const sessionLevelIds = [...sessionLevels.keys()];
          for (const id of sessionLevelIds) sessionLevels.delete(id);
          battleSeq = 0;
          nostalgiaSeq = 0;
          pendingSeenTriggerId = null; // A4-1：清档一并作废未收尾剧本的封印账目
          pendingChallengeLayer = null; // R-2：清档一并作废未入层的挑战层挂账
          set({ ...initialState, visitCount: get().visitCount });
        },
      };
    },
    {
      name: 'lawbox-chronicle:v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // 段内实体/战斗/演出态是会话态，不落盘；档案只存进度与偏好。
      // storyRuntime 自 v3 起同样不再落盘（A4-2）：全仓从未有读档恢复点，
      // 「剧本中断可续」承诺未兑现，落盘是纯死重；撤销后语义收敛为
      // 「剧本中断即重来」，配合触发封印延迟（pendingSeenTriggerId，A4-1）
      // 中断的 once 触发未落账，重走原坐标即可再次开演，不再软锁。
      // 旗标真相唯一在 story.flags —— 触发/META 评估经 triggerFlagView 以
      // 真相源为准；每次剧本开场即被 startStoryScript 以 story.flags 重播种。
      partialize: (state) => ({
        locale: state.locale,
        settings: state.settings,
        player: state.player,
        ruleSet: state.ruleSet,
        gacha: state.gacha,
        pity: state.pity,
        story: state.story,
        visitCount: state.visitCount,
      }),
      migrate: (persisted) => {
        // v3：storyRuntime 停止落盘 —— 剥离 v1/v2 旧档遗留的运行时切片
        //（剧本恢复从未实现，遗留切片只会让读档后 storyRuntime 带着幽灵
        // 节点；zustand merge 会把持久化切片原样灌回内存，必须在迁移时丢弃）。
        const legacy = persisted as Partial<GameState> & { visitCount?: number };
        const { storyRuntime: droppedRuntime, ...rest } = legacy;
        void droppedRuntime;
        // N-2：旧档迁移通道同样校验 locale —— 损坏存档的非法值回落 'zh-Hans'
        //（与下方 merge 的读档校验同一白名单，两条读档通道闭环）。
        if (!isLocaleId(rest.locale)) rest.locale = 'zh-Hans';
        return rest as GameState & { visitCount: number };
      },
      // N-2：读档通道校验 —— migrate 只在版本不匹配时运行，版本相等的损坏档
      //（locale 被绕过 setLocale 直接改写落盘）经 zustand 默认 merge 原样灌回
      // 内存。这里替换为带 locale 白名单校验的等价浅合并：非法值回落
      // 'zh-Hans'，堵住「损坏存档 locale 直达渲染树」的最后一条通道。
      merge: (persisted, current) => {
        const persistedLocale = (persisted as { locale?: unknown } | null | undefined)?.locale;
        const merged = { ...current, ...(persisted as object), locale: isLocaleId(persistedLocale) ? persistedLocale : 'zh-Hans' } as typeof current;
        // B4-3：按 CARDS 白名单清洗读档灌回的 gacha.owned —— 版本删卡或手改
        // 存档的 ghost 卡（cardId 不在卡池）此前原样进内存，logbook 收集器对
        // owned 全量重算时 recordCardObtained 抛 RangeError，订阅链中断、成就/
        // 图鉴静默停摆。治本：ghost 卡在读档入口即被洗掉，永不复发。
        // （收集器侧另有 per-call 容错兜底，见 archive/logbook.ts installLogbookCollector。）
        const gacha = merged.gacha;
        if (gacha !== undefined && Array.isArray(gacha.owned)) {
          const knownCardIds = new Set(CARDS.map((c) => c.id));
          // GameState.gacha 是 readonly 属性（types.ts），不能对 merged 原地赋值；
          // 用展开重建新对象覆盖 gacha，其余切片（含 store 方法）引用原样保留。
          return { ...merged, gacha: { ...gacha, owned: gacha.owned.filter((o) => knownCardIds.has(o.cardId)) } };
        }
        return merged;
      },
    },
  ),
);

/* ============================ 引擎类型视图（选择器） ======================= */

/** 谜题引擎状态的类型视图（core GameState 中以 unknown 持有，避免反向依赖） */
export function selectPuzzleState(state: GameState): PuzzleState | null {
  return state.puzzle as PuzzleState | null;
}

/** 战斗引擎状态的类型视图 */
export function selectBattleState(state: GameState): BattleState | null {
  return state.battle as BattleState | null;
}

/* ============================ 派生：地形选择器 ============================= */

/** 从 store 段位推导地形层（每调用现算；13×15 量级成本可忽略） */
export function selectTerrainGrid(state: GameState): Grid {
  const levelId = state.segment?.levelId;
  if (levelId === undefined) return [];
  return importLevel(levelId)?.terrain ?? [];
}

export function selectPlayerEntity(state: GameState): GridEntity | undefined {
  return state.segment?.entities.find((e) => e.kind === 'player');
}

/** 段位尖刺格（图例 5）：3D 渲染 hazardCells 与布阵战 hazard 装配的统一来源 */
export function selectHazardCells(state: GameState): readonly Vec2[] {
  const levelId = state.segment?.levelId;
  if (levelId === undefined) return [];
  const terrain = importLevel(levelId)?.terrain ?? [];
  const cells: Vec2[] = [];
  terrain.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell === SPIKE_CELL) cells.push({ x, y });
    });
  });
  return cells;
}

/** 战斗布阵 hazard 表（combat 期 3D 渲染地形武器；非战斗期为空表） */
export function selectBattleHazards(state: GameState): HazardMap {
  const battle = state.battle as BattleState | null;
  return battle?.formation?.hazards ?? {};
}

/** 战斗布阵网格（combat 期 3D 渲染战场网格；非战斗期为 null） */
export function selectBattleFormationGrid(state: GameState): Grid | null {
  const battle = state.battle as BattleState | null;
  return battle?.formation?.grid ?? null;
}

/* ============================== 再导出（视图用） =========================== */

export { currentLines, visibleChoices };
export type { StoryScriptDef };
/** 引擎几何助手经 store 再导出：view 层只 import core/store，不直引 engine（R3 分层收紧） */
export { effectiveTerrain } from '../../engine/puzzle/grid';
export type { HeightMap } from '../../engine/puzzle/grid';
