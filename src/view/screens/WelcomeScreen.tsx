/**
 * 欢迎页 —— 工程骨架的视觉方向宣言。
 * 全屏 R3F Canvas（浮空的「法则箱」+ 星野 + 轨道视角）打底，
 * framer-motion 驱动 2D overlay 文案动效；语言切换即写 store（持久化探针）。
 */

import { Suspense, useEffect, useRef } from 'react';
import type { Group } from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls, Stars } from '@react-three/drei';
import { motion } from 'framer-motion';
import { useGameStore } from '../../core/store/gameStore';
import { selectHudModel } from '../../core/store/selectors';
import { LOCALES } from '../../core/types';
import { GACHA_FLAVOR } from '../../data/gacha';
import { LEVELS } from '../../data/levels';
import { LOCALE_NAMES, t } from '../../data/i18n';
import { bus } from '../../core/events/bus';

/* ------------------------------- 3D 部分 --------------------------------- */

function LawBox() {
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    if (group.current !== null) {
      group.current.rotation.y += delta * 0.45;
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.12;
    }
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

  const startGame = () => {
    useGameStore.getState().startLevel(LEVELS[0]?.id ?? '');
  };

  const tryGacha = () => {
    useGameStore.getState().rollGacha(1);
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas camera={{ position: [4.2, 2.6, 6.2], fov: 46 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
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
          <button className="btn-neon" onClick={tryGacha}>{t(locale, 'gacha.roll1')}（{starStones}◈）</button>
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
              {lastResult.pulls.map((p) => p.cardId.replace(/^card-(law|chr)-/, '')).join(' · ')}
              {lastResult.pityTriggered !== 'none' ? ' ｜保底发动' : ''}
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
