/**
 * 资源清单单源 —— 每条素材必带 { source, license } 出处字段。
 * ---------------------------------------------------------------------------
 * 与 src/data/audio.ts（数据层 BGM/SFX 播放清单）的关系：
 *  - audio.ts 回答「怎么播」（id / file / playable），是 WORLD_TABLES 校验的
 *    音频子表；本文件在其之上回答「从哪来、能不能上架」（license 维度），
 *    并收录 32 张图片素材（barriers/directions/items/keys/roles/utils）。
 *  - bgm/sfx 的 id 与 file 一律从 audio.ts 引用再补许可字段，绝不复制第二份
 *    id 表 —— 双真相源只会重演 README 与代码系统性不一致（Kichiku K14）。
 *
 * 许可结论（逐条对照过原仓库，出处见各条 source 与 origin 字段）：
 *  - sanb-pushchest-bgm.mp3 与 20×wav、32×图：SanBPushChest 自有资产，GPL-3.0
 *    （SanBPushChest/LICENSE + index.html:8「Copyright (C) 2020 Emilelu」）；
 *  - bandori-lottery-bgm.mp3：BanG Dream 官方专辑（BandoriLotteryEmulator/
 *    README.md:8「BGM 取自 BanG Dream 官方专辑」），license 标注
 *    replaceBeforeShip —— 上架前必须替换或取得授权；
 *  - GodKnows.mid / black_rose.mid：KichikuAdventure 仓库资产（GPLv3 项目，
 *    其 README.md:5 自述为需手动复制的 mid 曲目），浏览器不可播，playable:false，
 *    待 MIDI→音频格式转码后才能进播放管线。
 */

import { AUDIO_MANIFEST } from '../audio';

/* ================================ 类型 ==================================== */

/** 资产许可：GPL-3.0 = 可随项目开源分发；replaceBeforeShip = 上架前必须处理 */
export type AssetLicense = 'GPL-3.0' | 'replaceBeforeShip';

export interface LicenseInfo {
  /** 原仓库内的相对路径（上游出处，署名与溯源用） */
  readonly source: string;
  readonly license: AssetLicense;
  /** 原始仓库（三仓库署名承诺的落点） */
  readonly origin: 'SanBPushChest' | 'BandoriLotteryEmulator' | 'KichikuAdventure';
  /** 许可补充说明（如 replaceBeforeShip 的处置动作） */
  readonly note?: string;
}

export interface LicensedBgmEntry extends LicenseInfo {
  readonly id: string;
  /** 相对 src/assets/audio/ 的路径（与 data/audio.ts 同基准） */
  readonly file: string;
  readonly title: string;
  /** false = 浏览器不可播（.mid 等待转码），播放器必须跳过 */
  readonly playable: boolean;
}

export interface LicensedSfxEntry extends LicenseInfo {
  readonly id: string;
  /** 相对 src/assets/audio/ 的路径 */
  readonly file: string;
}

export type ImageKind = 'barrier' | 'direction' | 'item' | 'key' | 'role' | 'util';

export interface LicensedImageEntry extends LicenseInfo {
  readonly id: string;
  /** 相对 src/assets/ 的路径（图片基准与音频不同，见 ASSET_BASE） */
  readonly file: string;
  readonly kind: ImageKind;
}

export interface AssetManifest {
  readonly bgm: readonly LicensedBgmEntry[];
  readonly sfx: readonly LicensedSfxEntry[];
  readonly images: readonly LicensedImageEntry[];
}

/* ============================== 许可维度补全 ============================== */

const SANB_NOTE = 'SanBPushChest 自有资产（GPL-3.0），新项目按 GPLv3 兼容开源并保留署名';

const BGM_LICENSES: Readonly<Record<string, Omit<LicenseInfo, 'source'>>> = Object.freeze({
  'bgm-sanb': {
    license: 'GPL-3.0',
    origin: 'SanBPushChest',
    note: SANB_NOTE,
  },
  'bgm-bandori': {
    license: 'replaceBeforeShip',
    origin: 'BandoriLotteryEmulator',
    note: 'BanG Dream 官方专辑曲目（BandoriLotteryEmulator/README.md:8），上架前必须替换或取得授权',
  },
  'bgm-god-knows': {
    license: 'GPL-3.0',
    origin: 'KichikuAdventure',
    note: 'KichikuAdventure 仓库资产（GPLv3）；.mid 浏览器不可播，等待 MIDI 转码',
  },
  'bgm-black-rose': {
    license: 'GPL-3.0',
    origin: 'KichikuAdventure',
    note: 'KichikuAdventure 仓库资产（GPLv3）；.mid 浏览器不可播，等待 MIDI 转码',
  },
});

const SFX_LICENSE: Omit<LicenseInfo, 'source'> = Object.freeze({
  license: 'GPL-3.0',
  origin: 'SanBPushChest',
  note: SANB_NOTE,
});

const IMAGE_LICENSE: Omit<LicenseInfo, 'source'> = Object.freeze({
  license: 'GPL-3.0',
  origin: 'SanBPushChest',
  note: SANB_NOTE,
});

/* ================================ 清单 ==================================== */

/** 图片条目的文件名基准（bgm/sfx 条目沿用 data/audio.ts 的 src/assets/audio 基准） */
export const AUDIO_BASE = 'src/assets/audio';
export const IMAGE_BASE = 'src/assets';

const SANB_SRC_ROOT = 'SanBPushChest/assets';

const bgmEntries: readonly LicensedBgmEntry[] = AUDIO_MANIFEST.bgm.map((b) => {
  const license = BGM_LICENSES[b.id];
  if (license === undefined) {
    // K11 教训：清单对不上号就在数据组装期炸出来，绝不允许静默吞掉
    throw new Error(`manifest: BGM 条目 ${b.id} 缺少许可登记（请在 BGM_LICENSES 补全）`);
  }
  return { id: b.id, file: b.file, title: b.title, playable: b.playable, source: b.source, ...license };
});

