/**
 * App —— 阶段路由 + 全套挂载（集成期组装）。
 * ---------------------------------------------------------------------------
 * 场景切换（uiRedesign）：
 *   title → WelcomeScreen（自 Canvas 底座）；
 *   playing/dialogue/combat/gacha/result → 全屏 WorldCanvas（R3F 底座，
 *   demand 渲染）+ 帷幕 overlay 套件。
 * 挂载清单：
 *   - useKeyActions()：全局键盘输入唯一事件源（App 根部一次）；
 *   - <ErrorBoundary>：渲染异常屏障（S14）；
 *   - <UiOverlaySuite />：HUD/对话框/战斗面板/卡组/设置/抽卡/结算/toast 八件套；
 *   - <TouchPad />：触屏十字键+swipe（对话期自动收起）；
 *   - <MetaTerminal />：通关后按 ` 呼出的 META 终端；
 *   - <BGMController />：howler 生命周期唯一 React 挂载点（替换骨架
 *     mountAudioEngine —— 双音频栈会同时订阅 bus，必须二选一）；
 *   - <PlaneInvertOverlay /> / <BossTitleOverlay />：帷幕演出层（位面反色 /
 *     BOSS 入场刻字），各自订阅 store 投影或 bus 事件，均不拦截输入；
 *   - archive 两个收集器（stats/logbook）随模块加载自装（import 副作用）。
 */

import { useGameStore } from './core/store/gameStore';
import { WelcomeScreen } from './view/screens/WelcomeScreen';
import { WorldCanvas } from './view/three/WorldCanvas';
import { UiOverlaySuite } from './view/ui/HudBar';
import { BGMController } from './audio/BGMController';
import { TouchPad } from './input/TouchPad';
import { MetaTerminal } from './input/MetaTerminal';
import { ErrorBoundary } from './input/ErrorBoundary';
import { useKeyActions } from './input/useKeyActions';
import { PlaneInvertOverlay } from './view/ui/PlaneInvertOverlay';
import { BossTitleOverlay } from './view/ui/BossTitleOverlay';
import { AutoPlayLayer } from './demo/autoPlay';
// 收集器随模块加载自动安装（bus 计数 / store 镜像 / 成就重评）
import './archive/statsCollector';
import './archive/logbook';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  const hasSegment = useGameStore((s) => s.segment !== null);

  // 全局键盘输入：App 根部挂载一次（卸载即全部移除，无残留监听）
  useKeyActions();

  const inWorld = phase !== 'title' && hasSegment;

  return (
    <ErrorBoundary>
      {inWorld && <WorldCanvas />}
      {phase === 'title' && <WelcomeScreen />}
      <UiOverlaySuite />
      <TouchPad />
      <MetaTerminal />
      <BGMController />
      <PlaneInvertOverlay />
      <BossTitleOverlay />
      {/* 自动演示：URL ?autoplay=1 时启用（默认不渲染任何内容） */}
      <AutoPlayLayer />
    </ErrorBoundary>
  );
}
