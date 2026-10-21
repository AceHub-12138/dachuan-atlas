/**
 * ATLAS 标准架构数据 Schema（P1.0，P1.2 模块协作场景，P1.3 语义与多仓库准备，
 * P1.4 仓库/运行时双维度作用域）。
 *
 * 这一层刻意与 Graphify 原始 JSON 解耦：Canvas 场景、详情面板和导入/导出
 * 都只读取这里的结构，不再直接消费 graph.json。
 *
 * 版本策略：schemaVersion 使用 semver；主版本变化表示不兼容。导入时只接受
 * 同一主版本的数据，避免旧前端静默读取新结构。
 *
 * 1.2.0 增加可选的 flows（模块协作场景）。
 * 1.3.0 增加流程语义（概念步骤 / 静态关联 / 运行时顺序）、模块“为什么需要它”
 * 的解释、以及多仓库/运行时边界的可选元数据。
 * 1.4.0 把关系的仓库维度与运行时维度拆开：
 *   - repositoryScope: intra-repository | cross-repository
 *   - runtimeScope: intra-runtime | cross-runtime | unknown
 * 两个维度正交，因此“跨仓库 + 跨进程”可以同时成立；“跨仓库”不再自动
 * 等于“跨进程”，运行时边界未知时也绝不推断为同进程。
 *
 * 1.0–1.3 数据仍可导入：旧 relation.scope 会按显式规则迁移，原始证据与
 * 审核记录保留；未知的运行时边界一律迁移为 unknown。
 */

export const ATLAS_SCHEMA_ID = 'atlas.architecture';
export const ATLAS_SCHEMA_VERSION = '1.4.0';
export const ATLAS_SCHEMA_MAJOR = 1;
export const ATLAS_SCHEMA_MINOR = 4;

export type AtlasSourceKind = 'demo' | 'graphify';
export type AtlasSourceOrigin = 'demo' | 'bundled' | 'file-import';
export type AtlasReviewStatus = 'verified' | 'partially_verified' | 'unverified';
export type AtlasReviewMethod =
  | 'graphify-extracted'
  | 'graphify-inferred'
  | 'ai-source-review'
  | 'human-review'
  | 'unverified';
export type AtlasEvidenceConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | 'SIMULATED' | 'UNKNOWN';
export type AtlasSystemId = 'crm' | 'nexus' | 'electron';
/**
 * 模块 ID 在单个数据集内唯一。NEXUS 继续使用四个固定 ID；CRM / Electron
 * 使用自己的模块集合，不能复用 NEXUS 的模块定义。模块归属由
 * AtlasModuleRecord.repository 绑定到具体仓库。
 */
export type AtlasModuleId = 'data' | 'voice' | 'animation' | 'canvas' | (string & {});
export type AtlasNodeKind = 'file' | 'symbol' | 'concept' | 'rationale' | 'external';
export type AtlasScope = 'product' | 'test' | 'tooling' | 'external' | 'demo';
/**
 * 代码实际执行的进程边界。NEXUS 历史快照尚未逐节点标注，因此不能据此
 * 推断任何运行时调用。不同已知边界的节点之间的静态关系必须标记为
 * cross-runtime，避免把浏览器与服务端当成同一运行时。
 */
export type AtlasRuntimeBoundary =
  | 'browser-renderer'
  | 'node-service'
  | 'electron-main'
  | 'electron-renderer'
  | 'shared'
  | 'unknown';
/**
 * 1.3 及更早的单一枚举。它把仓库维度与运行时维度混在一起，无法表达
 * “同一关系既跨仓库又跨进程”。1.4 只把它保留为迁移输入与审计原值。
 */
export type AtlasRelationScope = 'intra-repository' | 'cross-repository' | 'cross-process';
/** 1.4 仓库维度：关系两端是否属于同一个仓库。 */
export type AtlasRepositoryScope = 'intra-repository' | 'cross-repository';
/**
 * 1.4 运行时维度，与仓库维度正交：
 * - intra-runtime：两端都有证据表明处在同一已知运行时；
 * - cross-runtime：两端跨越运行时边界（同仓库或跨仓库都可能）；
 * - unknown：没有足够边界或运行时证据；不得当作 intra-runtime。
 */
