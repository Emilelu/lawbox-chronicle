/**
 * 卡名 / 武器名 / 法则补丁名 i18n 表（C4）—— 覆盖与对齐回归。
 * ---------------------------------------------------------------------------
 * 老缺陷：CardDef/WeaponDef/LawPatchDef 的 name 是数据层硬编码中文，且全仓
 * 无本地化机制——非中文语种下标题页抽卡、HUD 武器、战斗武器栏、法则快捷栏、
 * 档案图鉴与逐抽记录全部保持中文。
 *
 * 修复机制（与关卡名 F4 同款）：uiText.ts 的 CARD_NAME_TEXT / WEAPON_NAME_TEXT /
 * LAW_PATCH_NAME_TEXT 按 id 提供七语种覆写，cardName/weaponName/lawPatchName
 * 未收录 id 回落数据原文。本文件锁死两条不变量：
 *  1. 覆盖完整性 —— CARDS/WEAPONS/LAW_PATCHES 的每个 id 都已入表（漏配即测试红）；
 *  2. zh-Hans 逐字保真 —— 表内简中名与数据原文完全一致（防两处真相漂移）。
 */

import { describe, expect, it } from 'vitest';
import { LAW_PATCHES } from '../../../core/lawRegistry';
import { WEAPONS } from '../../../data/weapons';
import { CARDS } from '../../../data/gacha';
import {
  CARD_NAME_TEXT,
  LAW_PATCH_NAME_TEXT,
  WEAPON_NAME_TEXT,
  cardName,
  lawPatchName,
  weaponName,
} from '../uiText';
import { LOCALES, type LocaleId } from '../../../core/types';

describe('CARD_NAME_TEXT · 卡名表覆盖（C4）', () => {
  it('CARDS 的每个 id 都已入表，zh-Hans 与数据原文逐字一致', () => {
    for (const card of CARDS) {
      const entry = CARD_NAME_TEXT[card.id as keyof typeof CARD_NAME_TEXT];
      expect(entry, `卡 ${card.id} 未收录进 CARD_NAME_TEXT`).toBeDefined();
      expect(entry!['zh-Hans'].name).toBe(card.name);
    }
  });

  it('每个 id 的七语种名齐备且非空（7 语种必须对齐）', () => {
    for (const [id, entry] of Object.entries(CARD_NAME_TEXT)) {
      for (const locale of LOCALES) {
        expect(entry[locale].name.length, `${id}/${locale} 名为空`).toBeGreaterThan(0);
      }
    }
  });

  it('非中文语种不再显示中文卡名（抽样：en/ja/de 的法则·位面之眼）', () => {
    const card = CARDS.find((c) => c.id === 'card-law-plane-eye')!;
    expect(cardName('en', card)).toBe('Law · Plane Eye');
    expect(cardName('ja', card)).toBe('法則・位相の眼');
    expect(cardName('de', card)).toBe('Gesetz · Auge der Ebene');
    expect(cardName('en', card)).not.toContain('法则');
  });

  it('cardName 未收录 id 回落卡数据原文（新增卡漏配不白屏）', () => {
    expect(cardName('en', { id: 'card-future', name: '未来卡' })).toBe('未来卡');
    expect(cardName('zh-Hans', { id: 'card-chr-caixukun', name: '蔡徐坤' })).toBe('蔡徐坤');
    expect(cardName('en', { id: 'card-chr-caixukun', name: '蔡徐坤' })).toBe('Cai Xukun');
  });
});

describe('WEAPON_NAME_TEXT · 武器名表覆盖（C4）', () => {
  it('WEAPONS 的每个 id 都已入表，zh-Hans 与数据原文逐字一致', () => {
    for (const weapon of WEAPONS) {
      const entry = WEAPON_NAME_TEXT[weapon.id as keyof typeof WEAPON_NAME_TEXT];
      expect(entry, `武器 ${weapon.id} 未收录进 WEAPON_NAME_TEXT`).toBeDefined();
      expect(entry!['zh-Hans'].name).toBe(weapon.name);
    }
  });

  it('weaponName 按语种解析（en：Dagger/Basketball/Kiwi Bomb…），未知 id 回落原文', () => {
    const dagger = WEAPONS.find((w) => w.id === 'weapon-dagger')!;
    const mihotel = WEAPONS.find((w) => w.id === 'weapon-mihotel')!;
    expect(weaponName('zh-Hans', dagger)).toBe('匕首');
    expect(weaponName('en', dagger)).toBe('Dagger');
    expect(weaponName('en', mihotel)).toBe('Kiwi Bomb');
    expect(weaponName('fr', mihotel)).toBe('Bombe kiwi');
    expect(weaponName('en', { id: 'weapon-future', name: '未来武器' })).toBe('未来武器');
  });
});

describe('LAW_PATCH_NAME_TEXT · 法则补丁名表覆盖（C4）', () => {
  it('LAW_PATCHES 的每个 id 都已入表，zh-Hans 与注册表原文逐字一致', () => {
    for (const patch of Object.values(LAW_PATCHES)) {
      const entry = LAW_PATCH_NAME_TEXT[patch.id as keyof typeof LAW_PATCH_NAME_TEXT];
      expect(entry, `补丁 ${patch.id} 未收录进 LAW_PATCH_NAME_TEXT`).toBeDefined();
      expect(entry!['zh-Hans'].name).toBe(patch.name);
    }
  });

  it('lawPatchName 按语种解析（法则快捷栏芯片语义：位面之眼 → Plane Eye）', () => {
    const eye = LAW_PATCHES['plane-eye'];
    expect(lawPatchName('zh-Hans', eye)).toBe('位面之眼');
    expect(lawPatchName('en', eye)).toBe('Plane Eye');
    expect(lawPatchName('ru', eye)).toBe('Око Плана');
  });
});

describe('三表 · 语种键集形状（类型层 satisfies 之外的运行期双保险）', () => {
  it('每个条目恰好覆盖 7 个 LocaleId（无缺语种/无野语种键）', () => {
    const tables = [CARD_NAME_TEXT, WEAPON_NAME_TEXT, LAW_PATCH_NAME_TEXT];
    for (const table of tables) {
      for (const [id, entry] of Object.entries(table)) {
        expect(Object.keys(entry).sort(), `${id} 语种键集异常`).toEqual([...LOCALES].sort());
      }
    }
  });
});

/** 类型冒烟：LocaleId 约束在 satisfies 下编译期生效，这里只做形状防回归 */
const _localeSmoke: readonly LocaleId[] = LOCALES;
void _localeSmoke;
