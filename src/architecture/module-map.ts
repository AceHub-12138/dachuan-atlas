import {
  type AtlasModuleId,
  type AtlasModuleRecord,
  type AtlasModuleStats,
  type AtlasNodeKind,
  type AtlasScope,
  type AtlasSymbolType,
} from './schema.ts';
import { normalizeRelativePath } from './paths.ts';

/**
 * 人工核对的模块归类规则（P1.0）。
 *
 * 规则只看源码路径与文件职责，不读取 Graphify community。Community 是
 * 图聚类结果，不是业务模块；同一个模块会横跨数十个 Community，同一个
 * Community 也可能混有多个职责。
 */

export interface EvidenceSeed {
  file: string;
  line: number;
  symbol: string;
  note: string;
}

export interface ModuleDefinition {
  id: AtlasModuleId;
  index: string;
  name: string;
  latin: string;
  review: AtlasModuleRecord['review'];
  rule: string;
  description: string;
  summary: string;
  responsibilities: string[];
  gaps: string[];
  notes: string[];
  primaryPrefixes: string[];
  primaryFiles: string[];
  supportingFiles: string[];
  evidence: EvidenceSeed[];
}

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: 'voice',
    index: '02',
    name: '语音交互',
    latin: 'VOICE INTERACTION',
    review: 'verified',
    rule:
      '以浏览器语音链路 src/lib/voice/、语音编排服务 services/voice-orchestrator/、语音控制台 src/app/voice-console/ 与覆盖层 src/components/overlay/ 的路径前缀为主归属。',
    description:
      '覆盖麦克风采集与 VAD、PCM 播放、WebSocket 协议、会话状态机、服务端编排与 TTS 音频缓存；代码分布在浏览器进程与 Node 服务两个运行位置。',
    summary: '让用户可以用语音提问，并把答案以语音和屏幕卡片返回。',
    responsibilities: [
      '浏览器端采集麦克风音频，并做 VAD/KWS 判断。',
      '在浏览器与服务端之间传输语音会话协议。',
      '服务端编排 ASR、LLM、TTS 与经营数据查询。',
      '播放 PCM 音频，并在覆盖层展示答案卡。',
    ],
    gaps: [
      '浏览器与服务端之间的跨进程运行时链路没有图边，仍待核实。',
      '浏览器音频 API、React 回调与 Canvas 覆盖层的调用关系不完整。',
      '13 条 AI 复核关系之外，模块内部关系仍待核实。',
    ],
    notes: [
      '语音模块横跨 43 个 Graphify Community；Community 编号没有参与归类。',
      'Community 31 只包含 17 个编排服务节点，不能代表整个语音模块。',
      '浏览器端与服务端通过 VoiceWireEvent 协议连接；Graphify 没有生成跨进程的运行时边，相关关系仍需人工核实。',
    ],
    primaryPrefixes: [
      'src/lib/voice/',
      'services/voice-orchestrator/',
      'src/app/voice-console/',
      'src/components/overlay/',
    ],
    primaryFiles: [],
    supportingFiles: ['src/lib/voice/params.ts'],
    evidence: [
      { file: 'src/lib/voice/microphone.ts', line: 15, symbol: 'VoiceMicrophone', note: '浏览器麦克风采集与语音活动检测' },
      { file: 'src/lib/voice/pcm-player.ts', line: 28, symbol: 'PcmPlayer', note: 'PCM 音频播放、降音与回声处理' },
      { file: 'src/lib/voice/protocol.ts', line: 198, symbol: 'parseWireEvent', note: '语音 wire 协议解析（fail-closed）' },
      { file: 'src/lib/voice/session-machine.ts', line: 178, symbol: 'sessionReducer', note: '覆盖层会话状态机' },
      { file: 'src/lib/voice/live-source.ts', line: 40, symbol: 'wireToMachineEvents', note: '协议事件到状态机事件的映射' },
      { file: 'services/voice-orchestrator/src/orchestrator.ts', line: 132, symbol: 'createVoiceOrchestrator', note: '服务端语音会话编排入口' },
      { file: 'services/voice-orchestrator/src/tts/audio-store.ts', line: 23, symbol: 'AudioStore', note: 'TTS 音频缓存与句子级通知' },
      { file: 'src/components/overlay/JarvisCore.tsx', line: 80, symbol: 'JarvisCore', note: '语音覆盖层的 Canvas 2D 粒子核心' },
    ],
  },
  {
    id: 'animation',
    index: '03',
    name: '动画调度',
    latin: 'MOTION ORCHESTRATION',
    review: 'verified',
    rule:
      '以 src/components/screen/motion/ 为主归属，并纳入 src/lib/use-reduced-motion.ts；以 MotionDirector/GsapScene 的职责而不是 Community 聚类判定。',
    description:
      'MotionDirector 统一持有一个未完成的 requestAnimationFrame，负责场景状态、脉冲节奏、FPS 采样与低动态降级；GsapScene 提供可采样的代理时间线。',
    summary: '用一个统一的帧调度器控制大屏的入场、脉冲、航线与降级节奏。',
    responsibilities: [
      'MotionDirector 统一持有单个未完成的 rAF，避免多时钟竞争。',
      '根据 FPS、页面可见性、语音状态和减少动态偏好自动降级。',
      'GsapScene 提供可采样的代理时间线，驱动入场、脉冲与航线。',
      'useSceneMotion 把帧状态写入 SVG 属性与大屏背景 Canvas。',
    ],
    gaps: [
      'requestAnimationFrame 与 cancelAnimationFrame 未被 Graphify 建边。',
      'GsapTickerOwner 不在本历史快照中，不能从当前工作区补入。',
      '动画与经营数据、语音模块的运行时联动仍待核实。',
    ],
    notes: [
      'MotionDirector 的源码注释明确写出“一个所有者、一个未完成的 rAF”，这是动画调度的核心证据。',
      'Graphify 没有把 requestAnimationFrame、cancelAnimationFrame 建成节点或边；动画调度的运行时调用图不完整。',
      'GsapTickerOwner 不存在于本历史快照，未从当前工作区补入。',
    ],
    primaryPrefixes: ['src/components/screen/motion/'],
    primaryFiles: ['src/lib/use-reduced-motion.ts'],
    supportingFiles: [],
    evidence: [
      { file: 'src/components/screen/motion/MotionDirector.ts', line: 15, symbol: 'MotionDirector', note: '单一 rAF 所有者、状态机与自动降级' },
      { file: 'src/components/screen/motion/GsapScene.ts', line: 6, symbol: 'GsapScene', note: 'GSAP 代理时间线与采样接口' },
      { file: 'src/components/screen/motion/MotionProvider.tsx', line: 11, symbol: 'MotionProvider', note: '动画运行时与页面可见性/语音状态联动' },
      { file: 'src/components/screen/motion/useSceneMotion.ts', line: 12, symbol: 'useSceneMotion', note: '大屏 SVG/Canvas 场景的逐帧写入' },
      { file: 'src/lib/use-reduced-motion.ts', line: 9, symbol: 'useReducedMotion', note: '减少动态偏好的外部状态订阅' },
    ],
  },
  {
    id: 'canvas',
    index: '04',
    name: 'Canvas 渲染',
    latin: 'CANVAS RENDERING',
    review: 'partially_verified',
    rule:
      '历史快照中没有独立的 Canvas 目录或入口。仅把明确执行 Canvas 2D 绘制的文件标记为支撑模块：JarvisCore、voice/params、useSceneMotion、ScreenStage。',
    description:
      'Canvas 能力分布在语音覆盖层核心与大屏粒子舞台中：JarvisCore 使用全屏 Canvas 2D 绘制粒子环系，useSceneMotion 驱动大屏背景粒子，params 提供 3D 投影与粒子构建数学。',
    summary: '分布在大屏与语音覆盖层中的 Canvas 2D 绘制能力集合，不是一个独立业务子系统。',
    responsibilities: [
      'JarvisCore 用全屏 Canvas 2D 绘制语音覆盖层粒子环系。',
      'useSceneMotion 绘制大屏背景粒子。',
      'params 提供 3D 投影与粒子构建数学。',
      'ScreenStage 承载大屏 canvas 元素与舞台布局。',
    ],
    gaps: [
      '历史快照没有独立 Canvas 模块入口，主归属节点为 0。',
      'Graphify 没有 getContext、fillRect 或 CanvasRenderingContext2D 节点与边。',
      '只能证明 Canvas 绘制存在，不能证明完整调用网络。',
    ],
    notes: [
      '本模块主归属节点为 0；4 个文件仅作为支撑归属，避免虚构一个不存在的独立模块。',
      'Graphify 未生成 getContext、fillRect、CanvasRenderingContext2D 等节点，Canvas 调用关系不完整。',
      '因此标记为“部分核实”：源码能证明 Canvas 绘制存在，但无法证明完整的调用网络。',
    ],
    primaryPrefixes: [],
    primaryFiles: [],
    supportingFiles: [
      'src/components/overlay/JarvisCore.tsx',
      'src/lib/voice/params.ts',
      'src/components/screen/motion/useSceneMotion.ts',
      'src/components/screen/ScreenStage.tsx',
    ],
    evidence: [
      { file: 'src/components/overlay/JarvisCore.tsx', line: 80, symbol: 'JarvisCore', note: '全屏 Canvas 2D 粒子系统与四组粒子池' },
      { file: 'src/lib/voice/params.ts', line: 255, symbol: 'project3', note: 'Canvas 2D 使用的弱透视投影' },
      { file: 'src/lib/voice/params.ts', line: 323, symbol: 'buildNucleus', note: '核心粒子构建' },
      { file: 'src/components/screen/motion/useSceneMotion.ts', line: 12, symbol: 'useSceneMotion', note: '大屏 nexus-particles Canvas 绘制' },
      { file: 'src/components/screen/ScreenStage.tsx', line: 11, symbol: 'ScreenStage', note: '大屏舞台与 canvas 元素容器' },
    ],
  },
  {
    id: 'data',
    index: '01',
    name: '经营数据展示',
    latin: 'OPERATIONS DATA',
    review: 'verified',
    rule:
      '以 src/components/screen/、src/app/screen/、src/app/api/screen/ 与经营数据投影/格式化库（public-screen-payload、format、freshness、screen-*、geo、target）为主归属。',
    description:
      '覆盖经营指标、合同与回款表盘、发货预警、发货动态和业务覆盖地图；CRM 数据先经 toPublicScreenPayload 投影为公开 payload，再进入大屏面板。',
    summary: '把 CRM 经营数据整理成合同、回款、发货与业务覆盖四类现场视图。',
    responsibilities: [
      '把 CRM 数据投影为只含公开字段的大屏 payload。',
      '展示合同额、回款率、客户与发货指标。',
      '用 SVG 地图展示业务覆盖与发运航线。',
      '给出数据新鲜度、逾期与待发货提醒。',
    ],
    gaps: [
      'Graphify 没有覆盖指标计算与数据刷新之间的运行时链路。',
      '地图使用 SVG 绘制，不属于 Canvas 模块。',
      '关系默认待核实，不能据此证明生产环境的数据流方向。',
    ],
    notes: [
      '数据展示模块与语音模块之间存在跨模块关系；Graphify 能看到 import/call，但不能证明生产环境的数据流方向。',
      '地图使用 SVG 绘制，不属于 Canvas 模块。',
      '本模块的“已核实”只表示模块组成已核对，不表示每条关系都已人工审核。',
    ],
    primaryPrefixes: [
      'src/app/screen/',
      'src/app/api/screen/',
      'src/components/screen/',
      'src/lib/screen-',
      'src/data/china-',
    ],
    primaryFiles: [
      'src/lib/public-screen-payload.ts',
      'src/lib/format.ts',
      'src/lib/freshness.ts',
      'src/lib/geo.ts',
      'src/lib/target.ts',
      'src/lib/types.ts',
      'src/lib/mock.ts',
      'src/lib/display-copy.ts',
      'src/lib/feed-mask.ts',
      'src/lib/font-scale.ts',
      'src/lib/layout.ts',
      'src/lib/region-zone.ts',
      'src/lib/text-layout.ts',
    ],
    supportingFiles: [],
    evidence: [
      { file: 'src/lib/public-screen-payload.ts', line: 39, symbol: 'toPublicScreenPayload', note: 'CRM 数据投影为公开大屏 payload' },
      { file: 'src/components/screen/KpiRail.tsx', line: 71, symbol: 'KpiRail', note: '经营指标栏' },
      { file: 'src/components/screen/NexusPanels.tsx', line: 16, symbol: 'ContractGauge', note: '合同额仪表' },
      { file: 'src/components/screen/NexusPanels.tsx', line: 48, symbol: 'OperationMetrics', note: '经营指标读数' },
      { file: 'src/components/screen/NexusPanels.tsx', line: 58, symbol: 'CollectionDial', note: '回款表盘' },
      { file: 'src/components/screen/NexusPanels.tsx', line: 82, symbol: 'DeliveryAlerts', note: '发货预警' },
      { file: 'src/components/screen/NexusPanels.tsx', line: 88, symbol: 'ShipmentFeed', note: '发货动态列表' },
      { file: 'src/components/screen/ShipmentMap.tsx', line: 16, symbol: 'ShipmentMap', note: '业务覆盖 SVG 地图' },
      { file: 'src/lib/freshness.ts', line: 3, symbol: 'freshness', note: '数据新鲜度判定' },
      { file: 'src/lib/format.ts', line: 45, symbol: 'formatMoney', note: '经营金额格式化' },
    ],
  },
];

