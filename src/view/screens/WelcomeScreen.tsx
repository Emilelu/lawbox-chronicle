/**
 * 欢迎页 —— 工程骨架的视觉方向宣言。
 * 全屏 R3F Canvas（浮空的「法则箱」+ 星野 + 轨道视角）打底，
 * framer-motion 驱动 2D overlay 文案动效；语言切换即写 store（持久化探针）。
 * 「最近抽卡」槽位经 pullCardLabel 显示本地化卡名，与档案·逐抽记录同口径。
 * B3-7/B4-9：单抽按钮的定价与余额分开标注 —— 单价取 pools 定价常量（100◈），
 * 余额经 gacha.balance 键控标注，不再把持有余额拼成价格样式的「（N◈）」。
 * A2-6：frameloop="demand" 与 N5/K5 后台唤醒兜底（installDemandCanvasWake 复用）
 * 与 WorldCanvas 同一套纪律 —— 静置零渲染；LawBox 的常驻自转改为有限时长
 * 入场演出（角速度与摆幅随 easeOut 收敛到 0，结束即冻结），Stars/Float 在
 * demand 下只随已有渲染帧更新（drei 不主动 invalidate），拖拽视角仍由
 * OrbitControls 的 change 事件驱动重绘。
 */

import { Suspense, useCallback, useEffect, useRef } from 'react';
import type { Group } from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, OrbitControls, Stars } from '@react-three/drei';
import { motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { selectHudModel } from '../../core/store/selectors';
import { LOCALES, type CardDef, type LocaleId } from '../../core/types';
import { CARDS, GACHA_FLAVOR } from '../../data/gacha';
import { FORMAL_POOL } from '../../data/gacha/pools';
import { LEVELS } from '../../data/levels';
import { LOCALE_NAMES, t } from '../../data/i18n';
import { cardName, tUi } from '../../data/i18n/uiText';
import { bus } from '../../core/events/bus';
import { installDemandCanvasWake, RootReadyProbe } from '../three/WorldCanvas';

/* ------------------------------- 3D 部分 --------------------------------- */

/** 法则箱入场演出时长（s）：有限自终止，结束后 demand 画布静置零渲染 */
const LAW_BOX_INTRO_SECONDS = 2.4;

function LawBox() {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const introRef = useRef(0); // 入场已渲染时长（秒；demand 下按真实帧间 delta 累积）
  useFrame((state, delta) => {
    const g = group.current;
    if (g === null) return;
    const t = Math.min(1, introRef.current / LAW_BOX_INTRO_SECONDS);
    introRef.current += delta;
    // 入场演出：转速与摆幅随进度收敛到 0 —— 终帧角速度为零，姿态自然静止；
    // 演出结束后不再 invalidate，画布回归静置零渲染（S18 纪律覆盖标题页）
    g.rotation.y += delta * 0.45 * (1 - t);
    g.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.12 * (1 - t);
    if (t < 1) invalidate();
  });
  return (
    <group ref={group}>
      {/* 法则箱主体 */}
      <mesh castShadow>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshStandardMaterial
          color="#1b2347"
          emissive="#7c5cff"
          emissiveIntensity={0.35}
          metalness={0.7}
          roughness={0.25}
        />
      </mesh>
      {/* 霓虹线框 */}
      <mesh scale={1.03}>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.28} />
      </mesh>
      {/* 环绕的三只小箱（推箱之魂） */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.cos((i / 3) * Math.PI * 2) * 2.4, Math.sin(i * 2.1) * 0.6, Math.sin((i / 3) * Math.PI * 2) * 2.4]}>
          <boxGeometry args={[0.42, 0.42, 0.42]} />
          <meshStandardMaterial color="#ffcf5c" emissive="#ffcf5c" emissiveIntensity={0.22} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <pointLight position={[6, 5, 4]} intensity={140} color="#7c5cff" />
      <pointLight position={[-5, -3, -4]} intensity={90} color="#00e5ff" />
      <Stars radius={60} depth={40} count={2400} factor={3.2} saturation={0.4} fade speed={0.6} />
      <Float speed={1.5} rotationIntensity={0.55} floatIntensity={1.1}>
        <LawBox />
      </Float>
      {/* 俯仰 35°~80°：与设计稿的 OrbitControls 约定一致 */}
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI * (35 / 180)}
        maxPolarAngle={Math.PI * (80 / 180)}
      />
    </>
  );
}

/* ----------------------------- 2D overlay -------------------------------- */

/**
 * 逐抽卡名本地化：与 ArchivePanel.pullLabel 同一口径 ——
 * 怀旧展品（cardId 不指向卡表）按稀有度经 archive.nostalgiaStar 键控标名；
 * 正式卡经 uiText.cardName 按语种取卡名（未收录 id 回落卡表原文），查无则回落原 id。
 * locale 缺省 zh-Hans —— 保持三参调用（纯逻辑测试）语义不变。
 */
export function pullCardLabel(cardId: string, rarity: number, cards: readonly CardDef[] = CARDS, locale: LocaleId = 'zh-Hans'): string {
  if (cardId.startsWith('nostalgia-star-')) {
    return tUi(locale, 'archive.nostalgiaStar', { n: rarity });
  }
  const card = cards.find((c) => c.id === cardId);
  return card !== undefined ? cardName(locale, card) : cardId;
}

/**
 * 标题页单抽按钮文案（B3-7/B4-9）：定价与余额分开标注 ——
 * 「单抽 · 100◈（当前的星石数 1600◈）」。单价取 pools 定价常量
 * （FORMAL_POOL.pricing.single，与 GachaOverlay 的「单抽 · 100◈」同口径），
 * 余额沿用 GachaOverlay 余额行的 gacha.balance 键控词；不再把持有余额
 * starStones 拼成价格样式的「（N◈）」（余额随涨数值随变，必被读成标价）。
 */
