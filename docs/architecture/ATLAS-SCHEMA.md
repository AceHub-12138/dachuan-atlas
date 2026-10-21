# ATLAS 标准架构数据 Schema · v1.4.0

- **Schema ID**：`atlas.architecture`
- **版本**：`1.4.0`（兼容 1.0.x / 1.1.x / 1.2.x / 1.3.x 导入）
- **实现**：`src/architecture/schema.ts`
- **校验 / 导入导出**：`src/architecture/dataset.ts`
- **多仓库辅助**：`src/architecture/multi-repo.ts`
- **Graphify 适配器**：`src/architecture/graphify-adapter.ts`
- **适用范围**：NEXUS 单仓库历史快照；CRM / Electron 只完成 Schema 兼容层与设计，尚未扫描或导入

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
  schemaVersion: '1.4.0';
  schemaMigratedFrom?: string;      // 从旧版导入时记录原版本
  scopeMigration?: AtlasScopeMigrationSummary; // 1.3 及更早数据的关系作用域迁移汇总
  generatedAt: string;              // 数据集构建时间，不是源码提交时间
  source: AtlasSourceDescriptor;    // 演示 / Graphify；是否模拟；来源形式
  snapshot: AtlasSnapshot | null;   // 演示数据必须为 null
  systems: AtlasSystemRecord[];
  modules: AtlasModuleRecord[];
  nodes: AtlasNode[];
  relations: AtlasRelation[];
  diagnostics: AtlasDiagnostics;
  flows: AtlasFlowScenario[];       // 可选模块协作场景；旧版导入后为空数组
  repositories?: AtlasRepositoryRecord[]; // 仓库登记表
}
```

不变量：

1. `schemaId` 必须完全匹配；`schemaVersion` 主版本必须为 `1`，当前最高次版本为 `4`。
2. 节点 `id` 全局唯一；关系 `id` 在同一快照内唯一；关系两端必须存在。
3. `source.kind === 'demo'` 时 `snapshot` 必须为 `null`。
4. `source.kind === 'graphify'` 时 `snapshot.history` 必须为 `true`。
5. 任何源码路径都必须是仓库相对路径（POSIX 分隔符），不得是绝对路径。
6. 节点与关系按 `id` 排序，模块按固定顺序排序；导出文件是确定性的紧凑 JSON。
7. 一个 `AtlasDataset` 只描述一个主仓库历史快照；多个仓库 / 多个快照由多个数据集表示，不合并节点数组。
8. 不同快照的关系 ID 必须用 `${snapshotKey}::${relation.id}` 建立索引，不能只按 `relation.id` 合并。

---

## 3. 节点

```ts
interface AtlasNode {
  id: string;                 // 跨版本逻辑 ID，不含提交 SHA
  sourceId: string;           // Graphify 原始节点 ID，仅追溯
  repository: string;         // 'nexus' / 'crm' / 'electron'
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
  runtimeBoundary?: 'browser-renderer' | 'node-service' | 'electron-main'
    | 'electron-renderer' | 'shared' | 'unknown' | null;
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
- 多快照共存的索引必须使用 `repository@snapshotKey:path#symbol` 命名空间，或者分别保存为不同数据集；不得把两个提交的同名节点覆盖成一条。

### 3.2 证据

`AtlasEvidenceRef` 包含仓库、完整提交 SHA、相对路径、行号、符号与 `file#Lline` 定位符。`commit` 在原始图未提供清单时为 `'unknown'`，界面必须显示“未知”，不能伪造。

1.4 起，节点证据和关系证据的 `commit` 必须属于该仓库已登记快照之一（`unknown` 除外）。这防止把不同历史快照的证据混在一起。

### 3.3 运行时边界

`runtimeBoundary` 描述节点所在代码的实际执行边界，不是目录、模块或 Git 仓库：

- `browser-renderer`
- `node-service`
- `electron-main`
- `electron-renderer`
- `shared`（共享代码，不能据此判定两端同进程）
- `unknown`（未标注；不得推断为同进程）

NEXUS 历史快照尚未逐节点标注，全部节点保持未标注。因此 NEXUS 关系迁移后 `runtimeScope=unknown`，不会产生任何运行时调用结论。

---

## 4. 关系与双维度作用域

```ts
type AtlasRepositoryScope = 'intra-repository' | 'cross-repository';
type AtlasRuntimeScope = 'intra-runtime' | 'cross-runtime' | 'unknown';
type AtlasRuntimeEvidenceKind =
  | 'runtime-trace' | 'runtime-log' | 'protocol-test'
  | 'integration-test' | 'runtime-observation';
type AtlasContractEvidenceKind =
  | 'api-contract' | 'protocol-schema' | 'package-manifest'
  | 'config-binding' | 'contract-test' | 'integration-test';

interface AtlasRuntimeEvidenceRef extends AtlasEvidenceRef {
  kind?: AtlasRuntimeEvidenceKind | null;
  capturedAt?: string | null;
  note?: string | null;
}

interface AtlasContractEvidenceRef extends AtlasEvidenceRef {
  kind: AtlasContractEvidenceKind;
  note?: string | null;
}

interface AtlasRelation {
  id: string;
  from: string;
  to: string;
  type: 'contains' | 'calls' | 'imports_from' | 'imports' | 'method'
    | 'indirect_call' | 'references' | 'rationale_for' | 'implements'
    | 'dynamic_import' | 'cites' | 'unknown';
  sourceRelation: string;
  evidenceType: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
    | 'SIMULATED' | 'UNKNOWN';
  confidence: number | null;
  review: AtlasReview;
  evidence: AtlasEvidenceRef | null;
  selfReference: boolean;
  context: string | null;

  repositoryScope: AtlasRepositoryScope; // 1.4 必填
  runtimeScope: AtlasRuntimeScope;       // 1.4 必填
  runtimeVerified: boolean;              // 默认 false
  runtimeEvidence: AtlasRuntimeEvidenceRef[];
  interfaceEvidence: AtlasContractEvidenceRef[];
  legacyScope?: AtlasRelationScope | null; // 1.3 原值，只作迁移审计
  scopeNote?: string | null;

  flags: { deferred: boolean; typeOnly: boolean };
  sourceIndex: number;
}
```

### 4.1 两个维度正交

| 情况 | `repositoryScope` | `runtimeScope` | 是否允许 |
| --- | --- | --- | --- |
| 同仓库、同运行时 | `intra-repository` | `intra-runtime` | 允许 |
| 同仓库、跨运行时 | `intra-repository` | `cross-runtime` | 允许 |
| 跨仓库、未知运行时 | `cross-repository` | `unknown` | 允许 |
| 跨仓库、同运行时边界 | `cross-repository` | `intra-runtime` | 允许（例如两个仓库的浏览器端代码） |
| 跨仓库、跨运行时 | `cross-repository` | `cross-runtime` | 允许，P1.3 的互斥枚举已修正 |
| 边界未知，声称同运行时 | 任意 | `intra-runtime` | **拒绝** |
| 边界未知，声称跨运行时且无运行时证据 | 任意 | `cross-runtime` | **拒绝**（1.4 数据） |

规则：

1. `repositoryScope` 必须与两端 `repository` 一致。跨仓库关系不能省略；同仓库关系不能标成跨仓库。
2. 两端都有已知且不同的非 `shared` 边界时，`runtimeScope` 必须是 `cross-runtime`。
3. 两端都有已知且相同的边界时，`runtimeScope` 必须是 `intra-runtime`。
4. 任一端边界缺失、`unknown` 或 `shared` 时，只能使用 `unknown`；若声称 `cross-runtime`，1.4 数据必须提供至少一条带 `kind` 的 `runtimeEvidence`。
5. `runtimeScope` 是边界分类，不是执行证明。它不会自动把关系变成运行时已验证。
6. `runtimeVerified=true` 必须同时满足：
   - 经过 AI 源码复核或独立人工复核（`review.method` 为 `ai-source-review` / `human-review`，状态非 `unverified`）；
   - `runtimeScope` 不是 `unknown`；
   - `runtimeEvidence` 非空；
   - 每条 `runtimeEvidence` 都有合法 `kind`。
7. **AI 源码复核本身不等于运行时已验证**。没有 trace / 日志 / 协议测试 / 集成测试 / 运行时观察，`runtimeVerified` 必须为 `false`。
8. `runtimeEvidence=[]` 时不得写 `runtimeVerified=true`。旧版迁移无法分类的 `runtimeVerified=true` 会降级为 `false`，原始证据保留。

### 4.2 跨仓库关系

1. 两端 `repository` 不同时，必须 `repositoryScope='cross-repository'`。
2. 必须经过 AI 源码复核或独立人工复核；未审核的候选关系直接拒绝，不能进入已确认关系图。
3. 1.4 数据必须提供非空 `interfaceEvidence`，类型限定为：
   - API 契约 / OpenAPI
   - 协议文档 / 消息 schema
   - 包清单 / workspace 依赖
   - 配置绑定
   - 契约测试 / 集成测试
4. `interfaceEvidence` 的仓库必须在登记表中，提交必须匹配该仓库已登记快照；不能拿另一个提交的接口文档冒充当前关系。
5. 1.3 迁移的跨仓库关系如果没有 `interfaceEvidence`，仍保留原始证据和审核记录，但作为**未确认候选**存在：`confirmedCrossRepositoryRelations()` 不会返回它，界面也不得把它画成已确认跨仓库边。
6. 目录相似、命名相似、LLM 猜测、同一 Git 仓库都不构成跨仓库证据。

### 4.3 已确认关系

```ts
isConfirmedRelation(relation):
  review 为 AI/人工且非 unverified
  且（evidence 非空 或 review.evidence 非空 或 interfaceEvidence 非空 或 runtimeVerified）
```

跨仓库关系还要求 `interfaceEvidence` 非空，见 `isConfirmedCrossRepositoryRelation()`。

NEXUS 的“真实关系投影”仍保留 46 条待核实静态关系，并在界面逐条标注“待核实”；它不是一个把未审核边当作已确认事实的图。**已确认跨仓库关系图**是更严格的独立视图，只包含复核 + 接口证据的边。

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
  atlasSchemaVersion: string; // 快照生成时的 Schema 版本；迁移时不改写
  history: true;              // 强制历史标记
  importStatus: 'complete' | 'partial';
  stats: AtlasSnapshotStats;
  manifest: AtlasManifestStatus | null;
  notes: string[];
}
```

`history: true` 是硬约束：历史快照永远不能被界面称为“当前实时架构”。`importStatus` 只有在清单逐文件校验通过且提交 SHA 存在时才是 `complete`。

`snapshot.atlasSchemaVersion` 是历史快照生成时的版本，不得因为导入层升级而改写。数据面板显示当前数据集版本，并注明“快照记录 1.3.0，导入时迁移”。

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

interface AtlasModuleExplanation {
  whyNeeded: string;          // 面向普通用户的“为什么需要它”
  review: AtlasReview;        // 解释来源，不替代模块组成审核
}

interface AtlasModuleRecord {
  id: AtlasModuleId;          // 数据集内唯一；NEXUS 为四个固定 ID
  name: string;               // 中文
  repository: string;         // 模块定义所属仓库
  system: 'crm' | 'nexus' | 'electron';
  review: 'verified' | 'partially_verified' | 'unverified';
  rule: string;
  description: string;
  summary: string;
  responsibilities: string[];
  explanation?: AtlasModuleExplanation | null;
  keyComponents: AtlasModuleComponent[];
  gaps: string[];
  notes: string[];
  evidence: AtlasModuleEvidence[];
  stats: AtlasModuleStats;
}
```

