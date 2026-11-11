/**
 * lawboxDebug —— DEV 调试句柄（约束⑤：数值化验证，禁截图）。
 * ---------------------------------------------------------------------------
 * 仅 import.meta.env.DEV 下挂载 window.__lawboxDebug；生产构建本模块零副作用。
 * 句柄全部只读/驱动既有 store 与 theme 纯函数，不引入第二真相源：
 *  - 相机数值（getCameraAzimuth/getCameraDistance）读 viewStore —— CameraRig
 *    useFrame 按阈值发布的同源数据，分档夹紧的数值证据走这里断言；
 *  - setCamYaw 只写 viewStore.camYaw（输入映射的数据源），验证「W 随相机偏航」
 *    时与实按 W 的 playerGrid() 差值互相印证；
 *  - mapInputDir 即 cameraYawToGridDir(± 当前 camYaw)，与 useKeyActions.mappedDir
 *    同一纯函数，行为天然一致。
 */

import { cameraYawToGridDir, planeTheme, type PlaneTheme } from '../three/theme';
import type { Dir } from '../../core/types';
import type { GameStore } from '../../core/store/gameStore';
import { useGameStore } from '../../core/store/gameStore';
import { useViewStore } from '../three/viewStore';

export interface LawboxDebugHandles {
  /** 当前视角档偏好（'first' | 'third'） */
  readonly getViewPreference: () => 'first' | 'third';
  /** 切视角档（等价 KeyV） */
  readonly setViewPreference: (view: 'first' | 'third') => void;
  /** 相机方位角（弧度；CameraRig 发布值） */
  readonly getCameraAzimuth: () => number;
  /** 相机距离（世界单位；CameraRig 发布值，分档夹紧数值证据） */
  readonly getCameraDistance: () => number;
  /** 写输入映射用的相机偏航（验证方向随映射；不动真实相机） */
  readonly setCamYaw: (yaw: number) => void;
  /** KeyT 战术俯瞰标记直写 */
  readonly setPeeking: (peeking: boolean) => void;
  /** 输入方向 → 网格方向（当前 camYaw 下，与按键派发同一纯函数） */
  readonly mapInputDir: (dir: Dir) => Dir;
  /** 玩家网格坐标（无段位返回 null；配合 mapInputDir 验证位移差值） */
  readonly playerGrid: () => { readonly x: number; readonly y: number } | null;
  /** 主 store 快照（调试直查） */
  readonly getStore: () => GameStore;
  /** 当前阴阳主题 */
  readonly getTheme: () => PlaneTheme;
}

declare global {
  interface Window {
    __lawboxDebug?: LawboxDebugHandles;
  }
}

if (import.meta.env.DEV) {
  const playerGrid = (): { readonly x: number; readonly y: number } | null => {
    const player = useGameStore
      .getState()
      .segment?.entities.find((entity) => entity.kind === 'player');
    return player !== undefined ? { x: player.x, y: player.y } : null;
  };

  window.__lawboxDebug = {
    getViewPreference: () => useViewStore.getState().viewPreference,
    setViewPreference: (view) => useViewStore.getState().setViewPreference(view),
    getCameraAzimuth: () => useViewStore.getState().camYaw,
    getCameraDistance: () => useViewStore.getState().camDistance,
    setCamYaw: (yaw) => useViewStore.getState().setCamYaw(yaw),
    setPeeking: (peeking) => useViewStore.getState().setPeeking(peeking),
    mapInputDir: (dir) => cameraYawToGridDir(dir, useViewStore.getState().camYaw),
    playerGrid,
    getStore: () => useGameStore.getState(),
    getTheme: () => planeTheme(useGameStore.getState().segment?.planeShifted ?? false),
  };
}

export {};
