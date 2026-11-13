/**
 * 席卷界面层 · LevelGuidePanel 标题关卡名键控回归测试。
 * ---------------------------------------------------------------------------
 * 标题此前直接渲染 buildLevelGuide 返回的 guide.name（数据层中文原文），
 * 非 zh 语种下出现「💡 Guide · 初醒箱庭」。修复后走 uiText.levelName 覆写表
 * （与选关面板 levelNameI18n 同款）：收录的 levelId 按语种取名，未收录的
 * levelId（如程序生成层）回落 guide.name 原文。渲染方式与 archivePanel.test.ts
 * 同款（react-dom createRoot + act，仓库未引入 @testing-library）；本文件是
 * .ts，用 createElement 代替 JSX。
 */

import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGameStore } from '../../../core/store/gameStore';
import { tUi } from '../../../data/i18n/uiText';
import { LevelGuidePanel, useGuidePanelStore } from '../LevelGuidePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 挂载攻略面板并打开指定关卡，返回标题 h3 文本 */
function openGuideTitle(levelId: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  try {
    act(() => {
      root.render(createElement(LevelGuidePanel));
    });
    act(() => {
      useGuidePanelStore.getState().openFor(levelId);
    });
    const title = host.querySelector('h3')?.textContent ?? '';
    expect(title).not.toBe('');
    return title;
  } finally {
    act(() => root.unmount());
    host.remove();
    useGuidePanelStore.getState().close();
  }
}

describe('LevelGuidePanel 标题关卡名键控（R-5 回归防线）', () => {
  it('zh-Hans：标题为「💡 攻略 · 初醒箱庭」（键控不改变中文原貌）', () => {
    expect(openGuideTitle('level-sb-01')).toBe(`${tUi('zh-Hans', 'guide.entry')} · 初醒箱庭`);
  });

  it('en：标题随 LEVEL_TEXT 覆写为英文名，中文关名原文不再出现（仅切语言并还原）', () => {
    act(() => {
      useGameStore.getState().setLocale('en');
    });
    try {
      expect(openGuideTitle('level-sb-01')).toBe(`${tUi('en', 'guide.entry')} · First-Awaken Garden`);
      expect(openGuideTitle('level-sb-01')).not.toContain('初醒箱庭');
    } finally {
      useGameStore.getState().setLocale('zh-Hans');
    }
  });

  it('未收录 levelId：levelName 回落 guide.name 原文（程序生成关卡语义不变）', () => {
    expect(openGuideTitle('level-unknown-procedural')).toBe(
      `${tUi('zh-Hans', 'guide.entry')} · 程序生成关卡`,
    );
  });
});
