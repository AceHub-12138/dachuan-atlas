# ATLAS 标准架构数据 Schema · v1.2.0

- **Schema ID**：`atlas.architecture`
- **版本**：`1.2.0`（兼容 1.0.x / 1.1.x 导入）
- **实现**：`src/architecture/schema.ts`
- **校验 / 导入导出**：`src/architecture/dataset.ts`
- **Graphify 适配器**：`src/architecture/graphify-adapter.ts`
- **适用范围**：P1.0 NEXUS 历史快照；CRM / Electron 尚未接入

---

## 1. 四层数据边界

P1.0 刻意把四类信息分开，避免 Canvas 场景直接消费 Graphify 原始 JSON：

| 层 | 内容 | 存放位置 | 是否可被前端直接读取 |
| --- | --- | --- | --- |
| A. Graphify 原始数据 | `graph.json`、`snapshot-manifest.json`、`GRAPH_REPORT.md` | 用户指定的 POC 目录 | 否；只由适配器读取 |
| B. ATLAS 标准架构数据 | 节点、关系、快照、统计、诊断 | `local-data/nexus/*.atlas.json`（本地，不进入构建） | 是；唯一真实数据入口，需用户本地导入 |
| C. 中文解释与人工审核 | `displayName`、`responsibility`、`review`、模块证据 | 嵌入 B；规则在 `module-map.ts` / `display-names.ts` | 是；只有核对过的才填写 |
| D. 前端布局数据 | 星系位置、模块位置、装饰卫星 | `src/data/atlas.ts` + `AtlasScene.ts` | 是；仍是演示构图 |

D 层本轮没有改动。Canvas 不读取 B 层节点，也不会把 1,390 个源码节点画到首页。

---

## 2. 顶层结构

```ts
interface AtlasDataset {
  schemaId: 'atlas.architecture';
  schemaVersion: '1.2.0';
  generatedAt: string;              // 数据集构建时间，不是源码提交时间
  source: AtlasSourceDescriptor;    // 演示 / Graphify；是否模拟；来源形式
  snapshot: AtlasSnapshot | null;   // 演示数据必须为 null
  systems: AtlasSystemRecord[];
  modules: AtlasModuleRecord[];
  nodes: AtlasNode[];
  relations: AtlasRelation[];
  diagnostics: AtlasDiagnostics;
  flows: AtlasFlowScenario[];       // 可选流程场景；旧版导入后为空数组
}
```

不变量：

1. `schemaId` 必须完全匹配；`schemaVersion` 主版本必须为 `1`。
2. 节点 `id` 全局唯一；关系两端必须存在。
3. `source.kind === 'demo'` 时 `snapshot` 必须为 `null`。
4. `source.kind === 'graphify'` 时 `snapshot.history` 必须为 `true`。
5. 任何源码路径都必须是仓库相对路径（POSIX 分隔符），不得是绝对路径。
6. 节点与关系按 `id` 排序，模块按固定顺序排序；导出文件是确定性的紧凑 JSON。

---

## 3. 节点

```ts
interface AtlasNode {
  id: string;                 // 跨版本逻辑 ID，不含提交 SHA
  sourceId: string;           // Graphify 原始节点 ID，仅追溯
  repository: string;         // 'nexus'
  system: 'crm' | 'nexus' | 'electron';
  kind: 'file' | 'symbol' | 'concept' | 'rationale' | 'external';
  symbol: string;
  symbolType: 'class' | 'function' | 'method' | 'interface' | 'type'
    | 'constant' | 'variable' | 'file' | 'concept' | 'rationale'
    | 'external' | 'unknown';
  sourceFile: string | null;  // 仓库相对路径；外部节点为 null
  sourceLine: number | null;
  scope: 'product' | 'test' | 'tooling' | 'external' | 'demo';
  moduleId: AtlasModuleId | null;   // 主模块，唯一
  moduleIds: AtlasModuleId[];       // 全部匹配模块，主模块在首位
  displayName: string | null;       // 仅在源码核对后填写（P1.1 为 AI 源码复核，非人工）
  responsibility: string | null;    // 仅在源码核对后填写（P1.1 为 AI 源码复核，非人工）
  sourceConfidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
    | 'SIMULATED' | 'UNKNOWN';
  review: AtlasReview;              // 名称/职责注释的审核状态
  community: number | null;         // Graphify 原值，只作参考
  external: boolean;
  metadata: { unresolvedCalls?: AtlasUnresolvedCall[] };
  evidence: AtlasEvidenceRef[];
}
```