- 模块归类只看源码路径与文件职责，**不读取 Community 编号**。
- 一个节点有一个主模块（`moduleId`），可以有多个支撑模块（`moduleIds`）；主模块必须在 `moduleIds` 首位。
- 节点只能引用同一仓库的模块定义。CRM 不能复用 NEXUS 的 `data / voice / animation / canvas`，Electron 同理。
- `canvas` 没有主归属节点，只把 4 个明确执行 Canvas 2D 绘制的文件标记为支撑归属，状态为 `partially_verified`。
- `stats.productNodes` 只统计 `scope === 'product'` 的主归属节点；测试与脚本不计入模块构成。
- `systems` 中 `crm` / `electron` 固定为 `not_connected`，说明文字必须包含“尚未接入真实架构数据”。

---

## 8. 模块协作场景（P1.2 引入，P1.3 修正语义）

```ts
type AtlasFlowSemantics = 'module-collaboration' | 'runtime-verified';
type AtlasFlowStepBasis = 'source-responsibility' | 'runtime-evidence';

interface AtlasFlowStep {
  id: string;
  title: string;
  description: string;
  moduleId: AtlasModuleId;
  file: string;
  symbol: string;
  line: number | null;
  note: string;
  basis?: AtlasFlowStepBasis;
}

interface AtlasFlowRuntimeOrder {
  verified: boolean;
  note: string;
  evidence: AtlasEvidenceRef[];
}

interface AtlasFlowScenario {
  id: string;
  title: string;
  summary: string;
  entryModuleId: AtlasModuleId;
  steps: AtlasFlowStep[];  // 2–12 步
  review: AtlasReview;
  disclaimer: string;
  semantics?: AtlasFlowSemantics;
  runtimeOrder?: AtlasFlowRuntimeOrder;
}
```

