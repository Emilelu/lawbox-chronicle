/**
 * WorldCanvas —— 三维世界舞台入口。
 * ---------------------------------------------------------------------------
 * frameloop="demand"（本模块的核心约定，根治 S18 常驻 50ms 定时器）：
 *  - 静置时 R3F 一帧都不渲染（0% GPU）；
 *  - store 状态变化 → React 提交 → R3F 自动 invalidate（fiber 内置行为）；
 *  - OrbitControls 拖拽/缩放 → drei 控件自带 invalidate；
 *  - 滑动/溶解/粒子等有限时长动画在未收敛帧内自行 invalidate，结束即停。
 *  - 后台节流兜底（N5）：rAF 停摆的后台标签页里 react-use-measure 的
 *    ResizeObserver 初次回调永不投递，画布停在 300×150 不初始化 —— 回前台
 *    （visibilitychange→visible / focus）时若 R3F root 仍未建立，补发一次
 *    window resize 借其 resize 兜底监听重新量取，画布即按容器尺寸初始化。
 * 场景内容：灯光 + 指数雾 + 渐变天空穹（零纹理，1 draw call）、GridArena
 * （体素竞技场）、玩家/石板/NPC/门实体、Vfx 粒子层、CameraRig 运镜。
 * THEME-3 逐关主题：主题/灯光/雾经 levelThemes.resolveLevelTheme(levelId, yin)
 * 随关生效；逐关 Sparkles 环境粒子（demand 下静置冻结）；L3/L9 阴面玩家提灯；
 * FP 档 explore/dialogue 隐藏玩家化身（订阅 CAM-1 viewStore）；CameraRig 按
 * cameraMode 分档夹紧；explore 回正按 viewPreference 分支。
 * 本组件只读 selector / 只经 bus 消费演出事件；地形与海拔经 selector 输出
 * （selectPuzzleState.geometry / selectBattleState.formation）消费引擎纯几何
 * 助手（effectiveTerrain/heightOf），不写引擎、不维护第二份地图。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import type { ShaderMaterial } from 'three';
import { BackSide, Color, ShaderMaterial as ShaderMaterialClass } from 'three';
import type { Vec2 } from '../../core/types';
import {
  currentLines,
  effectiveTerrain,
  importLevel,
  selectBattleFormationGrid,
  selectBattleHazards,
  selectBattleState,
  selectHazardCells,
  selectPuzzleState,
  useGameStore,
  worldToGrid,
  type HeightMap,
} from '../../core/store/gameStore';
import { selectLevelComplete } from '../../core/store/selectors';
import { positionalRuleLevelId } from '../../engine/story/triggers';
import { findEnemy } from '../../data/enemies';
import { ALL_SCRIPTS, ALL_SPEAKERS, ALL_TRIGGER_RULES } from '../../data/storyScripts';
import { findLevel } from '../../data/levels';
import {
  CELL,
  COMBAT_STAGE,
  HEIGHT_STEP,
  cellWorldCenter,
  clampNpcCell,
  computeExploreResetPose,
  computePose,
  gridCenterWorld,
  heightOf,
  type CameraMode,
  type CameraPose,
  type PlaneTheme,
  type WorldVec3,
} from './theme';
import { levelLantern, levelSparkles, resolveLevelTheme } from './levelThemes';
import { useViewStore } from './viewStore';
import { CameraRig } from './CameraRig';
import { GridArena } from './GridArena';
import { PlayerAvatar } from './entities/PlayerAvatar';
import { CrateMesh } from './entities/CrateMesh';
import { ActorMesh, SPEAKER_SKINS } from './entities/ActorMesh';
import { AltarMesh } from './entities/AltarMesh';
import { WorldInfoCard, type EntityInfo } from './entities/InfoCard';
import { VfxLayer } from './effects/Vfx';

/* ============================ 渐变天空穹（零纹理） ========================= */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  varying vec3 vWorld;
  void main() {
    float h = clamp(vWorld.y / 60.0, -1.0, 1.0);
    float t = smoothstep(-0.25, 0.85, h);
    gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
  }
