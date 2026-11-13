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
  /** 本关 twist（新机制/看点一句话，面板置顶、文档独立段）；未列入 LEVEL_TWISTS 的关为 null */
  readonly twist: string | null;
  /** 法则门提示（本关入场需要的法则卡；无则为 null） */
  readonly gateHint: string | null;
  /** 预计算推法序列 */
  readonly pushes: readonly GuidePush[];
  /** 解法说明脚注 */
  readonly note: string;
}

const ARROWS: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };

/* ------------------------------ twist 文案表 ----------------------------- */
/**
 * 每关 twist（新机制/看点）——数据层唯一文字源：游戏内攻略面板与
 * docs/game-guide.html 共用本表（经 buildLevelGuide 输出），别处不得另写一份。
 * 未列入的关卡（程序生成/会话关）twist 为 null。
 * 注意两条与引擎字段联动的措辞（MECH-4 的 goalOrder/oneWay 机制行同源，
 * 由下方 GOAL_ORDER_PHRASE / ONE_WAY_PHRASE 锁定，验收①联动断言）：
 * - level-lb-10 的 twist 必含「旗位必须按序落座」（goalOrder）；
 * - level-lb-11 的 twist 必含「单向格仅允许箭头方向通过（箱子不受限）」（oneWay）。
 */
export const LEVEL_TWISTS: Readonly<Record<string, string>> = Object.freeze({
  'level-sb-01': '主城即教学关：走到主城中央的导航天使（网格 (8,6)）附近必遇她（剧情必发，不会受伤）；星愿祭坛在南侧开放地板，走近按 E 抽卡。',
  'level-sb-02': '对称回环箱庭：四箱四旗一一对位，回廊交错处推错一步就要绕整圈——先想好路线再出手。',
  'level-sb-03': '无外框开放雪原：七箱七旗散落十字轴线，没有墙可借力，走位顺序决定成败。',
  'level-sb-04': '原作 11 箱关的收编版：4 箱对 4 旗，保留直推/下推/双列攀爬四种路线形态；通关后星愿祭坛的法则箱格外明亮（4★ 档自开局即在池内，随时可抽）。',
  'level-lb-05': '立体教学关：旗位在 h1 台上（Δh≤1 可爬升），箱子也能推上台阶基座——落差即通路。',
  'level-lb-06': '双箱双龛对称练习：两箱互不挡路可分别规划；通关解锁「镜像拉箱」（Shift+方向 后退拉箱）。',
  'level-lb-07': '长廊双箱各登一阶：走廊狭窄无回旋，登阶顺序决定成败；通关解锁「位面通行」（F 键切阴阳）。',
  'level-lb-08': '箱落教学：守旗敌人蹲在 h2 环台井底，爬升上限出不来——唯一解法是把箱子推下环台压碎它。',
  'level-lb-09': '阴阳位面实战关：阴面墙皮之下藏着数段阳墙阴路捷径，两处浮空石板是切换锚点；F 键切换需「位面通行」（登阶长廊通关奖励）。',
  'level-lb-10': '顺序谜题：三箱三龛，旗位必须按序落座，推动顺序就是谜题本身；通关解锁「箱落引爆」。',
  'level-lb-11': '四箱归一列：大厅中央纵向四连星阶，单向格仅允许箭头方向通过（箱子不受限），可借单向门规划不可逆捷径。',
  'level-lb-12': '终局关：8 处尖刺苔藓漫上王座大厅与箱道，两名守卫可推上尖刺或被箱落清除；四方箱体归位中央 2×2 圣坛后，影流之主在等你。',
});

/** goalOrder（MECH-4）机制行的锚定措辞 —— 与 LEVEL_TWISTS['level-lb-10'] 同源 */
const GOAL_ORDER_PHRASE = '旗位必须按序落座';
/** oneWay（MECH-4）机制行的锚定措辞 —— 与 LEVEL_TWISTS['level-lb-11'] 同源 */
const ONE_WAY_PHRASE = '单向格仅允许箭头方向通过（箱子不受限）';

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
      twist: null,
      gateHint: null,
      pushes: [],
      note: '本关无预计算解法。',
    };
  }

  /* ------------------------------ 机制推导 ------------------------------ */
  const twist = LEVEL_TWISTS[levelId] ?? null;
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
  /* MECH-4 引擎扩展字段（goalOrder/oneWay，Level3D 可选字段）：字段在场即追加
   * 机制行，缺席零影响。文案以 LEVEL_TWISTS 为唯一文字源：twist 已含锚定措辞时
   * 不重复追加，避免面板/文档同句展示两遍。 */
  const twistAlreadySays = (phrase: string): boolean => twist !== null && twist.includes(phrase);
  if (level.goalOrder !== undefined && !twistAlreadySays(GOAL_ORDER_PHRASE)) {
    mechanics.push(`顺序谜题：${GOAL_ORDER_PHRASE}，推动顺序就是谜题本身`);
  }
  if (level.oneWay !== undefined && !twistAlreadySays(ONE_WAY_PHRASE)) {
    mechanics.push(`单向门：${ONE_WAY_PHRASE}`);
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
        `方向 ↑↓←→ 对应网格上/下/左/右；激活法则卡（羽箱/推程+1 等）会改变物理，路线可更短。` +
        `新玩法已在预计算解路中按引擎结算，照面板箭头推必落座。`;

  return {
    levelId,
    known: true,
    name: level.name,
    subtitle: level.subtitle,
    stars: { three: level.parSteps[0], two: level.parSteps[1] },
    rewardText,
    mechanics,
    twist,
    gateHint,
    pushes,
    note,
  };
}
