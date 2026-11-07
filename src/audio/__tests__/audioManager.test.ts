/**
 * audioManager 生命周期单测（howler 以替身注入，不触真音频设备）。
 * 验证的是本项目最在意的四条纪律：
 *   S13 —— 未解锁时的播放请求进入意图队列，首次交互自动补播（无 go 门槛）；
 *   KT4/B5 —— BGM 可停：切曲淡出即 stop，卸载即停，没有任何「停不下来」分支；
 *   B6   —— dispose 后全部 Howl stop+unload，总线退订，全局音量复位；
 *   K11  —— 不可播条目/未知 id 记入错误队列，绝不静默吞掉。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../core/events/bus';

const { FakeHowl } = vi.hoisted(() => {
  interface FakeOpts {
    src: string[];
    loop?: boolean;
    volume?: number;
    preload?: boolean;
    onloaderror?: () => void;
    onplayerror?: () => void;
  }
  class FakeHowl {
    static instances: FakeHowl[] = [];
    readonly opts: FakeOpts;
    played = 0;
    stopped = false;
    unloaded = false;
    private volumeValue: number;
    private onceHandlers: Array<() => void> = [];
    constructor(opts: FakeOpts) {
      this.opts = opts;
      this.volumeValue = opts.volume ?? 1;
      FakeHowl.instances.push(this);
    }
    play(): number {
      this.played += 1;
      this.stopped = false;
      return this.played;
    }
    stop(): void {
      this.stopped = true;
    }
    unload(): void {
      this.unloaded = true;
      this.stopped = true;
    }
    volume(v?: number): number {
      if (v !== undefined) this.volumeValue = v;
      return this.volumeValue;
    }
    playing(): boolean {
      return !this.stopped;
    }
    once(_event: string, cb: () => void): this {
      this.onceHandlers.push(cb);
      return this;
    }
    fade(_from: number, _to: number, _ms: number): this {
      const handlers = this.onceHandlers;
      this.onceHandlers = [];
      for (const cb of handlers) cb();
      return this;
    }
  }
  return { FakeHowl };
});

vi.mock('howler', () => ({
  Howl: FakeHowl,
  Howler: { volume: vi.fn(), ctx: null },
}));

import {
  clearAudioErrors,
  computeVolumes,
  disposeAudioManager,
  getAudioDebugState,
  getAudioErrors,
  initAudioManager,
  playBgm,
  playSfx,
  shouldThrottle,
  sfxMinIntervalMs,
} from '../audioManager';
import { ALL_SFX_IDS } from '../../data/audio/manifest';
import { PRELOAD_SFX_IDS } from '../sfxTable';

/** 替身实例的结构视图（测试只断言这些成员，不依赖类类型） */
interface FakeHowlShape {
  readonly opts: { readonly loop?: boolean; readonly preload?: boolean };
  readonly played: number;
  readonly stopped: boolean;
  readonly unloaded: boolean;
}

const howlsOf = (loop: boolean | undefined): FakeHowlShape[] =>
  (FakeHowl.instances as unknown as readonly FakeHowlShape[]).filter((h) => h.opts.loop === loop);
const bgmHowls = (): FakeHowlShape[] => howlsOf(true);
const sfxHowls = (): FakeHowlShape[] => howlsOf(undefined);

beforeEach(() => {
  FakeHowl.instances.length = 0;
  clearAudioErrors();
  disposeAudioManager();
});

afterEach(() => {
  disposeAudioManager();
});

describe('audioManager —— 初始化与 SFX 池预载', () => {
  it('init 建 SFX 池：资源清单全量 20 条逐个预载（S13）', () => {
    initAudioManager();
    const state = getAudioDebugState();
    expect(state.active).toBe(true);
    expect(state.unlocked).toBe(false);
    expect(ALL_SFX_IDS.length).toBe(20);
    expect(state.sfxPoolSize).toBe(ALL_SFX_IDS.length);
    expect(state.sfxPoolSize).toBe(20);
    for (const howl of sfxHowls()) {
      expect(howl.opts.preload).toBe(true);
    }
  });

  it('语义表是清单的子集（PRELOAD_SFX_IDS ⊆ 清单全量）', () => {
    expect(PRELOAD_SFX_IDS.length).toBeLessThanOrEqual(ALL_SFX_IDS.length);
    for (const id of PRELOAD_SFX_IDS) {
      expect(ALL_SFX_IDS).toContain(id);
    }
  });

  it('init 幂等：重复调用不重复建池', () => {
    initAudioManager();
    initAudioManager();
    expect(sfxHowls().length).toBe(20);
  });
});

