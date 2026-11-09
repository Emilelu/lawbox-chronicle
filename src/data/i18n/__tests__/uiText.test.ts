/**
 * 帷幕界面层 · uiText 单测 —— 键控字典的「语言对齐」回归防线。
 * ---------------------------------------------------------------------------
 * 老缺陷「语言 DOM 下标对齐」（SanBPushChest multiLang.js:149-157 按数组下标
 * 灌 .lang 元素）在结构上已被 Record<UiTextKey, string> 编译期约束铲除；
 * 本文件是运行期第二道防线：
 *  1. 七语种键集完全相等（无缺键、无多键）；
 *  2. 遗产 16 句逐字保真（对照 multiLang.js:13-140 原文断言）；
 *  3. tUi 插值 / 三级回落 / stripBr / formatPercent 行为。
 */

import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../../core/types';
import { LEVELS } from '../../../data/levels';
import { LEVEL_TEXT, UI_TEXT, UI_TEXT_KEYS, formatPercent, isUiTextKey, levelName, levelSubtitle, stripBr, tUi, type UiTextKey } from '../uiText';

describe('uiText · 七语种键集对齐', () => {
  it('每个语种的键集与简中键源完全相等（无缺键/无多键）', () => {
    const sourceKeys = [...UI_TEXT_KEYS].sort();
    expect(sourceKeys.length).toBeGreaterThan(100);
    for (const locale of LOCALES) {
      const keys = Object.keys(UI_TEXT[locale]).sort();
      expect(keys, `语种 ${locale} 缺键: ${sourceKeys.filter((k) => !keys.includes(k)).join(',')}`).toEqual(sourceKeys);
    }
  });

  it('isUiTextKey 对合法键/野键的判别', () => {
    expect(isUiTextKey('hud.hp')).toBe(true);
    expect(isUiTextKey('toast.not-a-key')).toBe(false);
  });
});

describe('uiText · 遗产 16 句逐字保真（multiLang.js:13-140）', () => {
  it('简中原文（multiLang.js:33-48）', () => {
    expect(UI_TEXT['zh-Hans']['legacy.gameRule']).toBe(
      '游戏规则：将所有箱子推到终点（旗子）即获胜。使用键盘上的方向键操控人物。',
    );
    expect(UI_TEXT['zh-Hans']['legacy.levelPassed']).toBe('你通过这关了!');
    expect(UI_TEXT['zh-Hans']['legacy.hotkeyFlash']).toBe('[F] 阴阳切换');
    expect(UI_TEXT['zh-Hans']['legacy.version']).toBe('伞兵推箱子 | 版本 0.3.8-阿尔法');
  });

  it('繁中原文（multiLang.js:51-66）', () => {
    expect(UI_TEXT['zh-Hant']['legacy.levelPassed']).toBe('你通過這關了!');
    expect(UI_TEXT['zh-Hant']['legacy.gameOver']).toBe('遊 戲 結 束');
  });

  it('英/日/俄/德/法抽检（含三处已登记修正：en 摘前缀、de 改 Stufe、ru 补译）', () => {
    expect(UI_TEXT.en['legacy.congratulations']).toBe(
      'Congratulations!!!!!!!!!!<br><br><br>Click any position to close this window.',
    );
    expect(UI_TEXT.en['legacy.level1']).toBe('Level 1'); // 原文「[E/T] Level 1」摘除热键前缀
    expect(UI_TEXT.ja['legacy.version']).toBe('パラトルーパーソコバン | バージョン 0.3.8-アルファ');
    expect(UI_TEXT.ru['legacy.gameOver']).toBe('ИГРА ЗАВЕРШЕНА');
    expect(UI_TEXT.ru['legacy.hotkeyReplay']).toBe('[Q] Заново'); // 原文「[Q] Replay」补译
    expect(UI_TEXT.de['legacy.levelPrefix']).toBe('Stufe '); // 原文「Niveau 」系法语串行，已修正
    expect(UI_TEXT.fr['legacy.hotkeyFlash']).toBe('[F] Commutateur Flash');
  });
});

describe('uiText · tUi 插值与回落', () => {
  it('{n} 占位符插值', () => {
    expect(tUi('zh-Hans', 'deck.ownedCount', { n: 3 })).toBe('持有 3 张');
    expect(tUi('en', 'combat.turn', { n: 7 })).toBe('Turn 7');
  });

  it('缺参时占位符原样保留（便于发现漏传）', () => {
    expect(tUi('zh-Hans', 'deck.ownedCount')).toBe('持有 {n} 张');
  });

  it('未知键三级回落到 key 字面量，绝不 undefined', () => {
    expect(tUi('ja', 'no.such.key' as UiTextKey)).toBe('no.such.key');
  });
});

describe('uiText · 展示工具', () => {
  it('stripBr 清洗遗产句中的 <br>（含大写与自闭合变体）', () => {
    expect(stripBr('a<br>b<BR>c<br/>d< br >e')).toBe('a\nb\nc\nd< br >e');
    expect(stripBr(UI_TEXT.en['legacy.congratulations']).split('\n')).toHaveLength(4);
  });

  it('formatPercent 概率公示格式（0.06 → 6%，0.2605 → 26.05%）', () => {
    expect(formatPercent(0.06)).toBe('6%');
    expect(formatPercent(0.2605)).toBe('26.05%');
    expect(formatPercent(0.3)).toBe('30%');
    expect(formatPercent(0.5)).toBe('50%');
  });
});

describe('uiText · 关卡名/副标题 i18n（F4）', () => {
  it('全部主线关卡七语种条目齐备，简中与 areas.ts 原文逐字一致', () => {
    for (const level of LEVELS) {
      const entry = LEVEL_TEXT[level.id as keyof typeof LEVEL_TEXT];
      expect(entry, `缺少关卡文案表条目：${level.id}`).toBeDefined();
      for (const locale of LOCALES) {
        expect(entry![locale]!.name, `${level.id} · ${locale} name`).toBeTruthy();
        expect(entry![locale]!.subtitle, `${level.id} · ${locale} subtitle`).toBeTruthy();
      }
      expect(entry!['zh-Hans']!.name).toBe(level.name);
      expect(entry!['zh-Hans']!.subtitle).toBe(level.subtitle);
    }
  });

  it('en 下关卡名/副标题不再是硬编码中文（HUD/选关/结算消费同一解析）', () => {
    const level = LEVELS[0]!;
    expect(level.name).toBe('初醒箱庭'); // 数据原文仍是中文唯一事实源
    expect(levelName('en', level)).toBe('First-Awaken Garden');
    expect(levelName('en', level)).not.toContain('箱庭');
    expect(levelSubtitle('en', level)).not.toBe(level.subtitle);
    expect(levelSubtitle('en', level)).not.toContain('主城·教学段');
  });

  it('未收录的 levelId（无尽程序层/坏档）回落关卡数据原文，绝不 undefined', () => {
    expect(levelName('ja', { id: 'level-ghost', name: '幻影层' })).toBe('幻影层');
    expect(levelSubtitle('de', { id: 'level-ghost', subtitle: '无主之地' })).toBe('无主之地');
    expect(levelName('zh-Hans', { id: '', name: '' })).toBe('');
  });
});
