/**
 * 面向普通用户的简短理解检查（5 题）。
 *
 * - 题目只使用界面中已经展示的概念，不包含源码路径或内部符号；
 * - 每题只有一个正确答案；
 * - 解释与证据提示指向产品界面中的具体位置，便于回看；
 * - 结果只用于自我检查，不是审核或认证。
 */

export interface ComprehensionOption {
  id: string;
  label: string;
}

export interface ComprehensionQuestion {
  id: string;
  prompt: string;
  options: ComprehensionOption[];
  answerId: string;
  explanation: string;
  evidenceHint: string;
}

export interface ComprehensionResult {
  question: ComprehensionQuestion;
  selectedId: string | null;
  correct: boolean;
}

export interface ComprehensionScore {
  total: number;
  correct: number;
  results: ComprehensionResult[];
}

export const COMPREHENSION_QUESTIONS: ComprehensionQuestion[] = [
  {
    id: 'q1-nexus-domains',
    prompt: 'NEXUS 主要由哪些功能领域组成？',
    options: [
      {
        id: 'a',
        label: '经营数据展示、语音交互、动画调度、Canvas 渲染四类能力，其中 Canvas 是分布式能力集合',
      },
      { id: 'b', label: 'CRM、NEXUS、Electron 三个独立系统' },
      { id: 'c', label: '只有经营数据展示和动画调度' },
      { id: 'd', label: '四个互不相关的独立业务子系统' },
    ],
    answerId: 'a',
    explanation:
      'NEXUS 的模块索引列出经营数据展示、语音交互、动画调度和 Canvas 渲染。Canvas 没有独立入口和主归属节点，只是分布在大屏与语音覆盖层中的绘制能力集合，不是独立业务子系统。',
    evidenceHint: 'NEXUS 模块索引；模块详情 · 它是什么 / 组成与关系。',
  },
  {
    id: 'q2-voice-components',
    prompt: '语音交互中有哪些主要组件？',
    options: [
      {
        id: 'a',
        label: '麦克风采集、会话状态机、协议解析、服务端编排、语音合成缓存、PCM 播放、覆盖层呈现',
      },
      { id: 'b', label: '合同仪表、回款表盘、发货地图' },
      { id: 'c', label: '动画调度器、GSAP 代理场景、减少动态偏好' },
      { id: 'd', label: '只有语音合成一个组件' },
    ],
    answerId: 'a',
    explanation:
      '语音模块的已核对证据覆盖浏览器端采集、会话状态、协议解析、服务端编排、音频缓存、PCM 播放和覆盖层呈现。它们之间的部分衔接仍没有图边，不能据此认定完整运行时顺序。',
    evidenceHint: '语音交互详情 · 包含哪些部分；模块协作示意。',
  },
  {
    id: 'q3-motion-director',
    prompt: '动画调度器负责什么？',
    options: [
      {
        id: 'a',
        label: '统一持有单个 requestAnimationFrame，管理场景状态、脉冲节奏、FPS 采样与低动态降级',
      },
      { id: 'b', label: '只负责把合同金额绘制成仪表' },
      { id: 'c', label: '负责麦克风采集与语音识别' },
      { id: 'd', label: '负责数据库事务和登录鉴权' },
    ],
    answerId: 'a',
    explanation:
      '动画调度模块的核心是一个统一的帧调度器：它只持有一个未完成的 requestAnimationFrame，避免多时钟竞争，并根据 FPS、页面可见性、语音状态和减少动态偏好自动降级。',
    evidenceHint: '动画调度详情 · 它做什么 / 包含哪些部分。',
  },
  {
    id: 'q4-canvas-boundary',
    prompt: 'Canvas 为什么不是一个独立业务子系统？',
    options: [
      {
        id: 'a',
        label: '历史快照没有独立 Canvas 入口或主归属节点，绘制能力分布在语音覆盖层与大屏舞台的宿主文件中',
      },
      { id: 'b', label: '因为 Canvas 是浏览器 API，所以不需要任何代码' },
      { id: 'c', label: '因为 Canvas 只能显示黑白颜色' },
      { id: 'd', label: '因为它只存在于测试脚本中' },
    ],
    answerId: 'a',
    explanation:
      'Canvas 模块的主归属节点为 0，只有 4 个支撑归属文件。它能证明 Canvas 2D 绘制存在，但不能证明存在一个独立的 Canvas 子系统或完整调用网络。',
    evidenceHint: 'Canvas 渲染详情 · 它是什么 / 还缺少什么。',
  },
  {
    id: 'q5-link-meaning',
    prompt: '图谱中的一条连接到底表示什么？',
    options: [
      {
        id: 'a',
        label: '当前历史快照中记录的一条静态源码关系（如导入、调用、包含），带有证据等级；不代表运行时调用顺序',
      },
      { id: 'b', label: '已经验证的运行时调用顺序' },
      { id: 'c', label: '两个模块一定存在业务依赖' },
      { id: 'd', label: '只是装饰性连线，没有任何证据' },
    ],
    answerId: 'a',
    explanation:
      '连线来自标准数据集中的静态关系，按直接提取、推断、AI 复核、人工审核和待核实区分。没有连线只表示当前快照没有记录，不代表不存在依赖；静态关系也不等于运行时顺序。',
    evidenceHint: 'NEXUS 真实关系投影摘要；架构投影 · 连线图例与关系证据。',
  },
];

export const COMPREHENSION_QUESTION_COUNT = COMPREHENSION_QUESTIONS.length;

export function scoreComprehension(answers: Record<string, string>): ComprehensionScore {
  const results = COMPREHENSION_QUESTIONS.map((question) => {
    const selectedId = answers[question.id] ?? null;
    return {
      question,
      selectedId,
      correct: selectedId === question.answerId,
    };
  });
  return {
    total: results.length,
    correct: results.filter((result) => result.correct).length,
    results,
  };
}
