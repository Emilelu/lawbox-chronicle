/**
 * G4 组修复回归 —— 状态存储与 UI 面板层（A4 系列上一轮审计项）。
 * ---------------------------------------------------------------------------
 * 覆盖：
 *  - A4-1  once 触发封印延迟到剧本收尾（对话中断刷新不再永久跳过剧情）；
 *  - A4-2  storyRuntime 停止落盘（partialize 不含该切片；migrate v3 剥离旧档遗留）；
 *  - A1-3  逃跑位移写回世界层（applyFleeDisplacement 纯函数 + settleBattleEnd 集成）；
 *  - K3    击败旗单一真相源（只清 story.flags 单侧，重踩遭遇即再触发 —— N3
 *          triggerFlagView 语义回归，storyRuntime 草稿残旗不遮蔽评估）；
 *  - A4-10 保底计数唯一真相（gacha 镜像字段已删，rollGacha 后只 pity 增长）；
 *  - A4-7/A4-8 死代码清零（pity 持久化 API 仅测试定位、uninstall 导出已删）。
 *
 * 驱动真实全局 store（无 mock），beforeEach resetSave 隔离。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFleeDisplacement,
  useGameStore,
  type ImportedSegment,
} from '../gameStore';
import type { PuzzleState } from '../../../engine/puzzle/move';
import type { BattleState } from '../../../engine/combat/turn';

const store = () => useGameStore.getState();
const puzzle = () => store().puzzle as PuzzleState | null;
const battle = () => store().battle as BattleState | null;

const playerPos = (): { x: number; y: number } => {
  const player = store().segment?.entities.find((e) => e.kind === 'player');
  if (player === undefined) throw new Error('段位里没有玩家实体');
  return { x: player.x, y: player.y };
};

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

/** 授予法则卡（绕过关卡入口的 100% 补发剧本） */
function grantLawCard(cardId: string): void {
  useGameStore.setState({
    gacha: {
      ...store().gacha,
      owned: [...store().gacha.owned, { uid: `test-${cardId}`, cardId, obtainedAt: 0 }],
    },
  });
}

/** 读完当前剧本（推进 dialogue 直到回到 playing） */
function drainDialogue(limit = 40): void {
  let guard = 0;
  while (store().phase === 'dialogue' && guard < limit) {
    store().advanceDialogue();
    guard += 1;
  }
}

beforeEach(() => {
  store().resetSave();
});

/* ========================= A4-1 · 触发封印延迟到收尾 ======================== */

describe('A4-1 · once 触发封印延迟到剧本正常收尾', () => {
  it('剧本演出中 seenEventIds 不含该触发（未封印）；收尾后才落盘', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(8, 6); // 导航天使①（主城网格 (8,6)）
    store().interact();
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-angel-1');
    // 关键断言：命中即挂账、收尾才落盘 —— 此刻 seenEventIds 仍是空
    expect(store().story.seenEventIds).not.toContain('trigger-angel-1');
    drainDialogue();
    expect(store().phase).toBe('playing');
    expect(store().story.seenEventIds).toContain('trigger-angel-1');
  });

  it('对话中断（模拟刷新）后重走原坐标可再次开演 —— 作者谜题不再被永久跳过', () => {
    // 作者谜题（trigger-author-quiz）：once:true 且无 unlessFlag —— 旧实现里
    // 「markTriggerSeen 先于开演」+ seenEventIds 随档持久化，演出中刷新即永久
    // 封印（story:key-boss 唯一置位点在成功节点 → BOSS 真战斗永不解锁，主线软锁）。
    // 天使①的遭遇规则另有 unlessFlag(story:angel-met-<seq>) 把关（见过本人即
    // 光羽 tile 接管，属设计语义，不属 seen 封印）——故本回归用作者谜题。
    store().startLevel('level-lb-09');
    useGameStore.setState({
      story: {
        ...store().story,
        flags: {
          ...store().story.flags,
          'story:defeated:enemy-caixukun': true,
          'story:defeated:enemy-guolaoshi': true,
          'story:defeated:enemy-dygg': true,
        },
      },
    });
    teleportPlayer(5, 4); // 作者躺椅（L9 表里回廊，radius 1）
    store().interact();
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-author-puzzle');
    expect(store().story.seenEventIds).not.toContain('trigger-author-quiz'); // 延迟封印：中断时未落账
    // 模拟「对话中刷新」：运行时重置为 IDLE（v3 起 storyRuntime 也不落盘）
    useGameStore.setState({ storyRuntime: { ...store().storyRuntime, scriptId: null, nodeId: null, phase: 'idle' }, phase: 'playing' });
    store().interact();
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-author-puzzle'); // 重走即重演
    expect(store().story.seenEventIds).not.toContain('trigger-author-quiz');
  });

  it('正常收尾后 once 封印生效：同格 E 交互不再触发该剧本（也不误触 tile 规则）', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(8, 6);
    store().interact();
    drainDialogue();
    expect(store().story.seenEventIds).toContain('trigger-angel-1');
    store().interact(); // 只查 npc 规则：angel-1 已封印，光羽 tile 不在 interact 范围
    expect(store().phase).toBe('playing');
    expect(store().storyRuntime.scriptId).toBeNull();
  });
});

