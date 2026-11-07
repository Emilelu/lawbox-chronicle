/**
 * combat-engine · turn —— 回合制战斗纯函数引擎（可独立 vitest）。
 * ---------------------------------------------------------------------------
 * 形如 (state, action, rng) => newState，零副作用、零退出路径：
 *  - K9（KichikuAdventure Game.java:958-975 等：结算写在 finally 块里，玩家
 *    死亡走 System.exit(0) 后仍执行掉落/加背包）：本引擎的结算是一份纯函数
 *    返回的 BattleReport 对象（settleBattle）；任何路径都不抛出、不退出，
 *    玩家死亡只是 phase:'defeat'，HP 全程经 core/formula.clampHp 保持
 *    [0, maxHp]（applyHp 是唯一修改通道）。
 *  - K12（Game.java:1611-1612「你选择了爷爷的拐杖！」假武器选择）：武器必须
 *    在布阵阶段从 availableWeapons 真实选择（selectWeapon 校验 uid），引擎
 *    绝不代选、绝不静默装上特定武器。
 *  - K16（Game.java:1602-1606 彩蛋 233666438×3 秒杀 / :1828 分身无界翻倍）：
 *    BOSS 攻击参数化为阶段技能（baseAttack × attackMul，数据见
 *    src/data/enemies.ts），伤害恒 max(0, ·) 且可被护盾吸收；分身计数走
 *    shove.ts 的 nextCloneCount，恒 ≤ 64。
 *  - K2：逃跑在布阵战场是 computeFlee 的真实位移；无战场时以 phase:'fled'
 *    结束战斗——绝无 x++ 值传递空转。
 *  - 格挡 = 独立护盾事件（defend 动作获得护盾，敌方命中先扣盾再扣血），
 *    防御永不加血（K1 根治，见 effects.ts）。
 *
 * 行动队列：玩家行动入队（enqueueAction），stepBattle 逐个弹出结算；
 * 战斗期玩家行动结算后若战斗仍在继续，队尾自动补一个敌方行动。
 * 随机性只来自注入的 Rng（暴击 roll），同种子同序列，测试可断言。
 */

import { clampHp } from '../../core/formula';
import { validateBuff } from '../../core/lawRegistry';
import type { Rng } from '../../core/rng';
import type {
  CombatLogEntry,
  CombatPhase,
  CombatState,
  Dir,
  EnemyDef,
  Grid,
  GridEntity,
  RuleSet,
  Vec2,
} from '../../core/types';
import { SINGLE_PHASE, findEnemyProfile, type EnemyCombatProfile, type EnemyPhaseDef, type EnemyWeaknessDef } from '../../data/enemies';
import type { WeaponInstance } from '../../data/weapons';
import {
  absorbByShield,
  applyBuffs,
  applyHp,
  computeDamage,
  computeFlee,
  computeKnockback,
  consumeCharge,
  effectiveEnemyAttack,
  effectivePlayerAttack,
  emptyBuffedStats,
  grantBlockShield,
  type BuffRejection,
  type BuffedStats,
} from './effects';
import {
  MAX_CLONES,
  buildFormation,
  nextCloneCount,
  resolveShove,
  spawnClones,
  type HazardMap,
} from './shove';

/* ================================ 类型 ==================================== */

export type BattlePhase = 'formation' | 'battle' | 'victory' | 'defeat' | 'fled';

/** 玩家可执行行动（布阵期：shove/selectWeapon/startBattle；战斗期：其余） */
export type BattleAction =
  | { readonly type: 'attack' }
  | { readonly type: 'defend' }
  | { readonly type: 'item' }
  | { readonly type: 'flee' }
  | { readonly type: 'shove'; readonly dir: Dir }
  | { readonly type: 'selectWeapon'; readonly uid: string }
  | { readonly type: 'startBattle' };

/** 队列项 = 玩家行动 + 引擎内部插入的敌方行动 */
export type QueuedAction = BattleAction | { readonly type: 'enemyAct' };

export interface BattleLogEntry {
  readonly turn: number;
  readonly actor: 'player' | 'enemy' | 'system';
  readonly text: string;
  readonly damage: number;
  readonly crit: boolean;
  /** 本次命中被护盾吸收的量（格挡=独立护盾事件的可见证据） */
  readonly shielded: number;
}

export interface FormationState {
  readonly grid: Grid;
  readonly hazards: HazardMap;
  readonly entities: readonly GridEntity[];
  readonly hpById: Readonly<Record<string, { readonly hp: number; readonly maxHp: number }>>;
  readonly playerId: string;
}

export interface BattleRunningStats {
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly chargesSpent: number;
  readonly secondChanceUsed: boolean;
}

