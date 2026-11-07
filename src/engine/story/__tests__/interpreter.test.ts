/**
 * 事件解释器状态机单测。
 * 覆盖：剧本启动/推进、选择（含条件不满足的显式兜底）、谜题（重试+提示，
 * 绝不退出）、战斗守卫（未解谜秒杀分支）、门锁、多出口覆盖、
 * 纯函数性（入参不被修改）、悬空边与环引用的安全停车（K15）。
 */

import { describe, expect, it } from 'vitest';
import {
  IDLE_STORY_RUNTIME,
  advanceStory,
  chooseStory,
  currentLines,
  resolveBattleResult,
  startStory,
  submitStoryInput,
  validateScript,
  type PuzzleSolver,
  type StoryEffect,
  type StoryRuntimeState,
  type StoryScriptDef,
} from '../interpreter';

/** 极简三节点剧本：对话 → 谜题 → 结局 */
const SOLVER: PuzzleSolver = (raw) =>
  raw.trim() === '42'
    ? { ok: true, effects: [{ kind: 'setFlag', key: 'got', value: true }] }
    : { ok: false, fatal: false, hint: '再想想' };

const MINI_SCRIPT: StoryScriptDef = {
  id: 'mini',
  title: 'mini',
  entryNodeId: 'a',
  nodes: [
    { kind: 'dialogue', id: 'a', lines: [{ speakerId: 's', text: 'l1' }, { speakerId: 's', text: 'l2' }], next: 'b' },
    {
      kind: 'puzzle',
      id: 'b',
      puzzleId: 'p',
      promptLines: [{ speakerId: 's', text: 'q' }],
      successNext: 'c',
      failNext: 'a',
    },
    { kind: 'ending', id: 'c', endingId: 'done', closable: true, lines: [] },
  ],
};

const SCRIPTS: readonly StoryScriptDef[] = [MINI_SCRIPT];

/** 连续 advance 直到离开 dialogue 阶段（返回最后一次的效果，供守卫/结局断言） */
function walk(script: StoryScriptDef, runtime: StoryRuntimeState): { state: StoryRuntimeState; effects: StoryEffect[] } {
  let cur = runtime;
  let lastEffects: StoryEffect[] = [];
  for (let i = 0; i < 64; i += 1) {
    if (cur.phase !== 'dialogue') return { state: cur, effects: lastEffects };
    const step = advanceStory([script], cur);
    cur = step.state;
    lastEffects = [...step.effects];
  }
  return { state: cur, effects: lastEffects };
}

