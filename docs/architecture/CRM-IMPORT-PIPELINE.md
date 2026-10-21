# DACHUAN ATLAS · CRM 本地导入管线（P2.0-A.1）

> 状态：数据层与本地 CLI 已实现，使用**合成 CRM 数据 + 临时合成 Git 仓库**验证。
> 尚未读取、扫描或导入任何真实 CRM 仓库。  
> 适用 Schema：`atlas.architecture` 1.4.0（未升级）
>
> 相关实现：
> `src/architecture/repository-profile.ts`、`src/architecture/import-provenance.ts`、
> `src/architecture/graphify-adapter.ts`、`tools/import-crm.mjs`、
> `tools/import-safety.mjs`、`tools/git-provenance.mjs`。

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

P2.0-A.1 起还应在授权范围内提供一个**本地 Git 仓库**，用于只读核实历史：

```bash
--git-repo "/path/to/crm-source-repository"
```

Git 核实不是扫描当前工作树：它只读取该仓库中指定提交的历史树。
没有提供 Git 仓库时，清单仍可内部自洽，但导入状态最高只能是 `partial`。

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

来源核对分成**两个独立维度**，不再用一个 `complete` 混淆：

1. **清单内部一致性**（`manifestConsistency`）：`snapshot-manifest.json` 与
   `source-snapshot/` 的逐文件 SHA-256、字节数、路径与符号链接检查；
2. **Git 历史核实**（`historyVerification.status`）：提交是否存在、是否为 commit
   对象、清单文件是否与该提交的历史树逐字节一致。

`snapshot.importStatus='complete'` 只在两个维度都通过时为真。

### 3.1 缺失证据 → 可显式降级为 partial

以下情况属于“证据不完整”，加 `--allow-partial` 可以继续导入，但状态必须是 `partial`：

- 缺少 `snapshot-manifest.json`；
- 清单为空或没有完成逐文件校验；
- 提交只出现在 `GRAPH_REPORT.md`，没有清单绑定；
- 清单与报告都没有完整提交；
- 仓库身份只来自 CLI 声明或报告，没有清单记录；
- 缺少 `GRAPH_REPORT.md`；
- 没有提供 `--git-repo`；
- Git 历史只能对应部分清单文件（例如 Graphify 过滤/转换过产物）。

### 3.2 矛盾证据 → 强制失败

以下情况是“事实互相冲突”，**`--allow-partial` 不能绕过**：

- 清单文件 SHA-256 不匹配；
- 清单文件缺失、`byte_count` 或 `file_count` 与实测冲突；
- 清单路径越界、绝对路径，或 `source-snapshot` 中存在符号链接；
- 清单 / 报告 / `--expect-commit` 的提交互相冲突；
- 清单仓库或系统与 profile 冲突；
- 清单与报告的生成时间或扫描时间冲突；
- Git 提交不存在、不是 commit 对象、无法读取历史树；
- Git 核实提交与快照提交不一致；
- 提交不是完整 40 位 SHA；
- profile 仓库 ID 不符；
- 合成 profile 未加 `--allow-synthetic`；
- Schema、JSON、路径或隐私体检失败。

导入失败时不会写入数据集或报告，也不会覆盖已有输出；数据集与报告采用成对
临时文件 + 失败回滚写入。

### 3.3 Git 历史核实（本地只读）

`tools/git-provenance.mjs` 只调用只读 Git plumbing：

```text
git rev-parse --verify <sha>^{commit}
git cat-file -t <sha>
git ls-tree -r -z --full-tree <sha>
```

核对步骤：

1. 完整提交 SHA 必须存在并解析为同一个 SHA；
2. `cat-file -t` 必须是 `commit`；tag/tree/blob 一律拒绝；
3. 对每个清单文件计算 Git blob 对象 ID `SHA-1("blob <bytes>\\0" + content)`，
   与历史树中的 blob ID 比较；
4. 分别记录：
   - `missingInGit`：清单文件在提交中不存在；
   - `mismatchedFiles`：文件存在但内容不一致，或历史项不是普通 blob；
   - `missingInSnapshot`：清单文件在本机快照中缺失；
   - `snapshotFilesNotInManifest`：快照中未被清单收录的文件；
   - `symlinksInSnapshot`：快照中的符号链接；
   - `gitFilesNotInManifest`：Git 同目录下未被清单收录的文件数量（可能被
     Graphify 过滤，单独记录，不据此伪造冲突）。

状态：

| 状态 | 含义 | 导入 |
| --- | --- | --- |
| `verified` | 提交是 commit，清单文件全部一致 | 可参与 `complete` |
| `partial` | 提交是 commit，但只能对应部分文件 | 只能 `partial` |
| `failed` | 提交不存在、不是 commit、无法读取 | 硬失败 |
| `not_attempted` | 未提供 `--git-repo` | 只能 `partial` |

