/**
 * 多语言文案 —— 7 语种（英、汉[简繁]、日、俄、德、法），语种表沿用
 * SanBPushChest README:30 的清单。骨架期收录欢迎页与 HUD 所需键位，
 * 各模块按 key 补齐即可（schema 用 z.record 校验非空）。
 */

import type { LocaleId } from '../core/types';

export interface I18nPack {
  readonly locale: LocaleId;
  readonly entries: Readonly<Record<string, string>>;
}

export const LOCALE_NAMES: Readonly<Record<LocaleId, string>> = Object.freeze({
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ru: 'Русский',
  de: 'Deutsch',
  fr: 'Français',
});

const zhHans: Readonly<Record<string, string>> = Object.freeze({
  'title': '法则箱庭异闻录',
  'subtitle': 'Lawbox Chronicle',
  'tagline': '推箱 × 回合战斗 × 法则抽卡',
  'welcome.start': '进入箱庭',
  'welcome.credits': '三段旧梦，一个新箱。',
  'welcome.modules': '八库熔铸成型 —— 推箱 × 回合战斗 × 法则抽卡',
  'welcome.visits': '到此一访',
  'welcome.storeProof': 'zustand+persist 探针',
  'hud.starStones': '星石',
  'hud.steps': '步数',
  'hud.level': '区域',
  'panel.deck': '卡组',
  'panel.rulebook': '规则手册',
  'panel.settings': '设置',
  'gacha.roll1': '单抽',
  'gacha.roll10': '十连',
  'toast.skeletonReady': '工程骨架就绪：store / 引擎 / 数据链路已通',
  'toast.gachaPlaceholder': '抽卡演出待 gacha-engine 接入',
  'common.language': '语言',
  'common.version': '版本',
});

const zhHant: Readonly<Record<string, string>> = Object.freeze({
  'title': '法則箱庭異聞錄',
  'subtitle': 'Lawbox Chronicle',
  'tagline': '推箱 × 回合戰鬥 × 法則抽卡',
  'welcome.start': '進入箱庭',
  'welcome.credits': '三段舊夢，一個新箱。',
  'welcome.modules': '八庫熔鑄成型 —— 推箱 × 回合戰鬥 × 法則抽卡',
  'welcome.visits': '到此一訪',
  'welcome.storeProof': 'zustand+persist 探針',
  'hud.starStones': '星石',
  'hud.steps': '步數',
  'hud.level': '區域',
  'panel.deck': '卡組',
  'panel.rulebook': '規則手冊',
  'panel.settings': '設定',
  'gacha.roll1': '單抽',
  'gacha.roll10': '十連',
  'toast.skeletonReady': '工程骨架就緒：store / 引擎 / 數據鏈路已通',
  'toast.gachaPlaceholder': '抽卡演出待 gacha-engine 接入',
  'common.language': '語言',
  'common.version': '版本',
});

const en: Readonly<Record<string, string>> = Object.freeze({
  'title': 'Lawbox Chronicle',
  'subtitle': '法则箱庭异闻录',
  'tagline': 'Sokoban × Turn-based Combat × Law Gacha',
  'welcome.start': 'Enter the Diorama',
  'welcome.credits': 'Three old dreams, one new box.',
  'welcome.modules': 'Eight modules fused — sokoban × tactics × law gacha',
  'welcome.visits': 'Visits',
  'welcome.storeProof': 'zustand+persist probe',
  'hud.starStones': 'Star Stones',
  'hud.steps': 'Steps',
  'hud.level': 'Area',
  'panel.deck': 'Deck',
  'panel.rulebook': 'Rulebook',
  'panel.settings': 'Settings',
  'gacha.roll1': 'Pull ×1',
  'gacha.roll10': 'Pull ×10',
  'toast.skeletonReady': 'Skeleton ready: store / engine / data pipeline connected',
  'toast.gachaPlaceholder': 'Gacha animation awaits the gacha engine',
  'common.language': 'Language',
  'common.version': 'Version',
});

const ja: Readonly<Record<string, string>> = Object.freeze({
  'title': '法則箱庭異聞録',
  'subtitle': 'Lawbox Chronicle',
  'tagline': '倉庫番 × ターン制バトル × 法則ガチャ',
  'welcome.start': '箱庭へ入る',
  'welcome.credits': '三つの古い夢、一つの新しい箱。',
  'welcome.modules': '八モジュール結合済み —— 箱庭 × 戦闘 × 法則ガチャ',
  'welcome.visits': '訪問回数',
  'welcome.storeProof': 'zustand+persist プローブ',
  'hud.starStones': '星石',
  'hud.steps': '歩数',
  'hud.level': 'エリア',
  'panel.deck': 'デッキ',
  'panel.rulebook': 'ルールブック',
  'panel.settings': '設定',
  'gacha.roll1': '単発',
  'gacha.roll10': '10連',
  'toast.skeletonReady': 'スケルトン準備完了：store / engine / データ経路接続済み',
  'toast.gachaPlaceholder': 'ガチャ演出は gacha-engine の実装待ち',
  'common.language': '言語',
  'common.version': 'バージョン',
});