describe('interpreter —— 基本推进', () => {
  it('start → 对话逐句推进 → 进入下一节点', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    expect(s0.error).toBeUndefined();
    expect(s0.state.phase).toBe('dialogue');
    expect(s0.state.nodeId).toBe('a');
    expect(currentLines(SCRIPTS, s0.state)).toHaveLength(2);

    const s1 = advanceStory(SCRIPTS, s0.state);
    expect(s1.state.lineIndex).toBe(1);
    const s2 = advanceStory(SCRIPTS, s1.state);
    // 读完最后一句 → 显式 next
    expect(s2.state.nodeId).toBe('b');
    expect(s2.state.phase).toBe('awaiting-input');
  });

  it('对话读完且无 next → 剧本结束 + exitScript 效果', () => {
    const solo: StoryScriptDef = {
      id: 'solo',
      title: 'solo',
      entryNodeId: 'x',
      nodes: [{ kind: 'dialogue', id: 'x', lines: [{ speakerId: 's', text: 'hi' }] }],
    };
    const s0 = startStory([solo], 'solo');
    const s1 = advanceStory([solo], s0.state);
    expect(s1.state.phase).toBe('finished');
    expect(s1.effects).toContainEqual({ kind: 'exitScript' });
  });

  it('未知剧本 id / 悬空边 → error 且不崩溃（K15：无穿透路径）', () => {
    const bad = startStory(SCRIPTS, 'no-such-script');
    expect(bad.state).toBe(IDLE_STORY_RUNTIME);
    expect(bad.error).toContain('未知剧本');

    const dangling: StoryScriptDef = {
      id: 'dangling',
      title: 'd',
      entryNodeId: 'a',
      nodes: [{ kind: 'dialogue', id: 'a', lines: [], next: 'ghost' }],
    };
    const s0 = startStory([dangling], 'dangling');
    // 进入节点本身合法；悬空边在读完空对话、跳转 ghost 时暴露
    const s1 = advanceStory([dangling], s0.state);
    expect(s1.error).toContain('缺少节点 ghost');
    expect(s1.state.phase).toBe('finished');
  });

  it('环引用的 gate 链 → 深度封顶安全停车，不死循环', () => {
    const loop: StoryScriptDef = {
      id: 'loop',
      title: 'l',
      entryNodeId: 'g1',
      nodes: [
        { kind: 'gate', id: 'g1', requireFlags: ['k'], openNext: 'g2', lockedNext: 'end' },
        { kind: 'gate', id: 'g2', requireFlags: ['k'], openNext: 'g1', lockedNext: 'end' },
        { kind: 'ending', id: 'end', endingId: 'e', closable: true, lines: [] },
      ],
    };
    const withFlag: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: { k: true } };
    const s = startStory([loop], 'loop', withFlag);
    expect(s.error).toContain('深度超过');
    expect(s.state.phase).toBe('finished');
  });
});

describe('interpreter —— 选择节点', () => {
  const choiceScript: StoryScriptDef = {
    id: 'choicey',
    title: 'c',
    entryNodeId: 'root',
    nodes: [
      {
        kind: 'choice',
        id: 'root',
        promptLines: [],
        choices: [
          { id: 'free', label: 'free', next: 'free-end' },
          { id: 'locked', label: 'locked', next: 'locked-end', requireCard: 'card-x' },
        ],
        defaultNext: 'free-end',
      },
      { kind: 'ending', id: 'free-end', endingId: 'f', closable: true, lines: [] },
      { kind: 'ending', id: 'locked-end', endingId: 'l', closable: true, lines: [] },
    ],
  };
  const all = [choiceScript];

  it('合法选择直达；未知选择走 defaultNext', () => {
    const s0 = startStory(all, 'choicey');
    expect(s0.state.phase).toBe('awaiting-choice');
    const s1 = chooseStory(all, s0.state, 'free');
    expect(s1.state.nodeId).toBe('free-end');

    const s2 = startStory(all, 'choicey');
    const s3 = chooseStory(all, s2.state, 'no-such-choice');
    expect(s3.state.nodeId).toBe('free-end'); // 显式兜底，不穿透
  });

  it('requireCard 不满足 → 显式兜底；grantCard 镜像后可选', () => {
    const s0 = startStory(all, 'choicey');
    const blocked = chooseStory(all, s0.state, 'locked');
    expect(blocked.state.nodeId).toBe('free-end'); // defaultNext 兜底

    // 模拟发卡：grantCard 效果会把 card:<id> 写进 flags 镜像
    const granted: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: { 'card:card-x': true } };
    const s1 = startStory(all, 'choicey', granted);
    const s2 = chooseStory(all, s1.state, 'locked');
    expect(s2.state.nodeId).toBe('locked-end');
  });

  it('非 choice 节点调用 choose → 原地不动 + error', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    const s1 = chooseStory(SCRIPTS, s0.state, 'free');
    expect(s1.state).toBe(s0.state);
    expect(s1.error).toBeDefined();
  });
});

