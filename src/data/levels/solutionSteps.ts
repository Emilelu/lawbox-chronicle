/**
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
  "level-sb-01": [
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 5,
        "y": 7
      },
      "from": {
        "x": 6,
        "y": 7
      },
      "to": {
        "x": 7,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 4
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 4
      },
      "from": {
        "x": 6,
        "y": 3
      },
      "to": {
        "x": 6,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 3
      },
      "from": {
        "x": 6,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 7,
        "y": 1
      },
      "from": {
        "x": 6,
        "y": 1
      },
      "to": {
        "x": 5,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 6,
        "y": 1
      },
      "from": {
        "x": 5,
        "y": 1
      },
      "to": {
        "x": 4,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 4,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 4,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 1
      },
      "to": {
        "x": 2,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 6,
        "y": 7
      },
      "from": {
        "x": 7,
        "y": 7
      },
      "to": {
        "x": 8,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 7,
        "y": 7
      },
      "from": {
        "x": 8,
        "y": 7
      },
      "to": {
        "x": 9,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 8,
        "y": 7
      },
      "from": {
        "x": 9,
        "y": 7
      },
      "to": {
        "x": 10,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 7
      },
      "from": {
        "x": 10,
        "y": 7
      },
      "to": {
        "x": 11,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 10,
        "y": 7
      },
      "from": {
        "x": 11,
        "y": 7
      },
      "to": {
        "x": 12,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 11,
        "y": 7
      },
      "from": {
        "x": 12,
        "y": 7
      },
      "to": {
        "x": 13,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 13,
        "y": 6
      },
      "from": {
        "x": 13,
        "y": 7
      },
      "to": {
        "x": 13,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 13,
        "y": 7
      },
      "from": {
        "x": 13,
        "y": 8
      },
      "to": {
        "x": 13,
        "y": 9
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 13,
        "y": 8
      },
      "from": {
        "x": 13,
        "y": 9
      },
      "to": {
        "x": 13,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 13,
        "y": 9
      },
      "from": {
        "x": 13,
        "y": 10
      },
      "to": {
        "x": 13,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 12,
        "y": 11
      },
      "from": {
        "x": 13,
        "y": 11
      },
      "to": {
        "x": 14,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 14,
        "y": 10
      },
      "from": {
        "x": 14,
        "y": 11
      },
      "to": {
        "x": 14,
        "y": 12
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 2,
        "y": 1
      },
      "to": {
        "x": 1,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-sb-02": [
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 4
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 7,
        "y": 3
      },
      "from": {
        "x": 6,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 5,
        "y": 4
      },
      "from": {
        "x": 5,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 5,
        "y": 3
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 5,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 6,
        "y": 1
      },
      "from": {
        "x": 5,
        "y": 1
      },
      "to": {
        "x": 4,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 4,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 4,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 1
      },
      "to": {
        "x": 2,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 2,
        "y": 1
      },
      "to": {
        "x": 1,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 11,
        "y": 4
      },
      "from": {
        "x": 11,
        "y": 3
      },
      "to": {
        "x": 11,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 11,
        "y": 3
      },
      "from": {
        "x": 11,
        "y": 2
      },
      "to": {
        "x": 11,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 7,
        "y": 8
      },
      "from": {
        "x": 8,
        "y": 8
      },
      "to": {
        "x": 9,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 8,
        "y": 8
      },
      "from": {
        "x": 9,
        "y": 8
      },
      "to": {
        "x": 10,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 8
      },
      "from": {
        "x": 10,
        "y": 8
      },
      "to": {
        "x": 11,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 6
      },
      "from": {
        "x": 6,
        "y": 7
      },
      "to": {
        "x": 6,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 7,
        "y": 8
      },
      "from": {
        "x": 6,
        "y": 8
      },
      "to": {
        "x": 5,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 7
      },
      "from": {
        "x": 5,
        "y": 8
      },
      "to": {
        "x": 5,
        "y": 9
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 8
      },
      "from": {
        "x": 5,
        "y": 9
      },
      "to": {
        "x": 5,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 6,
        "y": 10
      },
      "from": {
        "x": 5,
        "y": 10
      },
      "to": {
        "x": 4,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 4,
        "y": 9
      },
      "from": {
        "x": 4,
        "y": 10
      },
      "to": {
        "x": 4,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 11
      },
      "from": {
        "x": 4,
        "y": 11
      },
      "to": {
        "x": 3,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 4,
        "y": 11
      },
      "from": {
        "x": 3,
        "y": 11
      },
      "to": {
        "x": 2,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 3,
        "y": 11
      },
      "from": {
        "x": 2,
        "y": 11
      },
      "to": {
        "x": 1,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 10,
        "y": 8
      },
      "from": {
        "x": 11,
        "y": 8
      },
      "to": {
        "x": 12,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 11,
        "y": 8
      },
      "from": {
        "x": 12,
        "y": 8
      },
      "to": {
        "x": 13,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 12,
        "y": 8
      },
      "from": {
        "x": 13,
        "y": 8
      },
      "to": {
        "x": 14,
        "y": 8
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 14,
        "y": 7
      },
      "from": {
        "x": 14,
        "y": 8
      },
      "to": {
        "x": 14,
        "y": 9
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 14,
        "y": 8
      },
      "from": {
        "x": 14,
        "y": 9
      },
      "to": {
        "x": 14,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 14,
        "y": 9
      },
      "from": {
        "x": 14,
        "y": 10
      },
      "to": {
        "x": 14,
        "y": 11
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 14,
        "y": 10
      },
      "from": {
        "x": 14,
        "y": 11
      },
      "to": {
        "x": 14,
        "y": 12
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-sb-03": [
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 4,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 3
      },
      "from": {
        "x": 7,
        "y": 3
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 11,
        "y": 5
      },
      "from": {
        "x": 11,
        "y": 4
      },
      "to": {
        "x": 11,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 11,
        "y": 4
      },
      "from": {
        "x": 11,
        "y": 3
      },
      "to": {
        "x": 11,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 11,
        "y": 3
      },
      "from": {
        "x": 11,
        "y": 2
      },
      "to": {
        "x": 11,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 12
      },
      "from": {
        "x": 4,
        "y": 12
      },
      "to": {
        "x": 5,
        "y": 12
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 4,
        "y": 12
      },
      "from": {
        "x": 5,
        "y": 12
      },
      "to": {
        "x": 6,
        "y": 12
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 5,
        "y": 12
      },
      "from": {
        "x": 6,
        "y": 12
      },
      "to": {
        "x": 7,
        "y": 12
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 8,
        "y": 9
      },
      "from": {
        "x": 9,
        "y": 9
      },
      "to": {
        "x": 10,
        "y": 9
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 9
      },
      "from": {
        "x": 10,
        "y": 9
      },
      "to": {
        "x": 11,
        "y": 9
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 11,
        "y": 8
      },
      "from": {
        "x": 11,
        "y": 9
      },
      "to": {
        "x": 11,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 10,
        "y": 10
      },
      "from": {
        "x": 11,
        "y": 10
      },
      "to": {
        "x": 12,
        "y": 10
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 4,
        "y": 5
      },
      "from": {
        "x": 5,
        "y": 5
      },
      "to": {
        "x": 6,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 6
      },
      "from": {
        "x": 6,
        "y": 5
      },
      "to": {
        "x": 6,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 0
      },
      "from": {
        "x": 3,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 7,
        "y": 3
      },
      "from": {
        "x": 6,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 4
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 5,
        "y": 4
      },
      "from": {
        "x": 5,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 6,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 4,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 10,
        "y": 0
      },
      "from": {
        "x": 10,
        "y": 1
      },
      "to": {
        "x": 10,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 2
      },
      "from": {
        "x": 10,
        "y": 2
      },
      "to": {
        "x": 11,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 12,
        "y": 1
      },
      "from": {
        "x": 11,
        "y": 1
      },
      "to": {
        "x": 10,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 10,
        "y": 2
      },
      "from": {
        "x": 11,
        "y": 2
      },
      "to": {
        "x": 12,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 12,
        "y": 3
      },
      "from": {
        "x": 12,
        "y": 2
      },
      "to": {
        "x": 12,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 11,
        "y": 1
      },
      "from": {
        "x": 12,
        "y": 1
      },
      "to": {
        "x": 13,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 12,
        "y": 1
      },
      "from": {
        "x": 13,
        "y": 1
      },
      "to": {
        "x": 14,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 14,
        "y": 2
      },
      "from": {
        "x": 14,
        "y": 1
      },
      "to": {
        "x": 14,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 1
      },
      "from": {
        "x": 10,
        "y": 1
      },
      "to": {
        "x": 11,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 4,
        "y": 3
      },
      "from": {
        "x": 4,
        "y": 2
      },
      "to": {
        "x": 4,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 4,
        "y": 2
      },
      "from": {
        "x": 4,
        "y": 1
      },
      "to": {
        "x": 4,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 0
      },
      "from": {
        "x": 4,
        "y": 0
      },
      "to": {
        "x": 3,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 4,
        "y": 0
      },
      "from": {
        "x": 3,
        "y": 0
      },
      "to": {
        "x": 2,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 3,
        "y": 0
      },
      "from": {
        "x": 2,
        "y": 0
      },
      "to": {
        "x": 1,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 2,
        "y": 0
      },
      "from": {
        "x": 1,
        "y": 0
      },
      "to": {
        "x": 0,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-sb-04": [
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 3
      },
      "from": {
        "x": 6,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 2
      },
      "from": {
        "x": 6,
        "y": 1
      },
      "to": {
        "x": 6,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 4,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 6
      },
      "from": {
        "x": 7,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 9,
        "y": 1
      },
      "from": {
        "x": 10,
        "y": 1
      },
      "to": {
        "x": 11,
        "y": 1
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 0
      },
      "from": {
        "x": 3,
        "y": 1
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 5,
        "y": 0
      },
      "from": {
        "x": 6,
        "y": 0
      },
      "to": {
        "x": 7,
        "y": 0
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-05": [
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 5,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 3
      },
      "from": {
        "x": 5,
        "y": 4
      },
      "to": {
        "x": 5,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 3
      },
      "to": {
        "x": 3,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 3
      },
      "from": {
        "x": 3,
        "y": 4
      },
      "to": {
        "x": 3,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-06": [
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 4,
        "y": 2
      },
      "to": {
        "x": 5,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 1
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 5,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 2
      },
      "from": {
        "x": 2,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 3
      },
      "to": {
        "x": 3,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-07": [
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 8
      },
      "from": {
        "x": 6,
        "y": 7
      },
      "to": {
        "x": 6,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 6,
        "y": 7
      },
      "from": {
        "x": 6,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 5,
        "y": 5
      },
      "from": {
        "x": 6,
        "y": 5
      },
      "to": {
        "x": 7,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 2
      },
      "from": {
        "x": 2,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 3
      },
      "to": {
        "x": 3,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 3
      },
      "from": {
        "x": 3,
        "y": 4
      },
      "to": {
        "x": 3,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-08": [
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 2
      },
      "from": {
        "x": 2,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 1
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 3
      },
      "to": {
        "x": 3,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 3,
        "y": 3
      },
      "from": {
        "x": 3,
        "y": 4
      },
      "to": {
        "x": 3,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 5
      },
      "from": {
        "x": 3,
        "y": 5
      },
      "to": {
        "x": 4,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 5
      },
      "from": {
        "x": 4,
        "y": 5
      },
      "to": {
        "x": 5,
        "y": 5
      },
      "kind": "chest",
      "isFall": true
    }
  ],
  "level-lb-09": [
    {
      "dir": "right",
      "stand": {
        "x": 6,
        "y": 5
      },
      "from": {
        "x": 7,
        "y": 5
      },
      "to": {
        "x": 8,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 4
      },
      "from": {
        "x": 8,
        "y": 5
      },
      "to": {
        "x": 8,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 5
      },
      "from": {
        "x": 8,
        "y": 6
      },
      "to": {
        "x": 8,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 2,
        "y": 4
      },
      "from": {
        "x": 2,
        "y": 5
      },
      "to": {
        "x": 2,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 2,
        "y": 5
      },
      "from": {
        "x": 2,
        "y": 6
      },
      "to": {
        "x": 2,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-10": [
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 2
      },
      "from": {
        "x": 2,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 4,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 4,
        "y": 1
      },
      "from": {
        "x": 4,
        "y": 2
      },
      "to": {
        "x": 4,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 4,
        "y": 2
      },
      "from": {
        "x": 4,
        "y": 3
      },
      "to": {
        "x": 4,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 4,
        "y": 3
      },
      "from": {
        "x": 4,
        "y": 4
      },
      "to": {
        "x": 4,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 4,
        "y": 4
      },
      "from": {
        "x": 4,
        "y": 5
      },
      "to": {
        "x": 4,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 5,
        "y": 6
      },
      "from": {
        "x": 4,
        "y": 6
      },
      "to": {
        "x": 3,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 7,
        "y": 1
      },
      "from": {
        "x": 7,
        "y": 2
      },
      "to": {
        "x": 7,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 7,
        "y": 2
      },
      "from": {
        "x": 7,
        "y": 3
      },
      "to": {
        "x": 7,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 7,
        "y": 3
      },
      "from": {
        "x": 7,
        "y": 4
      },
      "to": {
        "x": 7,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 7,
        "y": 4
      },
      "from": {
        "x": 7,
        "y": 5
      },
      "to": {
        "x": 7,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 6
      },
      "from": {
        "x": 7,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 7,
        "y": 6
      },
      "from": {
        "x": 6,
        "y": 6
      },
      "to": {
        "x": 5,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 4,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 5,
        "y": 2
      },
      "from": {
        "x": 6,
        "y": 2
      },
      "to": {
        "x": 7,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 6,
        "y": 2
      },
      "from": {
        "x": 7,
        "y": 2
      },
      "to": {
        "x": 8,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 1
      },
      "from": {
        "x": 8,
        "y": 2
      },
      "to": {
        "x": 8,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 2
      },
      "from": {
        "x": 8,
        "y": 3
      },
      "to": {
        "x": 8,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 3
      },
      "from": {
        "x": 8,
        "y": 4
      },
      "to": {
        "x": 8,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 8,
        "y": 4
      },
      "from": {
        "x": 8,
        "y": 5
      },
      "to": {
        "x": 8,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-11": [
    {
      "dir": "left",
      "stand": {
        "x": 11,
        "y": 2
      },
      "from": {
        "x": 10,
        "y": 2
      },
      "to": {
        "x": 9,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 10,
        "y": 2
      },
      "from": {
        "x": 9,
        "y": 2
      },
      "to": {
        "x": 8,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 9,
        "y": 2
      },
      "from": {
        "x": 8,
        "y": 2
      },
      "to": {
        "x": 7,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 2
      },
      "from": {
        "x": 7,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 11,
        "y": 5
      },
      "from": {
        "x": 10,
        "y": 5
      },
      "to": {
        "x": 9,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 10,
        "y": 5
      },
      "from": {
        "x": 9,
        "y": 5
      },
      "to": {
        "x": 8,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 9,
        "y": 5
      },
      "from": {
        "x": 8,
        "y": 5
      },
      "to": {
        "x": 7,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 5
      },
      "from": {
        "x": 7,
        "y": 5
      },
      "to": {
        "x": 6,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 5
      },
      "from": {
        "x": 2,
        "y": 5
      },
      "to": {
        "x": 3,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 5
      },
      "from": {
        "x": 3,
        "y": 5
      },
      "to": {
        "x": 4,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 5
      },
      "from": {
        "x": 4,
        "y": 5
      },
      "to": {
        "x": 5,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 4
      },
      "from": {
        "x": 6,
        "y": 5
      },
      "to": {
        "x": 6,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 4,
        "y": 5
      },
      "from": {
        "x": 5,
        "y": 5
      },
      "to": {
        "x": 6,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 1
      },
      "from": {
        "x": 6,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 2
      },
      "from": {
        "x": 2,
        "y": 2
      },
      "to": {
        "x": 3,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 2
      },
      "from": {
        "x": 3,
        "y": 2
      },
      "to": {
        "x": 4,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 2
      },
      "from": {
        "x": 4,
        "y": 2
      },
      "to": {
        "x": 5,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 2
      },
      "from": {
        "x": 6,
        "y": 3
      },
      "to": {
        "x": 6,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 4,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 2
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 1
      },
      "from": {
        "x": 6,
        "y": 2
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    }
  ],
  "level-lb-12": [
    {
      "dir": "left",
      "stand": {
        "x": 11,
        "y": 3
      },
      "from": {
        "x": 10,
        "y": 3
      },
      "to": {
        "x": 9,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 10,
        "y": 3
      },
      "from": {
        "x": 9,
        "y": 3
      },
      "to": {
        "x": 8,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 9,
        "y": 3
      },
      "from": {
        "x": 8,
        "y": 3
      },
      "to": {
        "x": 7,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 3
      },
      "from": {
        "x": 7,
        "y": 3
      },
      "to": {
        "x": 6,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 2,
        "y": 8
      },
      "from": {
        "x": 2,
        "y": 7
      },
      "to": {
        "x": 2,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 11,
        "y": 7
      },
      "from": {
        "x": 10,
        "y": 7
      },
      "to": {
        "x": 9,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 10,
        "y": 7
      },
      "from": {
        "x": 9,
        "y": 7
      },
      "to": {
        "x": 8,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 9,
        "y": 7
      },
      "from": {
        "x": 8,
        "y": 7
      },
      "to": {
        "x": 7,
        "y": 7
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "up",
      "stand": {
        "x": 7,
        "y": 8
      },
      "from": {
        "x": 7,
        "y": 7
      },
      "to": {
        "x": 7,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "left",
      "stand": {
        "x": 8,
        "y": 6
      },
      "from": {
        "x": 7,
        "y": 6
      },
      "to": {
        "x": 6,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 6
      },
      "from": {
        "x": 2,
        "y": 6
      },
      "to": {
        "x": 3,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 6
      },
      "from": {
        "x": 3,
        "y": 6
      },
      "to": {
        "x": 4,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 6
      },
      "from": {
        "x": 4,
        "y": 6
      },
      "to": {
        "x": 5,
        "y": 6
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 2
      },
      "from": {
        "x": 6,
        "y": 3
      },
      "to": {
        "x": 6,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 6,
        "y": 3
      },
      "from": {
        "x": 6,
        "y": 4
      },
      "to": {
        "x": 6,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 1,
        "y": 3
      },
      "from": {
        "x": 2,
        "y": 3
      },
      "to": {
        "x": 3,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 2,
        "y": 3
      },
      "from": {
        "x": 3,
        "y": 3
      },
      "to": {
        "x": 4,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "right",
      "stand": {
        "x": 3,
        "y": 3
      },
      "from": {
        "x": 4,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 3
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 2
      },
      "from": {
        "x": 5,
        "y": 3
      },
      "to": {
        "x": 5,
        "y": 4
      },
      "kind": "chest",
      "isFall": false
    },
    {
      "dir": "down",
      "stand": {
        "x": 5,
        "y": 3
      },
      "from": {
        "x": 5,
        "y": 4
      },
      "to": {
        "x": 5,
        "y": 5
      },
      "kind": "chest",
      "isFall": false
    }
  ],
});
