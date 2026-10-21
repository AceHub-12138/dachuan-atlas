# DACHUAN ATLAS · CRM 本地导入管线（P2.0-A）

> 状态：数据层与本地 CLI 已实现，使用**合成 CRM 数据**验证。  
> 尚未读取、扫描或导入任何真实 CRM 仓库。  
> 适用 Schema：`atlas.architecture` 1.4.0
>
> 相关实现：
> `src/architecture/repository-profile.ts`、`src/architecture/import-provenance.ts`、
> `src/architecture/graphify-adapter.ts`、`tools/import-crm.mjs`。

---

## 1. 管线目的

把一个**明确的 CRM 历史快照**转换为 ATLAS 标准数据，同时保留：

- 仓库身份（`repository.id='crm'`）；
- 完整提交 SHA 或明确的 `unknown/partial`；
- 独立 `snapshotKey`；
- CRM 自己的模块定义与路径依据；
- 每条关系的仓库/运行时作用域与证据；
- 导入来源、文件哈希与隐私体检结果。

管线不负责证明真实 CRM 的当前架构，也不把 Graphify 的静态边升级为运行时事实。

---

## 2. 输入约定

本地目录至少包含：

```text
<crm-graphify>/
  graph.json
  snapshot-manifest.json
  GRAPH_REPORT.md
  source-snapshot/
    <manifest 中列出的相对路径>
```

另外必须提供一个**显式 profile**：

```text
<crm-profile.json>
```

### 2.1 graph.json

沿用 Graphify schema 1 / Graphify 0.9.x。适配器接受：

- `graph.schema_version`、`graph.graphify_version`；
- `nodes[].id`、`label`、`source_file`、`source_location`、`external`、
  `confidence`、`community`、`_callable`、`_callable_class`；
- `links[].source`、`target`、`relation`、`confidence`、`source_file`、
  `source_location`、`confidence_score`、`context`。

只做确定性结构转换；不做语义补全、不读取 Community 归类、不自动翻译中文名称。

### 2.2 snapshot-manifest.json

支持字段：

| 字段 | 说明 |
| --- | --- |
| `commit` | 完整 40 位十六进制提交 SHA；短 SHA 直接拒绝 |
| `repository_id` / `repositoryId` / `repo_id` | 仓库 ID；必须与 profile 一致 |
| `repository_name` / `repositoryName` | 展示名，不参与硬匹配 |
| `repository` | 字符串或 `{ id, name, system }` |
| `system` | `crm` / `nexus` / `electron` |
| `scanned_at` / `scannedAt` | 扫描时间 |
| `generated_at` / `generatedAt` | 图谱生成时间 |
| `file_count` / `byte_count` | 文件数与字节数，必须与 `files`/实测一致 |
| `files[]` | `{ path, sha256 }`，路径必须是仓库相对路径 |

`source-snapshot/` 下的实际文件必须与 `files[]` 一一对应并通过 SHA-256。路径越界、
绝对路径、短 SHA、`file_count` 不一致都属于硬错误。

### 2.3 GRAPH_REPORT.md

只解析明确写出的行：

```text
Repository: CRM ...
Repository ID: crm
Commit: <40-hex>
Scanned at: 2026-10-19T09:30:00Z
Generated at: 2026-10-20
```

不从标题、自然语言或括号日期里猜仓库身份；括号日期只作为生成日期的兜底。
报告中的短 SHA 不会被采用。

### 2.4 repository profile

示例（合成 fixture，仅展示结构）：

```json
{
  "schema": "atlas.repository-profile",
  "schemaVersion": "1.0.0",
  "synthetic": true,
  "repository": {
    "id": "crm",
    "name": "CRM 合成验证仓库",
    "system": "crm",
    "workspaceLabel": "CRM"
  },
  "sourceLabel": "CRM 合成验证快照",
  "modules": [
    {
      "id": "customer",
      "index": "01",
      "name": "客户（合成）",
      "latin": "CUSTOMER",
      "review": "unverified",
      "reviewMethod": "unverified",
      "reviewActor": "P2.0-A synthetic fixture",
      "reviewedAt": "2026-10-21",
      "reviewNote": "合成模块定义，仅用于验证导入管线。",
      "rule": "按 synthetic/customer/ 路径前缀归类；这是合成 fixture。",
      "description": "合成客户入口。",
      "summary": "合成数据：客户模块示例。",
      "responsibilities": ["创建客户。"],
      "gaps": ["没有真实 CRM 证据。"],
      "notes": ["路径与符号均为虚构。"],
      "primaryPrefixes": ["synthetic/customer/"],
      "primaryFiles": [],
      "supportingFiles": [],
      "evidence": [
        {
          "file": "synthetic/customer/customer-service.ts",
          "line": 8,
          "symbol": "CustomerService",
          "note": "合成客户服务类"
        }
      ]
    }
  ],
  "coverageNotes": ["合成数据没有运行时证据。"],
  "snapshotNotes": ["合成数据，不代表真实 CRM。"]
}
```

规则：

1. `repository.id` 与 CLI 期望一致；`system` 必须是 `crm`。
2. 非 NEXUS 仓库不能使用 `data / voice / animation / canvas` 四个模块 ID。
3. 每个模块必须至少有路径规则或职责证据；空规则不能占位。
4. `primaryPrefixes` 必须以 `/` 结尾，避免 `src/customer` 误匹配 `src/customer-service.ts`。
5. 模块默认 `unverified`；声明 `verified` 时必须同时给出
   `reviewMethod=ai-source-review|human-review`、`reviewActor`、`reviewedAt`、`reviewNote`。