describe('interpreter —— 谜题（重试+提示，绝不退出）', () => {
  it('答对：效果生效、flag 镜像、进入 successNext', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    const atPuzzle = advanceStory(SCRIPTS, advanceStory(SCRIPTS, s0.state).state).state;
    const s3 = submitStoryInput(SCRIPTS, atPuzzle, ' 42 ', { solvers: { p: SOLVER } });
    expect(s3.error).toBeUndefined();
    expect(s3.state.nodeId).toBe('c');
    expect(s3.state.phase).toBe('finished');
    expect(s3.state.flags['got']).toBe(true);
    expect(s3.effects.some((e) => e.kind === 'setFlag')).toBe(true);
  });

  it('答错（非致命）：留在原地重试 + showHint，retries 递增', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    const atPuzzle = advanceStory(SCRIPTS, advanceStory(SCRIPTS, s0.state).state).state;
    const wrong = submitStoryInput(SCRIPTS, atPuzzle, '999', { solvers: { p: SOLVER } });
    expect(wrong.state.nodeId).toBe('b');
    expect(wrong.state.phase).toBe('awaiting-input');
    expect(wrong.state.retries).toBe(1);
    expect(wrong.effects).toContainEqual({ kind: 'showHint', text: '再想想' });

    // 重试后答对仍可通
    const right = submitStoryInput(SCRIPTS, wrong.state, '42', { solvers: { p: SOLVER } });
    expect(right.state.nodeId).toBe('c');
  });

  it('答错（致命）：进入 failNext（隐藏关死亡分支）', () => {
    const fatal: PuzzleSolver = () => ({ ok: false, fatal: true, echo: '死了' });
    const script: StoryScriptDef = {
      id: 'fatal',
      title: 'f',
      entryNodeId: 'p',
      nodes: [
        { kind: 'puzzle', id: 'p', puzzleId: 'fp', promptLines: [], successNext: 'win', failNext: 'dead' },
        { kind: 'ending', id: 'win', endingId: 'w', closable: true, lines: [] },
        { kind: 'ending', id: 'dead', endingId: 'd', closable: true, lines: [] },
      ],
    };
    const s0 = startStory([script], 'fatal');
    const s1 = submitStoryInput([script], s0.state, 'x', { solvers: { fp: fatal } });
    expect(s1.state.nodeId).toBe('dead');
    expect(s1.effects.some((e) => e.kind === 'showHint' && e.text === '死了')).toBe(true);
  });

  it('求解器未注册：按非致命失败处理 + error 说明，绝不崩溃/退出', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    const atPuzzle = advanceStory(SCRIPTS, advanceStory(SCRIPTS, s0.state).state).state;
    const s1 = submitStoryInput(SCRIPTS, atPuzzle, '42', {});
    expect(s1.state.nodeId).toBe('b');
    expect(s1.error).toContain('未注册');
    expect(s1.effects.some((e) => e.kind === 'showHint')).toBe(true);
  });

  it('多出口覆盖：目标存在则生效；悬空覆盖回退节点 successNext', () => {
    const router: PuzzleSolver = (raw) => ({
      ok: true,
      successNext: raw.trim() === 'ghost' ? 'ghost-node' : 'win-b',
    });
    const script: StoryScriptDef = {
      id: 'router',
      title: 'r',
      entryNodeId: 'p',
      nodes: [
        { kind: 'puzzle', id: 'p', puzzleId: 'rp', promptLines: [], successNext: 'win-a', failNext: 'p' },
        { kind: 'ending', id: 'win-a', endingId: 'a', closable: true, lines: [] },
        { kind: 'ending', id: 'win-b', endingId: 'b', closable: true, lines: [] },
      ],
    };
    const s0 = startStory([script], 'router');
    const toA = submitStoryInput([script], s0.state, 'ghost', { solvers: { rp: router } });
    expect(toA.state.nodeId).toBe('win-a'); // 悬空覆盖被回退
    const s1 = startStory([script], 'router');
    const toB = submitStoryInput([script], s1.state, 'b', { solvers: { rp: router } });
    expect(toB.state.nodeId).toBe('win-b');
  });
});