### 3.1 逻辑 ID 与跨版本比较

- 基本形式：`nexus:<repo-relative-path>#<symbol>`，例如
  `nexus:src/lib/voice/microphone.ts#VoiceMicrophone`。
- 外部节点：`nexus:external#<sourceId>`。
- 同名符号冲突：优先从 Graphify 原始 ID 推断父级作用域，例如
  `nexus:src/lib/voice/pcm-player.ts#playbackerror.constructor()`。
- 仍无法区分时追加 `@L<line>`，最后才使用 `~2` 序号。
- **逻辑 ID 不含提交 SHA**。跨版本比较时应以「仓库 + 文件路径 + 符号 + 作用域」为主键；`sourceId` 只用于回到原图核对。

### 3.2 证据

`AtlasEvidenceRef` 包含仓库、完整提交 SHA、相对路径、行号、符号与 `file#Lline` 定位符。`commit` 在原始图未提供清单时为 `'unknown'`，界面必须显示“未知”，不能伪造。

---

## 4. 关系

```ts
interface AtlasRelation {
  id: string;
  from: string;               // AtlasNode.id
  to: string;                 // AtlasNode.id
  type: 'contains' | 'calls' | 'imports_from' | 'imports' | 'method'
    | 'indirect_call' | 'references' | 'rationale_for' | 'implements'
    | 'dynamic_import' | 'cites' | 'unknown';
  sourceRelation: string;     // Graphify 原值
  evidenceType: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
    | 'SIMULATED' | 'UNKNOWN';
  confidence: number | null;  // Graphify confidence_score
  review: AtlasReview;
  evidence: AtlasEvidenceRef | null;  // 调用/导入发生的位置
  selfReference: boolean;     // 递归/自调用，不是无效边
  context: string | null;
  flags: { deferred: boolean; typeOnly: boolean };
  sourceIndex: number;        // 原始 links 下标
}
```

规则：

- **多重关系全部保留**：同一对节点可以有 `calls` + `imports_from`，不合并。
- 只有 `from + to + type + evidenceType + 文件 + 行号 + context` 完全相同的记录才合并。
- 自调用保留并计入 `selfReferences`；它不是异常数据。
- 悬空关系跳过并计入 `danglingRelationsDropped`。
- 未识别的关系类型保留为 `unknown`，不丢弃。
- `method` / `contains` 等 Graphify 结构关系也保留；前端可按需过滤。

---

## 5. 审核模型

P1.0 明确区分四种可信度，不用一个布尔值混在一起：

| 情况 | `evidenceType` | `review.method` | `review.status` | 含义 |
| --- | --- | --- | --- | --- |
| 源码直接提取 | `EXTRACTED` | `graphify-extracted` | `unverified` | 工具看见了，但未审核 |
| Graphify 推断 | `INFERRED` | `graphify-inferred` | `unverified` | 模型推断，默认不可信 |
| AI 对照源码复核 | 保持原值 | `ai-source-review` | `verified` / `partially_verified` | Agent 打开源码核对 |
| 独立人工审核 | 保持原值 | `human-review` | `verified` | 真实审核人签字 |
| 尚未确认 / 模糊 | `AMBIGUOUS` / `UNKNOWN` | `unverified` | `unverified` | 不能当作事实 |

`verified` 不会因为 `EXTRACTED` 自动获得，也不等于人工审核。P1.1 的 13 条关系全部是 **AI 源码复核**，独立人工审核为 **0**；其余 3,157 条保持待核实。审核记录保存 `method / actor / reviewedAt / evidence / note`。

