/**
 * audioManager —— howler 的唯一封装层（模块级单例，零 React 依赖）。
 * ---------------------------------------------------------------------------
 * 对应根治的老 bug：
 *  - K11（KichikuAdventure Music.java:40-43 吞异常 / :13-15 硬编码路径 /
 *    Music.java:40-57 while(isEnd==0) 轮询且 setIsEnd 全仓库零调用）：
 *    资源 URL 全部经打包器 import.meta.glob 构建期解析，任何加载/播放失败
 *    记入错误队列并广播 toast，绝不静默吞掉；
 *  - S13（SanBPushChest service.js:3-12 首键 go 门槛：go=false 时音效直接
 *    return）：SFX 池初始化即全量预载 + 显式「首次交互解锁」—— 解锁前的
 *    播放请求进入意图队列，用户第一次 pointerdown/keydown/touchstart 时
 *    resume AudioContext 并补播，无需任何按键作为前置条件；
 *  - B5/B6（BandoriLotteryEmulator Music.java:54-57 异常 System.exit(0) 杀
 *    主线程、Lottery.java:7-12 非守护线程 while(fuck==1) 无限循环、流泄漏）：
 *    所有 Howl 实例由本模块统一持有，BGM 淡出即 stop，dispose() 一次性
 *    stop+unload 全部实例并复位 Howler 全局音量 —— 卸载即停、无流泄漏。
 *
 * 生命周期归属见 BGMController.tsx（React 挂载点）；本文件不 import React。
 */

import { Howl, Howler } from 'howler';
import { bus, type FxHandler } from '../core/events/bus';
import { useGameStore, type GameStore } from '../core/store/gameStore';
import { ALL_SFX_IDS, findBgmEntry, findSfxEntry, type LicensedBgmEntry } from '../data/audio/manifest';
import { SFX, SFX_MIN_INTERVAL_MS, type SfxKey } from './sfxTable';

/* ============================== 纯函数工具 ================================= */

export interface ChannelVolumes {
  /** 全局主音量（muted 时为 0） */
  readonly master: number;
  /** BGM 通道绝对音量 */
  readonly bgm: number;
  /** SFX 通道绝对音量 */
  readonly sfx: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** 由设置面板的三滑条+静音开关计算各通道最终音量（纯函数，可测） */
export function computeVolumes(settings: GameStore['settings']): ChannelVolumes {
  const master = settings.muted ? 0 : clamp01(settings.masterVolume);
  return {
    master,
    // 先乘后夹：主音量 × 通道音量，最终值恒在 [0,1]
    bgm: clamp01(master * settings.bgmVolume),
    sfx: clamp01(master * settings.sfxVolume),
  };
}

/** 节流判定：距上次播放不足 minMs 则跳过（纯函数，可测） */
export function shouldThrottle(lastPlayedAt: number, now: number, minMs: number): boolean {
  return now - lastPlayedAt < minMs;
}

/** sfx id → 最小重播间隔（SFX 语义表的反向投影，未知 id 用默认值） */
const DEFAULT_SFX_MIN_MS = 60;
const SFX_ID_MIN_MS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(SFX) as SfxKey[]).map((key) => [SFX[key], SFX_MIN_INTERVAL_MS[key]]),
  ),
);

export function sfxMinIntervalMs(sfxId: string): number {
  return SFX_ID_MIN_MS[sfxId] ?? DEFAULT_SFX_MIN_MS;
}

/* ============================== 资产 URL 解析 ============================== */