语义约束：

1. `semantics = 'module-collaboration'` 表示 **AI 根据模块职责整理的概念性协作步骤**，步骤顺序不是运行时调用顺序；此时 `runtimeOrder.verified` 必须为 `false`。
2. `semantics = 'runtime-verified'` 表示声称有运行时顺序证据；必须同时满足 `runtimeOrder.verified = true`、`runtimeOrder.evidence` 非空，且每个步骤 `basis = 'runtime-evidence'`。当前 NEXUS 数据不满足，因此没有这种场景。
3. 每个步骤必须能在当前快照中找到 `sourceFile + symbol + moduleId` 对应的节点；找不到时导入直接拒绝（`ATLAS_DATASET_FLOW_INVALID`）。
4. 步骤之间的连边由数据集关系实时计算；没有边时界面必须显示 **缺少证据 / 缺口**，不得补线。
5. 场景审核记录通常为 `ai-source-review`；它不是独立人工审核。
6. 本地附加场景使用 `npm run attach:flows -- --dataset ... --flows ...`；工具只读取已有快照，不扫描源码工作区。
7. 界面名称固定为 **「模块协作示意」**；禁止把它称为“执行流程”或“运行时调用链”。当前语音场景：7 个概念步骤、4 个有静态图边的衔接、2 个缺口、0 个已验证运行时顺序。

