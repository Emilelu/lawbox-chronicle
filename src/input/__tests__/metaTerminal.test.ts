/**
 * MetaTerminal 单测 —— /kill--、/give--@p--、BABA、exit 完整解析（K3）；
 * 解锁谓词与模块态开启门禁（C2-L2：未解锁按 ` 绝不形成隐形终端吞输入）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import './localStorageShim'; // 必须最先导入：垫片先于 store 装好
import { bus } from '../../core/events/bus';
import { useGameStore } from '../../core/store/gameStore';
import { LEVELS } from '../../data';
import {
  isMetaTerminalOpen,
  isMetaTerminalUnlocked,
  parseTerminalCommand,
  setMetaTerminalOpen,
  toggleMetaTerminal,
} from '../MetaTerminal';

describe('parseTerminalCommand —— 原作命令链语法', () => {
  it('/kill--SetName：开 幕 雷 击 钥 匙', () => {
    expect(parseTerminalCommand('/kill--SetName')).toEqual({ kind: 'kill', target: 'SetName' });
  });

  it('/kill--Caixukun：原作 Java 类名目标', () => {
    expect(parseTerminalCommand('/kill--Caixukun')).toEqual({ kind: 'kill', target: 'Caixukun' });
  });

  it('/kill-- 缺目标 → 显式用法回执，不是静默失败', () => {
    const parsed = parseTerminalCommand('/kill--');
    expect(parsed.kind).toBe('unknown');
    if (parsed.kind === 'unknown') expect(parsed.reason).toContain('缺少目标');
  });

  it('/give--@p--<武器名> 解析出选择器与物品', () => {
    expect(parseTerminalCommand('/give--@p--赤手空拳')).toEqual({ kind: 'give', selector: '@p', item: '赤手空拳' });
    expect(parseTerminalCommand('/give--@p--爷爷的拐杖')).toEqual({ kind: 'give', selector: '@p', item: '爷爷的拐杖' });
  });

  it('/give-- 缺选择器 / 缺物品名 → 用法回执', () => {
    const noSelector = parseTerminalCommand('/give--爷爷的拐杖');
    expect(noSelector.kind).toBe('unknown');
    if (noSelector.kind === 'unknown') expect(noSelector.reason).toContain('缺少选择器');

    const noItem = parseTerminalCommand('/give--@p--');
    expect(noItem.kind).toBe('unknown');
    if (noItem.kind === 'unknown') expect(noItem.reason).toContain('缺少物品名');
  });

  it('BABA 大小写不敏感（喊话何必拘谨）', () => {
    expect(parseTerminalCommand('BABA')).toEqual({ kind: 'baba' });
    expect(parseTerminalCommand('baba')).toEqual({ kind: 'baba' });
  });

  it('exit 只关闭终端；游戏世界没有退出流（B1）', () => {
    expect(parseTerminalCommand('exit')).toEqual({ kind: 'exit' });
    expect(parseTerminalCommand('  EXIT  ')).toEqual({ kind: 'exit' });
  });

  it('help 大小写不敏感', () => {
    expect(parseTerminalCommand('help')).toEqual({ kind: 'help' });
    expect(parseTerminalCommand('HELP')).toEqual({ kind: 'help' });
  });

  it('空输入与前后空白规范化', () => {
    expect(parseTerminalCommand('').kind).toBe('unknown');
    expect(parseTerminalCommand('   /kill--SetName  ')).toEqual({ kind: 'kill', target: 'SetName' });
  });

  it('未知输入显式回执并申明「绝不变成移动键」（K3）', () => {
    const w = parseTerminalCommand('w');
    expect(w.kind).toBe('unknown');
    if (w.kind === 'unknown') {
      expect(w.reason).toContain('未知指令');
      expect(w.reason).toContain('移动');
    }
    const garbage = parseTerminalCommand('/give--');
    expect(garbage.kind).toBe('unknown');
  });
});

/** 直接写旗标的测试辅助（与 cheatRegistry.test.ts 同款） */
function writeFlag(key: string, value: boolean): void {
  useGameStore.setState((s) => ({ story: { ...s.story, flags: { ...s.story.flags, [key]: value } } }));
}

/** 把全部主线关卡标记为已通关（cleared:* 齐备） */
function markGameCleared(): void {
  useGameStore.setState((s) => {
    const flags = { ...s.story.flags };
    for (const level of LEVELS) flags[`cleared:${level.id}`] = true;
    return { story: { ...s.story, flags } };
  });
}

describe('isMetaTerminalUnlocked —— 解锁谓词（纯函数）', () => {
  beforeEach(() => {
    useGameStore.getState().resetSave();
  });

  it('新存档（未通关、无旗标）未解锁', () => {
    expect(isMetaTerminalUnlocked(useGameStore.getState())).toBe(false);
  });

  it('旗标 meta:terminal-unlocked 置位即解锁（BOSS 结局路，无需全通关）', () => {
    writeFlag('meta:terminal-unlocked', true);
    expect(isMetaTerminalUnlocked(useGameStore.getState())).toBe(true);
  });

  it('全主线通关（cleared:* 齐备）即解锁', () => {
    markGameCleared();
    expect(isMetaTerminalUnlocked(useGameStore.getState())).toBe(true);
  });
});

describe('META 终端开启门禁（C2-L2：未解锁按 ` 不得形成隐形终端）', () => {
  const toasts: string[] = [];
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    useGameStore.getState().resetSave();
    toasts.length = 0;
    unsubscribe = bus.subscribe((event) => {
      if (event.type === 'ui/toast') toasts.push(event.messageKey);
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    setMetaTerminalOpen(false); // 模块态兜底清零，不跨用例泄漏（关闭永远放行）
  });

  it('未解锁：setMetaTerminalOpen(true) 与 toggleMetaTerminal 均 no-op，终端保持关闭且有提示', () => {
    setMetaTerminalOpen(true);
    expect(isMetaTerminalOpen()).toBe(false);
    toggleMetaTerminal();
    expect(isMetaTerminalOpen()).toBe(false);
    // 不是静默吞键：给出「未解锁」toast（与 executeCheat 拒绝反馈同款）
    expect(toasts.some((m) => m.includes('通关'))).toBe(true);
  });

  it('解锁（旗标路）后 toggle 正常开合', () => {
    writeFlag('meta:terminal-unlocked', true);
    toggleMetaTerminal();
    expect(isMetaTerminalOpen()).toBe(true);
    toggleMetaTerminal();
    expect(isMetaTerminalOpen()).toBe(false);
  });

  it('关闭永远放行：未解锁时传 false 直接生效，且不触发解锁提示', () => {
    setMetaTerminalOpen(false);
    expect(isMetaTerminalOpen()).toBe(false);
    expect(toasts).toEqual([]);
  });
});