6. 未匹配任何规则的节点保持 `moduleId=null`、`moduleIds=[]`，不借用 NEXUS 模块或 Community。
7. 真实 CRM 的中文名称与职责不得由机器翻译自动填充；没有核对记录就保持 `null`。

合成 profile 必须显式传 `--allow-synthetic`；真实 profile 设为 `synthetic=false`。

---

## 3. 来源核对与导入状态

`partial` 不是错误码，而是诚实的状态。以下任一成立时只能 `partial`：

- 缺少 `snapshot-manifest.json`；
- 清单没有逐文件通过 SHA-256；
- 提交只出现在 `GRAPH_REPORT.md`，没有清单绑定；
- 清单与报告都没有完整提交；
- 仓库身份只来自 CLI 声明或报告，没有清单记录；
- 缺少 `GRAPH_REPORT.md`；
- 清单与报告的生成时间或扫描时间冲突；
- 清单没有文件条目。

`complete` 必须同时满足：清单存在、逐文件校验通过、提交来自清单、仓库身份来自清单、
报告存在、时间记录不冲突。

**硬错误（不能被 `--allow-partial` 掩盖）：**

- 提交不是完整 40 位 SHA；
- 清单 / 报告 / `--expect-commit` 的提交互相冲突；
- 清单仓库或系统与 profile 冲突；
- profile 仓库 ID 不符；
- 合成 profile 未加 `--allow-synthetic`；
- Schema、JSON、路径或隐私体检失败。

---

## 4. 关系与运行时规则

CRM 管线只生成**仓库内静态关系**：

```text
repositoryScope = intra-repository
runtimeScope    = unknown
runtimeVerified = false
runtimeEvidence = []
interfaceEvidence = []
```

- Graphify 的静态边不等于运行时调用；
- 不根据函数名、目录名、Community 或框架习惯推断运行时；
- 服务端 / Web / worker 的运行时边界必须由带证据的复核清单提供，本轮不自动生成；
- 跨仓库关系不会从 CRM 单仓库产物中凭空生成；
- NEXUS ↔ CRM 的已确认关系必须另有 `interfaceEvidence`（API 契约、协议 schema、
  包清单、配置绑定、契约/集成测试）和 AI/人工复核；
- 1.4 数据中证据不足的跨仓库关系会被 Schema 校验直接拒绝；旧版 1.3 候选只保留为
  未确认候选，不进入 `confirmedCrossRepositoryRelations()`。

---

## 5. CLI

```bash
# 合成 fixture 演练（不写文件）
npm run import:crm -- \
  --graphify tests/fixtures/crm-synthetic \
  --profile tests/fixtures/crm-synthetic/profile.json \
  --allow-synthetic \
  --dry-run

# 真实 CRM 历史快照（必须由用户先提供本地产物与 profile）
npm run import:crm -- \
  --graphify "/path/to/crm-graphify" \
  --profile "local-data/crm/crm-profile.json" \
  --expect-commit <40-hex>
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--graphify` | Graphify 产物目录或 `graph.json` |
| `--profile` | CRM repository profile（必填） |
| `--out` | 输出数据集；默认 `local-data/crm/crm-<日期>-<提交>.atlas.json` |
| `--report` | 导入审计 JSON；默认与输出同目录 |
| `--expect-commit` | 校验完整提交 SHA |
| `--repository-id` | 期望仓库 ID（默认 `crm`） |
| `--allow-partial` | 来源核对不完整时仍导入，状态写 `partial` |
| `--allow-synthetic` | 允许 `synthetic:true` 的 profile，仅用于测试 |
| `--dry-run` | 只转换与校验，不写文件 |

默认严格：缺少清单、缺少报告、哈希不匹配都会失败。`--allow-partial` 只改变
“是否继续”，不改变 `partial` 状态，也不会把缺失证据写成已验证。

---

## 6. 输出与安全边界

输出两个文件：

1. `crm-<date>-<commit>.atlas.json`：标准 ATLAS 数据集；
2. `crm-import-report-<date>-<commit>.json`：来源、输入哈希、清单校验、模块统计、
   诊断、隐私体检与输出哈希。

写入前顺序：

1. 适配器转换；
2. `serializeAtlasDataset` + `parseAtlasDataset` 重新解析；
3. `auditDatasetPrivacy` 隐私体检；
4. 路径边界检查；
5. 原子写入。

安全边界：

- 真实 CRM（`synthetic:false`）的输出与报告只能写 `local-data/crm/` 或项目外目录；
  拒绝写入仓库其他位置、`public/`、`dist/`；
- 合成数据可以写测试临时目录或文档，但不能写 `public/`、`dist/`；
- 失败时不写文件，不覆盖已有 NEXUS 快照；
- 管线没有网络请求，不调用云端模型；
- 浏览器 UI 在 P2.0-A 暂时拒绝非 NEXUS 数据集，避免把 CRM 模块误画进 NEXUS 四模块星图；
  仓库切换器留到 P2.0-B。

---

## 7. 本轮验证范围

已用合成数据验证：

- 正确导入、独立仓库/快照/模块、未分类节点；
- 缺失清单、缺失报告、无效提交 SHA、文件哈希篡改；
- 仓库身份冲突、提交冲突；
- 重复关系 ID、未知模块引用；
- 跨仓库关系复核/接口证据门槛；
- 导出后重新导入；
- CRM 导入失败不改写 NEXUS 快照；
- 隐私体检与构建安全门禁。

尚未验证：

- 真实 CRM 的 Graphify 产物格式与字段差异；
- 真实 CRM 的模块划分、运行时边界、跨仓库契约；
- 真实 CRM 数据在浏览器 UI 中的展示；
- Windows 实机与异机恢复。