const ru: Readonly<Record<string, string>> = Object.freeze({
  'title': 'Хроника Законной Шкатулки',
  'subtitle': 'Lawbox Chronicle',
  'tagline': 'Сокобан × Пошаговый бой × Гача законов',
  'welcome.start': 'Войти в диораму',
  'welcome.credits': 'Три старых сна, одна новая коробка.',
  'welcome.modules': 'Восемь модулей собраны — сокобан × тактика × гача законов',
  'welcome.visits': 'Визиты',
  'welcome.storeProof': 'зонд zustand+persist',
  'hud.starStones': 'Звёздные камни',
  'hud.steps': 'Шаги',
  'hud.level': 'Зона',
  'panel.deck': 'Колода',
  'panel.rulebook': 'Справочник правил',
  'panel.settings': 'Настройки',
  'gacha.roll1': 'Крутка ×1',
  'gacha.roll10': 'Крутка ×10',
  'toast.skeletonReady': 'Скелет готов: store / engine / данные связаны',
  'toast.gachaPlaceholder': 'Анимация гачи ждёт gacha-engine',
  'common.language': 'Язык',
  'common.version': 'Версия',
});

const de: Readonly<Record<string, string>> = Object.freeze({
  'title': 'Lawbox Chronik',
  'subtitle': '法则箱庭异闻录',
  'tagline': 'Sokoban × Rundenkampf × Gesetz-Gacha',
  'welcome.start': 'Diorama betreten',
  'welcome.credits': 'Drei alte Träume, eine neue Box.',
  'welcome.modules': 'Acht Module verschmolzen — Sokoban × Taktik × Gesetzes-Gacha',
  'welcome.visits': 'Besuche',
  'welcome.storeProof': 'zustand+persist Sonde',
  'hud.starStones': 'Sternensteine',
  'hud.steps': 'Schritte',
  'hud.level': 'Gebiet',
  'panel.deck': 'Deck',
  'panel.rulebook': 'Regelhandbuch',
  'panel.settings': 'Einstellungen',
  'gacha.roll1': 'Ziehen ×1',
  'gacha.roll10': 'Ziehen ×10',
  'toast.skeletonReady': 'Skelett bereit: store / engine / Datenpipeline verbunden',
  'toast.gachaPlaceholder': 'Gacha-Animation wartet auf die gacha-engine',
  'common.language': 'Sprache',
  'common.version': 'Version',
});

const fr: Readonly<Record<string, string>> = Object.freeze({
  'title': 'Chronique de la Lawbox',
  'subtitle': '法则箱庭异闻录',
  'tagline': 'Sokoban × Combat au tour par tour × Gacha des lois',
  'welcome.start': 'Entrer dans la diorama',
  'welcome.credits': 'Trois vieux rêves, une nouvelle boîte.',
  'welcome.modules': 'Huit modules fusionnés — sokoban × tactique × gacha des lois',
  'welcome.visits': 'Visites',
  'welcome.storeProof': 'sonde zustand+persist',
  'hud.starStones': 'Pierres d’étoile',
  'hud.steps': 'Pas',
  'hud.level': 'Zone',
  'panel.deck': 'Deck',
  'panel.rulebook': 'Manuel des règles',
  'panel.settings': 'Paramètres',
  'gacha.roll1': 'Tirage ×1',
  'gacha.roll10': 'Tirage ×10',
  'toast.skeletonReady': 'Squelette prêt : store / moteur / données connectés',
  'toast.gachaPlaceholder': 'L’animation de gacha attend le moteur gacha',
  'common.language': 'Langue',
  'common.version': 'Version',
});

export const I18N_PACKS: Readonly<Record<LocaleId, I18nPack>> = Object.freeze({
  en: { locale: 'en', entries: en },
  'zh-Hans': { locale: 'zh-Hans', entries: zhHans },
  'zh-Hant': { locale: 'zh-Hant', entries: zhHant },
  ja: { locale: 'ja', entries: ja },
  ru: { locale: 'ru', entries: ru },
  de: { locale: 'de', entries: de },
  fr: { locale: 'fr', entries: fr },
});

export function t(locale: LocaleId, key: string): string {
  const entry = I18N_PACKS[locale]?.entries[key];
  if (entry !== undefined) return entry;
  return I18N_PACKS['zh-Hans'].entries[key] ?? key; // 缺键回落简中，再回落 key 本身
}