describe('interpreter —— 战斗与守卫（Game.java:1494 的显式化）', () => {
  const bossScript: StoryScriptDef = {
    id: 'boss',
    title: 'b',
    entryNodeId: 'meet',
    nodes: [
      { kind: 'dialogue', id: 'meet', lines: [{ speakerId: 's', text: '影流之主！' }], next: 'guard' },
      { kind: 'gate', id: 'guard', requireFlags: ['story:key-boss'], openNext: 'launch', lockedNext: 'slaughter' },
      { kind: 'dialogue', id: 'launch', lines: [{ speakerId: 's', text: '护盾展开' }], next: 'battle' },
      { kind: 'ending', id: 'slaughter', endingId: 'slaughter', closable: true, lines: [] },
      {
        kind: 'battle',
        id: 'battle',
        enemyId: 'enemy-ylzz',
        tuning: { shield: 233, weaknessCardFlag: 'story:key-boss', weaknessMultiplier: 2, shadowCap: 64 },
        winNext: 'win',
        loseNext: 'lose',
      },
      { kind: 'ending', id: 'win', endingId: 'w', closable: true, lines: [] },
      { kind: 'ending', id: 'lose', endingId: 'l', closable: true, lines: [] },
    ],
  };
  const all = [bossScript];

  it('未解谜（无钥匙 flag）→ 秒杀演出节点，绝不发 startBattle', () => {
    const s0 = startStory(all, 'boss');
    const stepped = walk(bossScript, s0.state);
    expect(stepped.state.nodeId).toBe('slaughter'); // 守卫直接链到秒杀
    expect(stepped.effects.some((e) => e.kind === 'startBattle')).toBe(false);
    const ending = stepped.effects.find((e) => e.kind === 'showEnding');
    expect(ending && ending.kind === 'showEnding' && ending.closable).toBe(true);
  });

  it('解谜后（有钥匙）→ 发 startBattle；win/lose 分别走显式节点', () => {
    const keyed: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: { 'story:key-boss': 'card-x' } };
    const stepped = walk(bossScript, startStory(all, 'boss', keyed).state);
    expect(stepped.state.nodeId).toBe('battle');
    expect(stepped.state.phase).toBe('awaiting-battle');
    const battle = stepped.effects.find((e) => e.kind === 'startBattle');
    expect(battle).toMatchObject({ kind: 'startBattle', enemyId: 'enemy-ylzz', tuning: { shield: 233 } });

    const win = resolveBattleResult(all, stepped.state, true);
    expect(win.state.nodeId).toBe('win');
    const lose = resolveBattleResult(all, stepped.state, false);
    expect(lose.state.nodeId).toBe('lose');
  });

  it('非 battle 阶段回填战斗结果 → 原地不动 + error', () => {
    const s0 = startStory(all, 'boss');
    const s1 = resolveBattleResult(all, s0.state, true);
    expect(s1.state).toBe(s0.state);
    expect(s1.error).toBeDefined();
  });
});

describe('interpreter —— 纯函数性与静态体检', () => {
  it('所有 API 都不修改传入的 runtime（纯函数）', () => {
    const s0 = startStory(SCRIPTS, 'mini');
    const frozen: StoryRuntimeState = Object.freeze({ ...s0.state });
    advanceStory(SCRIPTS, frozen);
    chooseStory(SCRIPTS, frozen, 'x');
    submitStoryInput(SCRIPTS, frozen, '42', { solvers: { p: SOLVER } });
    resolveBattleResult(SCRIPTS, frozen, true);
    expect(frozen.lineIndex).toBe(0);
    expect(frozen.nodeId).toBe('a');
  });

  it('validateScript：悬空边 / 缺入口能被静态发现', () => {
    expect(validateScript(MINI_SCRIPT)).toEqual([]);

    const bad: StoryScriptDef = {
      id: 'bad',
      title: 'b',
      entryNodeId: 'missing-entry',
      nodes: [{ kind: 'dialogue', id: 'a', lines: [], next: 'nowhere' }],
    };
    const issues = validateScript(bad);
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toContain('入口节点');
    expect(issues.join('\n')).toContain('悬空边');
  });
});