export interface BattleState {
  readonly enemyId: string;
  readonly enemyName: string;
  readonly enemyHp: number;
  readonly enemyMaxHp: number;
  /** 基础攻击（已并入剧情覆写；阶段技能在此之上做参数化乘法，K16） */
  readonly enemyBaseAttack: number;
  readonly enemyDefense: number;
  readonly enemyBoss: boolean;
  /** 剩余护盾（常规攻击先扣盾再扣血；弱点命中即击破） */
  readonly enemyShield: number;
  readonly enemyDropWeaponId: string | null;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly playerBaseAttack: number;
  readonly playerDefense: number;
  readonly weapon: WeaponInstance | null;
  /** 布阵阶段可真实选择的武器（K12） */
  readonly availableWeapons: readonly WeaponInstance[];
  readonly buffs: BuffedStats;
  readonly buffRejections: readonly BuffRejection[];
  readonly ruleSet: RuleSet;
  readonly turn: number;
  readonly phase: BattlePhase;
  /** 独立护盾（格挡事件），敌方回合结算后清零 */
  readonly shield: number;
  /** 分身计数，恒 ≤ MAX_CLONES(64)（K10） */
  readonly clones: number;
  /** 当前阶段技能下标（profilePhases 内） */
  readonly phaseIndex: number;
  readonly profilePhases: readonly EnemyPhaseDef[];
  readonly weakness: EnemyWeaknessDef | null;
  readonly queue: readonly QueuedAction[];
  readonly log: readonly BattleLogEntry[];
  readonly formation: FormationState | null;
  readonly stats: BattleRunningStats;
}

export interface BattleFormationConfig {
  readonly grid: Grid;
  readonly hazards?: HazardMap;
  readonly playerPos: Vec2;
  readonly enemyPos: Vec2;
  /** 额外战场实体（箱子等，用于箱落攻击联动） */
  readonly extraEntities?: readonly GridEntity[];
  readonly playerId?: string;
}

export interface BattleConfig {
  readonly enemy: EnemyDef;
  /** 战斗档案（弱点/阶段技能/分身配置；缺省用单阶段兜底） */
  readonly profile?: EnemyCombatProfile;
  readonly player: {
    readonly hp: number;
    readonly maxHp: number;
    readonly baseAttack: number;
    readonly defense: number;
  };
  readonly ruleSet: RuleSet;
  /** 角色卡 buff（逐条过 lawRegistry 校验，非法进 buffRejections） */
  readonly buffs?: readonly { readonly buffId: string; readonly value: number }[];
  /** 剧情覆写（作者问答：setEnemyAttack enemy-ylzz 0） */
  readonly enemyAttackOverride?: number;
  /** BOSS 护盾（bossActs BOSS_BATTLE_TUNING.shield 233）：常规攻击先被吸收；
   *  命中弱点（克星武器）时护盾击破、伤害 ×2。0/缺省 = 无护盾 */
  readonly enemyShield?: number;
  /** 布阵战场（缺省 = 纯公式战，无推挤/无逃跑位移） */
  readonly formation?: BattleFormationConfig;
  /** 布阵阶段可真实选择的武器（K12） */
  readonly availableWeapons?: readonly WeaponInstance[];
}

/* ================================ 常量 ==================================== */

/** 暴击概率（暴击 ×2，演出维度；rng 注入保证可测） */
export const CRIT_CHANCE = 0.1;
/** 布阵推挤的默认箱落冲击基数（× 箱质量；RuleSet/法则卡可在调用方覆写） */
export const DEFAULT_BOX_DROP_DAMAGE = 30;
/** 日志上限（有界状态，防长战爆内存） */
const LOG_LIMIT = 200;
/** 队列防御性步数上限（队列每回合最多 +1，正常远达不到） */
const QUEUE_GUARD = 256;

/* ================================ 开战 ==================================== */

