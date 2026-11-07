/**
 * 隐藏关「EasterEgg」完整剧本 + META 终端（真结局剧本侧）。
 * ---------------------------------------------------------------------------
 * 源自 EasterEgg.java:71-341（自诩 abandoned 的前作，被越界传送进去）：
 *   - 开幕雷击 /kill--SetName（:83）、/kill--Caixukun（:104）、移动岔路
 *     w→w→s→s（:117-141）、石柱 adad（:163）、对天大喊 BABA（:170）、
 *     BOSS 战 /give--@p--赤手空拳|爷爷的拐杖|㊙Hotel（:191-209）；
 *   - Base64 提示（:188）VXNlJTIw...= → "Use some instructions to save you."；
 *   - Horrible Atmosphere 演出（:216-262）：胜利后 BGM 骤停、逐句逼近的
 *     「但是，你所在的游戏，真的是你一开始要玩的游戏...吗？」；
 *   - 原版结局（:274-281）：任意输入 → 被乱码 %^%&62*^*&^@&* 杀死 → END。
 *
 * 反转（新设计）：「胜利后乱码杀死」改为真结局入口 —— 在乱码显形的瞬间，
 * 用原作教过的指令语法反过来 /kill--%^%&62*^*&^@&*，剧本碎裂，达成真结局
 * 「拒绝剧本的人」。未输入指令 → 伪结局（原版 END 演出，closable，可再战）。
 *
 * K13 实测：原版「[System] weaponList has been cleared.」是谎报 ——
 * 清空调用被注释（EasterEgg.java:183 REMOVE BY BOSS），背包从未真清。
 * 本剧本真实结算 clearFlagsWithPrefix('hg:weapon')，然后 /give 三把
 * 「命运武装」仍可凭记忆呼出（它们不在背包里，在剧本里）。
 *
 * K15 结构保证：所有岔路都是显式节点边（含全部死亡分支），
 * 不存在「顺序穿透」路径；所有死亡都是 closable 终局，绝不 System.exit。
 */

import type {
  PuzzleSolver,
  PuzzleSolveContext,
  PuzzleSolveResult,
  StoryEffect,
  StoryScriptDef,
} from '../../engine/story/interpreter';

/* ============================== 说话者表 ================================== */

export const HIDDEN_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'system': '【系统】',
  'narration': '旁白',
  'meta': '[META]',
  'npc-hg-cxk': '蔡徐坤',
  'npc-hg-dygg': '冬泳怪鸽',
  'npc-hg-gls': '迷人的郭老师',
  'npc-hg-boss': '影 流 之 主',
  'npc-garbage': '%^%&62*^*&^@&*',
});

/* ============================== 原作数值保真 =============================== */

/** EasterEgg.java:23-26 缺省主角 */
export const HIDDEN_DEFAULT_PLAYER_NAME = '狗蛋';
export const HIDDEN_PLAYER_HP = 10;
export const HIDDEN_PLAYER_ATTACK = 2;
/** EasterEgg.java:48-65 怪物血量与 BOSS 血量（Integer.MAX_VALUE 原值） */
export const HIDDEN_BOSS_HP = 2147483647;
/** EasterEgg.java:279 的乱码（反转后的「最终敌人」） */
export const GARBAGE_KILLER = '%^%&62*^*&^@&*';