export type AtlasRuntimeScope = 'intra-runtime' | 'cross-runtime' | 'unknown';
/** 只有这些证据类型可以支撑 runtimeVerified。 */
export type AtlasRuntimeEvidenceKind =
  | 'runtime-trace'
  | 'runtime-log'
  | 'protocol-test'
  | 'integration-test'
  | 'runtime-observation';
/** 跨仓库关系必须携带的接口/协议证据类型。 */
export type AtlasContractEvidenceKind =
  | 'api-contract'
  | 'protocol-schema'
  | 'package-manifest'
  | 'config-binding'
  | 'contract-test'
  | 'integration-test';
export type AtlasSymbolType =
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'type'
  | 'constant'
  | 'variable'
  | 'file'
  | 'concept'
  | 'rationale'
  | 'external'
  | 'unknown';

export type AtlasRelationType =
  | 'contains'
  | 'calls'
  | 'imports_from'
  | 'imports'
  | 'method'
  | 'indirect_call'
  | 'references'
  | 'rationale_for'
  | 'implements'
  | 'dynamic_import'
  | 'cites'
  | 'unknown';

export interface AtlasReview {
  status: AtlasReviewStatus;
  /**
   * 审核方式。P1.1 起必填；1.0 数据迁移时根据已知信息补全。
   * status=verified 不等于人工审核，必须结合 method 判断。
   */
  method: AtlasReviewMethod;
  /** 审核主体，例如 Graphify 0.9.92、ZCode + DeepSeek、具体人工审核人。 */
  actor: string | null;
  /** 兼容 P1.0 字段；通常与 actor 相同。 */
  reviewer: string | null;
  reviewedAt: string | null;
  note: string | null;
  /** 审核所依据的源码位置；AI/人工复核必须尽量提供。 */
  evidence: AtlasEvidenceRef[];
}

export interface AtlasEvidenceRef {
  repository: string;
  /** 完整提交 SHA；原始图未提供时为 'unknown'。 */
  commit: string;
  /** 仓库相对路径，统一使用 POSIX 分隔符。 */
  file: string;
  line: number | null;
  symbol: string | null;
  /** 便于界面展示的定位符，例如 src/a.ts#L23。 */
  locator: string;
}

/**
 * 运行时证据必须能说明它是哪一类真实运行记录。源码行、AI 复核意见或
 * Graphify 静态边都不是运行时证据，不能单独支撑 runtimeVerified=true。
 * 1.3 旧数据没有 kind；迁移时保留原证据位置，但把无法分类的
 * runtimeVerified=true 降级为 false。
 */
export interface AtlasRuntimeEvidenceRef extends AtlasEvidenceRef {
  kind?: AtlasRuntimeEvidenceKind | null;
  capturedAt?: string | null;
  note?: string | null;
}

/** 跨仓库接口/协议证据；与普通源码证据分开保存，避免把目录相似当成契约。 */
export interface AtlasContractEvidenceRef extends AtlasEvidenceRef {
  kind: AtlasContractEvidenceKind;
  note?: string | null;
}

export interface AtlasUnresolvedCall {
  callee: string;
  receiverType: string | null;
  line: string | null;
  language: string | null;
}

export interface AtlasNodeMetadata {
  /**
   * Graphify 在 AST 中看见、但未能落成边的调用。保留它是为了说明
   * “图中没有边”不等于“调用不存在”。
   */
  unresolvedCalls?: AtlasUnresolvedCall[];
}

