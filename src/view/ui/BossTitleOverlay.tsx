/**
 * 帷幕界面层 · BossTitleOverlay —— BOSS 入场「刻字」大字演出（R3）。
 * ---------------------------------------------------------------------------
 * 订阅 bus 的 anim/bossTitle 事件并全屏渲染刻字大标题：
 *  - 发布点一：gameStore.applyStoryEffects 的剧情 fx（bossActs.ts:121
 *    { fx: 'bossTitle', title: '影 流 之 主' }）；
 *  - 发布点二：gameStore.launchBattle 对 boss 敌人开战（title = enemy.name）。
 *    两个发布点会连发，本组件以递增 seq 重触发动画，不会卡死旧场次。
 * 与 CameraRig 的 BOSS_ORBIT_SECONDS 轨道运镜同期呈现（刻字时长对齐 2.6s）；
 * framer-motion 逐字渐入 + 整体渐出；pointerEvents:'none' 绝不拦截输入。
 * 挂载在 App 根部一次即可（对照 PlaneInvertOverlay 先例）。
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bus } from '../../core/events/bus';

/** 刻字展示时长（秒）：与 CameraRig 的 BOSS_ORBIT_SECONDS（2.6s 轨道运镜）同期 */
export const BOSS_TITLE_SECONDS = 2.6;

/** 逐字刻字的入场节奏（秒/字）：整词较短时仍能读出「逐字落款」的仪式感 */
export const BOSS_TITLE_STAGGER = 0.22;

/**
 * 刻字字符拆分（纯函数，vitest 可断言）：剔除全部空白后逐字展开。
 * '影 流 之 主' 与 '影流之主' 同得 ['影','流','之','主'] —— 字距由布局层
 * letter-spacing 负责，数据层不携带空白。
 */
export function titleCharsOf(title: string): readonly string[] {
  return [...title.replace(/\s+/g, '')];
}

/** 一次刻字场次：seq 递增用于重触发动画（重复事件不叠加、直接换场） */
interface TitleShow {
  readonly seq: number;
  readonly title: string;
}

export function BossTitleOverlay() {
  const [show, setShow] = useState<TitleShow | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return bus.subscribe((event) => {
      if (event.type !== 'anim/bossTitle') return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      seqRef.current += 1;
      setShow({ seq: seqRef.current, title: event.title });
      timerRef.current = window.setTimeout(() => setShow(null), BOSS_TITLE_SECONDS * 1000);
    });
  }, []);

  // 卸载时清计时器（StrictMode 双执行 / 路由卸载均不留悬挂 setTimeout）
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const chars = show !== null ? titleCharsOf(show.title) : [];

  return (
    <AnimatePresence>
      {show !== null && (
        <motion.div
          key={show.seq}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: BOSS_TITLE_SECONDS, times: [0, 0.18, 0.72, 1], ease: 'easeInOut' }}
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 210,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse at center, rgba(8,6,18,0.62) 0%, rgba(8,6,18,0.28) 46%, rgba(8,6,18,0) 74%)',
          }}
        >
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: BOSS_TITLE_STAGGER } } }}
            style={{ display: 'flex', gap: '0.35em' }}
          >
            {chars.map((char, i) => (
              <motion.span
                key={`${show.seq}:${i}`}
                variants={{
                  hidden: { opacity: 0, y: 26, filter: 'blur(10px)', scale: 1.35 },
                  show: { opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 },
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{
                  fontFamily: '"Songti SC", "SimSun", "Noto Serif SC", serif',
                  fontSize: 'min(13vw, 108px)',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#f5f2ff',
                  textShadow:
                    '0 0 18px rgba(167,139,250,0.9), 0 0 42px rgba(124,58,237,0.55), 0 3px 10px rgba(0,0,0,0.85)',
                }}
              >
                {char}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
