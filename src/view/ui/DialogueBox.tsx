/**
 * 帷幕界面层 · DialogueBox —— 底部 38% 磨砂玻璃对话框：打字机 + 历史回看 + 快进。
 * ---------------------------------------------------------------------------
 * 集成期改造（story-weaver 接线）：行来源由骨架 STORY_EVENTS 切换为剧情
 * 解释器运行时 —— currentLines(ALL_SCRIPTS, storyRuntime) 现算当前节点的
 * 台词/题面，ALL_SPEAKERS 合并表解析说话者名。四类节点在同一容器内渲染：
 *   - dialogue：打字机 + 点击推进（advanceDialogue）；
 *   - choice：promptLines + visibleChoices 选项按钮（chooseStory，条件不满足
 *     的分支已被解释器过滤，无穿透）；
 *   - puzzle：promptLines + 文本输入（submitStoryInput，求解器在数据层注册）；
 *   - ending：结局台词 + 「合上」按钮（advanceDialogue → exitScript，
 *     S11：终局可关闭不锁控制）。
 * 触屏冲突对接点：主信号 = store phase==='dialogue'（输入层订阅同一 store）；
 * 辅信号 = 本组件经 bus 广播的 debug/mark 标签 `dialogue/active=1|0`。
 * 打字机唯一的定时器是「逐行」setInterval，随行切换/卸载 useEffect 清理。
 */

import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore, currentLines, visibleChoices } from '../../core/store/gameStore';
import { bus } from '../../core/events/bus';
import { ALL_SCRIPTS, ALL_SPEAKERS } from '../../data/storyScripts';
import { tUi } from '../../data/i18n/uiText';

const TYPE_INTERVAL_MS = 26; // 打字机步进