export interface AtlasNode {
  /** 跨版本逻辑 ID：repository:path#symbol，不含提交 SHA。 */
  id: string;
  /** Graphify 原始节点 ID，仅用于追溯。 */
  sourceId: string;
  repository: string;
  system: AtlasSystemId;
  kind: AtlasNodeKind;
  symbol: string;
  symbolType: AtlasSymbolType;
  sourceFile: string | null;
  sourceLine: number | null;
  scope: AtlasScope;
  /** 主模块。一个节点只能有一个主模块，避免统计重复。 */
  moduleId: AtlasModuleId | null;
  /** 全部匹配模块，主模块在首位；Canvas 等交叉能力会出现在这里。 */
  moduleIds: AtlasModuleId[];
  /** 仅在中文名称经过源码核对后填写。 */
  displayName: string | null;
  responsibility: string | null;
  sourceConfidence: AtlasEvidenceConfidence;
  review: AtlasReview;
  /** Graphify community 原值，只作参考，不参与模块判定。 */
  community: number | null;
  external: boolean;
  /** P1.3 可选：节点的运行时边界；未标注时为 null，不能猜测。 */
  runtimeBoundary?: AtlasRuntimeBoundary | null;
  metadata: AtlasNodeMetadata;
  evidence: AtlasEvidenceRef[];
}

export interface AtlasRelation {
  id: string;
  from: string;
  to: string;
  type: AtlasRelationType;
  sourceRelation: string;
  evidenceType: AtlasEvidenceConfidence;
  confidence: number | null;
  review: AtlasReview;
  evidence: AtlasEvidenceRef | null;
  /** 自调用/递归；不是无效边。 */
  selfReference: boolean;
  context: string | null;
  /**
   * P1.4 仓库维度。跨仓库关系必须显式标记、经过 AI/人工复核，并在 1.4
   * 数据中携带 interfaceEvidence；旧版数据缺少分类时只能作为未确认候选
   * 保留，不进入已确认跨仓库关系图。
   */
  repositoryScope: AtlasRepositoryScope;
  /**
   * P1.4 运行时维度。与 repositoryScope 正交：
   * - 跨仓库 + 跨运行时可以同时成立；
   * - 同仓库也可以跨运行时；
   * - 跨仓库不自动等于跨运行时；
   * - 边界未知时为 unknown，不得写成 intra-runtime。
   */
  runtimeScope: AtlasRuntimeScope;
  /** 仅当有可追溯、带类型的运行时证据且经过复核时才为 true；默认 false。 */
  runtimeVerified: boolean;
  /** 运行时证据（trace、日志、协议/集成测试等）；没有时为空数组。 */
  runtimeEvidence: AtlasRuntimeEvidenceRef[];
  /** 跨仓库接口/协议证据；仓库内关系可以为空。 */
  interfaceEvidence: AtlasContractEvidenceRef[];
  /** 1.3 及更早的原始 scope，仅作迁移审计；不参与 1.4 判定。 */
  legacyScope?: AtlasRelationScope | null;
  /** 作用域迁移/判定的可读说明，不得用推测替代证据。 */
  scopeNote?: string | null;
  flags: {
    deferred: boolean;
    typeOnly: boolean;
  };
  /** 原始 links 数组下标，便于回到 Graphify 产物核对。 */
  sourceIndex: number;
}

export interface AtlasSnapshotStats {
  files: number;
  nodes: number;
  relations: number;
  /** Graphify 报告按无向节点对计数；graph.json 中可能有多重关系。 */
  uniqueRelationPairs: number;
  extractedRelations: number;
  inferredRelations: number;
  ambiguousRelations: number;
  communities: number;
  selfReferences: number;
  duplicateRelationsCollapsed: number;
  danglingRelationsDropped: number;
  nodesWithoutSource: number;
  redactedLabels: number;
}

export interface AtlasManifestStatus {
  fileCount: number;
  byteCount: number;
  verifiedFiles: number;
  hashAlgorithm: 'sha256';
  verifiedAt: string | null;
  status: 'verified' | 'unverified';
}