export function startBattle(config: BattleConfig): BattleState {
  const { enemy, player, ruleSet } = config;
  // 档案自动装配：未显式传入时按 enemyId 读取 ENEMY_COMBAT_PROFILES（数据驱动）
  const profile: EnemyCombatProfile =
    config.profile ?? findEnemyProfile(enemy.id) ?? { enemyId: enemy.id, phases: SINGLE_PHASE };

  // 角色卡 buff：逐条过 lawRegistry 校验（坏档拒收，不污染数值）
  const buffResult = applyBuffs(emptyBuffedStats(), config.buffs ?? []);
  const playerMaxHp = Math.max(1, Math.round(player.maxHp + buffResult.stats.maxHpBonus));
  const playerHp = clampHp(player.hp, playerMaxHp);
  const enemyBaseAttack =
    config.enemyAttackOverride !== undefined
      ? Math.max(0, Math.round(config.enemyAttackOverride))
      : Math.max(0, enemy.attack);

  // 布阵战场：敌人方块化 + BOSS 免疫标记 + 开场分身（K10 有界）
  let formation: FormationState | null = null;
  let clones = Math.max(0, Math.round(profile.initialClones ?? 0));
  const formationCfg = config.formation;
  if (formationCfg !== undefined) {
    const playerId = formationCfg.playerId ?? 'player-1';
    const built = buildFormation(
      [{ enemyId: enemy.id, x: formationCfg.enemyPos.x, y: formationCfg.enemyPos.y, maxHp: enemy.maxHp, boss: enemy.boss }],
      formationCfg.playerPos,
      playerHp,
      playerMaxHp,
      playerId,
    );
    let entities: readonly GridEntity[] = [...built.entities, ...(formationCfg.extraEntities ?? [])];
    let hpById = built.hpById;
    if (clones > 0) {
      const spawned = spawnClones(
        formationCfg.grid,
        entities,
        hpById,
        enemy.id,
        clones,
        `battle-${enemy.id}`,
        formationCfg.hazards ?? {},
      );
      entities = spawned.entities;
      hpById = spawned.hpById;
    }
    formation = {
      grid: formationCfg.grid,
      hazards: formationCfg.hazards ?? {},
      entities,
      hpById,
      playerId,
    };
  }

  const state: BattleState = {
    enemyId: enemy.id,
    enemyName: enemy.name,
    enemyHp: enemy.maxHp,
    enemyMaxHp: enemy.maxHp,
    enemyBaseAttack,
    enemyDefense: enemy.defense,
    enemyBoss: enemy.boss,
    enemyShield: Math.max(0, Math.round(config.enemyShield ?? 0)),
    enemyDropWeaponId: enemy.dropWeaponId ?? null,
    playerHp,
    playerMaxHp,
    playerBaseAttack: player.baseAttack,
    playerDefense: player.defense,
    weapon: null,
    availableWeapons: config.availableWeapons ?? [],
    buffs: buffResult.stats,
    buffRejections: buffResult.rejected,
    ruleSet,
    turn: 0,
    phase: 'formation',
    shield: 0,
    clones: Math.min(clones, MAX_CLONES),
    phaseIndex: 0,
    profilePhases: profile.phases,
    weakness: profile.weakness ?? null,
    queue: [],
    log: [
      {
        turn: 0,
        actor: 'system',
        text: `你遇到了一个怪物！它叫 ${enemy.name}（HP ${enemy.maxHp}）`,
        damage: 0,
        crit: false,
        shielded: 0,
      },
    ],
    formation,
    stats: { damageDealt: 0, damageTaken: 0, chargesSpent: 0, secondChanceUsed: false },
  };
  return state;
}

/* ============================== 行动队列 ================================== */

const FORMATION_ACTIONS: readonly QueuedAction['type'][] = ['shove', 'selectWeapon', 'startBattle'];

/** 行动入队：非法（阶段不符/无战场推挤）→ 记一条 system 日志并丢弃 */
export function enqueueAction(state: BattleState, action: BattleAction): BattleState {
  const isFormationAction = FORMATION_ACTIONS.includes(action.type);
  const phaseOk = isFormationAction ? state.phase === 'formation' : state.phase === 'battle';
  const structureOk = action.type !== 'shove' || state.formation !== null;
  if (!phaseOk || !structureOk) {
    return withLog(state, {
      turn: state.turn,
      actor: 'system',
      text: `（无效行动：${describeAction(action)} 在当前阶段不可用）`,
      damage: 0,
      crit: false,
      shielded: 0,
    });
  }
  return { ...state, queue: [...state.queue, action] };
}

function describeAction(action: QueuedAction): string {
  if (action.type === 'shove') return `推挤(${action.dir})`;
  if (action.type === 'selectWeapon') return `选择武器 ${action.uid}`;
  if (action.type === 'enemyAct') return '敌方行动';
  return action.type;
}

/** 弹出并结算队首行动；战斗期玩家行动后若战斗仍在继续，队尾自动补敌方行动 */
export function stepBattle(state: BattleState, rng: Rng): BattleState {
  const [head, ...rest] = state.queue;
  if (head === undefined) return state;

  const isPlayerBattleAction =
    head.type === 'attack' || head.type === 'defend' || head.type === 'item' || head.type === 'flee';
  let next = resolveAction({ ...state, queue: rest }, head, rng);
  if (isPlayerBattleAction && next.phase === 'battle') {
    next = { ...next, queue: [...next.queue, { type: 'enemyAct' } as const] };
  }
  return next;
}

