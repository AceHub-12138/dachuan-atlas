/**
 * AI 源码复核记录（独立于 Graphify 原始数据）。
 *
 * 这些记录在重新导入 graph.json 时由适配器重新应用，不会因为重新扫描而丢失。
 * 目前没有独立人工审核记录；humanReviewed 必须保持 0，直到有真实审核人签字。
 */

export const AI_REVIEW_ACTOR = 'ZCode + DeepSeek（P1.1 施工 Agent）';
export const AI_REVIEW_DATE = '2026-10-21';

export interface AiReviewedRelation {
  /** fromLabel|type|toLabel|link.source_file */
  key: string;
  note: string;
}

export const AI_REVIEWED_RELATIONS: AiReviewedRelation[] = [
  { key: 'microphone.ts|imports_from|pcm-player.ts|src/lib/voice/microphone.ts', note: 'microphone.ts L2 显式导入 pcm-player。' },
  { key: 'main.ts|imports|AudioStore|services/voice-orchestrator/src/main.ts', note: 'main.ts L24 显式导入 AudioStore。' },
  { key: 'main.ts|imports|createVoiceOrchestrator()|services/voice-orchestrator/src/main.ts', note: 'main.ts L21 显式导入 createVoiceOrchestrator。' },
  { key: 'MotionProvider.tsx|imports|MotionDirector|src/components/screen/motion/MotionProvider.tsx', note: 'MotionProvider.tsx L4 显式导入 MotionDirector。' },
  { key: 'useSceneMotion.ts|imports_from|MotionProvider.tsx|src/components/screen/motion/useSceneMotion.ts', note: 'useSceneMotion.ts L5 从 MotionProvider.tsx 导入运行时 hook。' },
  { key: 'ScreenStage.tsx|imports_from|useSceneMotion.ts|src/components/screen/ScreenStage.tsx', note: 'ScreenStage.tsx L3 显式导入 useSceneMotion。' },
  { key: 'ScreenStage()|calls|useSceneMotion()|src/components/screen/ScreenStage.tsx', note: 'ScreenStage.tsx L15 调用 useSceneMotion(payload, setActiveKey)。' },
  { key: 'ScreenStage()|calls|ShipmentMap()|src/components/screen/ScreenStage.tsx', note: 'ScreenStage.tsx L40 渲染 ShipmentMap。' },
  { key: 'ScreenStage()|calls|ContractGauge()|src/components/screen/ScreenStage.tsx', note: 'ScreenStage.tsx L39 渲染 ContractGauge。' },
  { key: 'ScreenStage()|calls|OperationMetrics()|src/components/screen/ScreenStage.tsx', note: 'ScreenStage.tsx L39 渲染 OperationMetrics。' },
  { key: 'KpiRail()|calls|Gauge()|src/components/screen/KpiRail.tsx', note: 'KpiRail.tsx L114 渲染 Gauge。' },
  { key: 'useSceneMotion()|calls|useMotionDirector()|src/components/screen/motion/useSceneMotion.ts', note: 'useSceneMotion.ts L13 调用 useMotionDirector()。' },
  {
    key: 'createVoiceOrchestrator()|indirect_call|beginSession()|services/voice-orchestrator/src/orchestrator.ts',
    note: '原图为 INFERRED；orchestrator.ts L997 返回对象显式包含 beginSession，推断成立。',
  },
];

export const AI_REVIEWED_RELATION_MAP = new Map(
  AI_REVIEWED_RELATIONS.map((rule) => [rule.key, rule.note]),
);