export interface AtlasSnapshot {
  id: string;
  repository: {
    id: string;
    name: string;
  };
  commit: string;
  commitShort: string;
  /** 图谱生成时间；原始产物未提供时为 null，界面必须显示“未知”。 */
  generatedAt: string | null;
  importedAt: string;
  graphifyVersion: string;
  graphifySchemaVersion: number;
  atlasSchemaVersion: string;
  /** 历史快照标记：永远为 true，避免被当成当前实时架构。 */
  history: true;
  importStatus: 'complete' | 'partial';
  stats: AtlasSnapshotStats;
  manifest: AtlasManifestStatus | null;
  notes: string[];
}

export interface AtlasModuleEvidence {
  pathPrefix: string;
  role: 'primary' | 'supporting';
  review: AtlasReviewStatus;
  note: string;
  /** 用于人工复核的代表性源码位置。 */
  sourceRefs: AtlasEvidenceRef[];
}

export interface AtlasModuleStats {
  /** 主归属且 scope=product 的节点数。 */
  productNodes: number;
  /** 非主归属但被标记为支撑模块的节点数。 */
  supportingNodes: number;
  productRelations: number;
  crossModuleRelations: number;
  extractedRelations: number;
  inferredRelations: number;
  ambiguousRelations: number;
  verifiedRelations: number;
  unverifiedRelations: number;
  files: number;
  communities: number;
}

export interface AtlasModuleComponent {
  symbol: string;
  file: string;
  line: number | null;
  name: string;
  responsibility: string;
  review: AtlasReview;
}

/**
 * 面向非程序员的模块解释。what 直接使用已审核的 summary / responsibilities；
 * 这里只补充“为什么需要它”，并单独记录解释的来源与审核方式。
 * 未收录时保持 null，界面明确显示“未收录”，不由前端自动生成。
 */
export interface AtlasModuleExplanation {
  whyNeeded: string;
  review: AtlasReview;
}

export interface AtlasModuleRecord {
  id: AtlasModuleId;
  index: string;
  name: string;
  latin: string;
  /** 模块定义所属仓库；CRM / Electron 不能复用 NEXUS 的模块定义。 */
  repository: string;
  system: AtlasSystemId;
  /** 兼容字段：组成核对状态。具体审核方式见 reviewRecord。 */
  review: AtlasReviewStatus;
  reviewRecord: AtlasReview;
  /** 面向非开发用户的一句话介绍。 */
  summary: string;
  /** 已核实的主要职责，3–5 条。 */
  responsibilities: string[];
  /** 面向普通用户的“为什么需要它”；未收录时为 null。 */
  explanation?: AtlasModuleExplanation | null;
  /** 面向用户的模块构成，默认 3–5 个代表对象。 */
  keyComponents: AtlasModuleComponent[];
  /** 尚未覆盖的运行时行为或待核实事项。 */
  gaps: string[];
  /** 归类规则说明；Community 不参与规则。 */
  rule: string;
  description: string;
  notes: string[];
  evidence: AtlasModuleEvidence[];
  stats: AtlasModuleStats;
}

export interface AtlasSystemRecord {
  id: AtlasSystemId;
  name: string;
  dataStatus: 'connected' | 'not_connected' | 'simulated';
  source: 'graphify' | 'demo';
  snapshotId: string | null;
  note: string;
}

export interface AtlasIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  count: number;
}

export interface AtlasDiagnostics {
  issues: AtlasIssue[];
  counts: {
    rawNodes: number;
    rawRelations: number;
    nodes: number;
    relations: number;
    productNodes: number;
    testNodes: number;
    toolingNodes: number;
    externalNodes: number;
    conceptNodes: number;
    rationaleNodes: number;
    modulesAssigned: number;
    modulesUnassigned: number;
    unresolvedCalls: number;
    nodesWithUnresolvedCalls: number;
  };
  unresolvedCallsByReceiver: { receiver: string; count: number }[];
  /** 关系审核来源统计；AI 复核与独立人工审核分开计数。 */
  reviewCounts: {
    aiReviewed: number;
    humanReviewed: number;
    graphifyExtractedUnverified: number;
    graphifyInferredUnverified: number;
    unverified: number;
  };
  /**
   * 已确认的 Graphify 覆盖盲区。这些是“没看见”，不是“不存在”。
   */
  coverageNotes: string[];
}