/** 一整个回合：入队 → 清空队列（终结态自动停） */
export function resolveTurn(state: BattleState, action: BattleAction, rng: Rng): BattleState {
  let current = enqueueAction(state, action);
  let guard = 0;
  while (current.queue.length > 0 && !isBattleOver(current.phase) && guard < QUEUE_GUARD) {
    current = stepBattle(current, rng);
    guard += 1;
  }
  return current;
}

export function isBattleOver(phase: BattlePhase): boolean {
  return phase === 'victory' || phase === 'defeat' || phase === 'fled';
}

/* ============================== 行动结算 ================================== */

function resolveAction(state: BattleState, action: QueuedAction, rng: Rng): BattleState {
  switch (action.type) {
    case 'selectWeapon':
      return resolveSelectWeapon(state, action.uid);
    case 'startBattle':
      return withLog(
        { ...state, phase: 'battle', turn: Math.max(1, state.turn) },
        systemEntry(state, '战斗开始！'),
      );
    case 'shove':
      return resolveShoveAction(state, action.dir);
    case 'attack':
      return resolveAttack(state, rng);
    case 'defend':
      return resolveDefend(state);
    case 'item':
      return resolveItem(state);
    case 'flee':
      return resolveFlee(state);
    case 'enemyAct':
      return resolveEnemyAct(state);
  }
}

function resolveSelectWeapon(state: BattleState, uid: string): BattleState {
  // K12：只允许选择 availableWeapons 里真实存在的实例，绝不代选
  const weapon = state.availableWeapons.find((w) => w.uid === uid);
  if (weapon === undefined) {
    return withLog(state, systemEntry(state, `（没有这把武器：${uid}）`));
  }
  return withLog(
    { ...state, weapon },
    {
      turn: state.turn,
      actor: 'player',
      text: `你选择了 ${weapon.name}！`,
      damage: 0,
      crit: false,
      shielded: 0,
    },
  );
}

function resolveShoveAction(state: BattleState, dir: Dir): BattleState {
  const formation = state.formation;
  if (formation === null) return state; // enqueueAction 已拦截，此处兜底

  const outcome = resolveShove({
    grid: formation.grid,
    hazards: formation.hazards,
    entities: formation.entities,
    originId: formation.playerId,
    dir,
    hpById: formation.hpById,
    overlays: {
      maxChain: Math.max(1, Math.round(state.ruleSet.pushRange)),
      fallOffEdge: state.ruleSet.fallFatal,
      boxDropDamage: DEFAULT_BOX_DROP_DAMAGE,
    },
  });

  if (outcome.kind === 'blocked') {
    const reasonText: Record<string, string> = {
      wall: '撞到了墙。',
      'out-of-bounds': '前面是战场边界。',
      immovable: '它纹丝不动！（BOSS 免疫推挤，必须走公式战）',
      'chain-limit': '推不动这么长的一串！',
      'no-origin': '战场上没有你。',
      'too-heavy': '太重了，推不动！（重量 ∝ HP）',
      hazard: '你不能把自己推进深渊。',
    };
    return withLog(state, systemEntry(state, reasonText[outcome.reason ?? 'wall'] ?? '推不动。'));
  }

  // 应用伤害记录（玩家/敌人/分身；HP 已在 shove 层 clamp）
  let playerHp = state.playerHp;
  let log = state.log;
  const pushLog = (entry: BattleLogEntry) => {
    log = [...log, entry].slice(-LOG_LIMIT);
  };
  for (const damage of outcome.damages) {
    const label =
      damage.source === 'abyss' ? '坠入深渊' : damage.source === 'fall' ? '坠出战场' : damage.source === 'spike' ? '踩上尖刺' : '被坠落的箱子砸中';
    if (damage.entityId === formation.playerId) {
      playerHp = damage.hpAfter;
      pushLog({
        turn: state.turn,
        actor: 'system',
        text: `你${label}，受到 ${damage.hpBefore - damage.hpAfter} 点伤害！`,
        damage: damage.hpBefore - damage.hpAfter,
        crit: false,
        shielded: 0,
      });
    } else {
      pushLog({
        turn: state.turn,
        actor: 'system',
        text: `${damage.entityId} ${label}，受到 ${damage.hpBefore - damage.hpAfter} 点伤害${damage.defeated ? '，败退了！' : '！'}`,
        damage: damage.hpBefore - damage.hpAfter,
        crit: false,
        shielded: 0,
      });
    }
  }
  for (const impact of outcome.boxDrop) {
    pushLog({
      turn: state.turn,
      actor: 'system',
      text: `箱子在 (${impact.at.x},${impact.at.y}) 碎裂，冲击波波及 ${impact.hits.length} 个敌人！`,
      damage: impact.damage,
      crit: false,
      shielded: 0,
    });
  }

  // 敌人 HP 归零（被推下深渊/尖刺耗死）→ 直接胜利
  const enemyHpNow = outcome.hpById[state.enemyId]?.hp ?? state.enemyHp;
  let phase: BattlePhase = state.phase === 'formation' ? 'formation' : state.phase;
  if (enemyHpNow <= 0) phase = 'victory';
  else if (playerHp <= 0) phase = 'defeat';

  // 清理 HP 归零的敌方实体（败退者移出战场）
  const entities = outcome.entities.filter((e) => {
    if (e.kind !== 'enemy') return true;
    const hp = outcome.hpById[e.id]?.hp;
    return hp === undefined || hp > 0;
  });

  const kindText =
    outcome.kind === 'move'
      ? '你调整了站位。'
      : outcome.kind === 'push'
        ? '你推动了一个目标！'
        : outcome.kind === 'chain'
          ? '连锁推挤！'
          : '目标坠出了战场！';
  return withLog(
    {
      ...state,
      playerHp: clampHp(playerHp, state.playerMaxHp),
      enemyHp: enemyHpNow,
      phase,
      formation: { ...formation, entities, hpById: outcome.hpById },
      log,
    },
    systemEntry(state, kindText),
  );
}