export function roll1ButtonLabel(locale: LocaleId, starStones: number): string {
  const unit = tUi(locale, 'common.stoneUnit');
  return `${t(locale, 'gacha.roll1')} · ${FORMAL_POOL.pricing.single}${unit}（${tUi(locale, 'gacha.balance')} ${starStones}${unit}）`;
}

export function WelcomeScreen() {
  const locale = useGameStore((s) => s.locale);
  const visitCount = useGameStore((s) => s.visitCount);
  const lastResult = useGameStore((s) => s.gacha.lastResult);
  const starStones = useGameStore((s) => s.gacha.starStones);
  const hud = useGameStore((s) => selectHudModel(s));
  const pingedRef = useRef(false);

  // zustand+persist 探针：每次挂载 +1，刷新页面后仍在（持久化生效的直接证据）
  useEffect(() => {
    if (pingedRef.current) return;
    pingedRef.current = true;
    useGameStore.setState((s) => ({ visitCount: s.visitCount + 1 }));
  }, []);

  // A2-6/N5/K5：标题页 demand 画布的后台节流兜底，与 WorldCanvas 同一套管线。
  // root 建立回执（RootReadyProbe mount）置位后兜底永久静默；安装时 root 仍未
  // 建立则立即补发一次 resize（K5：后台打开且一直不回前台时，visibilitychange/
  // focus 兜底永不触发，react-use-measure 的 resize 兜底监听是普通事件任务，
  // 不依赖渲染帧 —— 后台也能完成画布初始化）。effect 晚于 Canvas 子树 effect
  // 运行，补发时 resize 监听已就位。
  const rootReadyRef = useRef(false);
  const markRootReady = useCallback(() => {
    rootReadyRef.current = true;
  }, []);
  useEffect(() => installDemandCanvasWake(() => rootReadyRef.current), [markRootReady]);

  const startGame = () => {
    useGameStore.getState().startLevel(LEVELS[0]?.id ?? '');
  };

  const tryGacha = () => {
    useGameStore.getState().rollGacha(1);
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {/* A2-6：demand 渲染 —— 静置零渲染纪律覆盖标题页（此前 frameloop 缺省
          'always'，挂机时每帧重绘 2400 星点 + 三 mesh，GPU 常驻负载） */}
      <Canvas camera={{ position: [4.2, 2.6, 6.2], fov: 46 }} dpr={[1, 2]} frameloop="demand">
        <Suspense fallback={null}>
          {/* N5/K5：root 建立回执 —— 只有 R3F 真正 createRoot 并 render 子树时
              才会 mount，markRootReady 置位后后台节流兜底即永久静默 */}
          <RootReadyProbe onReady={markRootReady} />
          <Scene />
        </Suspense>
      </Canvas>

      <motion.div
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          pointerEvents: 'none',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div className="chip">{GACHA_FLAVOR.banner}</div>
        <h1 className="neon-text" style={{ fontSize: 'clamp(34px, 6vw, 64px)', letterSpacing: '0.14em', fontWeight: 800 }}>
          {t(locale, 'title')}
        </h1>
        <p style={{ color: 'var(--text-dim)', letterSpacing: '0.42em', fontSize: 14 }}>{t(locale, 'subtitle')}</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 15 }}>{t(locale, 'tagline')} · {t(locale, 'welcome.credits')}</p>

        <div style={{ display: 'flex', gap: 14, marginTop: 10, pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn-neon" onClick={startGame}>{t(locale, 'welcome.start')}</button>
          {/* B3-7/B4-9：定价（100◈）与余额分开标注，余额不再冒充标价 */}
          <button className="btn-neon" onClick={tryGacha}>{roll1ButtonLabel(locale, starStones)}</button>
        </div>

        {lastResult !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass"
            style={{ padding: '10px 22px', marginTop: 6, pointerEvents: 'auto' }}
          >
            <span style={{ color: 'var(--neon-gold)' }}>{'★'.repeat(Math.max(...lastResult.pulls.map((p) => p.rarity)))}</span>{' '}
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {lastResult.pulls.map((p) => pullCardLabel(p.cardId, p.rarity, CARDS, locale)).join(' · ')}
              {lastResult.pityTriggered !== 'none' ? ` ｜${tUi(locale, 'gacha.pityTriggered')}` : ''}
            </span>
          </motion.div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8, pointerEvents: 'auto' }}>
          <span className="chip">React 18</span>
          <span className="chip">TypeScript strict</span>
          <span className="chip">Vite</span>
          <span className="chip">zustand+persist</span>
          <span className="chip">three.js / R3F / drei</span>
          <span className="chip">framer-motion</span>
          <span className="chip">howler</span>
          <span className="chip">zod</span>
          <span className="chip">vitest</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, pointerEvents: 'auto' }}>
          <span className="chip">{t(locale, 'common.language')}</span>
          <select
            value={locale}
            onChange={(e) => useGameStore.getState().setLocale(e.target.value as (typeof LOCALES)[number])}
            aria-label={t(locale, 'common.language')}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
          <span className="chip">
            {t(locale, 'welcome.storeProof')} · {t(locale, 'welcome.visits')} {visitCount} · {hud.levelName}
          </span>
        </div>

        <button
          className="chip"
          style={{ cursor: 'pointer', marginTop: 4, pointerEvents: 'auto' }}
          onClick={() => bus.publish({ type: 'ui/toast', messageKey: 'toast.skeletonReady' })}
        >
          {t(locale, 'welcome.modules')} ▸ {t(locale, 'common.version')} 0.1.0
        </button>
      </motion.div>
    </div>
  );
}
