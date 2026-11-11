/**
 * viewStore —— 视角档轻量 zustand 分片（CAM-1/THEME-3 并行契约的唯一真相源）。
 * ---------------------------------------------------------------------------
 * 只存原始数字/布尔/字符串，零 R3F / 零 three 导入 —— 输入层（useKeyActions）
 * 与调试句柄可安全消费，R3F 相机对象绝不进本层（约束②）。
 *  - viewPreference：'first'（第一人称头位，默认）/ 'third'（第三人称轨道），
 *    localStorage 持久化（独立 key，不与主存档 'lawbox-chronicle:v1' 混存）。
 *  - camYaw / camDistance：CameraRig useFrame 发布的相机方位角与距离（供输入
 *    映射 cameraYawToGridDir 与调试句柄数值断言），会话态不落盘。
 *  - peeking：KeyT 按住期间的战术俯瞰标记，CameraRig 内部自发位姿消费。
 * gameStore 零改动：视角档是纯视图偏好，不进存档 block。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ViewPreference } from './theme';

export interface ViewStoreState {
  readonly viewPreference: ViewPreference;
  /** 相机方位角（弧度；CameraRig 差值 >0.02rad 才推送） */
  readonly camYaw: number;
  /** 相机距离（世界单位；CameraRig 差值 >0.02 才推送，供调试句柄断言） */
  readonly camDistance: number;
  /** KeyT 按住中的战术俯瞰（true = 临时收敛到 explore 预设俯瞰位） */
  readonly peeking: boolean;
  setViewPreference(view: ViewPreference): void;
  /** first ↔ third 切换（KeyV，任意相位可用） */
  toggle(): void;
  setCamYaw(yaw: number): void;
  setCamDistance(distance: number): void;
  setPeeking(peeking: boolean): void;
}

export const VIEW_STORAGE_KEY = 'lawbox-chronicle:view';

export const useViewStore = create<ViewStoreState>()(
  persist(
    (set) => ({
      viewPreference: 'first',
      camYaw: 0,
      camDistance: 0,
      peeking: false,
      setViewPreference(view) {
        set({ viewPreference: view });
      },
      toggle() {
        set((s) => ({ viewPreference: s.viewPreference === 'first' ? 'third' : 'first' }));
      },
      setCamYaw(yaw) {
        set({ camYaw: yaw });
      },
      setCamDistance(distance) {
        set({ camDistance: distance });
      },
      setPeeking(peeking) {
        set({ peeking });
      },
    }),
    {
      name: VIEW_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 只有偏好落盘；camYaw/camDistance/peeking 是会话态，重开页面回默认
      partialize: (state) => ({ viewPreference: state.viewPreference }),
    },
  ),
);
