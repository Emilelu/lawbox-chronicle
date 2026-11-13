/**
 * CheatRegistry —— 作弊系统唯一执行门。
 * ---------------------------------------------------------------------------
 * 键盘热键 / 面板点击 / META 终端三个入口全部汇到这里，先过 enabled() 谓词
 * 再执行效果（根治 S9「热键绕过解锁」）。解锁条件是 commands.ts 里的纯数据
 * 声明，本文件负责解释：
 *   - S10 根治：选关解锁 = 显式谓词「到达第 2 关」，读 store 旗标
 *     reached:<levelId>（无旗标时按 LEVELS 顺序与当前段位现算），永不读取
 *     「热键偷偷改过的本地变量」这种第二真相源。
 *   - S18 根治：墙皮重掷是按需一次性的 epoch 自增，绝无 setInterval。
 *   - KT1：GodMode 类的无敌/回血以作弊条目形式存在，走同一条门。
 *
 * 进度旗标：本模块订阅全局 store，把「到达/通关了哪关」写成
 * story.flags['reached:<id>'] / 'cleared:<id>'（幂等），与存档一起持久化 ——
 * 关卡完成管线（view/story 模块）后续可直接写同一旗标，两边幂等不冲突。
 */

import { useSyncExternalStore } from 'react';
import { useGameStore } from '../core/store/gameStore';
import { bus } from '../core/events/bus';
import { createRng } from '../core/rng';
import type { GameState } from '../core/types';
import { ENEMIES, LEVELS, WEAPONS, findEnemy, findLevel, findWeapon } from '../data';
import {
  BARE_HANDS_ID,
  CHEAT_COMMANDS,
  CHEAT_GRANT_STAR_STONES,
  EGG_MESSAGE,
  EGG_TAP_THRESHOLD,
  KILL_TARGET_SETNAME,
  TERMINAL_GIVE_ALIASES,
  TERMINAL_KILL_ALIASES,
  eggProgressMessage,
  type CheatCommandDef,
  type CheatEntrypoint,
  type CheatUnlockCondition,
} from '../data/cheats/commands';

/* ============================ 解锁谓词（S9/S10） =========================== */

/**
 * 「到达某关」= 旗标 reached:<id> 为真，或当前段位已排到该关或之后，或上一关
 * 已通关，或本关已通关（F3：通关即到达 —— 旧存档可能只有 cleared:<id> 而没有
 * reached:<id>（如自动演示直通关底），reached 不并入 cleared 会让选关面板
 * 同时亮「✓ cleared」与「未到达」chip 且无进入按钮，自相矛盾）。
 */
export function hasReachedLevel(state: GameState, levelId: string): boolean {
  if (state.story.flags[`reached:${levelId}`] === true) return true;
  if (state.story.flags[`cleared:${levelId}`] === true) return true; // F3：通关即到达，可重入
  const targetIndex = LEVELS.findIndex((l) => l.id === levelId);
  if (targetIndex < 0) return false;
  const segment = state.segment;
  if (segment !== null) {
    const currentIndex = LEVELS.findIndex((l) => l.id === segment.levelId);
    if (currentIndex >= targetIndex) return true;
  }
  // 旧存档回填：上一关已通关但 reached:<本关> 未写入时，视为已到达
  const prev = targetIndex > 0 ? LEVELS[targetIndex - 1] : undefined;
  return prev !== undefined && state.story.flags[`cleared:${prev.id}`] === true;
}

/** 「通关某关」= 旗标 cleared:<id> 为真，或结算面板正停在该关 */
export function hasClearedLevel(state: GameState, levelId: string): boolean {
  if (state.story.flags[`cleared:${levelId}`] === true) return true;
  return state.result?.levelId === levelId;
}

/** 通关全部主线关卡（关卡数取数据表长度，无硬编码上限 —— S7 精神） */
export function isGameCleared(state: GameState): boolean {
  return LEVELS.length > 0 && LEVELS.every((l) => hasClearedLevel(state, l.id));
}