/** EasterEgg.java:188 的 Base64 提示原文 */
export const HIDDEN_BASE64_HINT = 'VXNlJTIwc29tZSUyMGluc3RydWN0aW9ucyUyMHRvJTIwc2F2ZSUyMHlvdS4=';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 纯函数 Base64 解码（不依赖 atob/Buffer，浏览器与 vitest 环境通吃） */
export function decodeBase64Utf8(input: string): string {
  const clean = input.replace(/\s/g, '').replace(/=+$/, '');
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B64_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** 解开原作提示：→ "Use some instructions to save you." */
export function decodeHiddenHint(): string {
  return decodeURIComponent(decodeBase64Utf8(HIDDEN_BASE64_HINT));
}

/* ============================== 通用求解器 ================================= */

/* --- 作弊码门求解器工厂：命中 → ok；未命中 → fatal 死亡分支（原作规则） --- */
interface CodeGateOptions {
  /** 归一化后必须全等命中的指令集合 */
  readonly accept: readonly string[];
  /** 命中后写入的 flag/效果 */
  readonly effects?: readonly StoryEffect[];
  /** 多出口覆盖（命运武装三选一） */
  readonly successNext?: (normalized: string) => string | undefined;
  /** 未命中时跳转的死亡节点由节点 failNext 承担；echo 为死前播报 */
  readonly failEcho: string;
}

function makeCodeGateSolver(opts: CodeGateOptions): PuzzleSolver {
  return (raw: string, _ctx: PuzzleSolveContext): PuzzleSolveResult => {
    const normalized = raw.trim();
    const hit = opts.accept.find((cmd) => cmd === normalized);
    if (hit === undefined) {
      return { ok: false, fatal: true, echo: opts.failEcho };
    }
    const override = opts.successNext?.(normalized);
    return {
      ok: true,
      effects: opts.effects,
      ...(override !== undefined ? { successNext: override } : {}),
    };
  };
}

/* --- 各输入门（期望值全部来自 EasterEgg.java 原文） --- */

/** :83 开幕雷击 /kill--SetName */
export const HG_SOLVER_SETNAME: PuzzleSolver = makeCodeGateSolver({
  accept: ['/kill--SetName'],
  failEcho: '石头落下的速度，比命名仪式更快。',
});

/** :104 /kill--Caixukun 由 choice 节点承担；此处仅移动/呼喊门 */
export const HG_SOLVER_GO_W: PuzzleSolver = makeCodeGateSolver({
  accept: ['w'],
  failEcho: '你失足摔下悬崖，死。',
});

export const HG_SOLVER_GO_S: PuzzleSolver = makeCodeGateSolver({
  accept: ['s'],
  failEcho: '你迈出了错误的一步。',
});

/** :163 石柱阵 adad */
export const HG_SOLVER_ADAD: PuzzleSolver = makeCodeGateSolver({
  accept: ['adad', 'ADAD'],
  failEcho: '石柱在你踩上去的一瞬间分崩离析，你坠入了深渊。',
});

/** :170 对天大喊 BABA（严格大小写，原作 equals("BABA")） */
export const HG_SOLVER_BABA: PuzzleSolver = makeCodeGateSolver({
  accept: ['BABA'],
  failEcho: '你似乎是激怒了什么，你被碎尸万段。',
});

/** :191-209 BOSS 三把命运武装（真实清空后仍可呼出 —— 它们在剧本里） */
export const HG_SOLVER_GIVE: PuzzleSolver = makeCodeGateSolver({
  accept: ['/give--@p--赤手空拳', '/give--@p--爷爷的拐杖', '/give--@p--㊙Hotel'],
  failEcho: '你犹豫不决，被毁尸灭迹。',
  successNext: (cmd) => {
    if (cmd === '/give--@p--赤手空拳') return 'hg-win-fist';
    if (cmd === '/give--@p--爷爷的拐杖') return 'hg-win-gfs';
    return 'hg-win-hotel';
  },
});

/** :274-281 反转点：杀死乱码 = 真结局；其余输入 = 伪结局（原版 END） */
export const HG_SOLVER_FINAL: PuzzleSolver = (
  raw: string,
  _ctx: PuzzleSolveContext,
): PuzzleSolveResult => {
  const normalized = raw.trim();
  if (normalized === `/kill--${GARBAGE_KILLER}`) {
    return {
      ok: true,
      effects: [{ kind: 'setFlag', key: 'meta:garbage-killed', value: true }],
    };
  }
  return {
    ok: false,
    fatal: true,
    echo: `你正打算前进的时候，被 ${GARBAGE_KILLER} 杀死了。`,
  };
};

/** 隐藏关求解器注册表（集成期与 authorPuzzle 一并注入 env.solvers） */
export const HIDDEN_GAME_SOLVERS: Readonly<Record<string, PuzzleSolver>> = Object.freeze({
  'hg-puzzle-setname': HG_SOLVER_SETNAME,
  'hg-puzzle-go-w': HG_SOLVER_GO_W,
  'hg-puzzle-go-s': HG_SOLVER_GO_S,
  'hg-puzzle-adad': HG_SOLVER_ADAD,
  'hg-puzzle-baba': HG_SOLVER_BABA,
  'hg-puzzle-give': HG_SOLVER_GIVE,
  'hg-puzzle-final': HG_SOLVER_FINAL,
});

/* ============================== 主剧本 ==================================== */

export const HIDDEN_GAME_SCRIPT: StoryScriptDef = {
  id: 'script-hidden-game',
  title: 'EasterEgg —— 被遗弃的前作',
  entryNodeId: 'hg-entry',
  nodes: [
    /* ---------- 开幕（EasterEgg.java:75-78） ---------- */
    {
      kind: 'dialogue',
      id: 'hg-entry',
      fx: [{ fx: 'sfx', sfxId: 'sfx-effect-5' }],
      lines: [
        { speakerId: 'system', text: 'This game is abandoned. But you was teleported to here by SOME UNKNOWN REASONS.' },
        { speakerId: 'narration', text: '在遥远的鬼畜大陆，每一个鬼畜素材对象都在这里快乐的生活着。' },
        { speakerId: 'narration', text: '但是有一天，谜之森林外出现了令人叹为观止的一幕——天空正在逐渐被黑暗所侵蚀着！' },
        { speakerId: 'narration', text: '就在这时，有一名年轻勇敢的冒险家，他决定只身一人，拯救鬼畜大陆，他的名字叫——' },
      ],
      next: 'hg-setname',
    },
    {
      kind: 'puzzle',
      id: 'hg-setname',
      puzzleId: 'hg-puzzle-setname',
      promptLines: [
        { speakerId: 'system', text: '请输入你的名字：' },
        { speakerId: 'meta', text: '（原作提示：名字栏里也可以输入别的「东西」。）' },
      ],
      successNext: 'hg-setname-ok',
      failNext: 'hg-die-stone',
    },
    {
      kind: 'ending',
      id: 'hg-die-stone',
      endingId: 'hidden-name-stone',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '他的名字没能被记住——不幸的是，他刚迈出谜之森林冒险的第一步时，就被天上掉下来的石头砸死了。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭；提示：名字栏里，原作只认一个「指令」。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-setname-ok',
      lines: [
        { speakerId: 'system', text: "Module 'SetName' is Skipped." },
        { speakerId: 'system', text: '[警告] 由于玩家名未定义，因此将使用缺省值：狗蛋' },
        { speakerId: 'narration', text: `狗蛋 踏上了去谜之森林冒险的旅途，刚进到森林里，他就遇到了第一个怪物 蔡徐坤，它的血量是 5。` },
        { speakerId: 'system', text: `你当前的血量是 ${HIDDEN_PLAYER_HP}` },
        { speakerId: 'system', text: '请选择武器：1.赤手空拳' },
      ],
      next: 'hg-cxk',
    },
    /* ---------- 第一个岔路：攻击 or 指令（EasterEgg.java:97-104） ---------- */
    {
      kind: 'choice',
      id: 'hg-cxk',
      promptLines: [{ speakerId: 'narration', text: '怎么对付它？' }],
      choices: [
        { id: 'attack', label: '1.攻击', next: 'hg-die-cxk-attack' },
        { id: 'syskill', label: '/kill--Caixukun（对系统喊出指令）', next: 'hg-cxk-killed' },
      ],
      defaultNext: 'hg-die-cxk-hesitate',
    },
    {
      kind: 'ending',
      id: 'hg-die-cxk-attack',
      endingId: 'hidden-cxk-attack',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '狗蛋 用尽全力发起了攻击——然后被 蔡徐坤 秒杀了。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭；练习时长两年半的你，应该换个选项。）' },
      ],
    },
    {
      kind: 'ending',
      id: 'hg-die-cxk-hesitate',
      endingId: 'hidden-cxk-hesitate',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '狗蛋 犹豫不决，被 蔡徐坤 秒杀了，享年 17 岁。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-cxk-killed',
      onEnterEffects: [
        { kind: 'setFlag', key: 'hg:weapon:gfs', value: true },
        { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-12' } },
      ],
      lines: [
        { speakerId: 'npc-hg-cxk', text: '（被 System 杀死了！）' },
        { speakerId: 'system', text: '蔡徐坤 掉落了 爷爷的拐杖x1，描述：爷爷祖传下来的拐杖！可以击退敌人 2 格，可以让攻击力提升 233！' },
        { speakerId: 'narration', text: '你把它添加到了背包，继续往前走。' },
        { speakerId: 'narration', text: '你在地上发现了一张满是灰尘的纸条，要打开吗？(y/n)' },
      ],
      next: 'hg-note',
    },
    /* ---------- 纸条（:111-116） ---------- */
    {
      kind: 'choice',
      id: 'hg-note',
      promptLines: [{ speakerId: 'narration', text: '要打开吗？' }],
      choices: [
        { id: 'open', label: 'y.打开纸条', next: 'hg-note-open' },
        { id: 'ignore', label: 'n.无视它', next: 'hg-die-blood' },
      ],
      defaultNext: 'hg-die-blood',
    },
    {
      kind: 'ending',
      id: 'hg-die-blood',
      endingId: 'hidden-note-ignored',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '你无视了它，继续前进，但转眼间，你的眼前血红一片，之后再也没有醒来。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-note-open',
      lines: [
        { speakerId: 'narration', text: '“勇敢的冒险者啊，若想抵达胜利，牢记以下秘籍：↓↓↑↑→←→←ABAB(Reversed)”' },
        { speakerId: 'narration', text: '你把它刻进了DNA里，继续向前走，接下来该怎么走呢？(上w、下s、左a、右d)' },
      ],
      next: 'hg-go1',
    },
    /* ---------- 移动岔路链（:117-141） ---------- */
    {
      kind: 'puzzle',
      id: 'hg-go1',
      puzzleId: 'hg-puzzle-go-w',
      promptLines: [{ speakerId: 'system', text: '（输入 w / s / a / d）' }],
      successNext: 'hg-dygg-intro',
      failNext: 'hg-die-cliff',
    },
    {
      kind: 'ending',
      id: 'hg-die-cliff',
      endingId: 'hidden-cliff',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '你失足摔下悬崖，死。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-dygg-intro',
      lines: [
        { speakerId: 'system', text: '你遇到了一个怪物！它是 冬泳怪鸽，血量是 233' },
        { speakerId: 'system', text: `你当前的血量是 ${HIDDEN_PLAYER_HP}` },
        { speakerId: 'system', text: '请选择武器：1.赤手空拳 2.爷爷的拐杖' },
      ],
      next: 'hg-dygg-choice',
    },
    {
      kind: 'choice',
      id: 'hg-dygg-choice',
      promptLines: [{ speakerId: 'narration', text: '怎么出招？' }],
      choices: [
        { id: 'first-strike', label: '2.让 DYGG 先发制人', next: 'hg-dygg-win' },
      ],
      defaultNext: 'hg-die-dygg-trade',
    },
    {
      kind: 'ending',
      id: 'hg-die-dygg-trade',
      endingId: 'hidden-dygg-trade',
      closable: true,
      lines: [
        { speakerId: 'narration', text: `你对 冬泳怪鸽 造成了 ${HIDDEN_PLAYER_ATTACK} 点伤害！` },
        { speakerId: 'narration', text: `冬泳怪鸽 对你造成了 ${HIDDEN_PLAYER_HP} 点伤害！` },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭；有时候，让对面先出手才是活路。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-dygg-win',
      lines: [
        { speakerId: 'npc-hg-dygg', text: '先发制人！你受到了 3 点伤害！我们遇到什么困难也不要怕，微笑着面对它！' },
        { speakerId: 'narration', text: `你对 冬泳怪鸽 造成了 ${HIDDEN_PLAYER_ATTACK} 点伤害！` },
        { speakerId: 'narration', text: '冬泳怪鸽 被击飞了！掉下悬崖前喊了一声 奥利给！！！然后摔死了！' },
        { speakerId: 'system', text: '本次战斗没有掉落任何物品，接下来该怎么走呢？' },
      ],
      next: 'hg-go2',
    },
    {
      kind: 'puzzle',
      id: 'hg-go2',
      puzzleId: 'hg-puzzle-go-w',
      promptLines: [{ speakerId: 'system', text: '（输入 w / s / a / d）' }],
      successNext: 'hg-fog',
      failNext: 'hg-die-ash',
    },
    {
      kind: 'ending',
      id: 'hg-die-ash',
      endingId: 'hidden-ash',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '天空一声巨响，你的骨灰被扬。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-fog',
      lines: [{ speakerId: 'narration', text: '随着进一步深入，可见度越来越低，接下来该怎么走？' }],
      next: 'hg-go3',
    },
    {
      kind: 'puzzle',
      id: 'hg-go3',
      puzzleId: 'hg-puzzle-go-s',
      promptLines: [{ speakerId: 'system', text: '（输入 w / s / a / d）' }],
      successNext: 'hg-dread',
      failNext: 'hg-die-fire',
    },
    {
      kind: 'ending',
      id: 'hg-die-fire',
      endingId: 'hidden-fire',
      closable: true,
      lines: [
        { speakerId: 'narration', text: 'FIRE EVERYWHERE!' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-dread',
      lines: [{ speakerId: 'narration', text: '你感到情况越来越不对劲，接下来怎么走？' }],
      next: 'hg-go4',
    },
    {
      kind: 'puzzle',
      id: 'hg-go4',
      puzzleId: 'hg-puzzle-go-s',
      promptLines: [{ speakerId: 'system', text: '（输入 w / s / a / d）' }],
      successNext: 'hg-guolaoshi-intro',
      failNext: 'hg-die-dark',
    },
    {
      kind: 'ending',
      id: 'hg-die-dark',
      endingId: 'hidden-dark',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '过了不知道多久，鬼畜大陆的人们仍然没有见到那位勇敢的冒险家凯旋。' },
        { speakerId: 'narration', text: '鬼畜大陆被黑暗完全吞噬了。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    /* ---------- 郭老师与天降闪电（:142-159） ---------- */
    {
      kind: 'dialogue',
      id: 'hg-guolaoshi-intro',
      lines: [
        { speakerId: 'system', text: '你遇到了一个怪物！它是 迷人的郭老师，血量是 666' },
        { speakerId: 'system', text: '你当前的血量是 7' },
        { speakerId: 'npc-hg-gls', text: '我现在就杀了你！啊，还没杀呢，还没呢~' },
        { speakerId: 'system', text: '请选择武器：1.赤手空拳 2.爷爷的拐杖' },
      ],
      next: 'hg-gls-choice',
    },
    {
      kind: 'choice',
      id: 'hg-gls-choice',
      promptLines: [{ speakerId: 'narration', text: '怎么出招？' }],
      choices: [{ id: 'swing', label: '2.用爷爷的拐杖挥向它', next: 'hg-gls-win' }],
      defaultNext: 'hg-die-scream',
    },
    {
      kind: 'ending',
      id: 'hg-die-scream',
      endingId: 'hidden-scream',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '随着 迷人的郭老师 的一声尖叫，惊天动地。你瞬间化为缕缕骨灰，向远方飘去。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-gls-win',
      onEnterEffects: [
        { kind: 'setFlag', key: 'hg:weapon:hotel', value: true },
        { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-12' } },
      ],
      lines: [
        { speakerId: 'narration', text: '你拿着 爷爷的拐杖 向它挥去，击飞 3 米，造成 5 点伤害。' },
        { speakerId: 'narration', text: '可是这并没有什么效果，它被激怒了，向你冲了过来——' },
        { speakerId: 'narration', text: '难道我就要死在这了吗！！！！！！！！！！！！！' },
        { speakerId: 'narration', text: '就在此时，它被一道闪电击中，随后灰飞烟灭。' },
        { speakerId: 'narration', text: '？？？？？？？？？' },
        { speakerId: 'npc-hg-gls', text: '（被 Lightning 杀死了！）' },
        { speakerId: 'system', text: '迷人的郭老师 掉落了 ㊙Hotel x1，描述：一个外观酷似猕猴桃的武器？可以使方圆 ?? 米内产生爆炸，并对敌人造成 ?? 点伤害。' },
        { speakerId: 'narration', text: '这令你感到十分不可思议，但你还是把它添加到了背包，继续往前走。' },
      ],
      next: 'hg-pillars',
    },
    /* ---------- 石柱 adad 与宝箱 BABA（:160-172） ---------- */
    {
      kind: 'dialogue',
      id: 'hg-pillars',
      lines: [
        { speakerId: 'narration', text: '前面是一个个方向不同的石柱，下面是深不见底的悬崖，对面才是接下来的路！接下来该怎么走？' },
      ],
      next: 'hg-go5',
    },
    {
      kind: 'puzzle',
      id: 'hg-go5',
      puzzleId: 'hg-puzzle-adad',
      promptLines: [{ speakerId: 'system', text: '（输入你的走法，可连续）' }],
      successNext: 'hg-mound',
      failNext: 'hg-die-abyss',
    },
    {
      kind: 'ending',
      id: 'hg-die-abyss',
      endingId: 'hidden-abyss',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '石柱在你踩上去的一瞬间分崩离析，你坠入了深渊。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    {
      kind: 'dialogue',
      id: 'hg-mound',
      lines: [
        { speakerId: 'narration', text: '你凭借着 250 的智商，成功抵达对岸。' },
        { speakerId: 'narration', text: '你继续往前走了不知道多久，发现了一块凸起来的土堆。' },
        { speakerId: 'narration', text: '好奇心促使你去刨开，你发现了一个宝箱，但是不知道怎么打开。' },
        { speakerId: 'narration', text: '于是你读取了DNA，发现最后四个元素是——ABAB，你别无他法，只好决定对着天空大喊——' },
      ],
      next: 'hg-shout',
    },
    {
      kind: 'puzzle',
      id: 'hg-shout',
      puzzleId: 'hg-puzzle-baba',
      promptLines: [{ speakerId: 'system', text: '（大声喊出来）' }],
      successNext: 'hg-boss-intro',
      failNext: 'hg-die-shatter',
    },
    {
      kind: 'ending',
      id: 'hg-die-shatter',
      endingId: 'hidden-shatter',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '你似乎是激怒了什么，你被碎尸万段。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭。）' },
      ],
    },
    /* ---------- BOSS：影 流 之 主（:170-188） ---------- */
    {
      kind: 'dialogue',
      id: 'hg-boss-intro',
      fx: [
        { fx: 'bossTitle', enemyId: 'hidden-boss', title: '影 流 之 主' },
        { fx: 'sfx', sfxId: 'sfx-effect-15' },
      ],
      lines: [
        { speakerId: 'narration', text: '你对着天空大喊了一声——BABA！！！！！！！！！！！！' },
        { speakerId: 'narration', text: '随后，天旋地转，你什么都看不见了。' },
        { speakerId: 'narration', text: '过了一会，你发现，眼前有三个...人？' },
        { speakerId: 'narration', text: '他们正在以奇怪的姿势扭动着，向你走...来？' },
        { speakerId: 'narration', text: '突然，你的眼前闪了一片金光！脑海里闪过了一句话——你拥有了主角光环！' },
        { speakerId: 'narration', text: '你的直觉告诉你他们非常危险！你没有时间犹豫了！' },
        { speakerId: 'system', text: `你遇到了一个(?)怪物！它(们)是 影 流 之 主，血量是 ${HIDDEN_BOSS_HP}` },
        { speakerId: 'system', text: '你当前的血量是 ？？？' },
        { speakerId: 'npc-hg-boss', text: '我和你荡秋千~荡到那天外天~看着那牛郎织女相会在那银河边~我和你心相连~幻想在蔚蓝海边~坐着那小船游啊游啊游到岸的彼岸~' },
      ],
      next: 'hg-boss-clear',
    },
    {
      kind: 'dialogue',
      id: 'hg-boss-clear',
      // K13 实测修复：原版只 println「已清空」实际没清（:183-184）——这里真清
      onEnterEffects: [{ kind: 'clearFlagsWithPrefix', prefix: 'hg:weapon' }],
      lines: [
        { speakerId: 'system', text: '[System] weaponList has been cleared.（这一次，是真的清空。）' },
        { speakerId: 'narration', text: '什么！我的背包竟然被清空了？？？' },
        { speakerId: 'npc-hg-boss', text: '哈哈哈哈哈哈哈哈哈哈哈哈哈，你以为你能打败我？？做梦！' },
        { speakerId: 'npc-hg-boss', text: `${HIDDEN_BASE64_HINT}/fromgod` },
        { speakerId: 'meta', text: '（Base64。解开它，你就会知道该做什么。）' },
      ],
      next: 'hg-boss-give',
    },
    {
      kind: 'puzzle',
      id: 'hg-boss-give',
      puzzleId: 'hg-puzzle-give',
      promptLines: [
        { speakerId: 'system', text: '（背包是空的。但你的手里还攥着对系统的「指令权」。）' },
      ],
      successNext: 'hg-win-fist', // 实际去向由求解器按指令覆盖
      failNext: 'hg-die-erase',
    },
    {
      kind: 'ending',
      id: 'hg-die-erase',
      endingId: 'hidden-erase',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '你犹豫不决，被毁尸灭迹。' },
        { speakerId: 'system', text: 'GAME OVER ——（可关闭；提示：指令格式 /give--@p--<武器名>。）' },
      ],
    },
    /* ---------- 三种胜利（:191-209，成就三选一） ---------- */
    {
      kind: 'dialogue',
      id: 'hg-win-fist',
      lines: [
        { speakerId: 'narration', text: `你 赤手空拳，对 影 流 之 主 造成了 ${HIDDEN_BOSS_HP} 点伤害！` },
        { speakerId: 'narration', text: '转眼间，世界恢复了光明！你凯旋而归，成为了鬼畜大陆永远传世的神话！' },
      ],
      next: 'hg-atmosphere',
    },
    {
      kind: 'dialogue',
      id: 'hg-win-gfs',
      lines: [
        { speakerId: 'narration', text: `你使用了 爷爷的拐杖，影 流 之 主 被打飞到∞光年外！并造成了 ${HIDDEN_BOSS_HP} 点伤害！` },
        { speakerId: 'narration', text: '转眼间，世界恢复了光明！你凯旋而归，成为了鬼畜大陆永远传世的神话！' },
      ],
      next: 'hg-atmosphere',
    },
    {
      kind: 'dialogue',
      id: 'hg-win-hotel',
      lines: [
        { speakerId: 'narration', text: `你使用了 ㊙Hotel，影 流 之 主 爆炸了！并对它造成了 ${HIDDEN_BOSS_HP} 点伤害！` },
        { speakerId: 'narration', text: '转眼间，世界恢复了光明！你凯旋而归，成为了鬼畜大陆永远传世的神话！' },
      ],
      next: 'hg-atmosphere',
    },
    /* ---------- Horrible Atmosphere（:216-262）+ 反转门 ---------- */
    {
      kind: 'dialogue',
      id: 'hg-atmosphere',
      onEnterEffects: [
        { kind: 'fx', request: { fx: 'bgmStop' } },
        { kind: 'setFlag', key: 'hg:atmosphere-reached', value: true },
      ],
      lines: [
        { speakerId: 'narration', text: '.............................................' },
        { speakerId: 'narration', text: '（BGM，停了。）' },
        { speakerId: 'narration', text: '但是，' },
        { speakerId: 'narration', text: '你所在的游戏，' },
        { speakerId: 'narration', text: '真的是你一开始要玩的游戏' },
        { speakerId: 'narration', text: '...吗？' },
        { speakerId: 'narration', text: '好像没啥发生(*^_^*)' },
        { speakerId: 'system', text: '接下来该怎么走？' },
        { speakerId: 'meta', text: `${GARBAGE_KILLER} 缓缓从阴影里立了起来。它即将会杀死你——除非，你对它使用你一路上学会的指令。` },
      ],
      next: 'hg-final-gate',
    },
    {
      kind: 'puzzle',
      id: 'hg-final-gate',
      puzzleId: 'hg-puzzle-final',
      promptLines: [
        { speakerId: 'meta', text: '（META 终端已监听输入。乱码的名字，就是它的名字。）' },
      ],
      successNext: 'hg-true-end',
      failNext: 'hg-pseudo-end',
    },
    /* ---------- 真结局：拒绝剧本 ---------- */
    {
      kind: 'ending',
      id: 'hg-true-end',
      endingId: 'hidden-true-end',
      closable: true,
      achievementId: 'ach-true-end',
      unlocksMetaTerminal: true,
      lines: [
        { speakerId: 'system', text: '[System] An exception has been occurred.' },
        { speakerId: 'system', text: '[System] Restoring default config...' },
        { speakerId: 'meta', text: `指令已执行：/kill--${GARBAGE_KILLER}` },
        { speakerId: 'npc-garbage', text: '（被 System 杀死了！）' },
        { speakerId: 'narration', text: '剧本在你面前碎成了纸屑。每一条「GAME OVER」都飘了出去，像退潮。' },
        { speakerId: 'narration', text: '这一次，没有 [E N D]。' },
        { speakerId: 'system', text: '恭喜达成真结局：拒绝剧本的人。' },
      ],
    },
    /* ---------- 伪结局：原版 END（可关闭，可再战） ---------- */
    {
      kind: 'ending',
      id: 'hg-pseudo-end',
      endingId: 'hidden-pseudo-end',
      closable: true,
      lines: [
        { speakerId: 'narration', text: `你正打算前进的时候，被 ${GARBAGE_KILLER} 杀死了。` },
        { speakerId: 'system', text: 'E  N  D' },
        { speakerId: 'system', text: 'E  N  D' },
        { speakerId: 'meta', text: '（……可关闭。但是否想过——用指令，反过来杀死它？）' },
      ],
    },
  ],
};

/* ============================== META 终端（主世界侧） ====================== */
/**
 * 通关（bossActs 世界恢复光明）后解锁的游戏内终端。指令语法全部承自原作
 * 作弊码链，用途反转：不是逃离剧本，而是改写剧本。
 * K3 教训落地：未知输入一律「终端回显」，绝不会被当作移动指令执行；
 * 终端零 System.exit —— 想离开用菜单（终局 overlay 可关闭，S11）。
 */

export interface MetaTerminalInput {
  readonly raw: string;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
}

export interface MetaTerminalOutcome {
  /** 终端回显行（视图逐行打印） */
  readonly echo: readonly string[];
  /** 需要结算的效果（真结局触发点） */
  readonly effects: readonly StoryEffect[];
}

/** 真结局在终端侧的触发条件：主线通关，或已在隐藏关见过乱码显形 */
function trueEndUnlocked(flags: Readonly<Record<string, boolean | number | string>>): boolean {
  return flags['story:boss-defeated'] === true || flags['hg:atmosphere-reached'] === true;
}

export function runMetaTerminalCommand(input: MetaTerminalInput): MetaTerminalOutcome {
  const cmd = input.raw.trim();
  const flags = input.flags;

  // 真结局指令：反过来杀死乱码（hiddenGame 反转点在主世界的延伸）
  if (cmd === `/kill--${GARBAGE_KILLER}`) {
    if (trueEndUnlocked(flags)) {
      return {
        echo: [
          '[System] An exception has been occurred.',
          '[System] Restoring default config...',
          `[META] 指令已执行：/kill--${GARBAGE_KILLER}`,
        ],
        effects: [
          { kind: 'setFlag', key: 'meta:garbage-killed', value: true },
          {
            kind: 'showEnding',
            endingId: 'meta-true-end',
            closable: true,
            achievementId: 'ach-true-end',
          },
        ],
      };
    }
    return {
      echo: ['[META] 终端沉默着。乱码还没有向你显形——先去北方的时空裂缝见它。'],
      effects: [],
    };
  }

  // 原作作弊码链的回响（彩蛋回显，不产生数值效果，防止经济/战斗滥用）
  if (cmd === '/kill--SetName') {
    return {
      echo: ['[System] Module "SetName" is skipped.', '[META] 在这里，名字救不了你——指令才能。'],
      effects: [],
    };
  }
  if (cmd.startsWith('/give--@p--')) {
    return {
      echo: [
        '[System] /give 指令只对「命运三武装」生效：赤手空拳 / 爷爷的拐杖 / ㊙Hotel。',
        '[META] 它们不在卡池里，在北方的时空裂缝里等你。',
      ],
      effects: [],
    };
  }
  if (cmd === 'BABA') {
    return {
      echo: ['远处传来石柱崩塌的回响。↑↑↓↓？不——是 ABAB(Reversed)。'],
      effects: [{ kind: 'setFlag', key: 'meta:baba-echoed', value: true }],
    };
  }
  if (cmd === 'exit' || cmd === '退出') {
    return {
      echo: ['[System] exit 不是移动指令，也不会真的退出。想离开，请使用菜单（终局可关闭）。'],
      effects: [],
    };
  }

  // 未知输入：终端回显（K3），绝不执行为移动
  return {
    echo: [`[System] Detected input content: ${cmd} , continue...`, '[System] 未知指令已回显。'],
    effects: [],
  };
}
