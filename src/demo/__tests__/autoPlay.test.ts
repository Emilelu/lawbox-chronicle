/**
 * 自动演示（autoplay）纯逻辑单测 —— URL 参数解析、演示角色、重试节拍（F2）、
 * 步数预算与主城巡游路线约束（N2）。
 */

import { describe, expect, it } from 'vitest';
import {
  DEMO_MAX_LEVEL_RESETS,
  DEMO_STALL_MS,
  DEMO_STEP_BUDGET_MARGIN,
  HUB_TOUR,
  demoPlayer,
  demoStepBudget,
  levelRetryPlan,
  readAutoPlayConfig,
} from '../autoPlay';

describe('autoplay —— 配置解析', () => {
  it('只有 autoplay=1 才启用', () => {
    expect(readAutoPlayConfig('?autoplay=1').enabled).toBe(true);
    expect(readAutoPlayConfig('?autoplay=0').enabled).toBe(false);
    expect(readAutoPlayConfig('?foo=1').enabled).toBe(false);
    expect(readAutoPlayConfig('').enabled).toBe(false);
  });

  it('速度夹在 0.5~5，非法值回退 1', () => {
    expect(readAutoPlayConfig('?autoplay=1&speed=3').speed).toBe(3);
    expect(readAutoPlayConfig('?autoplay=1&speed=99').speed).toBe(5);
    expect(readAutoPlayConfig('?autoplay=1&speed=0.1').speed).toBe(0.5);
    expect(readAutoPlayConfig('?autoplay=1&speed=abc').speed).toBe(1);
  });
});

describe('autoplay —— 演示角色', () => {
  it('满武器、高攻高血、武器已装备', () => {
    const p = demoPlayer();
    expect(p.weapons?.length ?? 0).toBeGreaterThan(0);
    expect(p.baseAttack).toBeGreaterThan(1000);
    expect(p.hp).toBe(p.maxHp);
    expect(p.weaponId).not.toBeNull();
  });
});

describe('autoplay —— 连败重试决策（F2：不无限重玩、不永久卡死）', () => {
  it('同一关重置次数未超上限 → 原地重试（边界：恰好等于上限仍重试）', () => {
    expect(levelRetryPlan(0, true)).toBe('reset');
    expect(levelRetryPlan(0, false)).toBe('reset');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS, true)).toBe('reset');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS, false)).toBe('reset');
  });

  it('超过重试上限且主线还有下一关 → 跳关恢复（演示继续推进）', () => {
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 1, true)).toBe('skip');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 10, true)).toBe('skip');
  });

  it('超过重试上限且没有下一关 → 有界放弃（而非无限循环）', () => {
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 1, false)).toBe('giveup');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 10, false)).toBe('giveup');
  });

  it('看门狗窗口为 60s（停滞重试节拍），重试上限为 4', () => {
    expect(DEMO_STALL_MS).toBe(60_000);
    expect(DEMO_MAX_LEVEL_RESETS).toBe(4);
  });
});

describe('autoplay —— 步数预算（N2：重试路径不得无限累计步数）', () => {
  it('预算 = 该关 2☆ 阈值（parSteps[1]）+ 余量', () => {
    // 初醒箱庭标定：3☆≤148，2☆≤222（src/data/levels/areas.ts）
    expect(demoStepBudget([148, 222])).toBe(222 + DEMO_STEP_BUDGET_MARGIN);
    expect(demoStepBudget([11, 17])).toBe(17 + DEMO_STEP_BUDGET_MARGIN);
  });

  it('无标定数据的关卡不设预算（不触发重置）', () => {
    expect(demoStepBudget(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('余量钉值为 30（改动需有实测依据，防「余量膨胀」把预算架空）', () => {
    expect(DEMO_STEP_BUDGET_MARGIN).toBe(30);
  });
});

describe('autoplay —— 主城巡游路线（N2：十站齐全 + 剧情顺序约束）', () => {
  /** 巡游站标签在路线中的下标 */
  const indexOf = (label: string): number => HUB_TOUR.findIndex((s) => s.label === label);

  it('十站齐全且无重复站名', () => {
    expect(HUB_TOUR.length).toBe(10);
    expect(new Set(HUB_TOUR.map((s) => s.label)).size).toBe(HUB_TOUR.length);
  });

  it('所有剧情点都被覆盖（天使①、三根羽毛、三只小怪、作者、BOSS、东侧彩蛋）', () => {
    const targets = HUB_TOUR.map((s) => `${s.target.x},${s.target.y}`);
    // 天使① = 世界(1,0)+STORY_GRID_OFFSET(7,6)；羽毛③④分别对应天使③④同位
    expect(targets.filter((t) => t === '8,6').length).toBe(2); // 天使① + 同格羽毛①
    expect(targets.filter((t) => t === '7,7').length).toBe(1); // 羽毛③
    expect(targets.filter((t) => t === '7,5').length).toBe(1); // 羽毛④
    expect(targets.filter((t) => t === '11,8').length).toBe(1); // 蔡徐坤
    expect(targets.filter((t) => t === '10,3').length).toBe(1); // 郭老师
    expect(targets.filter((t) => t === '3,2').length).toBe(1); // 冬泳怪鸽
    expect(targets.filter((t) => t === '4,10').length).toBe(1); // 作者谜题
    expect(targets.filter((t) => t === '2,11').length).toBe(1); // 影流之主 BOSS
    expect(targets.filter((t) => t === '14,10').length).toBe(1); // 东侧彩蛋
  });

  it('剧情顺序：羽毛/小怪在天使①后（requireFlag/unlessFlag 语义），作者在三小怪后（requireFlags），BOSS 在作者后', () => {
    const angel = indexOf('导航天使①');
    expect(angel).toBe(0); // 天使姐妹锁：遇到一位其余去世，必须最先
    for (const label of ['残留的羽毛·①', '残留的羽毛·③', '残留的羽毛·④']) {
      expect(indexOf(label)).toBeGreaterThan(angel);
    }
    const mobs = ['蔡徐坤', '郭老师', '冬泳怪鸽'].map(indexOf);
    const author = indexOf('作者谜题');
    for (const mob of mobs) expect(author).toBeGreaterThan(mob); // 作者前置：三只小怪全灭
    expect(indexOf('影流之主 BOSS')).toBeGreaterThan(author);
    expect(indexOf('东侧彩蛋·神秘法阵')).toBe(HUB_TOUR.length - 1); // 彩蛋收尾（送回主线）
  });

  it('与天使①同格的羽毛①带 reEnter（tile 触发只在落格瞬间评估，原地不触发）', () => {
    const feather1 = HUB_TOUR.find((s) => s.label === '残留的羽毛·①');
    expect(feather1).toBeDefined();
    expect(feather1?.target).toEqual({ x: 8, y: 6 });
    expect(feather1?.reEnter).toBe('down'); // 跨出到 (8,7) 再回踩
    // 其余各站到站即落格触发，不需要回踩
    for (const stop of HUB_TOUR) {
      if (stop.label !== '残留的羽毛·①') expect(stop.reEnter).toBeUndefined();
    }
  });

  it('东侧彩蛋保留界外推（edgePush right，触发 beyond 神秘法阵）', () => {
    const east = HUB_TOUR.find((s) => s.label === '东侧彩蛋·神秘法阵');
    expect(east).toBeDefined();
    expect(east?.edgePush).toBe('right');
  });
});