/** 求第一个不满足的解锁条件；全部满足返回 null */
export function firstUnlockDenial(state: GameState, requires: readonly CheatUnlockCondition[]): string | null {
  for (const cond of requires) {
    switch (cond.kind) {
      case 'always':
        break;
      case 'cheats-enabled':
        if (!state.settings.cheatsEnabled) return '需要先开启作弊开关（设置 → 作弊面板）';
        break;
      case 'reached-level': {
        if (hasReachedLevel(state, cond.levelId)) break;
        const level = findLevel(cond.levelId);
        return `需要先到达「${level?.name ?? cond.levelId}」才能解锁`;
      }
      case 'game-cleared':
        if (!isGameCleared(state)) return 'META 终端在通关全部主线关卡后解锁';
        break;
    }
  }
  return null;
}

/* ========================== 进度旗标自动记录 =============================== */

/** 幂等写旗标；不覆盖已有值（旗标只进不退，类似成就） */
function setProgressFlag(key: string, value: boolean): void {
  const { story } = useGameStore.getState();
  if (story.flags[key] === value) return;
  useGameStore.setState({ story: { ...story, flags: { ...story.flags, [key]: value } } });
}

let observedLevelId: string | null = null;

useGameStore.subscribe((state) => {
  const levelId = state.segment?.levelId ?? null;
  if (levelId !== observedLevelId) {
    observedLevelId = levelId;
    if (levelId !== null) setProgressFlag(`reached:${levelId}`, true);
  }
  const resultLevelId = state.result?.levelId;
  if (resultLevelId !== undefined) {
    setProgressFlag(`cleared:${resultLevelId}`, true);
    // 通关即解锁下一关（修复主线软锁：新存档通关后 reached:<next> 永不置位，
    // 选关面板与 cheat-level-next 都会把玩家锁死在本关）
    const clearedIndex = LEVELS.findIndex((l) => l.id === resultLevelId);
    const nextLevel = clearedIndex >= 0 ? LEVELS[clearedIndex + 1] : undefined;
    if (nextLevel !== undefined) setProgressFlag(`reached:${nextLevel.id}`, true);
  }
});

/* ========================= 皮肤 / 墙皮 / 彩蛋状态 =========================== */

/**
 * 冒险者皮肤资产（原作 roleImgs 5 套）。
 * 经 Vite import.meta.glob 解析为可渲染 URL，视图层消费 useCheatVisualState()。
 */
const SKIN_URLS: readonly string[] = Object.values(
  import.meta.glob<string>('../assets/imgs/roles/*.{png,jpeg}', { eager: true, query: '?url', import: 'default' }),
).sort();

export const CHEAT_SKIN_COUNT = SKIN_URLS.length;

export interface CheatVisualState {
  /** 当前皮肤下标（mod 皮肤数），视图渲染角色时按此取 SKIN_URLS */
  readonly skinIndex: number;
  /** 墙皮纪元：自增一次 = 视图按需重掷一次 14 张阴面墙皮（S18，无定时器） */
  readonly wallSkinEpoch: number;
  /** 皮肤按钮连点计数（原作 easterEgg.js 的 count） */
  readonly tapCount: number;
  /** 连点彩蛋是否已解锁 */
  readonly eggUnlocked: boolean;
  /** 最近一次彩蛋文案（供面板展示；运行时同步经 ui/toast 广播） */
  readonly lastEggMessage: string | null;
}

const VISUAL_STORAGE_KEY = 'lawbox-chronicle:cheat-visuals:v1';

interface StoredVisualState {
  readonly skinIndex: number;
  readonly wallSkinEpoch: number;
  readonly tapCount: number;
  readonly eggUnlocked: boolean;
}

function loadVisualState(): CheatVisualState {
  const fallback: CheatVisualState = {
    skinIndex: 0,
    wallSkinEpoch: 0,
    tapCount: 0,
    eggUnlocked: false,
    lastEggMessage: null,
  };
  try {
    const raw = localStorage.getItem(VISUAL_STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredVisualState>;
    return {
      skinIndex: clampIndex(parsed.skinIndex),
      wallSkinEpoch: typeof parsed.wallSkinEpoch === 'number' ? parsed.wallSkinEpoch : 0,
      tapCount: typeof parsed.tapCount === 'number' ? parsed.tapCount : 0,
      eggUnlocked: parsed.eggUnlocked === true,
      lastEggMessage: null,
    };
  } catch {
    return fallback; // 坏档只影响皮肤观感，绝不影响游戏进程
  }
}

function clampIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const count = Math.max(1, SKIN_URLS.length);
  return Math.abs(Math.trunc(value)) % count;
}