export interface AtlasSourceDescriptor {
  kind: AtlasSourceKind;
  label: string;
  detail: string;
  simulated: boolean;
  snapshotId: string | null;
  origin: AtlasSourceOrigin;
}

/**
 * 模块协作场景是本地附加的“解释材料”，不是自动生成的业务流程图。
 * 每一步都必须指向快照里真实存在的文件与符号；步骤之间的连边由
 * 数据集中的关系实时计算，缺口不会自动补全。
 *
 * P1.3 起显式区分：
 * - semantics=module-collaboration：AI 按已核对职责整理的概念步骤，不是运行时顺序；
 * - semantics=runtime-verified：确实有运行时证据的调用顺序。
 * 当前 NEXUS 语音场景属于前者，必须用“模块协作示意”命名，不能称为执行流程。
 */
export type AtlasFlowSemantics = 'module-collaboration' | 'runtime-verified';
export type AtlasFlowStepBasis = 'source-responsibility' | 'runtime-evidence';

export interface AtlasFlowRuntimeOrder {
  /** 仅当有可追溯的运行时证据时才为 true。 */
  verified: boolean;
  /** 说明证据范围，或明确写出“尚未验证”。 */
  note: string;
  evidence: AtlasEvidenceRef[];
}

export interface AtlasFlowStep {
  id: string;
  /** 面向普通用户的一步标题。 */
  title: string;
  /** 这一步在源码中被证实的职责，不描述未经核实的运行时行为。 */
  description: string;
  moduleId: AtlasModuleId;
  file: string;
  symbol: string;
  line: number | null;
  /** 为什么可以这样描述；引用源码职责或注释。 */
  note: string;
  /** 步骤依据：已核对职责，或运行时证据；默认 source-responsibility。 */
  basis?: AtlasFlowStepBasis;
}

export interface AtlasFlowScenario {
  id: string;
  title: string;
  summary: string;
  entryModuleId: AtlasModuleId;
  steps: AtlasFlowStep[];
  /** 场景整理者的审核记录；不代表步骤之间的运行时顺序已被验证。 */
  review: AtlasReview;
  disclaimer: string;
  /** 场景语义；1.2 旧数据迁移时默认为 module-collaboration。 */
  semantics?: AtlasFlowSemantics;
  /** 运行时顺序是否已验证；默认 verified=false，evidence=[]。 */
  runtimeOrder?: AtlasFlowRuntimeOrder;
}

/**
 * 多仓库准备（P1.3）。
 *
 * 当前数据集仍是一个仓库、一个历史快照；repositories 只是可选的登记表。
 * 未来每个仓库以自己的 .atlas.json 导入，快照用 snapshotKey 区分；不同
 * 仓库/快照的节点不合并成同一张“运行时图”。节点 ID 的仓库前缀必须与
 * repository.id 一致。
 */
export interface AtlasRepositorySnapshotRef {
  snapshotId: string;
  /** 仓库 + 提交 + 生成时间的稳定标识，用于同时存在多个历史快照时区分。 */
  snapshotKey: string;
  commit: string;
  commitShort: string;
  /** 仓库扫描时间；与图谱生成时间、导入时间分开记录。 */
  scannedAt: string | null;
  generatedAt: string | null;
  importedAt: string;
  graphifyVersion: string;
  nodeCount: number;
  relationCount: number;
  history: true;
}

export interface AtlasRepositoryRecord {
  id: string;
  name: string;
  system: AtlasSystemId;
  snapshots: AtlasRepositorySnapshotRef[];
}

/**
 * 从 1.3 及更早数据迁移关系作用域时的汇总。逐条迁移说明仍保留在
 * relation.scopeNote，这里只给出可审计的总量，避免每条关系重复长文本。
 */
