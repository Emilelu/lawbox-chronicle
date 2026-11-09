/**
 * MetaTerminal —— META 终端 + 命令解析器（真结局入口）。
 * ---------------------------------------------------------------------------
 * 原作 EasterEgg.main 的 Scanner 递归巨链（K15 顺序穿透、K5 EOF 挂死、K6 22 个
 * Scanner）在这里变成：一个 UI 终端 + 一个纯函数解析器 + CheatRegistry 执行。
 * 命令语法保真自原作输入链：
 *   /kill--SetName（开 幕 雷 击 钥 匙）、/kill--Caixukun（System 处刑）、
 *   /give--@p--赤手空拳（赤手空拳打败 BOSS）、BABA（对天空大喊）。
 *
 * K3 根治：exit / 未知输入永远在终端里显式回显，绝不被解释成移动指令；
 * 游戏世界也没有「退出流」（B1），exit 只关闭终端本身。
 *
 * 解锁契约：通关全部主线关卡（isGameCleared），或 BOSS 结局明示解锁
 * （showEnding.unlocksMetaTerminal → 旗标 meta:terminal-unlocked）。
 * 契约在模块态单点落实（C2-L2）：未解锁时 setMetaTerminalOpen(true) 一律
 * no-op 并 toast 提示，关闭永远放行——热键 Backquote 绝不会把模块态置成
 * 「开着却渲染 null」的隐形终端，吞掉移动/交互等全部玩法键。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { bus } from '../core/events/bus';
import type { GameState } from '../core/types';
import { useGameStore } from '../core/store/gameStore';
import { GARBAGE_KILLER } from '../data/story/hiddenGame';
import { executeCheat, isGameCleared, listCheatCommandStatuses } from './cheatRegistry';

/** 真结局指令（hiddenGame 反转点在主世界侧的延伸）：/kill--<乱码名> */
const TRUE_END_COMMAND = `/kill--${GARBAGE_KILLER}`;

/* ============================== 解析器（纯） =============================== */

export type ParsedTerminalCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'exit' }
  | { readonly kind: 'baba' }
  | { readonly kind: 'kill'; readonly target: string }
  | { readonly kind: 'give'; readonly selector: string; readonly item: string }
  | { readonly kind: 'unknown'; readonly raw: string; readonly reason: string };

const KILL_PREFIX = '/kill--';
const GIVE_PREFIX = '/give--';

/**
 * 终端命令解析（纯函数，vitest 直测）。
 * 大小写不敏感的词：help / exit / baba；路径式命令保持原样大小写（目标名含中文）。
 */
export function parseTerminalCommand(raw: string): ParsedTerminalCommand {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'unknown', raw, reason: '空指令。输入 help 查看可用指令。' };
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === 'help') return { kind: 'help' };
  if (lowered === 'exit') return { kind: 'exit' };
  if (lowered === 'baba') return { kind: 'baba' };

  if (trimmed.startsWith(KILL_PREFIX)) {
    const target = trimmed.slice(KILL_PREFIX.length).trim();
    if (target === '') {
      return { kind: 'unknown', raw, reason: `${KILL_PREFIX} 缺少目标。用法：/kill--SetName 或 /kill--Caixukun` };
    }
    return { kind: 'kill', target };
  }

  if (trimmed.startsWith(GIVE_PREFIX)) {
    // 原作格式：/give--@p--赤手空拳 → 选择器 @p + 物品名
    const rest = trimmed.slice(GIVE_PREFIX.length);
    const parts = rest.split('--');
    const head = parts[0];
    if (head === undefined || !head.startsWith('@')) {
      return { kind: 'unknown', raw, reason: `${GIVE_PREFIX} 缺少选择器。用法：/give--@p--<武器名>` };
    }
    const item = parts.slice(1).join('--').trim();
    if (item === '') {
      return { kind: 'unknown', raw, reason: `${GIVE_PREFIX} 缺少物品名。用法：/give--@p--爷爷的拐杖` };
    }
    return { kind: 'give', selector: head, item };
  }

  return {
    kind: 'unknown',
    raw: trimmed,
    reason: `未知指令：${trimmed}。输入 help 查看可用指令（它绝不会变成移动键）。`,
  };
}

/* ============================ 打开状态（模块级） ============================ */

let terminalOpen = false;
const openListeners = new Set<() => void>();

export function isMetaTerminalOpen(): boolean {
  return terminalOpen;
}

/** 解锁谓词（纯函数，vitest 直测）。
 *  两条解锁路：全主线通关（isGameCleared）或 BOSS 结局明示解锁
 *  （showEnding.unlocksMetaTerminal → 旗标 meta:terminal-unlocked）。 */
export function isMetaTerminalUnlocked(state: GameState): boolean {
  return isGameCleared(state) || state.story.flags['meta:terminal-unlocked'] === true;
}

export function setMetaTerminalOpen(open: boolean): void {
  if (terminalOpen === open) return;
  // 解锁门禁（C2-L2）：只拦开启、不拦关闭。未解锁时试图打开一律 no-op 并
  // toast 说明（与 executeCheat 的拒绝反馈同款）——否则模块态先置位、组件又
  // 因 !unlocked 渲染 null，玩家会得到一个吞掉全部玩法键的「隐形终端」。
  if (open && !isMetaTerminalUnlocked(useGameStore.getState())) {
    bus.publish({ type: 'ui/toast', messageKey: 'META 终端在通关全部主线关卡后解锁' });
    return;
  }
  terminalOpen = open;
  for (const listener of openListeners) listener();
}

export function toggleMetaTerminal(): void {
  setMetaTerminalOpen(!terminalOpen);
}

function useTerminalOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    () => terminalOpen,
  );
}

/** 通关谓词 hook（真结局入口的可见性），复用上面的纯函数谓词。 */
export function useMetaTerminalUnlocked(): boolean {
  return useGameStore(isMetaTerminalUnlocked);
}

/* ================================ 终端 UI ================================= */

interface TerminalLine {
  readonly id: number;
  readonly kind: 'echo' | 'system' | 'error' | 'narrative';
  readonly text: string;
}

const LINE_COLOR: Readonly<Record<TerminalLine['kind'], string>> = Object.freeze({
  echo: 'var(--text-dim)',
  system: 'var(--neon-cyan)',
  error: 'var(--neon-rose)',
  narrative: 'var(--text-primary)',
});

const INTRO_LINES: readonly string[] = Object.freeze([
  'This game is abandoned. But you was teleported to here by SOME UNKNOWN REASONS.',
  '——不。这个箱庭已经被你通关了。所谓 abandoned 的前作残响，现在由你执笔。',
  '[System] 输入 help 查看可用指令；exit 关闭终端（世界没有退出流，只有继续）。',
]);

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderTop: '1px solid rgba(124, 92, 255, 0.35)',
  paddingTop: 12,
  marginTop: 4,
};

const promptStyle: CSSProperties = { color: 'var(--neon-cyan)', fontFamily: 'monospace', fontSize: 14 };

export function MetaTerminal() {
  const unlocked = useMetaTerminalUnlocked();
  const open = useTerminalOpen();
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<readonly string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const lineSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const appendLine = (kind: TerminalLine['kind'], text: string) => {
    lineSeq.current += 1;
    const id = lineSeq.current;
    setLines((prev) => [...prev, { id, kind, text }]);
  };

  // 首次打开注入开场白（原作 EasterEgg.java:75 的开场致敬）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (lineSeq.current === 0) {
      for (const text of INTRO_LINES) appendLine('narrative', text);
    }
  }, [open]);

  // 新行自动滚动到底
  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [lines]);

  if (!unlocked || !open) return null;

  const runCommand = (raw: string) => {
    appendLine('echo', `> ${raw}`);
    setHistory((prev) => [...prev, raw]);
    setHistoryCursor(null);
    // 真结局指令优先匹配（P-engine①）：/kill--<乱码> 走 hiddenGame 的反转链路，
    // 不落 term-kill 的处刑目标解析（那会得到「未找到处刑目标」的断链）
    if (raw.trim() === TRUE_END_COMMAND) {
      const echo = useGameStore.getState().runMetaTerminal(raw);
      for (const text of echo) appendLine('narrative', text);
      return;
    }
    const parsed = parseTerminalCommand(raw);
    switch (parsed.kind) {
      case 'help': {
        for (const status of listCheatCommandStatuses()) {
          if (status.def.category !== 'terminal') continue;
          appendLine('system', `${status.def.usage ?? status.def.name} —— ${status.def.description}${status.enabled ? '' : `（未解锁：${status.denial}）`}`);
        }
        appendLine('system', 'help —— 显示本帮助');
        appendLine('system', 'exit —— 关闭终端（不是退出游戏：世界没有 exit，只有继续）');
        break;
      }
      case 'exit': {
        appendLine('system', '[System] META 终端已关闭。剧本还留在原地——下次再来。');
        setMetaTerminalOpen(false);
        break;
      }
      case 'baba': {
        const result = executeCheat('term-baba', 'terminal');
        appendLine(result.ok ? 'narrative' : 'error', result.message ?? result.reason ?? '');
        break;
      }
      case 'kill': {
        const result = executeCheat('term-kill', 'terminal', [parsed.target]);
        appendLine(result.ok ? 'narrative' : 'error', result.message ?? result.reason ?? '');
        break;
      }
      case 'give': {
        const result = executeCheat('term-give', 'terminal', [parsed.item]);
        appendLine(result.ok ? 'narrative' : 'error', result.message ?? result.reason ?? '');
        break;
      }
      case 'unknown': {
        appendLine('error', `[System] ${parsed.reason}`);
        break;
      }
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const raw = draft;
      if (raw.trim() === '') return;
      setDraft('');
      runCommand(raw);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMetaTerminalOpen(false);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (history.length === 0) return;
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const base = historyCursor ?? history.length;
      const next = Math.min(history.length, Math.max(0, base + delta));
      if (next >= history.length) {
        setHistoryCursor(null);
        setDraft('');
        return;
      }
      const entry = history[next];
      if (entry === undefined) return;
      setHistoryCursor(next);
      setDraft(entry);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="META 终端"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(3, 6, 18, 0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setMetaTerminalOpen(false);
      }}
    >
      <div
        className="glass"
        style={{
          width: 'min(720px, calc(100vw - 32px))',
          height: 'min(480px, calc(100vh - 96px))',
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 20px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span className="neon-text" style={{ fontSize: 16, letterSpacing: '0.18em' }}>
            META TERMINAL
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>法则箱庭终端 · 真结局入口 · 通关后解锁</span>
        </div>
        <div
          ref={logRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            fontSize: 13,
            lineHeight: 1.75,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {lines.map((line) => (
            <span key={line.id} style={{ color: LINE_COLOR[line.kind] }}>
              {line.text}
            </span>
          ))}
        </div>
        <div style={inputRowStyle}>
          <span style={promptStyle}>&gt;</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入指令（help / exit / /kill--… / /give--@p--… / BABA）"
            aria-label="终端指令输入"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              fontSize: 14,
            }}
          />
        </div>
      </div>
    </div>
  );
}