function saveVisualState(state: CheatVisualState): void {
  try {
    const persisted: StoredVisualState = {
      skinIndex: state.skinIndex,
      wallSkinEpoch: state.wallSkinEpoch,
      tapCount: state.tapCount,
      eggUnlocked: state.eggUnlocked,
    };
    localStorage.setItem(VISUAL_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* 隐私模式等场景写不进就算了：皮肤是纯观感 */
  }
}

let visualState: CheatVisualState = loadVisualState();
const visualListeners = new Set<() => void>();

function setVisualState(patch: Partial<CheatVisualState>): void {
  visualState = { ...visualState, ...patch };
  saveVisualState(visualState);
  for (const listener of visualListeners) listener();
}

function subscribeVisual(listener: () => void): () => void {
  visualListeners.add(listener);
  return () => visualListeners.delete(listener);
}

/** React 侧订阅：视图渲染角色皮肤 / 墙皮时使用 */
export function useCheatVisualState(): CheatVisualState {
  return useSyncExternalStore(subscribeVisual, () => visualState);
}

/** 非 React 场景的同步读取（终端/测试/存档导出用） */
export function getVisualState(): CheatVisualState {
  return visualState;
}

/** 视图层按 skinIndex 取皮肤 URL（越界自动取模） */
export function skinUrlAt(index: number): string | undefined {
  if (SKIN_URLS.length === 0) return undefined;
  return SKIN_URLS[((index % SKIN_URLS.length) + SKIN_URLS.length) % SKIN_URLS.length];
}

/* ============================== 效果实现 =================================== */

type CheatEffect = (entrypoint: CheatEntrypoint, args: readonly string[]) => string;

function currentLevelIndex(): number {
  const segment = useGameStore.getState().segment;
  if (segment === null) return -1;
  return LEVELS.findIndex((l) => l.id === segment.levelId);
}

const EFFECTS: Readonly<Record<string, CheatEffect>> = Object.freeze({
  'cheat-level-next'() {
    const state = useGameStore.getState();
    const index = currentLevelIndex();
    const next = index + 1 >= 0 ? LEVELS[index + 1] : LEVELS[0];
    if (next === undefined) return '已经是最后一关了，没有下一关可跳。';
    state.startLevel(next.id);
    return `已跳转至「${next.name}」（${next.id}）`;
  },

  'cheat-level-prev'() {
    const state = useGameStore.getState();
    const index = currentLevelIndex();
    if (index <= 0) return '当前没有更早的关卡了。';
    const prev = LEVELS[index - 1];
    if (prev === undefined) return '当前没有更早的关卡了。';
    state.startLevel(prev.id);
    return `已回到「${prev.name}」（${prev.id}）`;
  },

  'cheat-remove-chest'() {
    const state = useGameStore.getState();
    const segment = state.segment;
    if (segment === null) return '当前没有进行中的关卡。';
    const chests = segment.entities.filter((e) => e.kind === 'chest');
    if (chests.length === 0) return '场上已经没有箱子可消除了。';
    const rng = createRng(`cheat-remove-chest:${Date.now()}`);
    const victim = rng.pick(chests);
    // 集成期：经 store.removeChestById 走谜题引擎（谜题态 + 投影同步 + 可撤销），
    // 不再直改 segment 投影层（那会在下一步移动时被引擎真相冲掉）
    const removed = state.removeChestById(victim.id);
    if (!removed) return '消除失败：箱子不在谜题引擎状态里。';
    console.log(`[Cheat] Random removed a #${victim.id}.`); // 致敬原作 cheat.js:52 的控制台行话
    return `已消除箱子 ${victim.id}，剩余 ${chests.length - 1} 个。`;
  },

  'cheat-skin-next'() {
    const next = (visualState.skinIndex + 1) % Math.max(1, CHEAT_SKIN_COUNT);
    setVisualState({ skinIndex: next });
    bus.publish({ type: 'debug/mark', label: `skin:${next}` });
    return `皮肤已切换至第 ${next + 1} 套（共 ${CHEAT_SKIN_COUNT} 套）。`;
  },

  'cheat-wall-shuffle'() {
    const epoch = visualState.wallSkinEpoch + 1;
    setVisualState({ wallSkinEpoch: epoch });
    bus.publish({ type: 'debug/mark', label: `wall-skin-epoch:${epoch}` });
    return `阴面墙皮已重掷（第 ${epoch} 次，14 选 N，按需一次）。`;
  },

  'cheat-full-heal'() {
    const state = useGameStore.getState();
    if (state.player.hp >= state.player.maxHp) return 'HP 已经是满的。';
    useGameStore.setState({ player: { ...state.player, hp: state.player.maxHp } });
    return `HP 已回满（${state.player.maxHp}/${state.player.maxHp}）。`;
  },

  'cheat-grant-stones'() {
    const state = useGameStore.getState();
    useGameStore.setState({ gacha: { ...state.gacha, starStones: state.gacha.starStones + CHEAT_GRANT_STAR_STONES } });
    return `星石 +${CHEAT_GRANT_STAR_STONES}（当前 ${state.gacha.starStones + CHEAT_GRANT_STAR_STONES}）。`;
  },

  'term-kill'(_entrypoint, args) {
    const target = args[0] ?? '';
    if (target === KILL_TARGET_SETNAME) {
      setProgressFlag('terminal:setname-skipped', true);
      return "Module 'SetName' is Skipped. —— 你拒绝了剧本给你起的名字。";
    }
    // 解析顺序：别名（原作 Java 类名）→ 敌人 id → 敌人名
    const resolvedId = TERMINAL_KILL_ALIASES[target] ?? ENEMIES.find((e) => e.id === target || e.name === target)?.id;
    const enemy = resolvedId !== undefined ? findEnemy(resolvedId) : undefined;
    if (enemy === undefined) {
      return `[System] 未找到处刑目标：${target}（可用：SetName / 敌人 id / 敌人名 / ${Object.keys(TERMINAL_KILL_ALIASES).join(' / ')}）`;
    }
    setProgressFlag(`terminal:killed:${enemy.id}`, true);
    return `${enemy.name} 被 System 杀死了！`;
  },

  'term-give'(_entrypoint, args) {
    const item = args[0] ?? '';
    if (item === '') return '[System] 用法：/give--@p--<武器名>';
    const resolvedId = TERMINAL_GIVE_ALIASES[item] ?? item;
    if (resolvedId === BARE_HANDS_ID) {
      const state = useGameStore.getState();
      useGameStore.setState({ player: { ...state.player, weaponId: null } });
      return '你放下了所有武器，赤手空拳。有时候，这才是最难的选项。';
    }
    const weapon = findWeapon(resolvedId) ?? weaponByName(item);
    if (weapon === undefined) return `[System] 未知武器：${item}`;
    const state = useGameStore.getState();
    // B4-8：与 gameStore 的 grantWeapon 同构——先判重入列 player.weapons 再设
    // weaponId，否则战斗界面的武器列表（由 player.weapons 构建）选不到终端
    // 发放的武器，只换了手持不进背包
    const weapons = state.player.weapons ?? [];
    const nextWeapons = weapons.includes(weapon.id) ? weapons : [...weapons, weapon.id];
    useGameStore.setState({ player: { ...state.player, weapons: nextWeapons, weaponId: weapon.id } });
    return `获得 ${weapon.name}：${weapon.description}`;
  },

  'term-baba'() {
    const state = useGameStore.getState();
    if (state.story.flags['terminal:baba'] === true) {
      return '主角光环已经在身上了。再喊一次也只是重复表演（笑）。';
    }
    setProgressFlag('terminal:baba', true);
    useGameStore.setState({ player: { ...state.player, baseAttack: state.player.baseAttack + 233 } });
    return [
      '你对着天空大喊了一声——BABA！！！！！！！！！！！！',
      '随后，天旋地转，你什么都看不见了。',
      '金光闪过，脑海里闪过了一句话——你拥有了主角光环！',
      '攻击力 +233。',
    ].join('\n');
  },
});

function weaponByName(name: string) {
  return WEAPONS.find((w) => w.name === name);
}

/* ============================== 执行门（S9） =============================== */

export interface CheatExecutionResult {
  readonly ok: boolean;
  /** ok=false 时的拒绝/失败原因 */
  readonly reason?: string;
  /** 执行成功的回执文案（终端直接回显，面板/热键走 ui/toast） */
  readonly message?: string;
}

export function findCheatCommand(id: string): CheatCommandDef | undefined {
  return CHEAT_COMMANDS.find((c) => c.id === id);
}

/**
 * 唯一执行入口：三入口（keyboard / click / terminal）全部走这里。
 * 先查入口白名单，再过解锁谓词，二者任一不过都只回执原因、绝不放行。
 */
export function executeCheat(id: string, entrypoint: CheatEntrypoint, args: readonly string[] = []): CheatExecutionResult {
  const def = findCheatCommand(id);
  if (def === undefined) return { ok: false, reason: `未知作弊指令：${id}` };
  if (!def.entrypoints.includes(entrypoint)) {
    return { ok: false, reason: `「${def.name}」不支持 ${entrypoint} 入口（仅限：${def.entrypoints.join(' / ')}）` };
  }
  const denial = firstUnlockDenial(useGameStore.getState(), def.requires);
  if (denial !== null) {
    bus.publish({ type: 'ui/toast', messageKey: denial });
    return { ok: false, reason: denial };
  }
  const effect = EFFECTS[def.id];
  if (effect === undefined) return { ok: false, reason: `「${def.name}」没有注册效果实现` };
  const message = effect(entrypoint, args);
  bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-5' });
  if (entrypoint !== 'terminal') bus.publish({ type: 'ui/toast', messageKey: message });
  return { ok: true, message };
}

/** 面板/终端渲染用：带实时可执行性标注的条目 */
export interface CheatCommandStatus {
  readonly def: CheatCommandDef;
  readonly enabled: boolean;
  readonly denial: string | null;
}

export function listCheatCommandStatuses(): readonly CheatCommandStatus[] {
  const state = useGameStore.getState();
  return CHEAT_COMMANDS.map((def) => {
    const denial = firstUnlockDenial(state, def.requires);
    return { def, enabled: denial === null, denial };
  });
}

/** 热键表（e.code → 作弊 id），useKeyActions 用它绑定键盘入口 */
export const HOTKEY_CHEATS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CHEAT_COMMANDS.filter((c) => c.hotkey !== undefined).map((c) => [c.hotkey as string, c.id])),
);

