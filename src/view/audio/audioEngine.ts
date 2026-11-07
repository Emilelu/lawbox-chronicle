/**
 * audio-engine —— howler + 事件总线。
 * ---------------------------------------------------------------------------
 * 订阅 core/events/bus 的音频事件；Howl 实例由本模块统一持有：
 *  - BGM 切换即 stop 旧的（卸载/切曲即停，杜绝后台长鸣）；
 *  - 组件卸载（React 生命周期 cleanup）时 stopAll；
 *  - 资源 URL 经打包器 import.meta.glob 解析（构建期确定，无运行时路径猜测）。
 * 对应根治：KichikuAdventure 非守护线程挂死、BandoriLotteryEmulator 异常
 * System.exit 杀主线程、SanBPushChest service.js:3-12 首键 go 门槛无声。
 */

import { Howl, Howler } from 'howler';
import { bus, type FxHandler } from '../../core/events/bus';
import { AUDIO_MANIFEST } from '../../data/audio';
import type { BgmDef, SfxDef } from '../../core/types';
import { useGameStore } from '../../core/store/gameStore';

/* 资产 URL 表：构建期由 Vite 生成（key=模块路径, value=产物 URL） */
const ASSET_URLS = import.meta.glob('../../assets/**/*.{mp3,wav,mid,ogg}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function resolveAssetUrl(manifestFile: string): string | undefined {
  const entry = Object.entries(ASSET_URLS).find(([path]) => path.endsWith(`/${manifestFile}`));
  return entry?.[1];
}

function masterVolume(): number {
  const { settings } = useGameStore.getState();
  return settings.muted ? 0 : settings.masterVolume;
}

export interface AudioEngineHandle {
  /** 退订 bus + 停止一切声音（React useEffect cleanup 直接返回本函数） */
  readonly dispose: () => void;
}

export function mountAudioEngine(): AudioEngineHandle {
  let currentBgmId: string | null = null;
  let currentBgm: Howl | null = null;
  const oneShots = new Set<Howl>();

  const stopBgm = () => {
    currentBgm?.stop();
    currentBgm?.unload();
    currentBgm = null;
    currentBgmId = null;
  };

  const playBgm = (bgmId: string) => {
    if (currentBgmId === bgmId) return;
    const def: BgmDef | undefined = AUDIO_MANIFEST.bgm.find((b) => b.id === bgmId);
    if (def === undefined || !def.playable) return; // .mid 等待转换的条目直接跳过
    const url = resolveAssetUrl(def.file);
    if (url === undefined) return;
    stopBgm();
    currentBgmId = def.id;
    currentBgm = new Howl({ src: [url], loop: true, volume: masterVolume() * useGameStore.getState().settings.bgmVolume });
    currentBgm.play();
  };

  const playSfx = (sfxId: string) => {
    const def: SfxDef | undefined = AUDIO_MANIFEST.sfx.find((s) => s.id === sfxId);
    if (def === undefined) return;
    const url = resolveAssetUrl(def.file);
    if (url === undefined) return;
    const howl = new Howl({ src: [url], volume: masterVolume() * useGameStore.getState().settings.sfxVolume });
    oneShots.add(howl);
    howl.once('end', () => {
      oneShots.delete(howl);
      howl.unload();
    });
    howl.play();
  };

  const handler: FxHandler = (event) => {
    switch (event.type) {
      case 'bgm/play':
        playBgm(event.bgmId);
        break;
      case 'bgm/stop':
        stopBgm();
        break;
      case 'sfx/play':
        playSfx(event.sfxId);
        break;
      default:
        break; // 非音频事件不关心
    }
  };

  const unsubscribe = bus.subscribe(handler);

  return {
    dispose() {
      unsubscribe();
      stopBgm();
      for (const howl of oneShots) {
        howl.stop();
        howl.unload();
      }
      oneShots.clear();
      Howler.volume(1);
    },
  };
}