const sfxEntries: readonly LicensedSfxEntry[] = AUDIO_MANIFEST.sfx.map((s) => ({
  id: s.id,
  file: s.file,
  source: s.source,
  ...SFX_LICENSE,
}));

const imageEntries: readonly LicensedImageEntry[] = [
  // 14 张墙皮 —— SanBPushChest 定时变换障碍物（README:26）的资产本体；
  // 新作中作为阴阳位面（F 键）阴面随机墙皮，经 WALL_SKIN_IDS 引用
  ...Array.from({ length: 14 }, (_, i): LicensedImageEntry => {
    const n = i + 1;
    return {
      id: `img-barrier-${n}`,
      file: `imgs/barriers/${n}.png`,
      kind: 'barrier',
      source: `${SANB_SRC_ROOT}/imgs/barriers/${n}.png`,
      ...IMAGE_LICENSE,
    };
  }),
  ...(['a', 'd', 's', 'w'] as const).map(
    (k): LicensedImageEntry => ({
      id: `img-direction-${k}`,
      file: `imgs/directions/${k}.png`,
      kind: 'direction',
      source: `${SANB_SRC_ROOT}/imgs/directions/${k}.png`,
      ...IMAGE_LICENSE,
    }),
  ),
  ...(['chest', 'chestR', 'flag'] as const).map(
    (k): LicensedImageEntry => ({
      id: `img-item-${k}`,
      file: `imgs/items/${k}.png`,
      kind: 'item',
      source: `${SANB_SRC_ROOT}/imgs/items/${k}.png`,
      ...IMAGE_LICENSE,
    }),
  ),
  ...(['a', 'd', 's', 'w'] as const).map(
    (k): LicensedImageEntry => ({
      id: `img-key-${k}`,
      file: `imgs/keys/${k}.png`,
      kind: 'key',
      source: `${SANB_SRC_ROOT}/imgs/keys/${k}.png`,
      ...IMAGE_LICENSE,
    }),
  ),
  ...(['role.png', 'role2.png', 'role3.png', 'role4.jpeg', 'role5.png'] as const).map(
    (k, i): LicensedImageEntry => ({
      id: `img-role-${i + 1}`,
      file: `imgs/roles/${k}`,
      kind: 'role',
      source: `${SANB_SRC_ROOT}/imgs/roles/${k}`,
      ...IMAGE_LICENSE,
    }),
  ),
  ...(['blur', 'map'] as const).map(
    (k): LicensedImageEntry => ({
      id: `img-util-${k}`,
      file: `imgs/utils/${k}.png`,
      kind: 'util',
      source: `${SANB_SRC_ROOT}/imgs/utils/${k}.png`,
      ...IMAGE_LICENSE,
    }),
  ),
];

export const ASSET_MANIFEST: AssetManifest = Object.freeze({
  bgm: bgmEntries,
  sfx: sfxEntries,
  images: imageEntries,
});

/* ================================ 查询 ==================================== */

export function findBgmEntry(id: string): LicensedBgmEntry | undefined {
  return ASSET_MANIFEST.bgm.find((b) => b.id === id);
}

export function findSfxEntry(id: string): LicensedSfxEntry | undefined {
  return ASSET_MANIFEST.sfx.find((s) => s.id === id);
}

export function findImageEntry(id: string): LicensedImageEntry | undefined {
  return ASSET_MANIFEST.images.find((i) => i.id === id);
}

/** 浏览器当下真正可播的 BGM id（.mid 条目被 manifest 明确排除） */
export const PLAYABLE_BGM_IDS: readonly string[] = Object.freeze(
  ASSET_MANIFEST.bgm.filter((b) => b.playable).map((b) => b.id),
);

/** 可预载的 SFX id 全集（audioManager 池按此建实例） */
export const ALL_SFX_IDS: readonly string[] = Object.freeze(ASSET_MANIFEST.sfx.map((s) => s.id));

/**
 * 阴面墙皮编号（1..14）—— SanBPushChest service.js:19-27 的 50ms 随机换皮
 * 升格为阴阳位面玩法后，视图层按需从这里取随机墙皮（S18：无常驻定时器）。
 */
export const WALL_SKIN_IDS: readonly number[] = Object.freeze(
  Array.from({ length: 14 }, (_, i) => i + 1),
);

/** 墙皮编号 → 图片条目 id（越界编号返回 undefined，由调用方兜底） */
export function wallSkinImageId(n: number): string | undefined {
  return WALL_SKIN_IDS.includes(n) ? `img-barrier-${n}` : undefined;
}

/* ============================ 三仓库署名（README 用） ====================== */

export interface LicenseCredit {
  readonly origin: string;
  readonly license: string;
  readonly summary: string;
}

export const LICENSE_CREDITS: readonly LicenseCredit[] = Object.freeze([
  {
    origin: 'SanBPushChest (Copyright (C) 2020 Emilelu, index.html:8)',
    license: 'GPL-3.0',
    summary: '20×效果音、14×墙皮、方向/物品/按键/角色/工具共 32 图、1×BGM —— 本项目自有资产',
  },
  {
    origin: 'BandoriLotteryEmulator (Emilelu)',
    license: 'replaceBeforeShip',
    summary: '1×BGM（bgm.mp3）取自 BanG Dream 官方专辑（其 README.md:8），上架前替换或获授权',
  },
  {
    origin: 'KichikuAdventure (Emilelu, GPLv3)',
    license: 'GPL-3.0',
    summary: '2×BGM（GodKnows.mid / black_rose.mid，README.md:5 自述为外部曲目原件）',
  },
]);