function resolveAttack(state: BattleState, rng: Rng): BattleState {
  // 回合开始：再生 buff（唯一合法的 HP 增量，clamp 到上限）
  let playerHp = applyHp(state.playerHp, state.playerMaxHp, state.buffs.regen);
  let nextState: BattleState = { ...state, playerHp };

  const breakdown = effectivePlayerAttack(state.playerBaseAttack, state.weapon, state.buffs, state.ruleSet);
  const raw = computeDamage(breakdown.total, state.enemyDefense);

  // 弱点（数据驱动）：克星武器命中 → 倍率放大
  const weakness =
    state.weapon !== null && state.weakness !== null && state.weapon.defId === state.weakness.weaponId
      ? state.weakness
      : null;
  let damage = weakness !== null ? Math.round(raw * weakness.damageMul) : raw;

  // 暴击（只在实际造成伤害时 roll，rng 序列可测）
  let crit = false;
  if (damage > 0) {
    crit = rng.chance(CRIT_CHANCE);
    if (crit) damage *= 2;
  }
  damage = Math.max(0, damage); // K16：永无负伤害

  // BOSS 护盾（bossActs 调参接线）：常规攻击先扣盾再扣血；
  // 弱点命中 = 护盾击破（本次全额伤害直入 HP，且盾清零）
  let enemyShield = state.enemyShield;
  let absorbed = 0;
  if (enemyShield > 0 && weakness === null) {
    absorbed = Math.min(damage, enemyShield);
    enemyShield -= absorbed;
  } else if (enemyShield > 0 && weakness !== null) {
    enemyShield = 0; // 弱点击破护盾
  }

  const hpDamage = damage - absorbed;
  const enemyHp = applyHp(state.enemyHp, state.enemyMaxHp, -hpDamage);
  nextState = {
    ...withEnemyHp(nextState, enemyHp),
    enemyShield,
    stats: { ...nextState.stats, damageDealt: nextState.stats.damageDealt + hpDamage },
  };
  nextState = withLog(
    nextState,
    {
      turn: nextState.turn,
      actor: 'player',
      text: `你使用 ${state.weapon?.name ?? '徒手'}，对 ${state.enemyName} 造成了 ${damage} 点伤害${crit ? '！暴击！' : ''}${weakness !== null ? '（击中弱点！）' : ''}${
        weakness !== null && state.enemyShield > 0 ? '，分身护盾被击碎！' : ''
      }${absorbed > 0 ? `（分身护盾吸收了 ${absorbed} 点）` : ''}`,
      damage: hpDamage,
      crit,
      shielded: 0,
    },
  );

  // 迷吼tiao：每次攻击消耗 1 格爆炸耐久（KT2，实例自带 remainingCharges）
  if (state.weapon !== null && state.weapon.maxCharges !== null) {
    const charge = consumeCharge(state.weapon);
    nextState = {
      ...nextState,
      weapon: charge.weapon,
      stats: { ...nextState.stats, chargesSpent: nextState.stats.chargesSpent + (charge.exploded ? 1 : 0) },
    };
    nextState = withLog(
      nextState,
      systemEntry(nextState, `迷吼tiao 爆炸了！剩余耐久：${charge.remaining ?? 0}${charge.spent ? '（已耗尽）' : ''}`),
    );
  }

  // 拐杖击退（KT3）：命中且敌人未倒下时真实位移
  if (
    state.weapon !== null &&
    state.weapon.knockbackSteps > 0 &&
    enemyHp > 0 &&
    nextState.formation !== null
  ) {
    nextState = applyKnockback(nextState, state.weapon.knockbackSteps);
  }

  if (enemyHp <= 0) {
    return withLog({ ...nextState, phase: 'victory' }, victoryEntry(nextState));
  }
  return nextState;
}