export interface AtlasScopeMigrationSummary {
  fromSchemaVersion: string;
  relations: number;
  repositoryScopes: {
    intraRepository: number;
    crossRepository: number;
  };
  runtimeScopes: {
    intraRuntime: number;
    crossRuntime: number;
    unknown: number;
  };
  /** 旧 scope 原值计数；'none' 表示旧数据没有该字段。 */
  legacyScopes: Record<string, number>;
  /** 旧 runtimeVerified=true 因缺少带类型证据而被降级的数量。 */
  runtimeVerifiedDowngraded: number;
  notes: string[];
}

export interface AtlasDataset {
  schemaId: typeof ATLAS_SCHEMA_ID;
  schemaVersion: string;
  /** 从旧版 Schema 迁移时记录原版本，便于审计。 */
  schemaMigratedFrom?: string;
  /** 1.4 关系作用域迁移汇总；1.4 原生数据不需要。 */
  scopeMigration?: AtlasScopeMigrationSummary;
  /** 数据集构建/导出时间，不是源码提交时间。 */
  generatedAt: string;
  source: AtlasSourceDescriptor;
  snapshot: AtlasSnapshot | null;
  systems: AtlasSystemRecord[];
  modules: AtlasModuleRecord[];
  nodes: AtlasNode[];
  relations: AtlasRelation[];
  diagnostics: AtlasDiagnostics;
  /** 可选模块协作场景；旧版数据导入后为空数组，不会自动生成。 */
  flows: AtlasFlowScenario[];
  /** 可选仓库登记表；旧版数据会从 snapshot 推导一个仓库记录。 */
  repositories?: AtlasRepositoryRecord[];
}

export type AtlasErrorCode =
  | 'GRAPHIFY_INVALID_JSON'
  | 'GRAPHIFY_NOT_OBJECT'
  | 'GRAPHIFY_METADATA_MISSING'
  | 'GRAPHIFY_SCHEMA_UNSUPPORTED'
  | 'GRAPHIFY_VERSION_UNSUPPORTED'
  | 'GRAPHIFY_NODES_INVALID'
  | 'GRAPHIFY_LINKS_INVALID'
  | 'GRAPHIFY_EMPTY'
  | 'GRAPHIFY_COMMIT_MISMATCH'
  | 'GRAPHIFY_MANIFEST_INVALID'
  | 'ATLAS_INVALID_JSON'
  | 'ATLAS_NOT_OBJECT'
  | 'ATLAS_SCHEMA_ID_UNSUPPORTED'
  | 'ATLAS_SCHEMA_VERSION_UNSUPPORTED'
  | 'ATLAS_DATASET_INVALID'
  | 'ATLAS_DATASET_DANGLING_RELATION'
  | 'ATLAS_DATASET_DUPLICATE_NODE'
  | 'ATLAS_DATASET_DUPLICATE_RELATION'
  | 'ATLAS_DATASET_MODULE_INVALID'
  | 'ATLAS_DATASET_PATH_LEAK'
  | 'ATLAS_DATASET_SNAPSHOT_INVALID'
  | 'ATLAS_DATASET_FLOW_INVALID'
  | 'ATLAS_DATASET_REPOSITORY_INVALID'
  | 'ATLAS_DATASET_CROSS_REPO_INVALID'
  | 'SNAPSHOT_LOAD_FAILED'
  | 'IMPORT_FILE_MISSING'
  | 'IMPORT_FILE_UNRECOGNIZED';

export class AtlasDataError extends Error {
  readonly code: AtlasErrorCode;
  readonly details: string[];

  constructor(code: AtlasErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'AtlasDataError';
    this.code = code;
    this.details = details;
  }
}

export const REVIEW_LABELS: Record<AtlasReviewStatus, string> = {
  verified: '已核实',
  partially_verified: '部分核实',
  unverified: '待核实',
};

export const REVIEW_METHOD_LABELS: Record<AtlasReviewMethod, string> = {
  'graphify-extracted': 'Graphify 直接提取',
  'graphify-inferred': 'Graphify 推断',
  'ai-source-review': 'AI 源码复核',
  'human-review': '独立人工审核',
  unverified: '尚未核实',
};

