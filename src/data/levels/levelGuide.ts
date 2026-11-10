/**
 * 关卡攻略数据 —— 每关的机制提示 + 预计算解法（推法）的展示模型。
 * ---------------------------------------------------------------------------
 * 数据来源：AREA_LEVELS（关卡定义）、PRECOMPUTED_SOLUTIONS（solver 离线解路）、
 * LAW_GATES（法则门）、CARDS（卡名）。
 * 游戏内攻略面板（src/view/ui/LevelGuidePanel.tsx）与 docs/game-guide.html
 * 共用本模块 —— 面板看的与文档看的是同一份攻略（单一真相）。
 */

import { AREA_LEVELS } from './areas';
import { PRECOMPUTED_SOLUTIONS } from './solutionSteps';
import { LAW_GATES } from '../../engine/story/triggers';
import { CARDS } from '../gacha';
import type { Dir } from '../../core/types';

export interface GuidePush {
  /** 第几推（1-based） */
  readonly index: number;
  /** 方向箭头（↑↓←→，对应网格上/下/左/右） */
  readonly arrow: string;
  /** 人读的推法描述 */
  readonly label: string;
  /** 该推是否使被推物坠落 */
  readonly isFall: boolean;
}

export interface LevelGuideData {
  readonly levelId: string;
  /** false = 程序生成/会话关卡（无固定攻略） */
  readonly known: boolean;
  readonly name: string;
  readonly subtitle: string;
  /** 3★ / 2★ 步数线 */
  readonly stars: { readonly three: number; readonly two: number };
  /** 通关奖励文本 */
  readonly rewardText: string;
  /** 机制提示行（按关卡数据推导） */
  readonly mechanics: readonly string[];
  /** 法则门提示（本关入场需要的法则卡；无则为 null） */
  readonly gateHint: string | null;
  /** 预计算推法序列 */
  readonly pushes: readonly GuidePush[];
  /** 解法说明脚注 */
  readonly note: string;
}

const ARROWS: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };

function cardName(cardId: string): string {
  return CARDS.find((c) => c.id === cardId)?.name ?? cardId;
}

/** 构建某关的攻略数据（纯函数；关卡数据或预计算解路更新后自动同步） */
export function buildLevelGuide(levelId: string): LevelGuideData {
  const level = AREA_LEVELS.find((l) => l.id === levelId);
  if (level === undefined) {
    return {
      levelId,
      known: false,
      name: '程序生成关卡',
      subtitle: '无尽回廊 / 挑战层（会话生成）',
      stars: { three: 0, two: 0 },
      rewardText: '按挑战层数结算星石',
      mechanics: ['本关为程序生成：布局随机，但生成时已由内置求解器校验可解，没有固定攻略——观察箱与旗的相对位置灵活推进即可。'],
      gateHint: null,
      pushes: [],
      note: '本关无预计算解法。',
    };
  }

  /* ------------------------------ 机制推导 ------------------------------ */
  let spikes = 0;
  let goals = 0;
  let chests = 0;
  for (const row of level.grid) {
    for (const cell of row) {
      if (cell === 5) spikes += 1;
      else if (cell === 3) goals += 1;
      else if (cell === 4) chests += 1;
    }
  }
  let maxHeight = 0;
  if (level.heights !== undefined) {
    for (const row of level.heights) {
      for (const h of row) maxHeight = Math.max(maxHeight, h);
    }
  }

  const mechanics: string[] = [`把 ${chests} 个箱子全部推上 ${goals} 处旗位基座（■）即通关`];
  if (spikes > 0) mechanics.push(`场上有 ${spikes} 处尖刺格：战斗布阵期可把敌人推进尖刺扣血`);
  if (maxHeight > 0) {
    mechanics.push(
      `立体高度层：最高海拔 ${maxHeight} 格——把箱子推下高台会坠落砸压下方目标${level.enemySpawns !== undefined && level.enemySpawns.length > 0 ? '（守旗敌人可这样清除）' : ''}；爬升有上限，落差才是通路`,
    );
  }
  if (level.enemySpawns !== undefined && level.enemySpawns.length > 0) {
    mechanics.push(`守卫 ${level.enemySpawns.length} 名：战斗布阵期可推挤（重量∝HP），谜题期可被箱落压碎`);
  }
  if (level.shadeGrid !== undefined) {
    mechanics.push('阴阳位面：按 F 切换表里世界（需「位面通行」法则卡解锁），阴面藏着另一套通路与浮空石板');
  }
  if (level.altarSpawns !== undefined && level.altarSpawns.length > 0) {
    mechanics.push('本关有星愿祭坛：走近按 E 打开抽卡');
  }
  if (mechanics.length === 1) mechanics.push('纯平面布局，专注最短推程即可');

  /* ------------------------------ 法则门 ------------------------------- */
  const gate = LAW_GATES.find((g) => g.levelId === levelId);
  const gateHint =
    gate === undefined
      ? null
      : `入场需持有法则卡「${gate.requiredCardIds.map(cardName).join('、')}」——缺卡会在入场时自动补发剧情，不会软锁`;

  /* ------------------------------ 奖励 --------------------------------- */
  const rewardText = `◈ ${level.reward.starStones}${level.reward.lawCardId !== undefined ? ` + 法则卡「${cardName(level.reward.lawCardId)}」` : ''}`;

  /* ------------------------------ 推法序列 ----------------------------- */
  const precomputed = PRECOMPUTED_SOLUTIONS[levelId];
  const pushes: GuidePush[] = (precomputed ?? []).map((p, i) => ({
    index: i + 1,
    arrow: ARROWS[p.dir] ?? p.dir,
    label: `把${p.kind === 'chest' ? '箱子' : '守卫'} (${p.from.x},${p.from.y}) 推到 (${p.to.x},${p.to.y})`,
    isFall: p.isFall,
  }));

  const note =
    precomputed === undefined
      ? '本关无预计算解法。'
      : `参考解法共 ${pushes.length} 推，由内置求解器求得并逐格回放验证，照做步数必在 3☆ 线内。` +
        `方向 ↑↓←→ 对应网格上/下/左/右；激活法则卡（羽箱/推程+1 等）会改变物理，路线可更短。`;

  return {
    levelId,
    known: true,
    name: level.name,
    subtitle: level.subtitle,
    stars: { three: level.parSteps[0], two: level.parSteps[1] },
    rewardText,
    mechanics,
    gateHint,
    pushes,
    note,
  };
}