export const MODULE_BY_ID = Object.fromEntries(
  MODULE_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<AtlasModuleId, ModuleDefinition>;

export const PRODUCT_MODULE_IDS: AtlasModuleId[] = ['voice', 'animation', 'data'];

const CANVAS_SUPPORTING_FILES = new Set(MODULE_BY_ID.canvas.supportingFiles);

export function classifyScope(sourceFile: string | null): AtlasScope {
  if (!sourceFile) return 'external';
  if (sourceFile.startsWith('e2e/') || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourceFile)) return 'test';
  if (sourceFile.startsWith('scripts/')) return 'tooling';
  return 'product';
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix);
}

export function primaryModuleFor(sourceFile: string | null): AtlasModuleId | null {
  if (!sourceFile) return null;
  const normalized = normalizeRelativePath(sourceFile);
  if (!normalized.ok) return null;
  const path = normalized.path;

  for (const definition of MODULE_DEFINITIONS) {
    if (definition.primaryFiles.includes(path)) return definition.id;
  }
  // Canvas 没有主归属入口，必须先跳过它，避免把支撑文件误判成主模块。
  for (const definition of MODULE_DEFINITIONS) {
    if (definition.id === 'canvas') continue;
    if (definition.primaryPrefixes.some((prefix) => matchesPrefix(path, prefix))) return definition.id;
  }
  return null;
}