节点的 `review` 表示**中文名称与职责注释**是否已核对，不表示该符号的所有关系都已审核。未收录的节点 `displayName` 为 `null`，保留英文符号名，不做机器翻译。

---

## 6. 快照

```ts
interface AtlasSnapshot {
  id: string;
  repository: { id: string; name: string };
  commit: string;             // 完整 SHA 或 'unknown'
  commitShort: string;
  generatedAt: string | null; // 图谱生成时间
  importedAt: string;         // 本次导入时间
  graphifyVersion: string;    // 0.9.92
  graphifySchemaVersion: number; // 1
  atlasSchemaVersion: string; // 1.2.0
  history: true;              // 强制历史标记
  importStatus: 'complete' | 'partial';
  stats: AtlasSnapshotStats;
  manifest: AtlasManifestStatus | null;
  notes: string[];
}
```

`history: true` 是硬约束：历史快照永远不能被界面称为“当前实时架构”。`importStatus` 只有在清单逐文件校验通过且提交 SHA 存在时才是 `complete`。

`stats` 同时记录：

- `relations`：原始关系记录数（3,170）；
- `uniqueRelationPairs`：无向节点对数（3,097，与 Graphify 报告一致）；
- `extractedRelations` / `inferredRelations` / `ambiguousRelations`；
- `selfReferences`、`duplicateRelationsCollapsed`、`danglingRelationsDropped`；
- `nodesWithoutSource`、`redactedLabels`；
- `files`（清单文件数）、`communities`。

---

## 7. 模块与系统

```ts
interface AtlasModuleComponent {
  symbol: string;
  file: string;
  line: number | null;
  name: string;
  responsibility: string;
  review: AtlasReview;
}
```

```ts
interface AtlasModuleRecord {
  id: 'data' | 'voice' | 'animation' | 'canvas';
  name: string;               // 中文
  review: 'verified' | 'partially_verified' | 'unverified';
  rule: string;               // 人工可读的归类规则
  description: string;
  notes: string[];
  evidence: AtlasModuleEvidence[];
  stats: AtlasModuleStats;
}
```

- 模块归类只看源码路径与文件职责，**不读取 Community 编号**。
- 一个节点有一个主模块（`moduleId`），可以有多个支撑模块（`moduleIds`）。
- `canvas` 没有主归属节点，只把 4 个明确执行 Canvas 2D 绘制的文件标记为支撑归属，状态为 `partially_verified`。
- `stats.productNodes` 只统计 `scope === 'product'` 的主归属节点；测试与脚本不计入模块构成。
- `systems` 中 `crm` / `electron` 固定为 `not_connected`，说明文字必须包含“尚未接入真实架构数据”。

---

## 8. 流程场景（P1.2）

```ts
interface AtlasFlowStep {
  id: string;
  title: string;
  description: string;
  moduleId: AtlasModuleId;
  file: string;       // 仓库相对路径
  symbol: string;
  line: number | null;
  note: string;       // 为什么可以这样描述
}

interface AtlasFlowScenario {
  id: string;
  title: string;
  summary: string;
  entryModuleId: AtlasModuleId;
  steps: AtlasFlowStep[];  // 2–12 步
  review: AtlasReview;     // 场景整理来源；不代表运行时顺序已验证
  disclaimer: string;
}
```

约束：

1. 每个步骤必须能在当前快照中找到 `sourceFile + symbol + moduleId` 对应的节点；找不到时导入直接拒绝（`ATLAS_DATASET_FLOW_INVALID`）。
2. 流程场景只存在于本地附加数据中，不由前端自动生成，也不进入默认构建。
3. 步骤之间的连边由数据集关系实时计算；没有边时界面必须显示“图谱缺口”，不得补线。
4. 场景审核记录通常为 `ai-source-review`；它不是独立人工审核，也不证明步骤顺序是运行时调用顺序。
5. 本地附加流程使用 `npm run attach:flows -- --dataset ... --flows ...`；工具只读取已有快照，不扫描源码工作区。

---

