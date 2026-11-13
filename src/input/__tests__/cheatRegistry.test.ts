/**
 * CheatRegistry 单测 —— 三入口统一门禁（S9）、选关显式谓词（S10）、
 * 连点 20 次彩蛋、皮肤轮换、墙皮纪元（S18）、终端剧本指令。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import './localStorageShim'; // 必须最先导入：垫片先于 store 装好
import { useGameStore } from '../../core/store/gameStore';
import { LEVELS } from '../../data';
import { EGG_MESSAGE, EGG_TAP_THRESHOLD } from '../../data/cheats/commands';
import {
  CHEAT_SKIN_COUNT,
  executeCheat,
  getVisualState,
  hasClearedLevel,
  hasReachedLevel,
  isGameCleared,
  listCheatCommandStatuses,
  resetCheatVisualState,
  skinUrlAt,
  tapSkinButton,
} from '../cheatRegistry';

/** 直接改 store 的测试辅助：开启作弊开关 */
function enableCheats(): void {
  const settings = useGameStore.getState().settings;
  useGameStore.setState({ settings: { ...settings, cheatsEnabled: true } });
}

/** 直接写旗标的测试辅助：把全部主线关卡标记为已通关 */
function markGameCleared(): void {
  const { story } = useGameStore.getState();
  const flags = { ...story.flags };
  for (const level of LEVELS) flags[`cleared:${level.id}`] = true;
  useGameStore.setState({ story: { ...story, flags } });
}

const chestCount = (): number =>
  useGameStore.getState().segment?.entities.filter((e) => e.kind === 'chest').length ?? 0;

beforeEach(() => {
  resetCheatVisualState();
  localStorage.removeItem('lawbox-chronicle:cheat-visuals:v1');
  useGameStore.getState().resetSave();
});

describe('S9 —— 三入口同一道门，热键无特权', () => {
  it('作弊开关未开时，键盘/点击入口一律拒绝且状态不变', () => {
    useGameStore.getState().startLevel('level-sb-01');
    const before = chestCount();
    expect(useGameStore.getState().settings.cheatsEnabled).toBe(false);

    const keyboard = executeCheat('cheat-remove-chest', 'keyboard');
    const click = executeCheat('cheat-remove-chest', 'click');
    expect(keyboard.ok).toBe(false);
    expect(click.ok).toBe(false);
    expect(keyboard.reason).toContain('作弊开关');
    expect(chestCount()).toBe(before);
  });

  it('开关打开后同一指令经同一门放行', () => {
    useGameStore.getState().startLevel('level-sb-01');
    enableCheats();
    const before = chestCount();
    const result = executeCheat('cheat-remove-chest', 'keyboard');
    expect(result.ok).toBe(true);
    expect(chestCount()).toBe(before - 1);
    expect(result.message).toContain('已消除箱子');
  });

  it('入口白名单：终端专属指令从键盘/点击调用被拒绝', () => {
    markGameCleared();
    const keyboard = executeCheat('term-give', 'keyboard', ['爷爷的拐杖']);
    const click = executeCheat('term-give', 'click', ['爷爷的拐杖']);
    expect(keyboard.ok).toBe(false);
    expect(click.ok).toBe(false);
    expect(keyboard.reason).toContain('不支持 keyboard 入口');
  });

  it('终端指令需通关全部主线关卡（game-cleared 谓词）', () => {
    const denied = executeCheat('term-kill', 'terminal', ['SetName']);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain('通关');
    markGameCleared();
    const allowed = executeCheat('term-kill', 'terminal', ['SetName']);
    expect(allowed.ok).toBe(true);
  });
});