`;

function SkyDome({ theme }: { theme: PlaneTheme }) {
  const materialRef = useRef<ShaderMaterial | null>(null);
  // 材质只建一次；位面换肤走 uniform 更新（无重建、无定时器）
  const material = useMemo(
    () =>
      new ShaderMaterialClass({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(theme.sky.top) },
          uHorizon: { value: new Color(theme.sky.horizon) },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const mat = materialRef.current;
    if (mat === null) return;
    const top = mat.uniforms.uTop;
    const horizon = mat.uniforms.uHorizon;
    if (top !== undefined) (top.value as Color).set(theme.sky.top);
    if (horizon !== undefined) (horizon.value as Color).set(theme.sky.horizon);
  }, [theme]);

  return (
    <mesh
      material={material}
      ref={(mesh) => {
        materialRef.current = mesh !== null ? (mesh.material as ShaderMaterial) : null;
      }}
    >
      <sphereGeometry args={[92, 24, 16]} />
    </mesh>
  );

}

/* ============================== 派生辅助 ================================== */

/** 说话者 id（首条非系统台词；映射 ActorMesh 皮肤表） */
function speakerOf(lines: readonly { readonly speakerId: string }[]): string {
  const line = lines.find((l) => l.speakerId !== 'system');
  return line !== undefined ? line.speakerId : 'system';
}

/** 敌人 id → 造型皮肤 */
function enemySkinByEnemyId(enemyId: string): 'caixukun' | 'guolaoshi' | 'dygg' | 'shadow-echo' {
  if (enemyId === 'enemy-caixukun') return 'caixukun';
  if (enemyId === 'enemy-guolaoshi') return 'guolaoshi';
  if (enemyId === 'enemy-dygg') return 'dygg';
  return 'shadow-echo';
}

/* ============================== 世界内容 ================================== */

function SceneContent({ pinnedInfo, onPin }: {
  readonly pinnedInfo: { readonly info: EntityInfo; readonly position: WorldVec3 } | null;
  readonly onPin: (pin: { readonly info: EntityInfo; readonly position: WorldVec3 } | null) => void;
}) {
  // ---- 只读 store（选择器返回稳定原始引用，避免无关重渲染） ----
  const levelId = useGameStore((s) => s.segment?.levelId ?? null);
  const entities = useGameStore((s) => s.segment?.entities ?? null);
  const planeShifted = useGameStore((s) => s.segment?.planeShifted ?? false);
  const phase = useGameStore((s) => s.phase);
  const seenEventIds = useGameStore((s) => s.story.seenEventIds);
  const combat = useGameStore((s) => s.combat);
  const result = useGameStore((s) => s.result);
  const complete = useGameStore((s) => selectLevelComplete(s));
  const storyFlags = useGameStore((s) => s.story.flags);
  const storyRuntime = useGameStore((s) => s.storyRuntime);
  const playerName = useGameStore((s) => s.player.name);
  // 引擎状态经 selector 消费（不写引擎、不维护第二份地图）
  const puzzle = useGameStore((s) => selectPuzzleState(s));
  const battle = useGameStore((s) => selectBattleState(s));
  const staticSpikeCells = useGameStore((s) => selectHazardCells(s));
  const battleFormationGrid = useGameStore((s) => selectBattleFormationGrid(s));
  const battleHazards = useGameStore((s) => selectBattleHazards(s));

  const level = useMemo(() => (levelId !== null ? findLevel(levelId) : undefined), [levelId]);
  const imported = useMemo(() => (levelId !== null ? importLevel(levelId) : undefined), [levelId]);
  const geometry = puzzle?.geometry;
  // 有效地形：战斗布阵用战场网格；平时切阴面走引擎 shadeGrid（含阴面通道）；
  // 引擎几何未就绪时退回 importLevel 阳面（标题页兜底）。
  const terrain = useMemo(() => {
    if (phase === 'combat' && battleFormationGrid !== null) return battleFormationGrid;
    if (geometry !== undefined) return effectiveTerrain(geometry, planeShifted);
    return imported?.terrain ?? [];
  }, [phase, battleFormationGrid, geometry, planeShifted, imported]);
  const heights: HeightMap | undefined = geometry?.heights;
  const currentArea = level?.area ?? 'main';
  // THEME-3：位面换肤升级为「位面 × 关卡」双维主题（12 关 accent/fog/sky/双灯/
  // 地面墙 mixHex 派生，L9 per-plane 分支；null 关卡退回基础位面主题）
  const theme = resolveLevelTheme(levelId, planeShifted);
  // CAM-1 viewStore 订阅：FP 档（first）且非 T 俯瞰时，explore/dialogue 相内
  // 隐藏自己的化身（第一人称看不见自己身体）；combat/victory 与俯瞰恢复可见
  const viewPreference = useViewStore((s) => s.viewPreference);
  const peeking = useViewStore((s) => s.peeking);
  const hidePlayerAvatar =
    viewPreference === 'first' && !peeking && (phase === 'playing' || phase === 'dialogue');

  const player = entities?.find((e) => e.kind === 'player');
  const chests = entities?.filter((e) => e.kind === 'chest') ?? [];
  const altarEntities = entities?.filter((e) => e.kind === 'altar') ?? [];

  const rows = terrain.length;
  const cols = terrain[0]?.length ?? 0;
  /** 格坐标 → 世界坐标：y = 海拔层 × HEIGHT_STEP（格子/实体共用） */
  const toWorld = useMemo(
    () => (x: number, y: number): WorldVec3 => {
      const [wx, , wz] = cellWorldCenter(x, y, rows, cols, currentArea);
      return [wx, heightOf(heights, x, y) * HEIGHT_STEP, wz];
    },
    [rows, cols, currentArea, heights],
  );
  const arenaCenter = useMemo(() => gridCenterWorld(rows, cols, currentArea), [rows, cols, currentArea]);

  // ---- 战斗布阵：玩家/敌人/箱子来自 battle.formation.entities（单一真相） ----
  const combatFormation = phase === 'combat' ? (battle?.formation ?? null) : null;
  const formationPlayer =
    combatFormation !== null
      ? combatFormation.entities.find((e) => e.id === combatFormation.playerId)
      : undefined;
  const formationEnemies = combatFormation !== null ? combatFormation.entities.filter((e) => e.kind === 'enemy') : [];
  const formationChests = combatFormation !== null ? combatFormation.entities.filter((e) => e.kind === 'chest') : [];

  // ---- 玩家世界坐标（战斗布阵按战场格；纯公式战兜底舞台位） ----
  const playerWorld = useMemo<WorldVec3>(() => {
    if (formationPlayer !== undefined) return toWorld(formationPlayer.x, formationPlayer.y);
    if (phase === 'combat') {
      return [
        arenaCenter[0] + COMBAT_STAGE.playerOffset.x,
        arenaCenter[1],
        arenaCenter[2] + COMBAT_STAGE.playerOffset.y,
      ];
    }
    if (player === undefined) return arenaCenter;
    return toWorld(player.x, player.y);
  }, [formationPlayer, phase, arenaCenter, player, toWorld]);

  const enemyDef = combat !== null ? findEnemy(combat.enemyId) : undefined;
  const mainEnemy =
    formationEnemies.find((e) => e.id === battle?.enemyId) ??
    (battle !== null ? formationEnemies[0] : undefined);
  const enemyWorld = useMemo<WorldVec3>(() => {
    if (mainEnemy !== undefined) return toWorld(mainEnemy.x, mainEnemy.y);
    return [arenaCenter[0] + COMBAT_STAGE.enemyOffset.x, arenaCenter[1], arenaCenter[2] + COMBAT_STAGE.enemyOffset.y];
  }, [mainEnemy, toWorld, arenaCenter]);

  // 对话进行中的剧本 id（R1 前置）：store 触发侧 markTriggerSeen 先于
  // startStoryScript 执行，触发瞬间说话者就会因 seen 过滤从渲染列表消失；
  // 且剧本 entry 节点的 onEnterEffects 第一拍就会自置旗标（如天使剧本的
  // unlessFlag 'story:angels-met'），旗标门同样会把说话者剔除 ——
  // 「运镜对准说话者」对 NPC 说话者永不生效。对话期间该剧本的 npc 规则
  // 免全部可见性门（seen 过滤 + require/unless 旗标），保证说话者模型留在世界里。
  const dialogueScriptId = phase === 'dialogue' ? storyRuntime.scriptId : null;

  // ---- 未触发的剧情 NPC 规则 → 世界内造型皮肤实体 ----
  // 集成期：数据源从骨架 STORY_EVENTS 切到 story-weaver 触发表（ALL_TRIGGER_RULES
  // 的 npc 规则）——坐标经主地图 → 网格换算（worldToGrid），可见性与解释器
  // ruleMatches 同一套旗标判定，渲染与触发永不脱钩。
  // STORY-5 渲染契约（与 gameStore.queryPositionalTrigger 同一判别源
  // positionalRuleLevelId）：level-scoped 规则只属于声明的关卡，坐标就是该关
  // 原始网格坐标，直接 toWorld 落位（不走 worldToGrid+clampNpcCell）；无
  // levelId 的旧规则保持主城世界坐标换算的现行为。
  const npcActors = useMemo(() => {
    const flagOn = (key: string): boolean => {
      const v = storyFlags[key];
      return v !== undefined && v !== false && v !== 0 && v !== '';
    };
    return ALL_TRIGGER_RULES.filter((rule) => {
      if (rule.when.kind !== 'npc') return false;
      // R1：这条规则正在开讲（对话剧本命中）→ 免全部可见性门（seen 过滤 +
      // require/unless 旗标），强制留在世界里。只豁免 seen 不够：剧本 entry
      // 节点 onEnterEffects 自置的旗（天使的 story:angels-met 就写在 unlessFlag
      // 上）在触发第一拍即为真，旗标门仍会把说话者剔除出渲染列表。
      if (rule.scriptId === dialogueScriptId) return true;
      // STORY-5：level-scoped 规则只渲染在对应关卡（缺省 = 主城兼容旧规则）
      const ruleLevelId = positionalRuleLevelId(rule);
      if (ruleLevelId !== undefined && ruleLevelId !== levelId) return false;
      if (rule.once !== false && seenEventIds.includes(rule.id)) return false;
      if (rule.requireFlag !== undefined && !flagOn(rule.requireFlag)) return false;
      if (rule.requireFlags !== undefined && !rule.requireFlags.every(flagOn)) return false;
      if (rule.unlessFlag !== undefined && flagOn(rule.unlessFlag)) return false;
      if (rule.unlessFlags !== undefined && rule.unlessFlags.some(flagOn)) return false;
      return true;
    }).map((rule) => {
      // 过滤器已保证 when.kind === 'npc'
      const when = rule.when as { kind: 'npc'; x: number; y: number };
      // level-scoped 规则坐标 = 当前关原始网格坐标，直接落位；旧规则走换算+钳位
      const cell =
        positionalRuleLevelId(rule) !== undefined
          ? { x: when.x, y: when.y }
          : clampNpcCell(worldToGrid(when.x, when.y), terrain);
      // R1：说话者提取扫全剧本的 dialogue 节点，取第一个有世界皮肤
      // （SPEAKER_SKINS 命中）的说话者 —— 多节点剧本（影流之主三幕）的首个
      // dialogue 节点可能只有 system/narration 旁白，按首个节点提取会拿到
      // narration：既配错皮肤（gate-wisp 兜底），又让 npc-ylzz 台词行查不到
      // 注视点而回退玩家。全剧本无皮肤说话者时退回首个 dialogue 节点的首个
      // 非 system 说话者（保持旧行为兜底）。
      const script = ALL_SCRIPTS.find((sc) => sc.id === rule.scriptId);
      let speakable: string | undefined;
      for (const node of script?.nodes ?? []) {
        if (node.kind !== 'dialogue') continue;
        speakable = node.lines.map((l) => l.speakerId).find((id) => SPEAKER_SKINS[id] !== undefined);
        if (speakable !== undefined) break;
      }
      const entry = script?.nodes.find((n) => n.kind === 'dialogue');
      const speakerId =
        speakable ?? (entry !== undefined && entry.kind === 'dialogue' ? speakerOf(entry.lines) : 'system');
      const skin = SPEAKER_SKINS[speakerId] ?? 'gate-wisp';
      return {
        eventId: rule.id,
        speakerId,
        name: ALL_SPEAKERS[speakerId] ?? speakerId,
        position: toWorld(cell.x, cell.y),
        skin,
      };
    });
  }, [levelId, seenEventIds, storyFlags, dialogueScriptId, terrain, toWorld]);

  // ---- 对话注视点：对准当前说话者 NPC（骨架 activeEventId 已退位） ----
  const dialogueLines = phase === 'dialogue' ? currentLines(ALL_SCRIPTS, storyRuntime) : [];
  const dialogueSpeakerId = useMemo(() => {
    if (dialogueLines.length === 0) return null;
    const idx = Math.min(Math.max(0, storyRuntime.lineIndex), dialogueLines.length - 1);
    const line = dialogueLines[idx];
    return line !== undefined ? line.speakerId : speakerOf(dialogueLines);
  }, [dialogueLines, storyRuntime.lineIndex]);
  const speakerPositions = useMemo(() => {
    const map = new Map<string, WorldVec3>();
    for (const npc of npcActors) map.set(npc.speakerId, npc.position);
    for (const altar of altarEntities) map.set('npc-star-altar', toWorld(altar.x, altar.y));
    return map;
  }, [npcActors, altarEntities, toWorld]);
  // R1：当前说话者的渲染/注视位置。说话者与玩家同格（radius 0 踩点型触发，
  // 如三小怪遭遇）时向 +Z 错开一格 —— 对话运镜对准的原位置即玩家位置，两
  // 模型完全重叠互相遮挡，「看到说话者模型」在视觉上不可能；错开后渲染与
  // 注视共用同一坐标，运镜对准的就是画面里那个说话者模型。
  const speakerRenderPos = useMemo<WorldVec3 | null>(() => {
    if (dialogueSpeakerId === null) return null;
    const npc = npcActors.find((n) => n.speakerId === dialogueSpeakerId);
    if (npc === undefined) return null;
    const sameCell =
      Math.abs(npc.position[0] - playerWorld[0]) < 1e-3 &&
      Math.abs(npc.position[2] - playerWorld[2]) < 1e-3;
    if (!sameCell) return npc.position;
    return [npc.position[0], npc.position[1], npc.position[2] + CELL];
  }, [dialogueSpeakerId, npcActors, playerWorld]);
  const dialogueFocus = useMemo<WorldVec3>(() => {
    if (speakerRenderPos !== null) return speakerRenderPos;
    if (dialogueSpeakerId !== null) {
      const pos = speakerPositions.get(dialogueSpeakerId);
      if (pos !== undefined) return pos;
    }
    return playerWorld; // 说话者不在世界内（system/越界）→ 退回玩家
  }, [speakerRenderPos, dialogueSpeakerId, speakerPositions, playerWorld]);

  // ---- 尖刺格：战斗布阵取 battle hazards；平时取图例 5（selectHazardCells） ----
  const spikeCells = useMemo(() => {
    if (phase !== 'combat') return staticSpikeCells;
    const cells: Vec2[] = [];
    for (const [key, kind] of Object.entries(battleHazards)) {
      if (kind !== 'spike') continue;
      const [sx, sy] = key.split(',');
      const x = Number(sx);
      const y = Number(sy);
      if (Number.isInteger(x) && Number.isInteger(y)) cells.push({ x, y });
    }
    return cells;
  }, [phase, battleHazards, staticSpikeCells]);

  // ---- 相机位姿：explore 常态不发请求（用户全权），其余模式收敛式运镜 ----
  const cameraMode: CameraMode =
    result !== null
      ? 'victory'
      : phase === 'dialogue'
        ? 'dialogue'
        : phase === 'combat' && enemyDef?.boss === true
          ? 'boss'
          : phase === 'combat'
            ? 'combat'
            : 'explore';
  // explore 回正（I2 根治）：战斗/对话/胜利运镜把方位角转走后，切回 playing
  // 的那一拍发一次「只回正方位角」的位姿（computeExploreResetPose），此后仍
  // 交还用户全权 —— 不发这次收敛，被转走的方位角会残留到整关谜题期。
  // CAM-1 契约：按 viewPreference 分支 —— third 回正方位角 0（现状），
  // first 传 null 保留用户头向（接缝验收：explore↔dialogue 往返在 first 档
  // getCameraAzimuth() 保持）。
  const [exploreResetPose, setExploreResetPose] = useState<CameraPose | null>(null);
  const prevCameraModeRef = useRef<CameraMode>('explore');
  useEffect(() => {
    if (prevCameraModeRef.current === cameraMode) return;
    const backToExplore = cameraMode === 'explore';
    prevCameraModeRef.current = cameraMode;
    if (!backToExplore) return;
    setExploreResetPose(
      computeExploreResetPose({ playerPos: playerWorld, focusPos: playerWorld, arenaCenter }, viewPreference),
    );
  }, [cameraMode, playerWorld, arenaCenter, viewPreference]);
  // THEME-3：玩家提灯（L3 暗夜关双位面 / L9 仅阴面）与 Sparkles 环境粒子参数
  const lantern = useMemo(() => levelLantern(levelId, planeShifted), [levelId, planeShifted]);
  const sparklesSpec = useMemo(() => levelSparkles(levelId, planeShifted), [levelId, planeShifted]);
  const pose = useMemo<CameraPose | null>(() => {
    if (cameraMode === 'explore') return exploreResetPose;
    return computePose(cameraMode, {
      playerPos: playerWorld,
      focusPos: cameraMode === 'combat' || cameraMode === 'boss' ? enemyWorld : dialogueFocus,
      arenaCenter,
    });
  }, [cameraMode, exploreResetPose, playerWorld, enemyWorld, dialogueFocus, arenaCenter]);
  const [poseId, setPoseId] = useState(0);
  useEffect(() => {
    setPoseId((id) => id + 1);
  }, [pose]);

  /** 战斗中的 spark 事件坐标是引擎占位 (0,0)，映射到敌方舞台位；平时按格换算（含海拔） */
  const vfxToWorld = (cell: Vec2): WorldVec3 => {
    if (phase === 'combat') return enemyWorld;
    return toWorld(cell.x, cell.y);
  };

  /** 点按实体：弹信息卡（组件本地 state，不写 store） */
  const pinEntity = (info: EntityInfo, position: WorldVec3): ((e: { stopPropagation: () => void }) => void) => {
    return (e) => {
      e.stopPropagation();
      onPin({ info, position });
    };
  };

  const playerInfo: EntityInfo = { name: playerName, description: '你：法则箱庭的访客。' };
  const chestInfo: EntityInfo = { name: '法则石板', description: '把它推上旗位基座；从高台推落可压碎脚下的敌人。' };
  const altarInfo: EntityInfo = { name: '星愿祭坛', description: '投下星石向法则祈愿 —— 靠近按 E 交互开启抽卡。' };
  const npcInfo: EntityInfo = { name: '未读剧情人物', description: '靠近或按 E 触发对话。' };

  const visibleChests = phase === 'combat' ? formationChests : chests;

  return (
    <>
      {/* 灯光（随「位面 × 关卡」主题生效；无阴影贴图，保移动端帧预算） */}
      <ambientLight color={theme.ambient.color} intensity={theme.ambient.intensity} />
      <directionalLight
        color={theme.keyLight.color}
        intensity={theme.keyLight.intensity}
        position={theme.keyLight.position}
      />
      <directionalLight
        color={theme.rimLight.color}
        intensity={theme.rimLight.intensity}
        position={theme.rimLight.position}
      />
      {/* L3/L9 阴面玩家提灯：暗关的随身 PointLight，位置随 playerWorld 每拍同步 */}
      {lantern !== null && (
        <pointLight
          color={lantern.color}
          intensity={lantern.intensity}
          distance={lantern.distance}
          position={playerWorld}
        />
      )}
      <fogExp2 attach="fog" color={theme.fogColor} density={theme.fogDensity} />
      <SkyDome theme={theme} />

      {/* R1：注视焦点——对话运镜期对准说话者（含同格错位位；y 抬升与
          computePose dialogue 的 target+0.55 注视高度一致），其余相对准玩家。
          CameraRig 的位姿收敛只管 distance/polar/azimuth，注视点恒走
          focusWorld 轻量跟随；此前对话期也传 playerWorld，computePose 的
          focusPos target 实际不被消费，「运镜对准说话者」在结构上不生效。 */}
      <CameraRig
        focusWorld={
          cameraMode === 'dialogue'
            ? [dialogueFocus[0], dialogueFocus[1] + 0.55, dialogueFocus[2]]
            : playerWorld
        }
        pose={pose}
        poseId={poseId}
        cameraMode={cameraMode} // CAM-1 契约：分档夹紧按 (viewPreference × cameraMode × peeking)
      />

      {/* 竞技场（点地面关闭信息卡）；战斗布阵时 grid = 战场网格、hazardCells = 尖刺 */}
      <group onPointerDown={() => onPin(null)}>
        <GridArena
          grid={terrain}
          currentArea={currentArea}
          yin={planeShifted}
          levelId={levelId}
          heights={heights}
          hazardCells={spikeCells}
          complete={complete}
        />
      </group>

      {/* 玩家（关卡切换即重挂，朝向复位）；FP 档 explore/dialogue 相内隐藏化身
          （第一人称不见自己身体），combat/victory 与 T 俯瞰恢复正常可见 */}
      {!hidePlayerAvatar && (phase !== 'combat' ? player !== undefined : true) && (
        <group onPointerDown={pinEntity(playerInfo, playerWorld)}>
          <PlayerAvatar
            key={`player:${levelId ?? 'none'}`}
            entityId={formationPlayer?.id ?? player?.id ?? 'player-1'}
            position={playerWorld}
            facing="down"
            theme={theme}
          />
        </group>
      )}

      {/* 法则石板：id 即 key，杜绝幻影/重复实体（S1/S12 结构隔离） */}
      {visibleChests.map((chest) => {
        const position = toWorld(chest.x, chest.y);
        const row = terrain[chest.y];
        const onGoal = row !== undefined && row[chest.x] === 3;
        return (
          <group key={chest.id} onPointerDown={pinEntity(chestInfo, position)}>
            <CrateMesh entityId={chest.id} position={position} onGoal={onGoal} theme={theme} />
          </group>
        );
      })}

      {/* 未读剧情 NPC；对话说话者与玩家同格时渲染到错位位（speakerRenderPos） */}
      {npcActors.map((npc) => {
        const position =
          npc.speakerId === dialogueSpeakerId && speakerRenderPos !== null
            ? speakerRenderPos
            : npc.position;
        return (
          <group
            key={npc.eventId}
            onPointerDown={pinEntity({ name: npc.name, description: npcInfo.description }, position)}
          >
            <ActorMesh skin={npc.skin} kind="npc" position={position} theme={theme} />
          </group>
        );
      })}

      {/* 世界内星愿祭坛（主城 altar 实体） */}
      {altarEntities.map((altar) => {
        const position = toWorld(altar.x, altar.y);
        return (
          <group key={altar.id} onPointerDown={pinEntity(altarInfo, position)}>
            <AltarMesh position={position} theme={theme} />
          </group>
        );
      })}

      {/* 战斗敌方实体（布阵战场上的本体 + 分身；纯公式战兜底单实体舞台） */}
      {phase === 'combat' && formationEnemies.length > 0
        ? formationEnemies.map((enemy) => {
            const isMain = enemy.id === battle?.enemyId;
            const def = isMain ? enemyDef : undefined;
            const skin = isMain ? (def?.boss ? 'ylzz' : enemySkinByEnemyId(enemy.id)) : 'shadow-echo';
            const kind = isMain && def?.boss === true ? ('boss' as const) : ('enemy' as const);
            const position = toWorld(enemy.x, enemy.y);
            return (
              <group
                key={enemy.id}
                onPointerDown={pinEntity(
                  { name: def?.name ?? enemy.id, description: '敌人。布阵阶段可推挤入尖刺/深渊。' },
                  position,
                )}
              >
                <ActorMesh skin={skin} kind={kind} position={position} facing="down" theme={theme} />
              </group>
            );
          })
        : phase === 'combat' && combat !== null && enemyDef !== undefined && (
            <group
              onPointerDown={pinEntity({ name: enemyDef.name, description: '敌人。' }, enemyWorld)}
            >
              <ActorMesh
                key={`combat:${combat.enemyId}`}
                skin={enemyDef.boss ? 'ylzz' : enemySkinByEnemyId(enemyDef.id)}
                kind={enemyDef.boss ? 'boss' : 'enemy'}
                position={enemyWorld}
                facing="down"
                theme={theme}
              />
            </group>
          )}

      <VfxLayer toWorld={vfxToWorld} playerWorld={playerWorld} theme={theme} />

      {/* 逐关环境粒子（THEME-3）：drei Sparkles 的 useFrame 只写 material.time、
          不 invalidate —— demand 下静置冻结，S18 零渲染约定不破 */}
      {sparklesSpec !== null && (
        <Sparkles
          count={sparklesSpec.count}
          color={sparklesSpec.color}
          size={sparklesSpec.size}
          speed={sparklesSpec.speed}
          opacity={sparklesSpec.opacity}
          scale={[sparklesSpec.scale[0], sparklesSpec.scale[1], sparklesSpec.scale[2]]}
          position={[arenaCenter[0], arenaCenter[1] + sparklesSpec.lift, arenaCenter[2]]}
        />
      )}

      {/* 实体信息卡（本地 state；点空白处/竞技场关闭） */}
      {pinnedInfo !== null && (
        <WorldInfoCard info={pinnedInfo.info} position={pinnedInfo.position} onDismiss={() => onPin(null)} />
      )}
    </>
  );
}

/* ================================ 入口 ==================================== */

export interface WorldCanvasProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * demand 渲染兜底（F2 黑屏根治）：订阅整个 gameStore，任何状态变更（包括
 * 自动演示 finish→restore 这类画布外 setState）都强制重绘一帧。fiber 的
 * 自动 invalidate 只发生在「React 提交改动了 three 实例属性」时 —— 纯
 * 数据恢复型提交可能什么都不改，画布会停留在旧帧甚至黑屏。
 */
function StoreInvalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => useGameStore.subscribe(() => invalidate()), [invalidate]);
  return null;
}

/* ================== demand 画布后台节流初始化兜底（N5） ==================== */

/**
 * R3F root 建立探针。作为 <Canvas> 的子节点挂进 React 树：R3F v8 的 Canvas
 * 只在容器尺寸守卫（containerRect.width>0 && containerRect.height>0）通过后
 * 才会 createRoot 并 root.render(子树)，守卫不通过时子树根本不会被渲染 ——
 * 因此「本组件 mount」与「R3F root 已建立」一一对应。mount 即回报一次
 * onReady；自身零渲染、零订阅、零定时器，不触碰 demand 静置零渲染约定。
 * （导出仅供 demandCanvasWake.test 校验 mount 回执契约。）
 */
export function RootReadyProbe({ onReady }: { readonly onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/**
 * 后台节流环境（rAF 停摆）的 demand 画布初始化兜底（N5）。
 * react-use-measure 的 bounds 只经两条通路更新：ResizeObserver 回调（初次
 * 通知在「update the rendering」步骤投递，rAF 停摆的后台标签页里永不触发）
 * 与 window resize 兜底监听（普通事件任务，不依赖渲染帧）。后台打开游戏时
 * containerRect 恒 {0,0,0,0}，R3F Canvas 的 width>0 守卫永不通过 —— canvas
 * 停在 300×150、data-engine 缺失、root 不建立。
 * 修法：回到前台（visibilitychange / window focus）时若 root 仍未建立，
 * 补发一次 window resize 借 react-use-measure 的 resize 兜底监听触发重新
 * 量取（与问题报告实测修法一致：dispatch 一次 resize 即正常初始化）。
 * 双重前置：root 已建立 → 永久静默（量取/重绘回归 ResizeObserver 正常管线）；
 * document 不可见 → 不发（rAF 停摆中补发无意义）。返回卸载函数：WorldCanvas
 * 卸载时拆除监听，不跨组件生命周期泄漏。
 */
export function installDemandCanvasWake(isRootReady: () => boolean): () => void {
  const wake = (): void => {
    if (isRootReady() || document.visibilityState !== 'visible') return;
    window.dispatchEvent(new Event('resize'));
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  return () => {
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
  };
}

/**
 * 全屏 R3F 画布底座。segment 为空时仍渲染灯光/天空（可作标题页底座），
 * 有段位时渲染完整竞技场与实体。实体信息卡选中态是画布级本地 state
 * （不写 store）；点实体弹卡、点空白处/竞技场关闭。
 */
export function WorldCanvas({ className, style }: WorldCanvasProps) {
  const [pinnedInfo, setPinnedInfo] = useState<{ info: EntityInfo; position: WorldVec3 } | null>(null);
  // N5：R3F root 建立回执（探针 mount 置位）；ref 只做同步读取，
  // 不触发重渲染，不干扰 demand 静置约定
  const rootReadyRef = useRef(false);
  const markRootReady = useCallback(() => {
    rootReadyRef.current = true;
  }, []);
  // N5：后台节流兜底，挂载即生效、卸载即拆除（effect 返回值即卸载函数）
  useEffect(() => installDemandCanvasWake(() => rootReadyRef.current), []);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, ...style }}>
      <Canvas
        frameloop="demand" // 静置零渲染；状态变化/交互才重绘 —— S18 根治
        // L2 根治：useMeasure 默认量 getBoundingClientRect（CSS zoom 下的
        // 「视觉像素」），整页 zoom>1 时会把 1366 视觉像素当布局像素写进
        // 画布 → 过大被窗口裁切；zoom<1 过小露黑边。offsetSize 改用
        // offsetWidth/offsetHeight（布局像素，与 2D HUD 同一套坐标系），
        // 画布随容器 911×512 这类真实布局尺寸同步缩放。
        resize={{ offsetSize: true }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 50, near: 0.1, far: 180, position: [0, 8.5, 9.5] }}
        onPointerMissed={() => setPinnedInfo(null)}
      >
        {/* N5：root 建立回执 —— 只有 R3F 真正 createRoot 并 render 子树时才会
            mount，markRootReady 置位后后台节流兜底即永久静默 */}
        <RootReadyProbe onReady={markRootReady} />
        <StoreInvalidator />
        <SceneContent pinnedInfo={pinnedInfo} onPin={setPinnedInfo} />
      </Canvas>
    </div>
  );
}

export default WorldCanvas;