export function DialogueBox() {
  const phase = useGameStore((s) => s.phase);
  const locale = useGameStore((s) => s.locale);
  const runtime = useGameStore((s) => s.storyRuntime);

  const active = phase === 'dialogue' && runtime.scriptId !== null && runtime.nodeId !== null;
  const nodePhase = runtime.phase;

  // 触屏冲突广播：激活状态翻转时各发一条（见文件头对接点说明）
  useEffect(() => {
    bus.publish({ type: 'debug/mark', label: `dialogue/active=${active ? '1' : '0'}` });
  }, [active]);

  const [typedCount, setTypedCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState('');

  const lines = active ? currentLines(ALL_SCRIPTS, runtime) : [];
  const isInput = nodePhase === 'awaiting-input';
  const isChoice = nodePhase === 'awaiting-choice';
  const isEnding = nodePhase === 'finished';
  const currentLine = !isInput && !isChoice && lineIndexOk(runtime.lineIndex, lines.length)
    ? lines[runtime.lineIndex]
    : undefined;
  const fullText = currentLine?.text ?? '';

  // 打字机：换行即重置并重新起表；清理函数随行切换与卸载执行（无常驻定时器）
  useEffect(() => {
    setTypedCount(0);
    if (!active || currentLine === undefined) return;
    const full = currentLine.text.length;
    const interval = setInterval(() => {
      setTypedCount((n) => {
        const next = Math.min(n + 1, full);
        if (next >= full) clearInterval(interval);
        return next;
      });
    }, TYPE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, runtime.scriptId, runtime.nodeId, runtime.lineIndex, currentLine?.text.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || (currentLine === undefined && !isInput && !isChoice)) {
    // 坏档兜底：给一条可点击的出口，绝不锁死（S11 精神）
    if (active) {
      return (
        <div className="glass" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '38%', minHeight: 220, zIndex: 30, padding: 24 }}>
          <button className="btn-neon" onClick={() => useGameStore.getState().advanceDialogue()}>
            {tUi(locale, 'ui.continue')}
          </button>
        </div>
      );
    }
    return null;
  }

  const store = useGameStore.getState;
  const typing = currentLine !== undefined && typedCount < fullText.length;
  const speaker = currentLine !== undefined ? (ALL_SPEAKERS[currentLine.speakerId] ?? currentLine.speakerId) : '';
  const visibleText = fullText.slice(0, typedCount);
  const historyLines = lines.slice(0, runtime.lineIndex + 1);
  const choices = isChoice ? visibleChoices(ALL_SCRIPTS, runtime) : [];

  /** 点击语义：打字中 → 瞬间补完；已完整 → 推进（结局节点则收尾退出剧本） */
  const advance = () => {
    if (typing) {
      setTypedCount(fullText.length);
      return;
    }
    store().advanceDialogue();
  };

  const submitInput = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') return;
    store().submitStoryInput(text);
    setDraft('');
  };

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onClick={isChoice || isInput ? undefined : advance}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: '38%',
        minHeight: 220,
        zIndex: 30,
        cursor: isChoice || isInput ? 'default' : 'pointer',
        padding: '18px 26px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      className="glass"
    >
      {/* 说话者 + 进度 + 工具行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {speaker !== '' && (
          <span style={{ color: 'var(--neon-cyan)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 15 }}>{speaker}</span>
        )}
        <span style={{ display: 'flex', gap: 4 }}>
          {lines.map((_, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i <= runtime.lineIndex ? 'var(--neon-violet)' : 'rgba(139,147,184,0.35)',
              }}
            />
          ))}
        </span>
        <span style={{ flex: 1 }} />
        {!isChoice && !isInput && (
          <button
            className="chip"
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onClick={(e) => {
              e.stopPropagation();
              setShowHistory((v) => !v);
            }}
          >
            {showHistory ? '▾' : '▸'} {tUi(locale, 'ui.history')}
          </button>
        )}
        {!isChoice && !isInput && (
          <button
            className="chip"
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onClick={(e) => {
              e.stopPropagation();
              advance();
            }}
          >
            ⏩ {tUi(locale, 'dialogue.fastForward')}
          </button>
        )}
      </div>

      {/* 历史回看面板：覆盖正文区，滚动展示本节点已播出的全部行 */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onClick={(e) => e.stopPropagation()}
            style={{ overflowY: 'auto', maxHeight: '55%', display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' }}
          >
            {historyLines.map((line, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                <span style={{ color: i === runtime.lineIndex ? 'var(--neon-gold)' : 'var(--neon-violet)' }}>
                  {ALL_SPEAKERS[line.speakerId] ?? line.speakerId}
                </span>
                <span style={{ color: 'var(--text-dim)' }}>：{line.text}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 正文（打字机）或选择/输入区 */}
      {!showHistory && isChoice && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          {lines.map((line, i) => (
            <p key={i} style={{ fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              <span style={{ color: 'var(--neon-cyan)' }}>{ALL_SPEAKERS[line.speakerId] ?? line.speakerId}：</span>
              {line.text}
            </p>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6, pointerEvents: 'auto' }}>
            {choices.map((choice) => (
              <button
                key={choice.id}
                className="btn-neon"
                style={{ padding: '0.55em 1.2em', textAlign: 'left', fontSize: 14 }}
                onClick={(e) => {
                  e.stopPropagation();
                  store().chooseStory(choice.id);
                }}
              >
                ▸ {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!showHistory && isInput && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          {lines.map((line, i) => (
            <p key={i} style={{ fontSize: 15, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--neon-cyan)' }}>{ALL_SPEAKERS[line.speakerId] ?? line.speakerId}：</span>
              {line.text}
            </p>
          ))}
          <form onSubmit={submitInput} style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={tUi(locale, 'dialogue.inputPlaceholder')}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid rgba(124,92,255,0.5)',
                background: 'rgba(20,26,48,0.6)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button type="submit" className="btn-neon" style={{ padding: '0.55em 1.4em' }}>
              {tUi(locale, 'dialogue.submit')}
            </button>
          </form>
        </div>
      )}

      {!showHistory && currentLine !== undefined && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <p style={{ fontSize: 16, lineHeight: 1.8, whiteSpace: 'pre-wrap', minHeight: '3.6em' }}>
            {visibleText}
            {typing && <span style={{ color: 'var(--neon-cyan)' }}>▌</span>}
          </p>
          {!typing && (
            <span style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--text-dim)', animation: 'none' }}>
              {isEnding ? tUi(locale, 'dialogue.close') : tUi(locale, 'dialogue.tap')}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

function lineIndexOk(index: number, length: number): boolean {
  return index >= 0 && index < length;
}
