/**
 * 中文名称与职责注释。只有逐条打开历史快照源码核对过的节点才写入这里；
 * 未收录的节点保持英文符号名，displayName 为 null，不做机器翻译或猜测。
 *
 * key = `${sourceFile}::${labelWithoutParens}`
 */

export interface DisplayAnnotation {
  file: string;
  symbol: string;
  line: number;
  name: string;
  responsibility: string;
  note: string;
}

export const DISPLAY_ANNOTATIONS: DisplayAnnotation[] = [
  // 语音交互 · 浏览器端
  {
    file: 'src/lib/voice/microphone.ts',
    symbol: 'VoiceMicrophone',
    line: 15,
    name: '浏览器麦克风',
    responsibility: '负责麦克风权限、VAD/KWS 采集，并在播放期间让出输入。',
    note: '类声明与音频工作线程字段已核对。',
  },
  {
    file: 'src/lib/voice/pcm-player.ts',
    symbol: 'PcmPlayer',
    line: 28,
    name: 'PCM 播放器',
    responsibility: '按句子排队播放 PCM，处理降音、打断与自动播放限制。',
    note: '类声明与播放失败类型已核对。',
  },
  {
    file: 'src/lib/voice/protocol.ts',
    symbol: 'parseWireEvent',
    line: 198,
    name: '语音协议解析',
    responsibility: '解析编排服务下发的事件；未知事件按 fail-closed 丢弃。',
    note: '函数签名与文件头协议说明已核对。',
  },
  {
    file: 'src/lib/voice/session-machine.ts',
    symbol: 'sessionReducer',
    line: 178,
    name: '语音会话状态机',
    responsibility: '维护 ambient、listening、thinking、speaking 等会话状态转换。',
    note: '状态类型与 reducer 位置已核对。',
  },
  {
    file: 'src/lib/voice/live-source.ts',
    symbol: 'wireToMachineEvents',
    line: 40,
    name: '协议到状态机映射',
    responsibility: '把 wire 传输事件转换为覆盖层内部状态机事件。',
    note: '映射函数位置已核对。',
  },
  {
    file: 'src/components/overlay/JarvisCore.tsx',
    symbol: 'JarvisCore',
    line: 80,
    name: '语音覆盖层 Canvas 核心',
    responsibility: '用全屏 Canvas 2D 粒子环系表达语音状态与能量。',
    note: '组件声明与文件头粒子结构说明已核对。',
  },
  {
    file: 'src/components/overlay/OverlayStage.tsx',
    symbol: 'OverlayStage',
    line: 73,
    name: '语音覆盖层舞台',
    responsibility: '组织语音覆盖层、答案卡与音频输入输出控制。',
    note: '组件声明位置已核对。',
  },
  {
    file: 'src/lib/voice/intent-answers.ts',
    symbol: 'buildIntentAnswer',
    line: 15,
    name: '意图答案构建',
    responsibility: '根据意图与大屏 payload 生成回答卡数据。',
    note: '函数签名已核对。',
  },
  // 语音交互 · 服务端
  {
    file: 'services/voice-orchestrator/src/orchestrator.ts',
    symbol: 'createVoiceOrchestrator',
    line: 132,
    name: '语音编排器',
    responsibility: '服务端语音会话入口，编排 ASR、LLM、TTS 与数据源。',
    note: '工厂函数位置与 OrchestratorOptions 已核对。',
  },
  {
    file: 'services/voice-orchestrator/src/tts/audio-store.ts',
    symbol: 'AudioStore',
    line: 23,
    name: 'TTS 音频缓存',
    responsibility: '按 turn 与 sentence 缓存合成音频，并通知等待中的播放方。',
    note: '类声明与 BufferedSentence 类型已核对。',
  },
  {
    file: 'services/voice-orchestrator/src/ws/ws-server.ts',
    symbol: 'startVoiceHub',
    line: 90,
    name: '语音 WebSocket 服务',
    responsibility: '启动语音 hub，处理鉴权、来源校验与连接管理。',
    note: '函数声明与鉴权函数位置已核对。',
  },
  {
    file: 'services/voice-orchestrator/src/tts/voice-local-client.ts',
    symbol: 'SpeechClient',
    line: 14,
    name: '本地语音服务客户端',
    responsibility: '调用本地语音服务的 health、ASR 与 TTS 接口。',
    note: '客户端类声明已核对。',
  },
  // 动画调度
  {
    file: 'src/components/screen/motion/MotionDirector.ts',
    symbol: 'MotionDirector',
    line: 15,
    name: '动画调度器',
    responsibility: '单一 rAF 所有者，管理 INTRO/AMBIENT/PULSE/DEGRADED 状态与自动降级。',
    note: '类声明与“一个未完成 rAF”的源码注释已核对。',
  },
  {
    file: 'src/components/screen/motion/GsapScene.ts',
    symbol: 'GsapScene',
    line: 6,
    name: 'GSAP 代理场景',
    responsibility: '用可采样的代理时间线驱动入场、脉冲、呼吸与航线动画。',
    note: '类声明与代理时间线实现已核对。',
  },
  {
    file: 'src/components/screen/motion/MotionProvider.tsx',
    symbol: 'MotionProvider',
    line: 11,
    name: '动画运行时提供者',
    responsibility: '创建 MotionDirector，并联动页面可见性、减少动态与语音状态。',
    note: '组件声明与 MutationObserver 逻辑已核对。',
  },
  {
    file: 'src/components/screen/motion/useSceneMotion.ts',
    symbol: 'useSceneMotion',
    line: 12,
    name: '大屏场景动效',
    responsibility: '逐帧写入 SVG 属性，并绘制大屏背景 Canvas 粒子。',
    note: 'hook 声明与 getContext 调用已核对。',
  },
  {
    file: 'src/lib/use-reduced-motion.ts',
    symbol: 'useReducedMotion',
    line: 9,
    name: '减少动态偏好',
    responsibility: '订阅 prefers-reduced-motion，向动效层提供无动画偏好。',
    note: 'hook 与 matchMedia 订阅已核对。',
  },
  {
    file: 'src/components/screen/motion/config.ts',
    symbol: 'MotionConfig',
    line: 14,
    name: '动效配置',
    responsibility: '集中定义脉冲、航线、粒子与降级阈值等时间参数。',
    note: '类型声明与 motionConfig 常量已核对。',
  },
  // Canvas 渲染支撑
  {
    file: 'src/lib/voice/params.ts',
    symbol: 'project3',
    line: 255,
    name: '三维弱透视投影',
    responsibility: '把单位球粒子投影到 Canvas 2D 屏幕坐标。',
    note: '函数声明已核对。',
  },
  {
    file: 'src/lib/voice/params.ts',
    symbol: 'buildNucleus',
    line: 323,
    name: '核心粒子构建',
    responsibility: '按种子生成核球粒子，供 JarvisCore 绘制。',
    note: '函数声明已核对。',
  },
  {
    file: 'src/components/screen/ScreenStage.tsx',
    symbol: 'ScreenStage',
    line: 11,
    name: '大屏舞台',
    responsibility: '组织大屏布局、面板与 canvas 粒子层。',
    note: '组件声明与 nexus-particles canvas 已核对。',
  },
  // 经营数据展示
  {
    file: 'src/lib/public-screen-payload.ts',
    symbol: 'toPublicScreenPayload',
    line: 39,
    name: '公开大屏数据投影',
    responsibility: '从 CRM payload 中只保留公开 UI 字段，避免透传敏感对象。',
    note: '函数声明与文件头注释已核对。',
  },
  {
    file: 'src/components/screen/KpiRail.tsx',
    symbol: 'KpiRail',
    line: 71,
    name: '经营指标栏',
    responsibility: '展示合同额、回款、客户与发货等经营指标。',
    note: '组件声明与指标分组已核对。',
  },
  {
    file: 'src/components/screen/NexusPanels.tsx',
    symbol: 'ContractGauge',
    line: 16,
    name: '合同额仪表',
    responsibility: '展示本期合同额与目标达成进度。',
    note: '组件声明已核对。',
  },
  {
    file: 'src/components/screen/NexusPanels.tsx',
    symbol: 'OperationMetrics',
    line: 48,
    name: '经营指标读数',
    responsibility: '展示合同、回款与客户等经营读数。',
    note: '组件声明已核对。',
  },
  {
    file: 'src/components/screen/NexusPanels.tsx',
    symbol: 'CollectionDial',
    line: 58,
    name: '回款表盘',
    responsibility: '以表盘呈现累计回款率。',
    note: '组件声明已核对。',
  },
  {
    file: 'src/components/screen/NexusPanels.tsx',
    symbol: 'DeliveryAlerts',
    line: 82,
    name: '发货预警',
    responsibility: '展示逾期与待发货预警。',
    note: '组件声明已核对。',
  },
  {
    file: 'src/components/screen/NexusPanels.tsx',
    symbol: 'ShipmentFeed',
    line: 88,
    name: '发货动态',
    responsibility: '展示最近发运记录，并与地图选中联动。',
    note: '组件声明与选中回调已核对。',
  },
  {
    file: 'src/components/screen/ShipmentMap.tsx',
    symbol: 'ShipmentMap',
    line: 16,
    name: '业务覆盖地图',
    responsibility: '以 SVG 绘制地图、航线、城市与省份标签。',
    note: '组件声明与 SVG 图层已核对。',
  },
  {
    file: 'src/lib/freshness.ts',
    symbol: 'freshness',
    line: 3,
    name: '数据新鲜度',
    responsibility: '判定大屏快照是否过期或不可用。',
    note: '函数声明已核对。',
  },
  {
    file: 'src/lib/format.ts',
    symbol: 'formatMoney',
    line: 45,
    name: '金额格式化',
    responsibility: '把金额格式化为人民币口径的显示文本。',
    note: '函数声明已核对。',
  },
  {
    file: 'src/lib/format.ts',
    symbol: 'formatCount',
    line: 66,
    name: '计数格式化',
    responsibility: '把整数计数格式化为大屏读数。',
    note: '函数声明已核对。',
  },
  {
    file: 'src/lib/geo.ts',
    symbol: 'createScreenArc',
    line: 66,
    name: '地图航线弧',
    responsibility: '生成两点之间的屏幕弧线，供地图航线使用。',
    note: '函数声明已核对。',
  },
];

const ANNOTATION_BY_KEY = new Map(
  DISPLAY_ANNOTATIONS.map((annotation) => [`${annotation.file}::${annotation.symbol}`, annotation]),
);

export function labelBase(label: string): string {
  return label.endsWith('()') ? label.slice(0, -2) : label;
}

export function annotationFor(file: string | null, label: string): DisplayAnnotation | null {
  if (!file) return null;
  return ANNOTATION_BY_KEY.get(`${file}::${labelBase(label)}`) ?? null;
}

export const DISPLAY_ANNOTATION_COUNT = DISPLAY_ANNOTATIONS.length;