/** 拐杖击退：方向取玩家→敌人的主轴；坠出战场按深渊比例结算伤害 */
function applyKnockback(state: BattleState, steps: number): BattleState {
  const formation = state.formation;
  if (formation === null) return state;
  const player = formation.entities.find((e) => e.id === formation.playerId);
  const enemy = formation.entities.find((e) => e.id === state.enemyId);
  if (player === undefined || enemy === undefined) return state;

  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  const dir: Dir =
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';

  const result = computeKnockback(formation.grid, formation.entities, state.enemyId, dir, steps);
  let enemyHp = state.enemyHp;
  let knockText = `击退了 ${state.enemyName} ${result.steps} 格！`;
  if (result.fell) {
    const ratioDamage = Math.max(1, Math.round(state.enemyMaxHp * 0.5));
    enemyHp = applyHp(enemyHp, state.enemyMaxHp, -ratioDamage);
    knockText = `击退了 ${state.enemyName}，它坠出了战场，受到 ${ratioDamage} 点坠落伤害！`;
  }
  const hpSynced = withEnemyHp({ ...state, formation: { ...formation, entities: result.entities } }, enemyHp);
  return withLog(
    hpSynced,
    {
      turn: state.turn,
      actor: 'player',
      text: `爷爷的拐杖${knockText}`,
      damage: state.enemyHp - enemyHp,
      crit: false,
      shielded: 0,
    },
  );
}

function resolveDefend(state: BattleState): BattleState {
  // K1：格挡 = 独立护盾事件（而非 hp - atk + def 的公式项）
  const shield = grantBlockShield(state.playerDefense, state.buffs.defenseBonus);
  return withLog(
    { ...state, shield },
    {
      turn: state.turn,
      actor: 'player',
      text: `你摆出防御姿态，获得 ${shield} 点护盾（下一次受击先扣盾）。`,
      damage: 0,
      crit: false,
      shielded: 0,
    },
  );
}

function resolveItem(state: BattleState): BattleState {
  const weapon = state.weapon;
  if (weapon === null || weapon.maxCharges === null || weapon.remainingCharges === null || weapon.remainingCharges <= 0) {
    return withLog(state, systemEntry(state, '（没有可引爆的道具，白白浪费了一个回合……）'));
  }
  // 迷吼tiao 掷爆：直伤（爆炸不吃防御），消耗 1 格耐久
  const charge = consumeCharge(weapon);
  const damage = Math.max(0, Math.round(weapon.attack));
  const enemyHp = applyHp(state.enemyHp, state.enemyMaxHp, -damage);
  const spentState: BattleState = {
    ...withEnemyHp(state, enemyHp),
    weapon: charge.weapon,
    stats: {
      ...state.stats,
      damageDealt: state.stats.damageDealt + damage,
      chargesSpent: state.stats.chargesSpent + 1,
    },
  };
  const victory = enemyHp <= 0;
  const logged: BattleState = withLog(
    victory ? { ...spentState, phase: 'victory' } : spentState,
    {
      turn: state.turn,
      actor: 'player',
      text: `你掷出 ${weapon.name}！爆炸对 ${state.enemyName} 造成了 ${damage} 点伤害！剩余耐久：${charge.remaining ?? 0}${charge.spent ? '（已耗尽）' : ''}`,
      damage,
      crit: false,
      shielded: 0,
    },
  );
  return victory ? withLog(logged, victoryEntry(logged)) : logged;
}

function resolveFlee(state: BattleState): BattleState {
  const formation = state.formation;
  if (formation === null) {
    // 无战场：战斗直接以 'fled' 结束（状态化的逃跑，而非 x++ 空转）
    return withLog({ ...state, phase: 'fled' }, systemEntry(state, '你逃跑了。'));
  }
  const result = computeFlee(formation.grid, formation.entities, formation.playerId);
  if (!result.ok) {
    return withLog(
      state,
      systemEntry(state, '找不到安全格，逃跑失败！敌人趁势逼近……'),
    );
  }
  return withLog(
    {
      ...state,
      phase: 'fled',
      formation: { ...formation, entities: result.entities },
    },
    systemEntry(
      state,
      result.moved
        ? `你逃到了安全格 (${result.to?.x},${result.to?.y})。`
        : '你本就站在安全格上，全身而退。',
    ),
  );
}