export function supportingModulesFor(sourceFile: string | null): AtlasModuleId[] {
  if (!sourceFile) return [];
  const normalized = normalizeRelativePath(sourceFile);
  if (!normalized.ok) return [];
  const modules: AtlasModuleId[] = [];
  if (CANVAS_SUPPORTING_FILES.has(normalized.path)) modules.push('canvas');
  for (const definition of MODULE_DEFINITIONS) {
    if (definition.id === 'canvas') continue;
    if (definition.supportingFiles.includes(normalized.path) && !modules.includes(definition.id)) {
      modules.push(definition.id);
    }
  }
  return modules;
}

export interface ClassifyNodeInput {
  sourceFile: string | null;
  external: boolean;
  fileType: string | null;
  label: string;
  callable: boolean;
  callableClass: boolean;
}

export interface NodeClassification {
  scope: AtlasScope;
  moduleId: AtlasModuleId | null;
  moduleIds: AtlasModuleId[];
  kind: AtlasNodeKind;
  symbolType: AtlasSymbolType;
}

export function classifyNode(input: ClassifyNodeInput): NodeClassification {
  const scope = input.external ? 'external' : classifyScope(input.sourceFile);
  const primary = input.external ? null : primaryModuleFor(input.sourceFile);
  const supporting = input.external ? [] : supportingModulesFor(input.sourceFile);
  const moduleIds = [...(primary ? [primary] : []), ...supporting.filter((id) => id !== primary)];

  const fileLabel = /\.(?:tsx?|jsx?|mjs|cjs|py|css)$/i.test(input.label);
  if (input.external) {
    return { scope, moduleId: null, moduleIds, kind: 'external', symbolType: 'external' };
  }
  if (input.fileType === 'concept') {
    return { scope, moduleId: primary, moduleIds, kind: 'concept', symbolType: 'concept' };
  }
  if (input.fileType === 'rationale') {
    return { scope, moduleId: primary, moduleIds, kind: 'rationale', symbolType: 'rationale' };
  }
  if (fileLabel) {
    return { scope, moduleId: primary, moduleIds, kind: 'file', symbolType: 'file' };
  }
  if (input.callableClass) {
    return { scope, moduleId: primary, moduleIds, kind: 'symbol', symbolType: 'class' };
  }
  if (input.callable) {
    return {
      scope,
      moduleId: primary,
      moduleIds,
      kind: 'symbol',
      symbolType: input.label.startsWith('.') ? 'method' : 'function',
    };
  }
  return { scope, moduleId: primary, moduleIds, kind: 'symbol', symbolType: 'unknown' };
}

export function baseModuleStats(): AtlasModuleStats {
  return {
    productNodes: 0,
    supportingNodes: 0,
    productRelations: 0,
    crossModuleRelations: 0,
    extractedRelations: 0,
    inferredRelations: 0,
    ambiguousRelations: 0,
    verifiedRelations: 0,
    unverifiedRelations: 0,
    files: 0,
    communities: 0,
  };
}

export function moduleReviewNote(definition: ModuleDefinition): string {
  if (definition.review === 'verified') {
    return '模块组成由 AI 按源码路径复核；内部关系仍逐条保留审核状态。';
  }
  return '模块边界只能部分确认；未用推测补齐缺失组件。';
}
