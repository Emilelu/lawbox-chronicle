/**
 * MetaTerminal 解析器单测 —— /kill--、/give--@p--、BABA、exit 完整解析；
 * 非法/未知命令显式回执（K3：exit 与未知输入绝不被解释成移动指令）。
 */

import { describe, expect, it } from 'vitest';
import { parseTerminalCommand } from '../MetaTerminal';

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