function resolveEnemyAct(state: BattleState): BattleState {
  if (state.phase !== 'battle') return state;

  // ---- 阶段切换（参数化技能表，K16） ----
  const hpRatio = state.enemyMaxHp > 0 ? state.enemyHp / state.enemyMaxHp : 0;
  let phaseIndex = state.phaseIndex;
  for (let i = state.profilePhases.length - 1; i > phaseIndex; i--) {
    if (hpRatio <= (state.profilePhases[i]?.threshold ?? 1)) {
      phaseIndex = i;
      break;
    }
  }
  let nextState = state;
  if (phaseIndex !== state.phaseIndex) {
    const phase = state.profilePhases[phaseIndex];
    nextState = withLog(
      nextState,
      systemEntry(state, phase?.announce ?? `进入阶段「${phase?.name ?? '?'}」`),
    );
    if (phase?.cloneDouble === true) {
      // K10：翻倍恒有界 ≤ 64；战场有实体时真实生成（分身 HP 1、质量 1、可推）
      const nextClones = nextCloneCount(nextState.clones);
      const formation = nextState.formation;
      if (formation !== null && nextClones > nextState.clones) {
        const spawned = spawnClones(
          formation.grid,
          formation.entities,
          formation.hpById,
          nextState.enemyId,
          nextClones - nextState.clones,
          `battle-${nextState.enemyId}`,
          formation.hazards,
        );
        nextState = {
          ...nextState,
          clones: nextClones,
          formation: { ...formation, entities: spawned.entities, hpById: spawned.hpById },
        };
      } else {
        nextState = { ...nextState, clones: nextClones };
      }
      nextState = withLog(nextState, systemEntry(nextState, `${nextState.enemyName} 当前分身：${nextState.clones}`));
    }
    nextState = { ...nextState, phaseIndex };
  }

  // ---- 每段命中：伤害 → 护盾吸收 → HP（全程 clamp，K1/K9） ----
  const phase = nextState.profilePhases[nextState.phaseIndex] ?? SINGLE_PHASE[0]!;
  const baseAttack = effectiveEnemyAttack(nextState.enemyBaseAttack, nextState.ruleSet);
  const perHit = computeDamage(Math.round(baseAttack * phase.attackMul), nextState.playerDefense);

  let shield = nextState.shield;
  let playerHp = nextState.playerHp;
  let damageTaken = nextState.stats.damageTaken;
  let log: readonly BattleLogEntry[] = nextState.log;
  for (let hit = 0; hit < Math.max(1, phase.hits); hit++) {
    const absorbedResult = absorbByShield(shield, perHit);
    shield = absorbedResult.shieldAfter;
    const nextHp = applyHp(playerHp, nextState.playerMaxHp, -absorbedResult.hpDamage);
    damageTaken += absorbedResult.hpDamage;
    const entry: BattleLogEntry = {
      turn: nextState.turn,
      actor: 'enemy',
      text: `${nextState.enemyName} 使用 ${nextState.clones} 个分身对 你 造成了 ${perHit} 点伤害${absorbedResult.absorbed > 0 ? `！但你格挡了 ${absorbedResult.absorbed} 点！` : '！'}`,
      damage: absorbedResult.hpDamage,
      crit: false,
      shielded: absorbedResult.absorbed,
    };
    log = [...log, entry].slice(-LOG_LIMIT);
    playerHp = nextHp;
    if (playerHp <= 0) break;
  }

  nextState = { ...nextState, shield: 0, playerHp, stats: { ...nextState.stats, damageTaken }, log };

  // ---- 玩家倒下：再临法则或败北（无 System.exit，报告由 settleBattle 产出） ----
  if (nextState.playerHp <= 0) {
    if (nextState.ruleSet.secondChance && !nextState.stats.secondChanceUsed) {
      nextState = withLog(
        { ...nextState, playerHp: 1, stats: { ...nextState.stats, secondChanceUsed: true } },
        systemEntry(nextState, '再临法则发动：HP 回到 1！'),
      );
    } else {
      nextState = withLog({ ...nextState, phase: 'defeat' }, {
        turn: nextState.turn,
        actor: 'system',
        text: '你死了！GAME OVER！（战斗报告已生成，世界仍在运行）',
        damage: 0,
        crit: false,
        shielded: 0,
      });
      return nextState;
    }
  }

  return { ...nextState, turn: nextState.turn + 1 };
}

/* ============================== 结算报告（K9） ============================= */