describe('S10 —— 选关解锁 = 显式谓词「到达第 2 关」', () => {
  it('只在第 1 关时即使开了作弊也无法跳关', () => {
    useGameStore.getState().startLevel('level-sb-01');
    enableCheats();
    const result = executeCheat('cheat-level-next', 'keyboard');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('到达');
  });

  it('到达第 2 关后（reached 旗标 / 当前段位）谓词放行', () => {
    enableCheats();
    useGameStore.getState().startLevel('level-sb-02'); // startLevel 会写 reached:level-sb-02
    expect(hasReachedLevel(useGameStore.getState(), 'level-sb-02')).toBe(true);
    const result = executeCheat('cheat-level-next', 'keyboard');
    expect(result.ok).toBe(true);
    expect(useGameStore.getState().segment?.levelId).toBe('level-sb-03');
  });

  it('hasReachedLevel 依据 LEVELS 顺序现算（无旗标也能判定）', () => {
    useGameStore.getState().startLevel('level-sb-03');
    const state = useGameStore.getState();
    expect(hasReachedLevel(state, 'level-sb-01')).toBe(true);
    expect(hasReachedLevel(state, 'level-sb-03')).toBe(true);
    expect(hasReachedLevel(state, 'level-sb-04')).toBe(false);
    expect(hasReachedLevel(state, 'level-not-exist')).toBe(false);
  });

  it('F3：本关已通关（只有 cleared 旗标）即视为已到达，不再与「未到达」矛盾', () => {
    // 干净存档基线：末关既未到达也未通关
    expect(hasReachedLevel(useGameStore.getState(), 'level-lb-12')).toBe(false);
    expect(hasClearedLevel(useGameStore.getState(), 'level-lb-12')).toBe(false);
    // 旧存档只写入 cleared:<id>（如自动演示直通关底，reached:<id> 缺失）
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, 'cleared:level-lb-12': true } },
    }));
    const state = useGameStore.getState();
    expect(hasClearedLevel(state, 'level-lb-12')).toBe(true);
    expect(hasReachedLevel(state, 'level-lb-12')).toBe(true);
  });
});

describe('hasClearedLevel / isGameCleared', () => {
  it('旗标缺失时未通关；补齐全部主线旗标后通关', () => {
    const state = useGameStore.getState();
    expect(hasClearedLevel(state, 'level-sb-01')).toBe(false);
    expect(isGameCleared(state)).toBe(false);
    markGameCleared();
    expect(isGameCleared(useGameStore.getState())).toBe(true);
  });
});

describe('皮肤轮换 / 墙皮纪元（S18）', () => {
  it('皮肤轮换按模循环，且不触碰游戏状态', () => {
    useGameStore.getState().startLevel('level-sb-01');
    const stepsBefore = useGameStore.getState().segment?.steps;
    expect(CHEAT_SKIN_COUNT).toBe(5); // assets/imgs/roles 5 套
    executeCheat('cheat-skin-next', 'keyboard');
    executeCheat('cheat-skin-next', 'keyboard');
    const after = skinUrlAt(2);
    expect(after).toBeDefined();
    expect(useGameStore.getState().segment?.steps).toBe(stepsBefore); // 纯观感，不进步数
  });

  it('墙皮重掷是 epoch 自增（按需一次，无定时器）', () => {
    const first = executeCheat('cheat-wall-shuffle', 'keyboard');
    expect(first.ok).toBe(false); // 未开作弊
    enableCheats();
    const second = executeCheat('cheat-wall-shuffle', 'keyboard');
    expect(second.ok).toBe(true);
    const third = executeCheat('cheat-wall-shuffle', 'keyboard');
    expect(third.ok).toBe(true);
    expect(skinUrlAt(0)).toBeDefined(); // 视图按 epoch 重掷，URL 表恒可用
  });

  it('skinUrlAt 越界自动取模', () => {
    expect(skinUrlAt(0)).toEqual(skinUrlAt(CHEAT_SKIN_COUNT));
    expect(skinUrlAt(-1)).toEqual(skinUrlAt(CHEAT_SKIN_COUNT - 1));
  });
});

describe('连点 20 次彩蛋', () => {
  it('恰好第 20 次点亮：原句上屏 + 作弊开关打开', () => {
    let last = tapSkinButton();
    for (let i = 1; i < EGG_TAP_THRESHOLD; i += 1) last = tapSkinButton();
    const state = useGameStore.getState();
    expect(state.settings.cheatsEnabled).toBe(true); // 「这功能开了」
    expect(getVisualState().eggUnlocked).toBe(true);
    expect(getVisualState().lastEggMessage).toBe(EGG_MESSAGE);
    expect(last.message).toBe(EGG_MESSAGE);
    expect(getVisualState().skinIndex).toBe(EGG_TAP_THRESHOLD % CHEAT_SKIN_COUNT);
  });

  it('连点超过 10 次但未到 20 次时只是致敬计数，不开作弊', () => {
    for (let i = 0; i < 15; i += 1) tapSkinButton();
    expect(useGameStore.getState().settings.cheatsEnabled).toBe(false);
    expect(getVisualState().eggUnlocked).toBe(false);
    expect(getVisualState().skinIndex).toBe(15 % CHEAT_SKIN_COUNT);
  });
});

