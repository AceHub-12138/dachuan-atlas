export type SystemId = 'crm' | 'nexus' | 'electron';
export type ModuleId = 'data' | 'voice' | 'animation' | 'canvas';

export interface AtlasSystem {
  id: SystemId;
  index: string;
  name: string;
  shortName: string;
  latin: string;
  description: string;
  color: string;
  colorSoft: string;
  position: { x: number; y: number };
  /** Calibrated vertical offset of the canvas-drawn name, in world units. */
  labelOffset: number;
  stat: string;
  available: boolean;
}

export interface AtlasModule {
  id: ModuleId;
  index: string;
  name: string;
  latin: string;
  description: string;
  color: string;
  colorSoft: string;
  offset: { x: number; y: number };
  icon: 'bars' | 'wave' | 'orbit' | 'frame';
  available: boolean;
}

export interface DecorativeOrbit {
  rx: number;
  ry: number;
  rotation: number;
  /** World-space radians per second; paused in static mode. */
  speed: number;
  opacity: number;
}

export interface DecorativeSatellite {
  id: string;
  orbit: 0 | 1;
  phase: number;
  size: number;
  shape: 'mote' | 'dot' | 'shard';
  brightness: number;
}

/**
 * Local moons around a module. This is a separate decorative layer on purpose:
 * satellites live outside AtlasModule, never appear in relations, hit areas,
 * tooltips or the details panel, and must not be read as architecture.
 */
export interface ModuleDecoration {
  moduleId: ModuleId;
  orbits: [DecorativeOrbit, DecorativeOrbit];
  satellites: DecorativeSatellite[];
}

export const SYSTEMS: AtlasSystem[] = [
  {
    id: 'crm',
    index: '01',
    name: 'CRM / ERP 管理系统',
    shortName: 'CRM / ERP',
    latin: 'BUSINESS OPERATIONS',
    description: '贯通客户、订单与经营数据的业务星系。',
    color: '#8FB2D8',
    colorSoft: '#41647F',
    position: { x: -470, y: -118 },
    labelOffset: 88,
    stat: '业务星系 · 模拟',
    available: false,
  },
  {
    id: 'nexus',
    index: '02',
    name: 'NEXUS 可视化大屏',
    shortName: 'NEXUS',
    latin: 'LIVE VISUAL SYSTEM',
    description: '面向经营现场的实时可视化中枢。',
    color: '#EE7D2C',
    colorSoft: '#A9572A',
    position: { x: 430, y: -150 },
    labelOffset: 88,
    stat: '04 核心模块 · 模拟 · 可进入',
    available: true,
  },
  {
    id: 'electron',
    index: '03',
    name: 'Electron 桌面客户端',
    shortName: 'DESKTOP',
    latin: 'LOCAL CLIENT',
    description: '连接本地能力与桌面工作流的应用星系。',
    color: '#78CFC2',
    colorSoft: '#376F6C',
    position: { x: 232, y: 242 },
    labelOffset: 88,
    stat: '客户端星系 · 模拟',
    available: false,
  },
];

export const MODULES: AtlasModule[] = [
  {
    id: 'data',
    index: '01',
    name: '经营数据展示',
    latin: 'OPERATIONS DATA',
    description: '汇聚经营指标，形成面向现场的可视化数据视图。',
    color: '#E8B56E',
    colorSoft: '#8D6334',
    offset: { x: -318, y: -202 },
    icon: 'bars',
    available: true,
  },
  {
    id: 'voice',
    index: '02',
    name: '语音交互',
    latin: 'VOICE INTERACTION',
    description: '连接语音、状态与界面的交互模块。',
    color: '#EE7D2C',
    colorSoft: '#9B4E26',
    offset: { x: 292, y: -184 },
    icon: 'wave',
    available: true,
  },
  {
    id: 'animation',
    index: '03',
    name: '动画调度',
    latin: 'MOTION ORCHESTRATION',
    description: '编排界面状态变化与过渡节奏。',
    color: '#83CED5',
    colorSoft: '#3E747A',
    offset: { x: -286, y: 208 },
    icon: 'orbit',
    available: true,
  },
  {
    id: 'canvas',
    index: '04',
    name: 'Canvas 渲染',
    latin: 'CANVAS RENDERING',
    description: '承载大屏视觉与高频图形绘制。',
    color: '#9AAFE0',
    colorSoft: '#4E5B87',
    offset: { x: 298, y: 222 },
    icon: 'frame',
    available: true,
  },
];