---

## 8.5 仓库与快照登记

```ts
interface AtlasRepositorySnapshotRef {
  snapshotId: string;
  snapshotKey: string;   // 必须以 `<repository>@` 开头，推荐 <repository>@<commitShort>@<generatedAt>
  commit: string;
  commitShort: string;
  scannedAt: string | null; // 真实扫描时间；未记录必须为 null
  generatedAt: string | null;
  importedAt: string;
  graphifyVersion: string;
  nodeCount: number;
  relationCount: number;
  history: true;
}

interface AtlasRepositoryRecord {
  id: string;            // 命名空间根，例如 nexus / crm / electron
  name: string;
  system: 'crm' | 'nexus' | 'electron';
  snapshots: AtlasRepositorySnapshotRef[]; // 至少一个
}
```

约束：

1. `repositories` 非空时，节点 `repository` 与模块 `repository` 必须出现在登记表中。
2. 节点 `id` 的仓库前缀必须等于 `node.repository`；形式为 `<repository>:<path>#<symbol>`，未来多快照共存时可用 `<repository>@<snapshotKey>:<path>#<symbol>`。
3. Graphify 数据必须至少登记一个仓库；1.0–1.2 数据导入时由 `snapshot` 推导单仓库记录。
4. `scannedAt` 没有记录时保持 `null`，界面显示“未记录”；不得用 `generatedAt` 或 `importedAt` 冒充。
5. `snapshotId` 在数据集内必须唯一；`snapshotKey` 必须全局唯一且以仓库 ID 开头。
6. 不同仓库 / 不同快照不合并节点；多仓库通过 `src/architecture/multi-repo.ts` 的索引汇总。
7. 关系 ID 只在单个快照内唯一。跨快照索引必须使用 `scopedRelationId(dataset, relation)`，即 `${snapshotKey}::${relation.id}`。
8. 证据的 `repository + commit` 必须匹配已登记快照，防止不同历史快照误合并。
9. 跨仓库关系必须提供接口/协议证据、AI 或人工复核；不同运行时之间的关系使用 `runtimeScope='cross-runtime'`，`runtimeVerified` 必须有带类型的 `runtimeEvidence`。
10. 详细设计见 [P1.4-MULTI-REPO.md](../P1.4-MULTI-REPO.md)。

