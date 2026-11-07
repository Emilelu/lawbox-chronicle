/**
 * BGMController —— 音频生命周期的唯一 React 挂载点。
 * ---------------------------------------------------------------------------
 * 挂载位置：顶层 App（coreFiles 的 src/App.tsx）渲染树的根部：
 *
 *     import { BGMController } from './audio/BGMController';
 *     function App() { return (<><BGMController /> ...其余视图</>); }
 *
 * 职责（对应设计「挂生命周期、卸载即停」的明确落点）：
 *  1. useEffect 挂载时 initAudioManager()：建 SFX 池并全量预载、订阅事件总线
 *     与 store 音量设置、安装首次交互自动解锁（S13，替代 SanBPushChest 的
 *     go 门槛）；
 *  2. 订阅 store 的 phase/区域变化，按 REGION 映射切曲（切曲淡出旧实例）；
 *  3. 组件卸载时 dispose：BGM/SFX 全部 Howl stop+unload、Howler 全局音量
 *     复位、退订总线 —— 根治三个老仓库的音乐 bug：
 *     - KichikuAdventure Game.java:7-14 `new Thread(...).start()` 非守护线程
 *       播放循环，进程退出都拦不住；
 *     - BandoriLotteryEmulator Music.java:54-57 异常 System.exit(0) 连坐主
 *       线程、Lottery.java:7-12 线程无法从外部停止；
 *     - KichikuAdventure Music.java:40-57 的 setIsEnd 全仓库零调用（KT4），
 *       BGM 无法停止 —— 这里卸载即停，没有任何「停不下来」的分支。
 *
 * 本组件不渲染任何 UI（返回 null）；重复挂载/StrictMode 双执行均安全
 * （initAudioManager 幂等、dispose 完全复位）。
 */

import { useEffect } from 'react';
import { useGameStore } from '../core/store/gameStore';
import type { GameState } from '../core/types';
import { initAudioManager, playBgm } from './audioManager';

/**
 * 区域 → BGM 的映射（纯函数，vitest 可测）。
 * 当前可播曲目仅两首（见 manifest 的 playable 契约）：箱庭（探索/标题）
 * 用 sanb-pushchest-bgm，星愿祭坛（抽卡）用 bandori-lottery-bgm。
 * domain-1..3 外域的专属曲目录入后，在「segment 存在」分支按 level.area
 * 扩展映射即可 —— store 在 startLevel/rollGacha 也发显式 bgm/play 事件，
 * 播放器对同一 id 去重，两路控制天然收敛。
 */
export function desiredBgmFor(state: GameState): string {
  if (state.phase === 'gacha') return 'bgm-bandori'; // 星愿祭坛 → Bandori 旋律
  return 'bgm-sanb'; // 标题画面与全部探索区域 → 箱庭回响
}

export function BGMController(): null {
  useEffect(() => {
    const handle = initAudioManager();

    // 挂载即声明当前区域的曲子：页面无交互时进入意图队列，首次交互自动补播
    let prevBgm = desiredBgmFor(useGameStore.getState());
    playBgm(prevBgm);

    const unsubscribe = useGameStore.subscribe((state) => {
      const next = desiredBgmFor(state);
      if (next !== prevBgm) {
        prevBgm = next;
        playBgm(next);
      }
    });

    return () => {
      unsubscribe();
      handle.dispose();
    };
  }, []);

  return null;
}
