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

describe('uiText · A4-5 收尾新增键（archive.nostalgiaStar / archive.nostalgiaNote / guide.starSteps）', () => {
  it('七语种插值齐备，无占位符残留', () => {
    for (const locale of LOCALES) {
      expect(tUi(locale, 'archive.nostalgiaStar', { n: 4 })).not.toContain('{');
      expect(tUi(locale, 'archive.nostalgiaNote', { source: 'Lottery.java:40' })).not.toContain('{');
      expect(tUi(locale, 'guide.starSteps', { stars: '★★★', n: 12 })).not.toContain('{');
    }
  });

  it('zh-Hans 逐字保真（与修复前视图硬编码原文一致）', () => {
    expect(tUi('zh-Hans', 'archive.nostalgiaStar', { n: 4 })).toBe('怀旧展品·4★');
    expect(tUi('zh-Hans', 'archive.nostalgiaStar', { n: 2 })).toBe('怀旧展品·2★');
    expect(tUi('zh-Hans', 'archive.nostalgiaNote', { source: 'Lottery.java:40' })).toBe(
      '这是原作 Lottery.java:40 行为的对照展品，仅供概率对照。',
    );
    expect(tUi('zh-Hans', 'guide.starSteps', { stars: '★★★', n: 12 })).toBe('★★★ ≤ 12 步');
    expect(tUi('zh-Hans', 'guide.starSteps', { stars: '★★', n: 20 })).toBe('★★ ≤ 20 步');
  });

  it('en 下不再是中文（N-1/A4-5：视图层中文残留收尾）', () => {
    expect(tUi('en', 'archive.nostalgiaStar', { n: 3 })).toBe('Nostalgia exhibit · 3★');
    expect(tUi('en', 'archive.nostalgiaNote', { source: 'Lottery.java:40' })).not.toMatch(/[\u4e00-\u9fff]/);
    expect(tUi('en', 'guide.starSteps', { stars: '★★', n: 9 })).not.toMatch(/[\u4e00-\u9fff]/);
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

describe('uiText · tUi 对白名单外 locale 的防御性回落（R-4 双保险）', () => {
  it('locale 绕过 store 直达渲染树时（如手改 zh）回落简中，绝不 TypeError', () => {
    // 修复前：UI_TEXT['zh'] 为 undefined，[key] 上直接 TypeError 崩渲染树
    expect(tUi('zh' as never, 'hud.hp')).toBe('生命');
    expect(tUi('zh' as never, 'toast.trueEnding')).toBe('真结局达成：拒绝剧本的人。');
    expect(() => tUi(undefined as never, 'hud.hp')).not.toThrow();
    expect(tUi(undefined as never, 'hud.hp')).toBe('生命');
    // 合法 locale 行为不受影响
    expect(tUi('en', 'hud.hp')).toBe('HP');
  });
});

describe('uiText · 成就/池名/公示行键控（R-6，7 语种对齐）', () => {
  it('成就 13 条的 titleKey/descriptionKey 全部为合法 uiText 键且七语种齐备', async () => {
    const { ACHIEVEMENTS } = await import('../../lore/achievements');
    expect(ACHIEVEMENTS).toHaveLength(13);
    for (const def of ACHIEVEMENTS) {
      expect(isUiTextKey(def.titleKey), `${def.id} titleKey 非法：${def.titleKey}`).toBe(true);
      expect(isUiTextKey(def.descriptionKey), `${def.id} descriptionKey 非法：${def.descriptionKey}`).toBe(true);
      for (const locale of LOCALES) {
        expect(UI_TEXT[locale][def.titleKey], `${def.id} · ${locale} title 缺失`).toBeTruthy();
        expect(UI_TEXT[locale][def.descriptionKey], `${def.id} · ${locale} desc 缺失`).toBeTruthy();
      }
      // 简中键文本与数据事实源逐字一致（内容语言唯一事实源纪律）
      expect(UI_TEXT['zh-Hans'][def.titleKey]).toBe(def.title);
      expect(UI_TEXT['zh-Hans'][def.descriptionKey]).toBe(def.description);
    }
  });

  it('en 下成就标题/描述不再是整句中文（专有名词保留中文属内容语言决策）', async () => {
    const { ACHIEVEMENTS } = await import('../../lore/achievements');
    // 原作英文原句两条（cheat-setname / kirakira-first4）逐语种保留英文原文，
    // title 相同属预期；其余 title 与全部 desc 都按语种本地化。
    const verbatimEnglishTitles = new Set(['ach-cheat-setname', 'ach-kirakira-first4']);
    for (const def of ACHIEVEMENTS) {
      if (!verbatimEnglishTitles.has(def.id)) {
        expect(tUi('en', def.titleKey)).not.toBe(def.title);
      }
      expect(tUi('en', def.descriptionKey)).not.toBe(def.description);
    }
    // 两条原作英文原句照旧逐字
    const setname = ACHIEVEMENTS.find((d) => d.id === 'ach-cheat-setname');
    const kirakira = ACHIEVEMENTS.find((d) => d.id === 'ach-kirakira-first4');
    expect(tUi('en', setname!.titleKey)).toBe(setname!.title);
    expect(tUi('en', kirakira!.titleKey)).toBe(kirakira!.title);
  });

  it('怀旧池名与概率公示行键控：7 语种齐备且行数与 lines 一致', async () => {
    const { NOSTALGIA_POOL_INFO, RATE_DISCLOSURE } = await import('../../gacha/pools');
    expect(isUiTextKey(NOSTALGIA_POOL_INFO.nameKey)).toBe(true);
    for (const locale of LOCALES) {
      expect(UI_TEXT[locale][NOSTALGIA_POOL_INFO.nameKey]).toBeTruthy();
    }
    const { lineKeys, lines } = RATE_DISCLOSURE.nostalgia;
    expect(lineKeys).toHaveLength(lines.length);
    for (const key of lineKeys) {
      expect(isUiTextKey(key), `公示行键非法：${key}`).toBe(true);
      for (const locale of LOCALES) expect(UI_TEXT[locale][key]).toBeTruthy();
    }
    // 简中键文本与数据事实源逐字一致
    expect(UI_TEXT['zh-Hans'][NOSTALGIA_POOL_INFO.nameKey]).toBe(NOSTALGIA_POOL_INFO.name);
    lineKeys.forEach((key, i) => expect(UI_TEXT['zh-Hans'][key]).toBe(lines[i]));
  });

  it('en 下怀旧池名与公示行不再直显中文整句', async () => {
    const { NOSTALGIA_POOL_INFO, RATE_DISCLOSURE } = await import('../../gacha/pools');
    expect(tUi('en', NOSTALGIA_POOL_INFO.nameKey)).toBe('Nostalgia Simulated Pool');
    for (const key of RATE_DISCLOSURE.nostalgia.lineKeys) {
      expect(tUi('en', key)).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});

describe('uiText · 怀旧对照 toast 键控（R-7）', () => {
  it('toast.nostalgiaRound 七语种齐备，占位符 {n}/{four}/{three} 全语种插值无残留', () => {
    for (const locale of LOCALES) {
      const text = tUi(locale, 'toast.nostalgiaRound', { n: 3, four: 1, three: 4 });
      expect(text).not.toContain('{');
      expect(text).toContain('3');
      expect(text).toContain('1');
      expect(text).toContain('4');
    }
  });

  it('zh-Hans 与既有中文整句口径一致；en 下不再是中文句', () => {
    expect(tUi('zh-Hans', 'toast.nostalgiaRound', { n: 1, four: 0, three: 1 })).toBe(
      '怀旧对照第 1 回：4★×0 3★×1（原版复刻，不产出可用卡；实测曲线已更新）。',
    );
    expect(tUi('en', 'toast.nostalgiaRound', { n: 2, four: 2, three: 0 })).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