export const MODULE_DECORATIONS: ModuleDecoration[] = [
  {
    moduleId: 'data',
    orbits: [
      { rx: 84, ry: 27, rotation: -0.26, speed: 0.045, opacity: 0.16 },
      { rx: 117, ry: 38, rotation: 0.62, speed: -0.026, opacity: 0.085 },
    ],
    satellites: [
      { id: 'data-mote-a', orbit: 0, phase: 0.16, size: 1.35, shape: 'mote', brightness: 0.92 },
      { id: 'data-dot-b', orbit: 0, phase: 0.63, size: 0.78, shape: 'dot', brightness: 0.66 },
      { id: 'data-shard', orbit: 1, phase: 0.37, size: 1.15, shape: 'shard', brightness: 0.78 },
    ],
  },
  {
    moduleId: 'voice',
    orbits: [
      { rx: 90, ry: 29, rotation: 0.42, speed: -0.05, opacity: 0.19 },
      { rx: 124, ry: 41, rotation: -0.48, speed: 0.028, opacity: 0.1 },
    ],
    satellites: [
      { id: 'voice-mote-a', orbit: 0, phase: 0.08, size: 1.55, shape: 'mote', brightness: 1 },
      { id: 'voice-dot-b', orbit: 0, phase: 0.58, size: 0.82, shape: 'dot', brightness: 0.7 },
      { id: 'voice-shard', orbit: 1, phase: 0.72, size: 1.2, shape: 'shard', brightness: 0.86 },
    ],
  },
  {
    moduleId: 'animation',
    orbits: [
      { rx: 86, ry: 26, rotation: 0.18, speed: 0.042, opacity: 0.15 },
      { rx: 120, ry: 37, rotation: -0.62, speed: -0.024, opacity: 0.08 },
    ],
    satellites: [
      { id: 'animation-mote-a', orbit: 0, phase: 0.31, size: 1.3, shape: 'mote', brightness: 0.9 },
      { id: 'animation-dot-b', orbit: 0, phase: 0.79, size: 0.76, shape: 'dot', brightness: 0.62 },
      { id: 'animation-shard', orbit: 1, phase: 0.12, size: 1.1, shape: 'shard', brightness: 0.74 },
    ],
  },
  {
    moduleId: 'canvas',
    orbits: [
      { rx: 88, ry: 28, rotation: -0.4, speed: -0.038, opacity: 0.15 },
      { rx: 122, ry: 40, rotation: 0.34, speed: 0.022, opacity: 0.08 },
    ],
    satellites: [
      { id: 'canvas-mote-a', orbit: 0, phase: 0.52, size: 1.4, shape: 'mote', brightness: 0.88 },
      { id: 'canvas-dot-b', orbit: 0, phase: 0.93, size: 0.8, shape: 'dot', brightness: 0.64 },
      { id: 'canvas-shard', orbit: 1, phase: 0.27, size: 1.12, shape: 'shard', brightness: 0.76 },
    ],
  },
];

export const DECORATIVE_LAYER_POLICY = {
  interactive: false,
  role: 'procedural-decoration',
  note: '模块外圈的微小卫星与轨迹为程序化装饰，不属于模拟架构关系，也不参与悬停、点击或详情。',
} as const;

export const VOICE_DETAIL = {
  name: '语音交互',
  latin: 'VOICE INTERACTION',
  purpose: '负责系统语音交互相关的状态管理、交互显示及服务编排。',
  related: [
    { index: '01', name: '经营数据展示', link: '模拟关联 · 提供经营上下文' },
    { index: '03', name: '动画调度', link: '模拟关联 · 联动界面反馈' },
    { index: '04', name: 'Canvas 渲染', link: '模拟关联 · 承载视觉呈现' },
  ],
  tech: [
    { label: '技术画像', value: 'React · TypeScript（模拟）' },
    { label: '接口层', value: '浏览器语音接口（演示占位）' },
    { label: '状态编排', value: '交互状态与服务编排（模拟）' },
    { label: '接入状态', value: '未接入真实服务' },
  ],
} as const;

export const SYSTEM_BY_ID = Object.fromEntries(
  SYSTEMS.map((system) => [system.id, system]),
) as Record<SystemId, AtlasSystem>;

export const MODULE_BY_ID = Object.fromEntries(
  MODULES.map((module) => [module.id, module]),
) as Record<ModuleId, AtlasModule>;