export function reviewLabel(review: AtlasReview): string {
  if (review.method === 'human-review') return '独立人工审核';
  if (review.method === 'ai-source-review') return 'AI 源码复核';
  if (review.method === 'graphify-inferred') return 'Graphify 推断';
  if (review.method === 'graphify-extracted') {
    return review.status === 'verified' ? 'Graphify 直接提取' : '直接提取 · 待核实';
  }
  return review.status === 'verified' ? '已核实（来源未记录）' : '尚未核实';
}

export function isHumanReviewed(review: AtlasReview): boolean {
  return review.method === 'human-review' && review.status === 'verified';
}

export function isAiReviewed(review: AtlasReview): boolean {
  return review.method === 'ai-source-review' && review.status !== 'unverified';
}

/** AI 或独立人工复核过；Graphify 提取/推断本身不算复核。 */
export function isReviewed(review: AtlasReview): boolean {
  return (
    (review.method === 'ai-source-review' || review.method === 'human-review') &&
    review.status !== 'unverified'
  );
}

/**
 * 已确认关系的判定：必须经过 AI/人工复核，并保留源码、接口或运行时证据。
 * 未审核的候选关系不得进入已确认关系图；它最多作为原始记录保留。
 */
export function isConfirmedRelation(relation: AtlasRelation): boolean {
  if (!isReviewed(relation.review)) return false;
  const hasSourceEvidence = relation.evidence !== null || relation.review.evidence.length > 0;
  const hasInterfaceEvidence = relation.interfaceEvidence.length > 0;
  const hasRuntimeEvidence = relation.runtimeVerified && relation.runtimeEvidence.length > 0;
  return hasSourceEvidence || hasInterfaceEvidence || hasRuntimeEvidence;
}

/**
 * 跨仓库关系只有在复核 + 接口/协议证据同时成立时才进入已确认图。
 * 1.3 迁移的跨仓库关系可能没有类型化接口证据，因此保留为候选。
 */
export function isConfirmedCrossRepositoryRelation(relation: AtlasRelation): boolean {
  return (
    relation.repositoryScope === 'cross-repository' &&
    isConfirmedRelation(relation) &&
    relation.interfaceEvidence.length > 0
  );
}

export const MODULE_ORDER: AtlasModuleId[] = ['data', 'voice', 'animation', 'canvas'];

export function isAtlasModuleId(value: unknown): value is AtlasModuleId {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

export function isAtlasSystemId(value: unknown): value is AtlasSystemId {
  return value === 'crm' || value === 'nexus' || value === 'electron';
}

export function emptyReview(
  note: string | null = null,
  method: AtlasReviewMethod = 'unverified',
  evidence: AtlasEvidenceRef[] = [],
  actor: string | null = null,
): AtlasReview {
  return {
    status: 'unverified',
    method,
    actor,
    reviewer: actor,
    reviewedAt: null,
    note,
    evidence,
  };
}

export function aiReview(
  note: string,
  evidence: AtlasEvidenceRef[],
  options: { actor: string; reviewedAt: string; status?: AtlasReviewStatus } = {
    actor: 'ZCode + DeepSeek（施工 Agent）',
    reviewedAt: '2026-10-21',
  },
): AtlasReview {
  return {
    status: options.status ?? 'verified',
    method: 'ai-source-review',
    actor: options.actor,
    reviewer: options.actor,
    reviewedAt: options.reviewedAt,
    note,
    evidence,
  };
}

export function humanReview(
  note: string,
  evidence: AtlasEvidenceRef[],
  options: { actor: string; reviewedAt: string; status?: AtlasReviewStatus },
): AtlasReview {
  return {
    status: options.status ?? 'verified',
    method: 'human-review',
    actor: options.actor,
    reviewer: options.actor,
    reviewedAt: options.reviewedAt,
    note,
    evidence,
  };
}
