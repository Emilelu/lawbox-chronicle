/**
 * BossTitleOverlay 纯逻辑单测（R3）。
 * ---------------------------------------------------------------------------
 * titleCharsOf：刻字字符拆分契约 —— 剧情 fx（bossActs.ts:121 '影 流 之 主'，
 * 带空格）与 launchBattle（enemy.name '影流之主'，无空格）两条发布源的标题
 * 都能拆成同一组逐字刻字；空白剔除后字距归布局层 letter-spacing 负责。
 * BOSS_TITLE_SECONDS：与 CameraRig 的 BOSS_ORBIT_SECONDS（theme.ts:547 = 2.6s
 * 轨道运镜）同期对齐，刻字与运镜一场结束。
 */

import { describe, expect, it } from 'vitest';
import { BOSS_TITLE_SECONDS, BOSS_TITLE_STAGGER, titleCharsOf } from '../BossTitleOverlay';

describe('titleCharsOf · 刻字字符拆分（纯函数）', () => {
  it('剧情 fx 数据契约：带空格刻字 → 剔空白逐字展开', () => {
    expect(titleCharsOf('影 流 之 主')).toEqual(['影', '流', '之', '主']);
  });

  it('launchBattle 发布源：enemy.name 无空格 → 同一组字符', () => {
    expect(titleCharsOf('影流之主')).toEqual(['影', '流', '之', '主']);
  });

  it('制表符/换行等空白一律剔除（防御性，两条发布源都不会携带）', () => {
    expect(titleCharsOf('影\t流\n之  主')).toEqual(['影', '流', '之', '主']);
  });

  it('空标题 → 空数组（组件侧 AnimatePresence 不渲染任何字）', () => {
    expect(titleCharsOf('')).toEqual([]);
    expect(titleCharsOf('   ')).toEqual([]);
  });
});

describe('BossTitleOverlay · 演出时长契约', () => {
  it('刻字展示 2.6s，与 CameraRig 的 BOSS_ORBIT_SECONDS 轨道运镜同期', () => {
    expect(BOSS_TITLE_SECONDS).toBe(2.6);
  });

  it('逐字入场节奏为正数（staggerChildren 可用）', () => {
    expect(BOSS_TITLE_STAGGER).toBeGreaterThan(0);
  });
});