Git 命令设置了 `GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=/dev/null`、
`GIT_TERMINAL_PROMPT=0`、`GIT_ALLOW_PROTOCOL=none`，不 fetch、不 checkout、
不执行钩子、不联网。提交与文件均为本机读取，不进入任何模型调用。

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

# 真实 CRM 历史快照（必须由用户先提供本地产物、profile 与源仓库）
npm run import:crm -- \
  --graphify "/path/to/crm-graphify" \
  --profile "local-data/crm/crm-profile.json" \
  --git-repo "/path/to/crm-source-repository" \
  --expect-commit <40-hex>
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--graphify` | Graphify 产物目录或 `graph.json` |
| `--profile` | CRM repository profile（必填） |
| `--out` | 输出数据集；默认 `local-data/crm/crm-<日期>-<提交>.atlas.json` |
| `--report` | 导入审计 JSON；默认与输出同目录 |
| `--git-repo` | 本地 Git 仓库；只读核实提交对象与历史文件 |
| `--expect-commit` | 校验完整提交 SHA |
| `--repository-id` | 期望仓库 ID（默认 `crm`） |
| `--allow-partial` | 仅在缺失证据时继续导入，状态写 `partial`；矛盾证据仍失败 |
| `--allow-synthetic` | 允许 `synthetic:true` 的 profile，仅用于测试 |
| `--dry-run` | 只转换与校验，不写文件 |

默认严格：缺少清单、缺少报告、没有 Git 历史核实都会失败。`--allow-partial`
只改变“是否继续”，不改变 `partial` 状态，也不会把缺失证据写成已验证。

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
4. 输入/输出路径与符号链接边界检查；
5. 成对临时文件写入；任一失败恢复旧文件并清理临时文件。

安全边界：

- 真实 CRM（`synthetic:false`）的输出与报告只能写 `local-data/crm/` 或项目外目录；
  拒绝写入仓库其他位置、`public/`、`dist/`、`.git/`、`node_modules/`、
  `local-data/nexus/`；
- 合成数据可以写测试临时目录或文档，但不能写上述受保护目录；
- 拒绝目标本身是符号链接；父目录符号链接会先解析真实路径再判断；
- 清单文件不得通过符号链接越出 `source-snapshot`；
- 失败时不写文件、不覆盖已有输出；`--out` 不得指向 Graphify 输入目录或 profile；
- 管线没有网络请求，不调用云端模型；
- 隐私体检通过 ≠ 可公开分享：输出仍包含内部符号、相对路径与架构关系，
  审计报告固定记录 `publicShareable: false`；
- 浏览器 UI 在 P2.0-A.1 仍拒绝非 NEXUS 数据集，避免把 CRM 模块误画进 NEXUS
  四模块星图；仓库切换器留到 P2.0-B1。

---

## 6.1 节点统计口径

P2.0-A.1 在 `diagnostics.counts` 中增加可复核分区：

```text
已导入节点 = 内部节点 + 外部节点
内部节点   = product + test + tooling
产品节点   = modulesAssigned + modulesUnassigned
全部节点   = assignedNodes + unassignedNodes
multiModuleNodes 是重叠维度，不参与相加
```

合成 CRM 的 12 个节点因此解释为：

```text
12 = 11 个内部节点（11 product + 0 test + 0 tooling）+ 1 个外部节点（zod）
产品模块主归属：9 已归类 + 2 未分类 = 11
全部节点：9 已归类 + 3 未归类（2 个产品节点 + 1 个外部节点）
多模块归属：0
```

`GRAPHIFY_NODE_PARTITION` 诊断会写出同样的公式；测试断言这些等式，
不允许为了数字好看修改原始节点。

---

## 7. 本轮验证范围

已用合成数据与临时合成 Git 仓库验证：

- 正确导入、独立仓库/快照/模块、未分类节点与统计分区；
- 缺失清单、缺失报告、无效提交 SHA；
- 文件哈希篡改、字节数冲突、路径穿越、符号链接逃逸；
- 仓库身份冲突、提交冲突、时间冲突；
- 伪造 Git 提交、tag/tree 非 commit 对象、Git 内容不一致；
- 清单自洽但没有 Git 仓库时只能 partial；
- 重复关系 ID、未知模块引用；
- 跨仓库关系复核/接口证据门槛；
- 导出后重新导入；
- CRM 导入失败不改写 NEXUS 快照；
- 输出路径保护、父目录符号链接、成对写入回滚；
- 隐私体检、`publicShareable=false` 与构建安全门禁；
- CLI 静态无网络导入 + `NODE_DEBUG` 运行检查。

尚未验证：

- 真实 CRM 的 Graphify 产物格式与字段差异；
- 真实 CRM 的 Git 历史（本轮只用合成 Git 仓库）；
- 真实 CRM 的模块划分、运行时边界、跨仓库契约；
- 真实 CRM 数据在浏览器 UI 中的展示；
- Windows 实机与异机恢复。
