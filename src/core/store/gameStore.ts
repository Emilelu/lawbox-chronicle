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
 *     开战/终局/传送）在本文件统一落账。story.flags 同时是作弊谓词与持久化旗标。
 *   - 抽卡：engine/gacha performGacha（正式池 + 三层保底 + 碎片）写
 *     `gacha` 与 `pity`（三层独立计数器，随存档持久化）。
 *
 * 世界坐标约定：Kichiku 主地图（±5）重化为「初醒箱庭」（level-sb-01，15×13）
 * 的网格空间 —— STORY_GRID_OFFSET=(7,6)。剧情 NPC/越界触发只在主线枢纽关卡
 * （HUB_LEVEL_ID）上评估；越界 beyond 事件由「边界外一步被拒」的出界动作触发。
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
import { DIAG_VECTORS, DIR_VECTORS, SPIKE_CELL } from '../types';
import { DEFAULT_RULE_SET } from '../lawRegistry';
import { bus, type FxEvent } from '../events/bus';
import { createRng } from '../rng';
import { starRating, starStoneReward, clampHp } from '../formula';
import { findEnemy, findLevel } from '../../data';
import { createWeaponInstance } from '../../data/weapons';
import { CARDS, GACHA_FLAVOR } from '../../data/gacha';
import { FORMAL_POOL, NOSTALGIA_PARAMS, gachaCost } from '../../data/gacha/pools';
import { ALL_SCRIPTS, STORY_SOLVERS, ALL_TRIGGER_RULES } from '../../data/storyScripts';
import { runMetaTerminalCommand } from '../../data/story/hiddenGame';
import { generateEndlessFloor, floorAsLevel } from '../../data/levels/endless';
import {
  classifyPosition,
  checkLevelEntryDeck,
  findInteractableRule,
  isOutskirtsTransition,
  queryTrigger,
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

function findLevelAny(levelId: string): Level3D | undefined {
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
    pullsSinceFourStar: 0,
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

/* ================================ 创建 ==================================== */

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
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
        const stars = starRating(puzzle.steps, level.parSteps);
        const gain = starStoneReward(stars, level.reward.starStones);
        const owned =
          level.reward.lawCardId !== undefined && !state.gacha.owned.some((o) => o.cardId === level.reward.lawCardId)
            ? [...state.gacha.owned, { uid: `reward-${level.reward.lawCardId}`, cardId: level.reward.lawCardId, obtainedAt: Date.now() }]
            : state.gacha.owned;
        // 相位穿行评分奖励（grantPhaseCharges 接线）：3★ +2 / 2★ +1 / 1★ +0，
        // 从结算面板撤销回局（undo 允许）时奖励充能仍真实可用
        const chargeBonus = stars >= 3 ? 2 : stars === 2 ? 1 : 0;
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
                  .catch(() => undefined);
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
              enterChallengeLayer(eff.layerId);
              break;
            case 'openMetaTerminal':
              writeFlag('meta:terminal-unlocked', true);
              bus.publish({ type: 'ui/toast', messageKey: 'META 终端已解锁：通关后按 ` 呼出。' });
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
      const startStoryScript = (scriptId: string, entryNodeId?: string): void => {
        const state = get();
        // 运行时旗标种子：持久化旗标 + 持卡镜像（解释器的 requireCard/gate 用）
        const seededFlags: Record<string, boolean | number | string> = { ...state.story.flags };
        for (const owned of state.gacha.owned) seededFlags[`card:${owned.cardId}`] = true;
        const runtime: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: seededFlags };
        const step = startStory(ALL_SCRIPTS, scriptId, runtime, entryNodeId);
        if (step.error !== undefined) {
          bus.publish({ type: 'debug/mark', label: `story-error:${step.error}` });
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
        set({
          storyRuntime: { ...IDLE_STORY_RUNTIME, flags: { ...state.story.flags } },
          story: { ...state.story, flags: { ...state.story.flags, ...runtime.flags } },
        });
        if (lastEnding === 'outskirt-north-transit') {
          startStoryScript('script-hidden-game');
          return;
        }
        set({ phase: 'playing' });
      };

      /* --------------------------- 战斗装配 ------------------------------- */
      let battleSeq = 0;
      let nostalgiaSeq = 0;
      let nostalgiaPullsTotal = 0;

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
        const enemyGrid = worldToGrid(enemy.originPos.x, enemy.originPos.y);

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
        let player = { ...state.player, hp: clampHp(report.playerHpFinal, report.playerMaxHp) };

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
          set({ battle: null, combat: null, player, storyRuntime: step.state });
          applyStoryEffects(step.effects);
          // 剧本续演（win/lose 分支都是对话或 ending 节点）——留在对话相渲染
          if (get().battle === null) set({ phase: 'dialogue' });
          return;
        }

        set({ battle: null, combat: null, player, phase: 'playing' });
      };

      /* --------------------------- 挑战层入场 ----------------------------- */
      const enterChallengeLayer = (layerId: string): void => {
        const state = get();
        const visitSeq = Object.keys(state.story.flags).filter((k) => k.startsWith(`layer:${layerId}:`)).length + 1;
        const runSeed = `challenge-${layerId}-${visitSeq}`;
        const levelId = `endless-${runSeed}-f1`;
        // 无尽回廊生成器（逆向拉箱构造性可解 + 内置求解器校验）按层种子生成
        const generated = generateEndlessFloor(runSeed, 1);
        if (!generated.ok) {
          bus.publish({ type: 'ui/toast', messageKey: `挑战层生成失败：${generated.error}` });
          return;
        }
        const level = { ...floorAsLevel(generated.floor), area: 'domain-3' as const, subtitle: `挑战层 · ${layerId}` };
        registerSessionLevel(level);
        beginLevel(levelId);
      };

      /* --------------------------- 关卡启动 ------------------------------- */
      const beginLevel = (levelId: string): void => {
        const state = get();
        const level = findLevelAny(levelId);
        if (level === undefined) return;
        const parsed = parseLevelGeometry(level);
        if (!parsed.ok) {
          bus.publish({ type: 'debug/mark', label: `level-parse-error:${parsed.error}` });
          return;
        }
        const rules = puzzleRulesOf();
        const puzzle = createPuzzleState(parsed.geometry, rules);
        set({
          phase: 'playing',
          activePanel: 'none',
          result: null,
          combat: null,
          battle: null,
          puzzle,
          segment: segmentOf(puzzle, levelId),
          storyRuntime: state.storyRuntime.phase === 'idle' ? state.storyRuntime : { ...IDLE_STORY_RUNTIME, flags: { ...state.storyRuntime.flags } },
        });
        // 进入任意关卡时统一收起外部面板（选关/档案分片经总线关闭）
        bus.publish({ type: 'ui/closePanels' });
        bus.publish({ type: 'bgm/play', bgmId: 'bgm-sanb' });
      };

      /* --------------------------- 剧情触发评估 --------------------------- */
      const evaluateTriggersAfterMove = (prevWorld: Vec2, currWorld: Vec2): void => {
        const state = get();
        if (state.segment?.levelId !== HUB_LEVEL_ID) return;
        const ctx = {
          x: currWorld.x,
          y: currWorld.y,
          flags: { ...state.story.flags, ...state.storyRuntime.flags },
          seenEventIds: state.story.seenEventIds,
        };
        // npc/tile 类规则：落地即查（小怪 radius 0 = 踩上即遭遇）
        const hit = queryTrigger(
          ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'npc' || r.when.kind === 'tile'),
          ctx,
        );
        if (hit !== null) {
          markTriggerSeen(hit);
          startStoryScript(hit.scriptId);
          return;
        }
        // 越界缓冲带：边沿触发（从 inside 跨入 buffer 的那一刻）
        const prevZone = classifyPosition(prevWorld.x, prevWorld.y);
        const currZone = classifyPosition(currWorld.x, currWorld.y);
        for (const dir of ['north', 'south', 'east', 'west'] as const) {
          if (isOutskirtsTransition(prevZone, currZone, dir, 'buffer')) {
            const rule = queryTrigger(
              ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'outskirts'),
              ctx,
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
        if (rule.once === false) return;
        const state = get();
        if (state.story.seenEventIds.includes(rule.id)) return;
        set({ story: { ...state.story, seenEventIds: [...state.story.seenEventIds, rule.id] } });
      };

      /* --------------------------- 推箱主流程 ----------------------------- */

      /** 法则动作被拒时的玩家提示（move 不弹 toast —— 撞墙是高频操作） */
      const PUZZLE_BLOCK_TOASTS: Partial<Record<PuzzleAction['type'] | string, string>> = {
        'law-locked': '对应法则未解锁：拉箱需「镜像拉箱」，斜推需「斜向推挤」，穿行需「相位穿行」（抽卡或关卡奖励获取）。',
        'no-chest': '那个方向上没有箱子。',
        'no-charge': '穿行充能不足：高星结算与「相位穿行」法则会补充充能。',
        'landed-occupied': '落点被不可压碎的实体占据。',
        'goal-locked': '就位的箱子推不落基座：需要「箱可推离」法则。',
        cliff: '高度差太大，爬不上去。',
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
          // 出界 + 主图枢纽 → 越界 beyond 事件的入场判定（玩家不位移，剧情开演）
          if (allowOutskirts && result.reason === 'out-of-bounds' && state.segment?.levelId === HUB_LEVEL_ID) {
            const step = DIR_VECTORS[fxDir];
            const beyond = { x: prevWorld.x + step.x, y: prevWorld.y + step.y };
            const zone = classifyPosition(beyond.x, beyond.y);
            if (zone.kind === 'beyond') {
              const rule = queryTrigger(
                ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'outskirts'),
                {
                  x: beyond.x,
                  y: beyond.y,
                  flags: { ...state.story.flags, ...state.storyRuntime.flags },
                  seenEventIds: state.story.seenEventIds,
                },
              );
              if (rule !== null && rule.when.kind === 'outskirts' && rule.when.zone === 'beyond' && rule.when.dir === zone.dir) {
                markTriggerSeen(rule);
                startStoryScript(rule.scriptId);
              }
            }
          }
          const toast = toastOnBlock ? PUZZLE_BLOCK_TOASTS[result.reason] : undefined;
          if (toast !== undefined) bus.publish({ type: 'ui/toast', messageKey: toast });
          return;
        }

        publishPuzzleFx(result.fx, fxDir);
        const solvedNow = result.fx.some((f) => f.type === 'solved');
        const nextSegment = segmentOf(result.state, state.segment?.levelId ?? '');
        set({ puzzle: result.state, segment: nextSegment, ruleSet: puzzleRulesOf() });

        const nextPuzzle = result.state;
        const nextPlayer = nextPuzzle.entities.find((e) => e.kind === 'player');
        if (nextPlayer !== undefined) {
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
                bus.publish({ type: 'ui/toast', messageKey: '战斗已开始，布阵阶段结束。' });
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
            bus.publish({ type: 'ui/toast', messageKey: '推挤只在布阵阶段可用：战斗期请选择武器攻击。' });
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
              bus.publish({ type: 'ui/toast', messageKey: '先用方向键走一步，C 键会沿刚才的方向穿行。' });
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
          const world = gridToWorld(player.x, player.y);
          const ctx = {
            x: world.x,
            y: world.y,
            flags: { ...state.story.flags, ...state.storyRuntime.flags },
            seenEventIds: state.story.seenEventIds,
          };
          const rule = findInteractableRule(ALL_TRIGGER_RULES, ctx);
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
            const toastByReason: Partial<Record<string, string>> = {
              'plane-locked': '位面未解锁：需要「法则·位面通行」（抽卡或剧情获取）。',
              'no-anchor': '这里离位面锚点太远了——「位面之眼」可以解除限制。',
              embedded: '有实体嵌在阴面的墙里，无法切换位面。',
            };
            bus.publish({ type: 'ui/toast', messageKey: toastByReason[result.reason] ?? '无法切换位面。' });
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
            bus.publish({ type: 'ui/toast', messageKey: `（背包里没有这把武器：${weaponId}）` });
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
          set({
            phase: 'gacha',
            pity,
            gacha: {
              ...state.gacha,
              starStones: state.gacha.starStones - cost,
              totalPulls: pity.totalPulls,
              pullsSinceFourStar: pity.pullsSinceFourStar,
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
          const startIndex = nostalgiaPullsTotal;
          nostalgiaSeq += 1;
          nostalgiaPullsTotal += pulls.length;
          const fourCount = stars.filter((s) => s === 'four').length;
          const threeCount = stars.filter((s) => s === 'three').length;
          // 统计分片动态引入（避免 gameStore ↔ statsCollector 的模块环，与 logbook 同策略）
          void import('../../archive/statsCollector')
            .then((m) => {
              m.useStatsStore.getState().recordPulls(m.POOL_NOSTALGIA, pulls, startIndex);
            })
            .catch(() => undefined);
          bus.publish({
            type: 'ui/toast',
            messageKey: `怀旧对照第 ${round + 1} 回：4★×${fourCount} 3★×${threeCount}（原版复刻，不产出可用卡；实测曲线已更新）。`,
          });
        },

        redeemLawCard(cardId) {
          const state = get();
          // 校验（余额/合法性/已持有）在引擎纯函数 redeemLawCard：60 碎片直购任一未持有法则卡
          const outcome = redeemLawCardEngine({
            counters: state.pity,
            cardId,
            ownedCardIds: new Set(state.gacha.owned.map((o) => o.cardId)),
            lawCards: CARDS,
            redeemCost: FORMAL_POOL.pity.redeemCost,
          });
          if (!outcome.ok) {
            bus.publish({ type: 'ui/toast', messageKey: outcome.error });
            bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-3' });
            return;
          }
          const card = CARDS.find((c) => c.id === outcome.cardId);
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
            messageKey: `碎片直购成功：「${card?.name ?? outcome.cardId}」已入卡组（-${FORMAL_POOL.pity.redeemCost} 碎片）。`,
          });
        },

        runMetaTerminal(raw) {
          const state = get();
          const outcome = runMetaTerminalCommand({
            raw,
            flags: { ...state.story.flags, ...state.storyRuntime.flags },
          });
          for (const eff of outcome.effects) {
            if (eff.kind === 'setFlag') {
              const cur = get();
              set({ story: { ...cur.story, flags: { ...cur.story.flags, [eff.key]: eff.value } } });
            } else if (eff.kind === 'showEnding') {
              const cur = get();
              set({ story: { ...cur.story, flags: { ...cur.story.flags, 'last-ending-id': eff.endingId } } });
              bus.publish({ type: 'ui/toast', messageKey: '真结局达成：拒绝剧本的人。' });
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
                  .catch(() => undefined);
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
            bus.publish({ type: 'ui/toast', messageKey: `「${card.name}」已编入卡组。` });
            return;
          }

          if (card.lawPatchId === undefined) return;
          const patchIds = state.gacha.activeLaws
            .map((cardId) => CARDS.find((c) => c.id === cardId)?.lawPatchId)
            .filter((id): id is string => id !== undefined);
          const rebuilt = buildPuzzleRuleSet(DEFAULT_RULE_SET, [...patchIds, card.lawPatchId]);
          if (!rebuilt.ok) {
            bus.publish({ type: 'ui/toast', messageKey: rebuilt.error });
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
          set({ activePanel: panel });
        },

        closeOverlay() {
          const state = get();
          // 终局/抽卡/设置 overlay 全部可关闭且不锁控制（根治 S11）
          // 无段位（标题页单抽）时回到标题，而不是落到没有世界的 playing 空白页
          const fallbackPhase = state.segment === null ? 'title' : 'playing';
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
          nostalgiaPullsTotal = 0;
          set({ ...initialState, visitCount: get().visitCount });
        },
      };
    },
    {
      name: 'lawbox-chronicle:v1',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // 段内实体/战斗/演出态是会话态，不落盘；档案只存进度与偏好
      partialize: (state) => ({
        locale: state.locale,
        settings: state.settings,
        player: state.player,
        ruleSet: state.ruleSet,
        gacha: state.gacha,
        pity: state.pity,
        story: state.story,
        storyRuntime: state.storyRuntime,
        visitCount: state.visitCount,
      }),
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
