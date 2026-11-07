/**
 * 音频清单 —— 唯一数据源。
 * ---------------------------------------------------------------------------
 * 资产来源（均已在搬运时重命名避免歧义）：
 *  - bgm/sanb-pushchest-bgm.mp3   ← SanBPushChest/assets/audios/bgm.mp3
 *  - bgm/bandori-lottery-bgm.mp3  ← BandoriLotteryEmulator/bgm.mp3
 *  - bgm/god-knows.mp3 / black-rose.mp3 ← KichikuAdventure 的两个 .mid
 *    经 FluidSynth 2.6.2 + GeneralUser GS 音源离线渲染为 wav，再用
 *    ffmpeg（libmp3lame）转码为 mp3；.mid 原件保留在
 *    src/assets/audio/midi/ 备查。
 *  - sfx/effect*.wav ← SanBPushChest/assets/audios/effects/effect*.wav(20)
 * 播放由 howler 承担：资源经打包器 import 解析，BGM/SFX 挂 React 生命周期，
 * 组件卸载即停 —— 一次性根治三个老项目的音乐 bug（非守护线程挂死 /
 * 异常 System.exit 杀主线程 / 首键 go 门槛无声）。
 */

import type { AudioManifest } from '../core/types';

export const AUDIO_MANIFEST: AudioManifest = {
  bgm: [
    {
      id: 'bgm-sanb',
      title: '箱庭回响',
      file: 'bgm/sanb-pushchest-bgm.mp3',
      source: 'SanBPushChest/assets/audios/bgm.mp3',
      playable: true,
    },
    {
      id: 'bgm-bandori',
      title: '星愿祭坛',
      file: 'bgm/bandori-lottery-bgm.mp3',
      source: 'BandoriLotteryEmulator/bgm.mp3',
      playable: true,
    },
    {
      id: 'bgm-god-knows',
      title: 'God Knows…',
      file: 'bgm/god-knows.mp3',
      source: 'KichikuAdventure/src/me/emilelu/KichikuAdventure/GodKnows.mid',
      playable: true,
    },
    {
      id: 'bgm-black-rose',
      title: 'Black Rose',
      file: 'bgm/black-rose.mp3',
      source: 'KichikuAdventure/src/me/emilelu/KichikuAdventure/black_rose.mid',
      playable: true,
    },
  ],
  sfx: [
    { id: 'sfx-effect-1', file: 'sfx/effect.wav', source: 'SanBPushChest/assets/audios/effects/effect.wav' },
    ...Array.from({ length: 19 }, (_, i) => {
      const n = i + 2;
      return {
        id: `sfx-effect-${n}`,
        file: `sfx/effect${n}.wav`,
        source: `SanBPushChest/assets/audios/effects/effect${n}.wav`,
      };
    }),
  ],
};

export function findBgm(bgmId: string) {
  return AUDIO_MANIFEST.bgm.find((b) => b.id === bgmId);
}