describe('META 终端剧本指令（通关后）', () => {
  beforeEach(() => markGameCleared());

  it('/kill--SetName：跳过命名剧本', () => {
    const result = executeCheat('term-kill', 'terminal', ['SetName']);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Module 'SetName' is Skipped");
    expect(useGameStore.getState().story.flags['terminal:setname-skipped']).toBe(true);
  });

  it('/kill--Caixukun（原作 Java 类名别名）与敌人名都能处刑', () => {
    const byAlias = executeCheat('term-kill', 'terminal', ['Caixukun']);
    expect(byAlias.ok).toBe(true);
    expect(byAlias.message).toContain('蔡徐坤 被 System 杀死了');
    const byName = executeCheat('term-kill', 'terminal', ['冬泳怪鸽']);
    expect(byName.ok).toBe(true);
    expect(useGameStore.getState().story.flags['terminal:killed:enemy-dygg']).toBe(true);
  });

  it('/kill-- 未知目标显式回执，绝不静默', () => {
    const result = executeCheat('term-kill', 'terminal', ['不存在的怪']);
    expect(result.ok).toBe(true); // 指令本身合法，业务层回执未找到
    expect(result.message).toContain('未找到处刑目标');
  });

  it('/give--@p--<武器名> 发放武器（入列 weapons）；赤手空拳放下武器', () => {
    const give = executeCheat('term-give', 'terminal', ['爷爷的拐杖']);
    expect(give.ok).toBe(true);
    expect(useGameStore.getState().player.weaponId).toBe('weapon-gfsStick');
    // B4-8：终端发放的武器必须入列 player.weapons（战斗界面武器列表的数据源），
    // 只设 weaponId 不进背包会让列表选不到
    expect(useGameStore.getState().player.weapons).toContain('weapon-gfsStick');
    // 重复发放判重：不产生重复条目
    const again = executeCheat('term-give', 'terminal', ['爷爷的拐杖']);
    expect(again.ok).toBe(true);
    expect(useGameStore.getState().player.weapons?.filter((id) => id === 'weapon-gfsStick')).toHaveLength(1);
    const bare = executeCheat('term-give', 'terminal', ['赤手空拳']);
    expect(bare.ok).toBe(true);
    expect(useGameStore.getState().player.weaponId).toBeNull();
    // 放下武器只清手持，背包不清空（与 gameStore 侧「放下武器」同语义）
    expect(useGameStore.getState().player.weapons).toContain('weapon-gfsStick');
  });

  it('BABA 一次性主角光环：攻击 +233，重复喊话只收到调侃', () => {
    const attackBefore = useGameStore.getState().player.baseAttack;
    const first = executeCheat('term-baba', 'terminal');
    expect(first.ok).toBe(true);
    expect(first.message).toContain('BABA');
    expect(useGameStore.getState().player.baseAttack).toBe(attackBefore + 233);
    const second = executeCheat('term-baba', 'terminal');
    expect(second.message).toContain('已经在身上');
    expect(useGameStore.getState().player.baseAttack).toBe(attackBefore + 233); // 不叠加
  });

  it('cheat-full-heal 与 cheat-grant-stones 走同一道门', () => {
    enableCheats(); // 这两条是 cheats-enabled 谓词条目
    const state = useGameStore.getState();
    useGameStore.setState({ player: { ...state.player, hp: 1 } });
    const heal = executeCheat('cheat-full-heal', 'terminal');
    expect(heal.ok).toBe(true);
    expect(useGameStore.getState().player.hp).toBe(useGameStore.getState().player.maxHp);
    const stonesBefore = useGameStore.getState().gacha.starStones;
    const grant = executeCheat('cheat-grant-stones', 'terminal');
    expect(grant.ok).toBe(true);
    expect(useGameStore.getState().gacha.starStones).toBe(stonesBefore + 1600);
  });
});

describe('listCheatCommandStatuses —— 面板渲染数据', () => {
  it('每条命令都带实时可执行性标注', () => {
    const statuses = listCheatCommandStatuses();
    expect(statuses.length).toBeGreaterThanOrEqual(10);
    for (const status of statuses) {
      expect(status.def.id.length).toBeGreaterThan(0);
      expect(typeof status.enabled).toBe('boolean');
    }
    const skin = statuses.find((s) => s.def.id === 'cheat-skin-next');
    expect(skin?.enabled).toBe(true); // always 谓词
  });
});