## 9. 诊断

```ts
interface AtlasDiagnostics {
  issues: AtlasIssue[];
  counts: {
    rawNodes, rawRelations, nodes, relations,
    productNodes, testNodes, toolingNodes, externalNodes,
    conceptNodes, rationaleNodes, modulesAssigned, modulesUnassigned,
    unresolvedCalls, nodesWithUnresolvedCalls
  };
  unresolvedCallsByReceiver: { receiver: string; count: number }[];
  reviewCounts: {
    aiReviewed: number;
    humanReviewed: number;
    graphifyExtractedUnverified: number;
    graphifyInferredUnverified: number;
    unverified: number;
  };
  coverageNotes: string[];
}
```

`issues` 记录被跳过/合并/脱敏的数量与原因；`coverageNotes` 记录已确认的 Graphify 盲区。两者都不包含绝对路径或源码内容。

---

## 10. 导入与导出契约

### 10.1 ATLAS 标准数据导入

`parseAtlasDataset(raw)` 接受 `1.0.x`、`1.1.x` 与 `1.2.x`。1.0 数据会自动迁移审核字段与模块详情字段，并写入 `schemaMigratedFrom`；源码事实（提交、节点、关系、证据）不改写。它是严格校验：

- `schemaId` 错误 → `ATLAS_SCHEMA_ID_UNSUPPORTED`
- 主版本不兼容 → `ATLAS_SCHEMA_VERSION_UNSUPPORTED`
- 重复节点 → `ATLAS_DATASET_DUPLICATE_NODE`
- 悬空关系 → `ATLAS_DATASET_DANGLING_RELATION`
- 绝对路径 / `..` → `ATLAS_DATASET_PATH_LEAK`
- 快照字段缺失或 `history !== true` → `ATLAS_DATASET_SNAPSHOT_INVALID`
- 流程步骤引用不存在节点 → `ATLAS_DATASET_FLOW_INVALID`
- JSON 解析失败 → `ATLAS_INVALID_JSON`

标准数据是 ATLAS 自己的格式；出现上述问题说明文件损坏或被手工改坏，应当拒绝，而不是猜测修复。

### 10.2 Graphify 原始导入

`adaptGraphify({ graph, manifest?, options? })` 是容错的：

- 版本检查：`graph.schema_version === 1`，`graphify_version` 以 `0.9.` 开头；
- 单节点/单边异常跳过并计入诊断；
- 绝对路径节点直接跳过，且不在错误信息中回显；
- 由绝对路径 slug 化的外部标签替换为“外部路径引用（已脱敏）”；
- 包名（如 `@playwright/test`）按外部节点处理；
- 没有清单时 `commit = 'unknown'`、`importStatus = 'partial'`。

### 10.3 浏览器端

- 默认构建只包含演示数据；真实快照不进入 `public/` 或 `dist/`；
- 用户通过文件选择器主动导入本地 `.atlas.json`，解析后仅驻留内存；
- Graphify 原始 `graph.json` 先在本地 CLI 转换，浏览器不携带 NEXUS 专属模块规则；
- 不进入 rAF，不在每帧重新解析；模块级 Graph Projection 按数据集缓存，文件/符号层按导航焦点缓存；
- 导入失败保留演示数据，Canvas 不崩溃；
- 文件导入全部在本地浏览器内完成，不上传；
- 导出的 JSON 包含内部符号名与相对路径，界面明确提示不要公开上传。

---

## 11. 隐私与跨平台

- 数据集中不保存源仓库绝对路径、本机用户名或 Graphify POC 目录。
- 路径统一为 `/` 分隔；Windows 反斜杠在归一化时转换。
- 拒绝盘符路径、UNC、`~`、`..` 与含 `:` 的路径。
- 浏览器错误只显示文件名，不显示用户本机完整路径。
- CLI 错误只显示相对路径或 `path.basename`。
- 数据包移动到另一台电脑后，不依赖原 Mac 的目录结构；把 ATLAS 数据集放到 `local-data/` 或用文件导入即可；不要放回 `public/`。