/** 构建期资产 URL 表：key=相对本文件的模块路径，value=打包产物 URL */
const AUDIO_ASSET_URLS = import.meta.glob('../assets/audio/**/*.{mp3,wav,mid,ogg}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** manifest 的 file 字段（相对 src/assets/audio/）→ 产物 URL；找不到返回 undefined */
export function resolveAudioUrl(manifestFile: string): string | undefined {
  const suffix = `/${manifestFile}`;
  for (const [path, url] of Object.entries(AUDIO_ASSET_URLS)) {
    if (path.endsWith(suffix)) return url;
  }
  return undefined;
}

/* ================================ 错误记录 ================================= */

export type AudioErrorKind =
  | 'bgm-load'
  | 'bgm-play'
  | 'bgm-unplayable'
  | 'sfx-load'
  | 'sfx-play'
  | 'sfx-missing';

export interface AudioError {
  readonly kind: AudioErrorKind;
  readonly assetId: string;
  readonly message: string;
  readonly at: number;
}

const MAX_ERRORS = 20;
const errors: AudioError[] = [];

function recordError(kind: AudioErrorKind, assetId: string, message: string): void {
  const entry: AudioError = { kind, assetId, message, at: Date.now() };
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.shift();
  // K11 教训：绝不吞异常 —— 控制台可见 + 上屏（toast 键由 UI 层解析）+ 可查询
  console.error(`[audio] ${kind}: ${assetId} — ${message}`);
  bus.publish({ type: 'ui/toast', messageKey: 'toast.audioError' });
}

/** 读取（并按需清空）音频错误队列 —— 调试面板与测试的观测点 */
export function getAudioErrors(): readonly AudioError[] {
  return errors;
}

export function clearAudioErrors(): void {
  errors.length = 0;
}

/* ================================ 运行时 =================================== */

const BGM_FADE_OUT_MS = 600;
const BGM_FADE_IN_MS = 800;

interface AudioRuntime {
  /** BGM 实例按 id 复用（切曲回来免重新解码），dispose 时统一 unload */
  readonly bgmPool: Map<string, Howl>;
  /** SFX 池：初始化即全量预载 */
  readonly sfxPool: Map<string, Howl>;
  currentBgmId: string | null;
  /** 解锁前排队的播放意图（S13：替代 go 门槛） */
  desiredBgmId: string | null;
  unlocked: boolean;
  readonly lastPlayedAt: Map<string, number>;
  readonly unsubBus: () => void;
  readonly unsubStore: () => void;
  readonly unlockEvents: readonly string[];
  removeUnlockListeners: () => void;
}

let runtime: AudioRuntime | null = null;

/* ------------------------------ Howl 构造 --------------------------------- */

/**
 * 运行时代际：init/dispose 各自推进。StrictMode 双挂载（mount→dispose→mount）
 * 会把首池的在途加载变成迟到的 onloaderror —— 已销毁池的错误是陈账，不再
 * 记录与上屏（否则冷启动会刷出一排 toast.audioError；当前池的错误照常记录）。
 */
let runtimeGeneration = 0;

function createSfxHowl(sfxId: string, generation: number): Howl | null {
  const entry = findSfxEntry(sfxId);
  if (entry === undefined) {
    recordError('sfx-missing', sfxId, '清单中不存在该 sfx id');
    return null;
  }
  const url = resolveAudioUrl(entry.file);
  if (url === undefined) {
    recordError('sfx-load', entry.file, '打包产物中未找到资产 URL');
    return null;
  }
  return new Howl({
    src: [url],
    preload: true,
    volume: 1,
    onloaderror: () => {
      if (generation !== runtimeGeneration) return; // 已销毁池的迟到错误：忽略
      recordError('sfx-load', entry.id, `加载失败：${entry.file}`);
    },
    onplayerror: () => {
      if (generation !== runtimeGeneration) return;
      recordError('sfx-play', entry.id, '播放失败（可能被浏览器策略拦截）');
    },
  });
}

function createBgmHowl(def: LicensedBgmEntry, url: string, volume: number, generation: number): Howl {
  return new Howl({
    src: [url],
    loop: true,
    volume,
    onloaderror: () => {
      if (generation !== runtimeGeneration) return;
      recordError('bgm-load', def.id, `加载失败：${def.file}`);
    },
    onplayerror: () => {
      if (generation !== runtimeGeneration) return;
      recordError('bgm-play', def.id, '播放失败（可能被浏览器策略拦截）');
    },
  });
}

/* ------------------------------ BGM 控制 ---------------------------------- */

export interface PlayBgmResult {
  readonly ok: boolean;
  /** false 且 queued=true：已排队等待首次交互解锁后自动补播 */
  readonly queued: boolean;
  readonly reason?: 'missing' | 'unplayable' | 'no-url' | 'queued' | 'same';
}

export function playBgm(bgmId: string): PlayBgmResult {
  const rt = runtime;
  if (rt === null) return { ok: false, queued: false, reason: 'missing' };
  if (rt.currentBgmId === bgmId) return { ok: true, queued: false, reason: 'same' };

  const def = findBgmEntry(bgmId);
  if (def === undefined) {
    recordError('bgm-load', bgmId, '清单中不存在该 bgm id');
    return { ok: false, queued: false, reason: 'missing' };
  }
  if (!def.playable) {
    // .mid 条目的诚实契约：明确记录而非假装在播
    recordError('bgm-unplayable', def.id, '该条目标记为不可播（.mid 等待转码），已跳过');
    return { ok: false, queued: false, reason: 'unplayable' };
  }
  const url = resolveAudioUrl(def.file);
  if (url === undefined) {
    recordError('bgm-load', def.file, '打包产物中未找到资产 URL');
    return { ok: false, queued: false, reason: 'no-url' };
  }

  if (!rt.unlocked) {
    rt.desiredBgmId = bgmId;
    return { ok: false, queued: true, reason: 'queued' };
  }

  fadeOutCurrentBgm(rt);
  const volumes = computeVolumes(useGameStore.getState().settings);
  let howl = rt.bgmPool.get(def.id);
  if (howl === undefined) {
    howl = createBgmHowl(def, url, 0, runtimeGeneration);
    rt.bgmPool.set(def.id, howl);
  }
  rt.currentBgmId = def.id;
  howl.play();
  // 淡入：音量从 0 升到通道音量（fade 的 from=0 显式给出，行为确定）
  howl.fade(0, Math.max(volumes.bgm, 0.0001), BGM_FADE_IN_MS);
  return { ok: true, queued: false };
}

function fadeOutCurrentBgm(rt: AudioRuntime): void {
  const currentId = rt.currentBgmId;
  rt.currentBgmId = null;
  if (currentId === null) return;
  const howl = rt.bgmPool.get(currentId);
  if (howl === undefined || !howl.playing()) {
    if (howl !== undefined) howl.stop();
    return;
  }
  howl.once('fade', () => howl.stop());
  howl.fade(howl.volume(), 0, BGM_FADE_OUT_MS);
}

export function stopBgm(): void {
  const rt = runtime;
  if (rt === null) return;
  rt.desiredBgmId = null;
  fadeOutCurrentBgm(rt);
}

/* ------------------------------ SFX 池 ------------------------------------ */

export function playSfx(sfxId: string): boolean {
  const rt = runtime;
  if (rt === null) return false;
  const now = Date.now();
  const last = rt.lastPlayedAt.get(sfxId);
  if (last !== undefined && shouldThrottle(last, now, sfxMinIntervalMs(sfxId))) return false;
  rt.lastPlayedAt.set(sfxId, now);

  let howl = rt.sfxPool.get(sfxId);
  if (howl === undefined) {
    const created = createSfxHowl(sfxId, runtimeGeneration);
    if (created === null) return false;
    howl = created;
    rt.sfxPool.set(sfxId, howl);
  }
  howl.volume(computeVolumes(useGameStore.getState().settings).sfx);
  howl.play();
  return true;
}

/* ------------------------------ 音量同步 ---------------------------------- */

function applyVolumes(): void {
  const rt = runtime;
  if (rt === null) return;
  const { master, bgm, sfx } = computeVolumes(useGameStore.getState().settings);
  Howler.volume(master);
  for (const howl of rt.bgmPool.values()) howl.volume(bgm);
  for (const howl of rt.sfxPool.values()) howl.volume(sfx);
}

/* --------------------------- 首次交互自动解锁 ------------------------------ */

const UNLOCK_EVENT_TYPES = ['pointerdown', 'keydown', 'touchstart'] as const;

function unlockAudio(): void {
  const rt = runtime;
  if (rt === null || rt.unlocked) return;
  rt.unlocked = true;
  // Howler 的 WebAudio 上下文若被浏览器自动播放策略挂起，显式唤醒
  const ctx = Howler.ctx as AudioContext | null | undefined;
  if (ctx !== null && ctx !== undefined && ctx.state === 'suspended') void ctx.resume();

  const pending = rt.desiredBgmId;
  rt.desiredBgmId = null;
  if (pending !== null) playBgm(pending);
}

function installUnlockListeners(rt: AudioRuntime): void {
  if (typeof window === 'undefined') return;
  const handler = (): void => unlockAudio();
  for (const type of UNLOCK_EVENT_TYPES) window.addEventListener(type, handler, { capture: true, passive: true });
  rt.removeUnlockListeners = () => {
    for (const type of UNLOCK_EVENT_TYPES) window.removeEventListener(type, handler, { capture: true });
  };
}

/* -------------------------------- 初始化 ---------------------------------- */

export interface AudioManagerHandle {
  /** 停止并 unload 一切实例、退订总线/存储、移除解锁监听（幂等） */
  readonly dispose: () => void;
}

/**
 * 初始化音频运行时（幂等；重复调用返回现存句柄）。
 * 由 BGMController 在 React 挂载时调用 —— 本模块自身不决定生命周期。
 */
export function initAudioManager(): AudioManagerHandle {
  if (runtime !== null) return { dispose: disposeAudioManager };

  const generation = ++runtimeGeneration;
  const sfxPool = new Map<string, Howl>();
  // 预载清单 = 资源清单全量 20 条（语义表未引用的条目也进池，池即表的完整缓存）
  for (const id of ALL_SFX_IDS) {
    const howl = createSfxHowl(id, generation);
    if (howl !== null) sfxPool.set(id, howl);
  }

  const busHandler: FxHandler = (event) => {
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
  const unsubBus = bus.subscribe(busHandler);

  let prevSettings = useGameStore.getState().settings;
  const unsubStore = useGameStore.subscribe((state) => {
    if (state.settings !== prevSettings) {
      prevSettings = state.settings;
      applyVolumes();
    }
  });

  const rt: AudioRuntime = {
    bgmPool: new Map(),
    sfxPool,
    currentBgmId: null,
    desiredBgmId: null,
    unlocked: false,
    lastPlayedAt: new Map(),
    unsubBus,
    unsubStore,
    unlockEvents: UNLOCK_EVENT_TYPES,
    removeUnlockListeners: () => undefined,
  };
  installUnlockListeners(rt);
  runtime = rt;
  applyVolumes();

  return { dispose: disposeAudioManager };
}

/** 停止并释放一切（BGM/SFX 全 unload、Howler 全局音量复位、退订、拆监听） */
export function disposeAudioManager(): void {
  const rt = runtime;
  if (rt === null) return;
  runtime = null;
  runtimeGeneration += 1; // 本池在途加载的迟到错误不再上屏

  rt.removeUnlockListeners();
  rt.unsubBus();
  rt.unsubStore();

  for (const howl of rt.bgmPool.values()) {
    howl.stop();
    howl.unload();
  }
  rt.bgmPool.clear();

  for (const howl of rt.sfxPool.values()) {
    howl.stop();
    howl.unload();
  }
  rt.sfxPool.clear();
  rt.lastPlayedAt.clear();

  rt.currentBgmId = null;
  rt.desiredBgmId = null;
  rt.unlocked = false;

  Howler.volume(1); // 复位全局状态，避免残留静音影响下一个挂载周期
}

/* ------------------------------- 观测接口 --------------------------------- */

export interface AudioDebugState {
  readonly active: boolean;
  readonly unlocked: boolean;
  readonly currentBgmId: string | null;
  readonly desiredBgmId: string | null;
  readonly bgmPoolSize: number;
  readonly sfxPoolSize: number;
}

export function getAudioDebugState(): AudioDebugState {
  const rt = runtime;
  return {
    active: rt !== null,
    unlocked: rt?.unlocked ?? false,
    currentBgmId: rt?.currentBgmId ?? null,
    desiredBgmId: rt?.desiredBgmId ?? null,
    bgmPoolSize: rt?.bgmPool.size ?? 0,
    sfxPoolSize: rt?.sfxPool.size ?? 0,
  };
}
