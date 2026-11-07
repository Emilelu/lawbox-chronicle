/**
 * InfoCard —— 3D 实体点击信息卡（本地 state，不写 store）。
 * ---------------------------------------------------------------------------
 * 点按实体（玩家/箱子/NPC/敌人/祭坛）在实体上方弹出一张悬浮信息卡：
 * 名称 + 描述。选中态由 WorldCanvas 的组件本地 useState 持有（pinnedInfo），
 * 本组件只负责把信息渲染到实体世界坐标处；「×」或点空白处关闭。
 * 使用 drei <Html>（DOM 悬浮层），与 frameloop="demand" 兼容：信息卡挂载
 * 即触发一次提交重绘，静置时不占帧。
 */

import type { CSSProperties } from 'react';
import { Html } from '@react-three/drei';
import type { WorldVec3 } from '../theme';

export interface EntityInfo {
  readonly name: string;
  readonly description: string;
}

export interface WorldInfoCardProps {
  readonly info: EntityInfo;
  /** 实体世界坐标（卡片挂在其上方） */
  readonly position: WorldVec3;
  readonly onDismiss: () => void;
}

const CARD_STYLE: CSSProperties = {
  width: 220,
  padding: '10px 12px',
  borderRadius: 12,
  background: 'rgba(16, 20, 38, 0.88)',
  border: '1px solid rgba(124, 92, 255, 0.55)',
  color: '#e8ecff',
  fontSize: 13,
  lineHeight: 1.55,
  boxShadow: '0 8px 26px rgba(0,0,0,0.45)',
  pointerEvents: 'auto',
  userSelect: 'none',
};

export function WorldInfoCard({ info, position, onDismiss }: WorldInfoCardProps) {
  return (
    <Html position={[position[0], position[1] + 1.5, position[2]]} center distanceFactor={8} zIndexRange={[40, 0]}>
      <div style={CARD_STYLE} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: '#ffcf5c', fontWeight: 700, letterSpacing: '0.05em', fontSize: 14 }}>{info.name}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭信息卡"
            style={{
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: 'rgba(232,236,255,0.7)',
              fontSize: 14,
              lineHeight: 1,
              padding: '2px 4px',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ color: 'rgba(232,236,255,0.82)' }}>{info.description}</div>
      </div>
    </Html>
  );
}
