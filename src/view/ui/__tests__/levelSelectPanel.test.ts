/**
 * 帷幕界面层 · LevelSelectPanel 纯逻辑单测 —— levelRows（选关行：reached/cleared）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../../core/store/gameStore';
import { LEVELS } from '../../../data/levels';
import { levelRows } from '../LevelSelectPanel';

beforeEach(() => {
  useGameStore.getState().resetSave();
});

describe('levelRows · 选关进度', () => {
  it('覆盖全关卡表', () => {
    useGameStore.getState().startLevel(LEVELS[0]!.id);
    expect(levelRows(useGameStore.getState())).toHaveLength(LEVELS.length);
  });

  it('当前所在关卡 reached（无旗标时按 LEVELS 顺序现算）', () => {
    useGameStore.getState().startLevel(LEVELS[0]!.id);
    const rows = levelRows(useGameStore.getState());
    expect(rows[0]?.level.id).toBe(LEVELS[0]!.id);
    expect(rows[0]?.reached).toBe(true);
  });

  it('关卡数 > 1 时，末尾关卡未到达不可进入', () => {
    useGameStore.getState().startLevel(LEVELS[0]!.id);
    const rows = levelRows(useGameStore.getState());
    const last = rows[rows.length - 1];
    expect(LEVELS.length).toBeGreaterThan(1);
    expect(last?.reached).toBe(false);
  });

  it('cleared 旗标写入后对应关卡 cleared 为真', () => {
    const firstId = LEVELS[0]!.id;
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, [`cleared:${firstId}`]: true } },
    }));
    const row = levelRows(useGameStore.getState()).find((r) => r.level.id === firstId);
    expect(row?.cleared).toBe(true);
  });

  it('F3：只有 cleared 旗标的旧档（如自动演示直通关底）也视为已到达、可重入', () => {
    const lastId = LEVELS[LEVELS.length - 1]!.id;
    // 干净存档：末关既未到达也未通关（基线）
    const before = levelRows(useGameStore.getState()).find((r) => r.level.id === lastId);
    expect(before?.reached).toBe(false);
    expect(before?.cleared).toBe(false);
    // 只写 cleared:<id>（无 reached:<id>、无段位）—— 老口径下出现「✓ cleared + 未到达」矛盾态
    useGameStore.setState((s) => ({
      story: { ...s.story, flags: { ...s.story.flags, [`cleared:${lastId}`]: true } },
    }));
    const row = levelRows(useGameStore.getState()).find((r) => r.level.id === lastId);
    expect(row?.cleared).toBe(true);
    expect(row?.reached).toBe(true);
  });
});