/* ==================== A4-2 · storyRuntime 停止落盘（v3 迁移） ==================== */

describe('A4-2 · storyRuntime 停止落盘', () => {
  it('partialize 输出不含 storyRuntime（纯死重切片退出存档契约）', () => {
    store().startLevel('level-sb-01');
    teleportPlayer(8, 6);
    store().interact(); // storyRuntime 进入 dialogue 态
    expect(store().storyRuntime.phase).toBe('dialogue');
    const persisted = useGameStore.persist.getOptions().partialize?.(store()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('storyRuntime');
    expect(persisted).toHaveProperty('story');
    expect(persisted).toHaveProperty('pity');
  });

  it('migrate（v2 → v3）剥离旧档遗留的 storyRuntime 切片，其余字段原样保留', () => {
    const legacyV2 = {
      locale: 'zh-Hans',
      story: { activeEventId: null, lineIndex: 0, seenEventIds: ['trigger-angel-1'], flags: {} },
      storyRuntime: { scriptId: 'script-angel-1', nodeId: 'angel-1-entry', phase: 'dialogue' },
      visitCount: 3,
    };
    const migrated = useGameStore.persist.getOptions().migrate?.(legacyV2, 2) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('storyRuntime');
    expect((migrated.story as { seenEventIds: readonly string[] }).seenEventIds).toEqual(['trigger-angel-1']);
    expect(migrated.visitCount).toBe(3);
  });

  it('persist 版本号升至 3（旧档升级触发 migrate 剥离）', () => {
    expect(useGameStore.persist.getOptions().version).toBe(3);
  });
});

/* ======================= A1-3 · 逃跑位移写回世界层 ======================= */

describe('A1-3 · 逃跑=真实位移写回世界层', () => {
  it('applyFleeDisplacement（纯函数）：formation 玩家落位覆盖世界玩家坐标', () => {
    const world: ImportedSegment['entities'] = [
      { id: 'player-1', kind: 'player' as const, x: 7, y: 5, mass: Infinity, pushable: false },
      { id: 'chest-1', kind: 'chest' as const, x: 3, y: 3, mass: 2, pushable: true },
    ];
    const formation: ImportedSegment['entities'] = [
      { id: 'player-1', kind: 'player' as const, x: 5, y: 5, mass: Infinity, pushable: false },
      { id: 'enemy-1', kind: 'enemy' as const, x: 7, y: 5, mass: 1, pushable: true },
    ];
    const moved = applyFleeDisplacement(world, formation, 'player-1');
    expect(moved.find((e) => e.id === 'player-1')).toMatchObject({ x: 5, y: 5 });
    expect(moved.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 3 }); // 其余实体不动
    // formation 缺玩家（异常战场）→ 原样返回
    expect(applyFleeDisplacement(world, [], 'player-1')).toBe(world);
  });

  it('郭老师遭遇逃跑结算后，世界层玩家已离开遭遇格（K2 症状回归：不再原地站怪旁）', () => {
    grantLawCard('card-law-wider-push'); // L3 入口法则门免打扰
    useGameStore.setState({ player: { ...store().player, baseAttack: 0, weapons: [] } }); // 徒手必逃
    store().startLevel('level-sb-03');
    teleportPlayer(7, 5); // 郭老师遭遇格（radius 0 踩上即遭遇）
    store().interact();
    store().advanceDialogue();
    store().advanceDialogue();
    expect(battle()?.enemyId).toBe('enemy-guolaoshi');
    expect(playerPos()).toEqual({ x: 7, y: 5 }); // 世界层：仍站遭遇格
    store().dispatch({ type: 'toggleFormation' }); // 确认布阵 → battle 相
    store().combatAct('flee'); // 布阵战场 BFS 安全格 → phase:'fled' → 结算
    expect(battle()).toBeNull();
    // 剧情战（awaiting-battle）的逃跑走 loseNext 分支续演战败文案，演完回世界
    drainDialogue(20);
    expect(store().phase).toBe('playing');
    const pos = playerPos();
    // 核心断言：世界层玩家不再停在遭遇格（与 formation 的逃跑落位一致）
    expect(pos).not.toEqual({ x: 7, y: 5 });
    // 段位与谜题双投影同步（segment 是 puzzle 的投影视图）
    const p = puzzle();
    const puzzlePlayer = p?.entities.find((e) => e.kind === 'player');
    expect({ x: puzzlePlayer?.x, y: puzzlePlayer?.y }).toEqual(pos);
  });
});