---

## 8.6 1.0–1.3 → 1.4 迁移规则

| 旧数据 | `repositoryScope` | `runtimeScope` | 说明 |
| --- | --- | --- | --- |
| 无 `scope` | 由两端 `repository` 计算 | 两端边界已知且相同 → `intra-runtime`；已知且不同 → `cross-runtime`；否则 `unknown` | 1.0–1.2 数据没有 scope；不得默认同进程 |
| `scope='intra-repository'` | `intra-repository` | 同上 | 与节点仓库不一致时拒绝 |
| `scope='cross-repository'` | `cross-repository` | 同上 | 缺少 1.4 接口证据时保留为候选 |
| `scope='cross-process'` | 由两端 `repository` 计算，可为跨仓库 | `cross-runtime` | 这是 P1.3 互斥枚举的迁移重点 |
| `runtimeVerified=true` + 无带类型证据 | 保留作用域 | 保留作用域 | 降级为 `false`，原始 `runtimeEvidence` 保留 |
| `runtimeVerified=true` + 带类型证据 + AI/人工复核 | 保留 | 保留 | 仅在作用域可判定时保持 true |

迁移不修改节点、关系类型、提交、原始证据或审核记录；`legacyScope` 保存旧值，`scopeNote` 保存逐条说明，`scopeMigration` 保存汇总。`snapshot.atlasSchemaVersion` 不改写。

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

`parseAtlasDataset(raw)` 接受 `1.0.x`、`1.1.x`、`1.2.x`、`1.3.x` 与 `1.4.x`。旧数据会按第 8.6 节迁移，并写入 `schemaMigratedFrom` 与 `scopeMigration`。源码事实（提交、节点、关系、证据、审核）不改写。它是严格校验：

- `schemaId` 错误 → `ATLAS_SCHEMA_ID_UNSUPPORTED`
- 主版本不兼容或未来次版本 → `ATLAS_SCHEMA_VERSION_UNSUPPORTED`
- 重复节点 → `ATLAS_DATASET_DUPLICATE_NODE`
- 重复关系 ID → `ATLAS_DATASET_DUPLICATE_RELATION`
- 悬空关系 → `ATLAS_DATASET_DANGLING_RELATION`
- 绝对路径 / `..` → `ATLAS_DATASET_PATH_LEAK`
- 模块 ID 重复、模块仓库不匹配、节点引用其他仓库模块 → `ATLAS_DATASET_MODULE_INVALID`
- 快照字段缺失或 `history !== true` → `ATLAS_DATASET_SNAPSHOT_INVALID`
- 流程步骤引用不存在节点或运行时声明无证据 → `ATLAS_DATASET_FLOW_INVALID`
- 仓库登记缺失、快照 ID/标识重复、节点前缀不一致、证据提交不属于登记快照 → `ATLAS_DATASET_REPOSITORY_INVALID`
- 跨仓库关系缺复核/接口证据、运行时边界矛盾、runtimeVerified 无证据 → `ATLAS_DATASET_CROSS_REPO_INVALID`
- JSON 解析失败 → `ATLAS_INVALID_JSON`

标准数据是 ATLAS 自己的格式；出现上述问题说明文件损坏或被手工改坏，应当拒绝，而不是猜测修复。

### 10.2 Graphify 原始导入

`adaptGraphify({ graph, manifest?, options? })` 是容错的：

- 版本检查：`graph.schema_version === 1`，`graphify_version` 以 `0.9.` 开头；
- 单节点/单边异常跳过并计入诊断；
- 绝对路径节点直接跳过，且不在错误信息中回显；
- 由绝对路径 slug 化的外部标签替换为“外部路径引用（已脱敏）”；
- 包名（如 `@playwright/test`）按外部节点处理；
- 没有清单时 `commit = 'unknown'`、`importStatus = 'partial'`；
- 生成的每条静态关系使用 `repositoryScope='intra-repository'`、`runtimeScope='unknown'`、`runtimeVerified=false`；Graphify 的静态提取不能证明运行时。

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
- Windows 迁移的完整命令、SHA-256 校验、bundle 恢复与数据导入步骤见 [P1.4-MAC-TO-WINDOWS.md](../P1.4-MAC-TO-WINDOWS.md)。Windows 实机验收仍待完成。