/* ============================ 连点 20 次彩蛋 =============================== */

/**
 * 皮肤按钮的点击入口（原作 easterEgg.js 的 #cr onclick）。
 * 每次点击轮换皮肤；恰在第 20 次点亮彩蛋：广播原句 + 打开作弊开关。
 */
export function tapSkinButton(): CheatExecutionResult {
  const result = executeCheat('cheat-skin-next', 'click');
  const before = visualState;
  const tapCount = before.tapCount + 1;
  if (before.eggUnlocked) {
    setVisualState({ tapCount });
    return result;
  }
  if (tapCount === EGG_TAP_THRESHOLD) {
    setVisualState({ tapCount, eggUnlocked: true, lastEggMessage: EGG_MESSAGE });
    const settings = useGameStore.getState().settings;
    if (!settings.cheatsEnabled) {
      useGameStore.setState({ settings: { ...settings, cheatsEnabled: true } });
    }
    bus.publish({ type: 'ui/toast', messageKey: EGG_MESSAGE });
    bus.publish({ type: 'sfx/play', sfxId: 'sfx-effect-16' });
    return { ok: true, message: EGG_MESSAGE };
  }
  if (tapCount > 10) {
    const index = Math.max(0, currentLevelIndex());
    bus.publish({ type: 'ui/toast', messageKey: eggProgressMessage(index, tapCount) });
  }
  setVisualState({ tapCount });
  return result;
}

/** 彩蛋是否已解锁（供欢迎页/面板埋钩子展示） */
export function useCheatEggUnlocked(): boolean {
  return useSyncExternalStore(subscribeVisual, () => visualState.eggUnlocked);
}

/**
 * 皮肤纪元与彩蛋计数归零（公开 API：存档整体重置时与 store.resetSave()
 * 配套调用；vitest 里用于测试间隔离）。
 */
export function resetCheatVisualState(): void {
  setVisualState({ skinIndex: 0, wallSkinEpoch: 0, tapCount: 0, eggUnlocked: false, lastEggMessage: null });
}