export interface BattleReport {
  readonly outcome: 'victory' | 'defeat' | 'fled' | 'ongoing';
  readonly enemyId: string;
  readonly enemyName: string;
  readonly turns: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  /** 终值再 clamp 一遍：报告里的 HP 永远在 [0, maxHp] */
  readonly playerHpFinal: number;
  readonly playerMaxHp: number;
  readonly enemyHpFinal: number;
  readonly weaponUid: string | null;
  readonly chargesSpent: number;
  readonly clonesFinal: number;
  readonly secondChanceUsed: boolean;
  /** 胜利且敌人配置了掉落 → 掉落武器 id（发放入背包由 store 落实） */
  readonly dropWeaponId: string | null;
}

/**
 * 结算报告对象——替代 KichikuAdventure 的 finally 块结算与 System.exit 路径。
 * 纯读取：不改状态，可在任意阶段调用（进行中 → 'ongoing'）。
 */
export function settleBattle(state: BattleState): BattleReport {
  const outcome: BattleReport['outcome'] =
    state.phase === 'victory' ? 'victory' : state.phase === 'defeat' ? 'defeat' : state.phase === 'fled' ? 'fled' : 'ongoing';
  return {
    outcome,
    enemyId: state.enemyId,
    enemyName: state.enemyName,
    turns: state.turn,
    damageDealt: state.stats.damageDealt,
    damageTaken: state.stats.damageTaken,
    playerHpFinal: clampHp(state.playerHp, state.playerMaxHp),
    playerMaxHp: state.playerMaxHp,
    enemyHpFinal: clampHp(state.enemyHp, state.enemyMaxHp),
    weaponUid: state.weapon?.uid ?? null,
    chargesSpent: state.stats.chargesSpent,
    clonesFinal: Math.min(state.clones, MAX_CLONES),
    secondChanceUsed: state.stats.secondChanceUsed,
    dropWeaponId: outcome === 'victory' ? state.enemyDropWeaponId : null,
  };
}

/* ============================ core 契约投影 ================================ */

/**
 * 投影到 core/types.CombatState（store 的 combat 字段形状）。
 * 'fled' 在 core 契约里不存在，投影为 'formation'（战斗已结束，store 应清空
 * combat 字段返回大地图）；system 日志不进 core 投影（core actor 只有双方）。
 */
export function toCoreCombatState(state: BattleState): CombatState {
  const phaseMap: Record<BattlePhase, CombatPhase> = {
    formation: 'formation',
    battle: 'battle',
    victory: 'victory',
    defeat: 'defeat',
    fled: 'formation',
  };
  const log: CombatLogEntry[] = state.log
    .filter((entry) => entry.actor !== 'system')
    .map((entry) => ({
      turn: entry.turn,
      actor: entry.actor === 'enemy' ? 'enemy' : 'player',
      text: entry.text,
      damage: entry.damage,
      crit: entry.crit,
    }));
  return {
    enemyId: state.enemyId,
    enemyHp: state.enemyHp,
    enemyMaxHp: state.enemyMaxHp,
    phase: phaseMap[state.phase],
    turn: state.turn,
    equippedWeaponId: state.weapon?.defId ?? null,
    log,
  };
}

/* ================================ 工具 ==================================== */

/**
 * 主敌人 HP 单点更新：state.enemyHp 与 formation.hpById 同步写，
 * 杜绝同一敌人在两处真相漂移（单一真相源纪律）。
 */
function withEnemyHp(state: BattleState, hp: number): BattleState {
  const clamped = clampHp(hp, state.enemyMaxHp);
  const formation = state.formation;
  if (formation === null) return { ...state, enemyHp: clamped };
  const entry = formation.hpById[state.enemyId];
  return {
    ...state,
    enemyHp: clamped,
    formation:
      entry === undefined
        ? formation
        : { ...formation, hpById: { ...formation.hpById, [state.enemyId]: { ...entry, hp: clamped } } },
  };
}

function withLog(state: BattleState, entry: BattleLogEntry): BattleState {
  return { ...state, log: [...state.log, entry].slice(-LOG_LIMIT) };
}

function systemEntry(state: BattleState, text: string): BattleLogEntry {
  return { turn: state.turn, actor: 'system', text, damage: 0, crit: false, shielded: 0 };
}

function victoryEntry(state: BattleState): BattleLogEntry {
  return {
    turn: state.turn,
    actor: 'system',
    text: `${state.enemyName} 被打败了！（结算报告对象已就绪——没有 finally，没有退出）`,
    damage: 0,
    crit: false,
    shielded: 0,
  };
}

/** buff 数值合法性快查（store/UI 预检用，引擎内以 applyBuffs 为准） */
export function isBuffLegal(buffId: string, value: number): boolean {
  return validateBuff({ buffId, value }).ok;
}

/** 当前阶段技能（UI 展示敌方意图） */
export function currentPhaseOf(state: BattleState): EnemyPhaseDef {
  return state.profilePhases[state.phaseIndex] ?? SINGLE_PHASE[0]!;
}
