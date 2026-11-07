/**
 * 生成自动演示预计算解路（一次性脚本；关卡数据变更后重跑）。
 * 用法：npx vite-node scripts/genSolutionSteps.ts
 */
import { writeFileSync } from 'node:fs';
import { AREA_LEVELS } from '../src/data/levels/areas';
import { parseLevelGeometry } from '../src/engine/puzzle/grid';
import { solveGeometry } from '../src/engine/puzzle/solver';

const entries: Array<[string, unknown[]]> = [];

for (const level of AREA_LEVELS) {
  const parsed = parseLevelGeometry(level);
  if (!parsed.ok) throw new Error(`${level.id}: ${parsed.error}`);
  const solved = solveGeometry(parsed.geometry);
  if (!solved.solvable || solved.steps.length === 0) {
    throw new Error(`${level.id}: 求解失败 ${solved.error ?? ''}`);
  }
  entries.push([
    level.id,
    solved.steps.map((s) => ({
      dir: s.dir,
      stand: s.stand,
      from: s.from,
      to: s.to,
      kind: s.kind,
      isFall: s.isFall,
    })),
  ]);
  console.log(`${level.id}: ${solved.steps.length} 推 / ${solved.solutionMoves} 步`);
}

const json = entries
  .map(([id, steps]) => `  ${JSON.stringify(id)}: ${JSON.stringify(steps, null, 2).replace(/\n/g, '\n  ')},`)
  .join('\n');

const content = `/**
 * 自动演示预计算解路（自动生成，勿手改）。
 * ---------------------------------------------------------------------------
 * 生成：npx vite-node scripts/genSolutionSteps.ts
 * 内容：每关的「推」序列（dir/stand/from/kind/isFall），由 engine/puzzle/solver
 * 离线求得；自动演示按玩家当前位置用 walkDirs 补走位，不再运行时求解
 * （消除高难关开局几十秒的求解卡顿）。关卡数据变更后请重跑生成脚本；
 * src/data/levels/__tests__/solutionSteps.test.ts 会逐关回放校验。
 */

import type { Dir, Vec2 } from '../../core/types';

export interface PrecomputedStep {
  readonly dir: Dir;
  /** 玩家发力站位（推之前所在格） */
  readonly stand: Vec2;
  /** 被推实体推前坐标 */
  readonly from: Vec2;
  /** 被推实体推后坐标 */
  readonly to: Vec2;
  readonly kind: 'chest' | 'enemy';
  /** 该推是否使实体坠落 */
  readonly isFall: boolean;
}

/** 关卡 id → 预计算推序列 */
export const PRECOMPUTED_SOLUTIONS: Readonly<Record<string, readonly PrecomputedStep[]>> = Object.freeze({
${json}
});
`;

writeFileSync('src/data/levels/solutionSteps.ts', content);
console.log('written src/data/levels/solutionSteps.ts');