/* ============ K3 · 击败旗单一真相源（N3 triggerFlagView 语义回归） ============ */

describe('K3 · 击败旗只存 story.flags 真相源（单侧清理即再触发）', () => {
  it('郭老师胜利置旗后，只清 story.flags 单侧（runtime 草稿残旗保留）→ 重踩 (7,5) 再触发', () => {
    grantLawCard('card-law-wider-push');
    useGameStore.setState({ player: { ...store().player, baseAttack: 300, weapons: [] } });
    store().startLevel('level-sb-03');
    teleportPlayer(7, 5);
    store().interact();
    expect(store().storyRuntime.scriptId).toBe('script-mob-guolaoshi');
    store().advanceDialogue();
    store().advanceDialogue();
    store().dispatch({ type: 'toggleFormation' });
    let guard = 0;
    while (store().battle !== null && guard < 40) {
      store().combatAct('attack');
      guard += 1;
    }
    expect(store().story.flags['story:defeated:enemy-guolaoshi']).toBe(true);
    // 会话草稿确实冗余持有一份（双写落账是解释器 gate/choice 所需）
    expect(store().storyRuntime.flags['story:defeated:enemy-guolaoshi']).toBe(true);
    drainDialogue(20);
    expect(store().phase).toBe('playing');
    // evidence 场景：只清 story.flags 单侧
    const flags = { ...store().story.flags };
    delete flags['story:defeated:enemy-guolaoshi'];
    useGameStore.setState({ story: { ...store().story, flags } });
    // 重踩：挪开一格再落格制造真实移动触发
    teleportPlayer(7, 4);
    store().move('down');
    expect(store().phase).toBe('dialogue');
    expect(store().storyRuntime.scriptId).toBe('script-mob-guolaoshi');
  });
});

/* ================= A4-10 · 保底计数唯一真相（gacha 镜像已删） ================= */

describe('A4-10 · pity 是保底计数唯一真相', () => {
  it('rollGacha 后 pity.pullsSinceFourStar 增长，gacha 不再有镜像字段', () => {
    store().rollGacha(1);
    expect(store().gacha.lastResult).not.toBeNull();
    expect(store().gacha).not.toHaveProperty('pullsSinceFourStar');
    expect(store().pity.pullsSinceFourStar).toBe(1);
    expect(store().pity.totalPulls).toBe(1);
    expect(store().gacha.totalPulls).toBe(1);
  });
});

/* ================ A4-7 / A4-8 · 死代码与误导注释清零 ================ */

describe('A4-7/A4-8 · 死分片/死代码清理', () => {
  it('pity.ts 的 PITY_STORAGE_KEY 指向独立分片键（生产不再写入，仅测试原语定位）', async () => {
    const pity = await import('../../../engine/gacha/pity');
    expect(pity.PITY_STORAGE_KEY).toBe('lawbox-chronicle:pity:v1');
    // 生产持久化通道是主档 partialize（pity 字段），不经该键 —— 见 A4-2 断言
  });

  it('statsCollector / logbook 的 uninstall 导出已删（模块加载即自装，卸载走 install 返回值）', async () => {
    const stats = (await import('../../../archive/statsCollector')) as Record<string, unknown>;
    const logbook = (await import('../../../archive/logbook')) as Record<string, unknown>;
    expect(stats.uninstallStatsCollector).toBeUndefined();
    expect(logbook.uninstallLogbookCollector).toBeUndefined();
    expect(typeof stats.installStatsCollector).toBe('function');
    expect(typeof logbook.installLogbookCollector).toBe('function');
  });
});