describe('audioManager —— 首次交互自动解锁（S13，替代 go 门槛）', () => {
  it('解锁前 playBgm 进入意图队列；首次交互后自动补播', () => {
    initAudioManager();
    const queued = playBgm('bgm-sanb');
    expect(queued.ok).toBe(false);
    expect(queued.queued).toBe(true);
    expect(getAudioDebugState().desiredBgmId).toBe('bgm-sanb');
    expect(bgmHowls().length).toBe(0); // 未解锁不建 BGM 实例

    window.dispatchEvent(new Event('pointerdown'));
    expect(getAudioDebugState().unlocked).toBe(true);
    expect(getAudioDebugState().desiredBgmId).toBeNull();
    expect(getAudioDebugState().currentBgmId).toBe('bgm-sanb');
    expect(bgmHowls().length).toBe(1);
    expect(bgmHowls()[0]?.played).toBe(1);
    expect(bgmHowls()[0]?.opts.loop).toBe(true);
  });

  it('解锁后同 id 去重、异 id 切曲淡出即停（KT4/B5）', () => {
    initAudioManager();
    window.dispatchEvent(new Event('keydown'));

    expect(playBgm('bgm-sanb').ok).toBe(true);
    const first = bgmHowls()[0];
    expect(first?.played).toBe(1);

    // 同 id：去重，不再 play
    expect(playBgm('bgm-sanb').reason).toBe('same');
    expect(first?.played).toBe(1);

    // 异 id：新实例播放，旧实例淡出后 stop（fake 的 fade 立即触发 once 回调）
    expect(playBgm('bgm-bandori').ok).toBe(true);
    expect(bgmHowls().length).toBe(2);
    expect(first?.stopped).toBe(true);
    expect(getAudioDebugState().currentBgmId).toBe('bgm-bandori');
  });

  it('stopBgm 停掉当前曲并清空排队意图（经 bus bgm/stop 触发同一实现）', () => {
    initAudioManager();
    window.dispatchEvent(new Event('touchstart'));
    playBgm('bgm-sanb');
    const current = bgmHowls()[0];
    bus.publish({ type: 'bgm/stop' });
    expect(current?.stopped).toBe(true);
    expect(getAudioDebugState().currentBgmId).toBeNull();
  });
});

describe('audioManager —— K11：错误上屏不吞', () => {
  it('不可播条目（.mid）明确记录并拒绝', () => {
    initAudioManager();
    window.dispatchEvent(new Event('pointerdown'));
    const r = playBgm('bgm-god-knows');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unplayable');
    expect(getAudioErrors().some((e) => e.kind === 'bgm-unplayable' && e.assetId === 'bgm-god-knows')).toBe(true);
    expect(getAudioDebugState().currentBgmId).toBeNull();
  });

  it('未知 id 记录为 missing；清理接口可用', () => {
    initAudioManager();
    expect(playBgm('bgm-nope').reason).toBe('missing');
    expect(playSfx('sfx-nope')).toBe(false);
    expect(getAudioErrors().length).toBeGreaterThanOrEqual(2);
    clearAudioErrors();
    expect(getAudioErrors().length).toBe(0);
  });
});

describe('audioManager —— SFX 池与节流', () => {
  it('池内直接复用实例，节流窗口内不重播', () => {
    initAudioManager();
    expect(playSfx('sfx-effect-1')).toBe(true);
    expect(playSfx('sfx-effect-1')).toBe(false); // 40ms 节流窗内
    expect(sfxHowls()[0]?.played).toBe(1);
    expect(playSfx('sfx-effect-3')).toBe(true); // 不同 id 不互相节流
  });

  it('sfxMinIntervalMs 兜底未知 id', () => {
    expect(sfxMinIntervalMs('sfx-effect-3')).toBe(120);
    expect(sfxMinIntervalMs('sfx-unknown')).toBe(60);
  });
});

describe('audioManager —— B6：卸载即停、无泄漏', () => {
  it('dispose 停止并 unload 一切实例、退订总线、复位状态', () => {
    const subscribersBefore = bus.subscriberCount();
    initAudioManager();
    window.dispatchEvent(new Event('pointerdown'));
    playBgm('bgm-sanb');
    playSfx('sfx-effect-1');
    expect(bus.subscriberCount()).toBe(subscribersBefore + 1);

    disposeAudioManager();
    expect(FakeHowl.instances.length).toBeGreaterThan(0);
    for (const howl of FakeHowl.instances) {
      expect(howl.stopped, 'dispose 后仍有未停止的实例').toBe(true);
      expect(howl.unloaded, 'dispose 后仍有未 unload 的实例').toBe(true);
    }
    const state = getAudioDebugState();
    expect(state.active).toBe(false);
    expect(state.bgmPoolSize).toBe(0);
    expect(state.sfxPoolSize).toBe(0);
    expect(bus.subscriberCount()).toBe(subscribersBefore);
  });

  it('dispose 幂等：重复调用不抛错', () => {
    initAudioManager();
    disposeAudioManager();
    expect(() => disposeAudioManager()).not.toThrow();
  });
});

describe('audioManager —— 音量模型（纯函数）', () => {
  it('静音时全通道为 0', () => {
    const v = computeVolumes({
      masterVolume: 0.8,
      bgmVolume: 0.6,
      sfxVolume: 0.8,
      muted: true,
      cheatsEnabled: false,
      touchControls: false,
    });
    expect(v.master).toBe(0);
    expect(v.bgm).toBe(0);
    expect(v.sfx).toBe(0);
  });

  it('正常路径为主音量 × 通道音量，并夹取到 [0,1]', () => {
    const v = computeVolumes({
      masterVolume: 0.8,
      bgmVolume: 0.5,
      sfxVolume: 2,
      muted: false,
      cheatsEnabled: false,
      touchControls: false,
    });
    expect(v.master).toBeCloseTo(0.8);
    expect(v.bgm).toBeCloseTo(0.4);
    expect(v.sfx).toBe(1);
  });

  it('shouldThrottle 数值语义', () => {
    expect(shouldThrottle(1000, 1050, 60)).toBe(true);
    expect(shouldThrottle(1000, 1060, 60)).toBe(false);
    expect(shouldThrottle(1000, 1061, 60)).toBe(false);
  });
});
