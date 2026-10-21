# DACHUAN ATLAS · 大川项目架构星图

> **P0.1 视觉原型 + P1.1 本地数据探索与可信度完善。** 默认构建只包含演示数据；真实 NEXUS 快照需在本地明确导入。画布仍是演示构图，真实关系只在模块详情与关系探索中显示。CRM / Electron 尚未接入真实架构数据。

一套用于评估「电影式宇宙星系 × 未来数字神经网络」视觉语言的独立前端原型，并在此基础上验证 Graphify 架构数据能否被可靠读取。它把 DACHUAN 软件体系映射为一座可探索的系统宇宙，通过三级镜头运动串联：**系统宇宙 → NEXUS 模块星系 → 语音交互详情**。

![DACHUAN ATLAS 首页](docs/screenshots/01-home-1920x1080.png)

---

## 1. 如何运行

测试环境：macOS 15.7.8 / Apple M1 Ultra / Node.js 24.21.0。  
要求：Node.js `^20.19.0 || >=22.12.0`，现代 Chrome / Edge 浏览器。

```bash
cd "DACHUAN ATLAS"
npm install
npm run dev
```

终端会显示本地地址，默认为：

**http://127.0.0.1:4173**

生产构建与预览：

```bash
npm run build
npm run preview
```

测试、本地转换与构建门禁：

```bash
npm test
npm run import:graphify -- --graphify "../graphify-poc" \
  --expect-commit 2584284e3e7b994d0510d9d53b2a302e3aa740bc
npm run build
npm run verify:build
```

`npm test` 不依赖 Graphify 目录；设置 `GRAPHIFY_POC_DIR` 可额外重跑原始 `graph.json` 的一致性测试。真实快照输出到 `local-data/`（已忽略），不会进入 `public/` 或 `dist/`。项目运行时不请求任何第三方服务。

---

## 2. 本轮体验路径

| 层级 | 可做的事 |
| --- | --- |
| 系统宇宙 | 悬停查看星系中文名称与模拟说明；点击 NEXUS 进入模块层；点击 CRM / Electron 可选中并查看简要信息 |
| NEXUS 模块星系 | 四个模块都可点击；查看模块介绍、职责、代表对象、组成/关系审核、证据与待核实事项 |
| 模块详情 | 组成与内部关系分开呈现；Canvas 明确标记为分布式能力集合；可进入关系探索 |
| 关系探索 | 按模块 → 文件 → 符号浏览；支持中文/文件/符号搜索，按类型、审核、证据、方向筛选 |
| 架构数据 | 点击右上角数据徽标，默认演示数据；选择本地 `.atlas.json` 后才加载真实快照，并查看隐私体检、导入导出 |

其他辅助操作：

- 点击画布空白处返回或取消选中。
- `Esc` 关闭弹窗、详情或返回上一级。
- 右上角「动效」可在 **完整 / 低动态 / 静态** 间切换，选择会保存在本机浏览器中。
- 系统若启用「减少动态效果」，首次访问会自动使用静态模式。

首屏 CTA 与 NEXUS 模块索引都提供了可键盘操作的替代入口；Canvas 中的星系本身同样支持鼠标悬停和点击。

---

## 3. P1.1 本地真实数据探索

P1.1 在 P0.1 视觉层之上完善本地数据探索。**真实 NEXUS 快照不进入默认构建**，只存放在项目外的 `local-data/`（已加入 `.gitignore`），由用户在本地面板明确选择 `.atlas.json` 导入。

| 数据来源 | 内容 | 界面标识 |
| --- | --- | --- |
| 演示数据 | P0.1 模拟节点 / 关系，`SIMULATED`，随前端发布 | 顶栏「演示数据」 |
| 本地历史快照 | 用户导入的 ATLAS 1.1 数据；当前样例 1,390 节点 / 3,170 条关系 | 顶栏「本地快照 · 2584284」 |

安全与审核边界：

- 生产构建 `dist` 不含真实快照文件、提交 SHA、内部符号或源码路径；`npm run verify:build` 会检查。CLI 拒绝写入 `public/`。
- Graphify 原始 `graph.json` 先在本地 CLI 转换为 ATLAS 标准数据；浏览器只导入转换结果，不携带 NEXUS 专属规则。
- 13 条关系是 **AI 源码复核**，不是独立人工审核；独立人工审核为 **0**。另有 3,116 条直接提取、41 条推断仍待核实。
- 导入导出均有隐私体检；导出文件仍含内部符号名与相对路径，不要公开上传。

四个模块现在都可打开真实详情：一句话介绍、已核实职责、3–5 个代表对象、组成/关系分开审核、源码证据与待核实事项。Canvas 标记为分布式 Canvas 2D 能力集合，不是独立业务子系统。

![架构数据面板](docs/screenshots/P1.1-01-local-import-1920x1080.png)

关系探索支持模块 → 文件 → 符号渐进浏览，按关系类型、审核状态、证据类型和方向筛选；中文模块名、中文节点名、文件名和符号都可搜索。画布连线仍为演示构图，不绘制未核实的确定连接。

完整报告：[P1.1-REPORT.md](docs/P1.1-REPORT.md) · Schema：[ATLAS-SCHEMA.md](docs/architecture/ATLAS-SCHEMA.md) · 模块证据：[NEXUS-MODULE-EVIDENCE.md](docs/architecture/NEXUS-MODULE-EVIDENCE.md)

```bash
npm run import:graphify -- --graphify "../graphify-poc" \
  --expect-commit 2584284e3e7b994d0510d9d53b2a302e3aa740bc
npm run build
npm run verify:build
```

---

## 4. P0.1 视觉优化

本轮不改变三级交互和产品范围，只提升既有场景的镜头、能量与阅读质量。

- **镜头纵深**：星空拆成远景 / 中景 / 近景三层视差，加入轻微前景尘埃与相机速度拖影；进入 NEXUS 时使用收缩的到达光圈，让目标星系成为镜头焦点。
- **连续缩放**：NEXUS 星系不再与模块中枢简单交叉淡化；中枢从系统形态连续放大，四个模块沿弧线从中心展开，关系线随展开进度生长。
- **文字退场**：首页与模块层改为“先退后进”的分层转场，旧标题完全退出后新标题才进入，避免叠字和跳切。
- **能量细节**：核心内部增加反向旋转能量虹膜与带尾迹的能量微粒；系统、中枢和模块拥有不同相位的呼吸光晕；流星尾迹更长，关系光流增加双段尾迹与焦点光波。
- **模块星系**：每个模块增加两条微轨道与三颗局部卫星，并按前后景遮挡关系绘制，使模块从“图标”变成小型星系。
- **装饰语义**：微卫星与细轨道是独立于模块数据的程序化装饰层，不参与悬停、点击、详情或架构关系；About 面板中有明确说明。
- **可读性**：提升模块名称、说明、系统状态与详情面板辅助文字的对比度；焦点之外的节点仍保留可见度，并使用局部暗色底衬平衡核心光晕。

详细改动与本轮性能对照见 **[docs/P0.1-REPORT.md](docs/P0.1-REPORT.md)**。

---

## 5. 视觉与技术方案

- **React + TypeScript + Vite**，不依赖 Three.js、GSAP 或其他动画库。
- 星空、中央能量核心、系统星系、关系曲线与流动光点均由 **Canvas 2D** 实时绘制。
- 光晕、星尘、扫光、细腻噪声与界面层次由 CSS 和本地字体共同完成。
- 所有图形为程序化原创生成，没有使用任何参考项目的源码或视频素材。

### 视觉构成

- **中央数字核心**：多层球形光体、内部旋转能量弧、倾斜轨道、呼吸光晕、能量波纹与少量绕行粒子。
- **三个系统星系**：不同的主色、尺度、轨道与粒子节奏；悬停时聚焦对应连接线。
- **关系流**：预采样三次贝塞尔曲线，沿路径运行的双段光尾表达方向；非焦点连接自动弱化但保持可见。
- **镜头层级**：进入 NEXUS 时，镜头平滑推进并聚焦到目标星系，模块从中枢连续展开；详情打开时镜头轻微让位于右侧面板。
- **模块微星系**：模块外圈的卫星和微轨道仅用于视觉构图，不属于数据节点。

### 动效与性能控制

| 模式 | 行为 |
| --- | --- |
| 完整 | 完整星空漂移、前景尘埃、流星、光流、核心能量与呼吸光晕 |
| 低动态 | 降低运动速度与粒子密度，取消流星，放缓 CSS 环境动效 |
| 静态 | 停止 canvas 连续帧循环与 CSS 环境动画，悬停仍可获得即时反馈 |

此外：

- 支持 `prefers-reduced-motion: reduce`：首次访问默认进入静态模式。
- 页面失焦时 Canvas 降至约 20 FPS 并暂停 CSS 环境动画。
- 页面不可见时停止动画帧。
- Canvas 设备像素比上限为 1.75，同时将画布单边限制在 4096 px，避免高 DPI 大屏重复像素填充。
- 关系曲线、发光纹理、标签底衬在初始化阶段缓存，不在每帧重建节点拓扑或复杂渐变。
- 组件卸载时移除动画帧、ResizeObserver、鼠标与可见性监听器。

---

## 6. 实测结果摘要

完整 P0.1 记录见 **[docs/P0.1-REPORT.md](docs/P0.1-REPORT.md)**；P0 基线见 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)。

测试时间：2026-10-20  
测试设备：Apple M1 Ultra / 64 GB / macOS 15.7.8 / 内置显示器 1920×1080 @ 100 Hz  
测试浏览器：ZCode 内置 Chromium 浏览器（Chromium 146.0.7680.80 / Electron 41.0.3）

| 场景 | 分辨率 | P0 Canvas 平均 / p95 | P0.1 Canvas 平均 / p95 | P0.1 FPS |
| --- | --- | --- | --- | --- |
| 首页 · 完整动效 | 1920×1080 | 0.89 / 1.7 ms | 1.06 / 2.3 ms | 99.8–100.2 |
| 首页 → NEXUS 转场 | 1920×1080 | 1.19 / 2.0 ms | 0.96 / 2.1 ms | 99.8–100.1 |
| 语音交互详情 | 1920×1080 | 1.14 / 2.9 ms | 0.91 / 1.8 ms | 99.9–100.2 |
| 首页 · 完整动效 | 2560×1440 | 1.31 / 2.3 ms | 1.22 / 2.7 ms | 100.1 |
| 首页 · 完整动效 | 3840×2160 | 0.74 / 0.8 ms | 0.86 / 1.0 ms | 99.9–100.1 |
| 首页 → NEXUS 转场 | 3840×2160 | 1.13 / 2.4 ms | 0.88 / 1.0 ms | 100.1 |

- 显示器刷新率为 100 Hz，因此 100 FPS 是本次环境的采样上限；P0.1 的 95% 帧间隔最高为 11.9 ms。
- 1080p 首页的平均 Canvas 绘制增加约 0.17 ms；其余场景在运行波动范围内。
- 4K 转场曾因全屏文字 blur 降至约 95 FPS，移除全屏滤镜后恢复 100.1 FPS，最终代码已包含该修正。
- 失焦降载约 19.6 FPS；静态模式停止连续 rAF；低动态约 100 FPS。

注意：

- 上述帧率为浏览器 `requestAnimationFrame` 采样与实际 Canvas 绘制耗时，不等同于完整 GPU 合成链路的专业帧分析。
- 2560×1440 与 3840×2160 通过 Chromium 视口渲染验证，尚未在物理显示器上验收。
- 性能数字仅对本次 M1 Ultra 测试环境负责。
- P1.1 默认演示模式实测：完整 100.1 FPS / 0.65 ms / p95 0.8 ms；低动态 99.9 FPS；静态 `rafActive:false`。Canvas 引擎未改动，详见 [P1.1-REPORT.md](docs/P1.1-REPORT.md)。

---

## 7. 验收状态

| 项目 | 状态 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| 生产构建 | 通过 |
| 1920×1080 布局 / 三级交互 | 通过 |
| 2560×1440 布局 | 通过（浏览器视口渲染） |
| 3840×2160 布局 | 通过（浏览器视口渲染） |
| 完整 / 低动态 / 静态 | 通过 |
| 失焦降载 | 通过（合成 blur/focus 事件验证） |
| `prefers-reduced-motion` | 已实现初始偏好检测；未做系统辅助功能级自动化实测 |
| Windows 运行 | **待 Windows 验收** |
| 独立安装的 Chrome / Edge | P1.1 已用独立 Google Chrome 155 完成本地导入/导出验收（CDP 注入 file input）；Edge 待验 |
| 物理 2560×1440 / 4K 显示器 | 待真机验收 |
| P1.1 架构数据单元测试 | 通过（73 项，8 个测试文件；1 项外部快照重跑需 GRAPHIFY_POC_DIR） |
| P1.1 默认构建安全门禁 | 通过；dist 无快照、提交 SHA、内部符号或源码路径 |
| P1.1 四模块真实详情 | 通过（独立 Chrome + 截图） |
| P1.1 关系搜索 / 筛选 | 通过（23 条关系；AI 筛选 4 条） |
| P1.1 导出 / 重新导入 | 通过（1,390 / 3,170，Schema 1.1.0） |
| P1.1 旧 Schema 1.0 兼容 | 通过单元测试迁移 |
| P1.1 Windows CLI / 路径 | 路径逻辑通过单元测试；未在 Windows 实机执行 |

P0.1 没有接入 Graphify；P1.1 已接入本地导入的 Graphify 历史快照，但没有安装 MCP 或 Agent Skill，也没有读取或修改现有 CRM/ERP、NEXUS 正式项目。P1.1 只读取用户指定的 POC 产物目录与本地 ATLAS 文件。

---

## 8. 截图与录屏

### 关键状态

| 画面 | 文件 |
| --- | --- |
| 首页 · 1920×1080 | [查看](docs/screenshots/01-home-1920x1080.png) |
| 悬停 NEXUS 星系 | [查看](docs/screenshots/02-hover-nexus-1920x1080.png) |
| NEXUS 模块星系 · 1920×1080 | [查看](docs/screenshots/03-nexus-modules-1920x1080.png) |
| 语音交互详情 | [查看](docs/screenshots/04-voice-detail-1920x1080.png) |
| 技术信息展开 | [查看](docs/screenshots/05-voice-tech-expanded-1920x1080.png) |
| 选中 CRM / ERP 星系 | [查看](docs/screenshots/11-selected-crm-1920x1080.png) |
| 静态模式 | [查看](docs/screenshots/10-static-mode-1920x1080.png) |
| 首页 · 2560×1440 | [查看](docs/screenshots/06-home-2560x1440.png) |
| 首页 · 3840×2160 | [查看](docs/screenshots/07-home-3840x2160.png) |
| NEXUS · 3840×2160 | [查看](docs/screenshots/08-nexus-3840x2160.png) |
| 语音交互详情 · 3840×2160 | [查看](docs/screenshots/09-voice-detail-3840x2160.png) |

![NEXUS 模块星系](docs/screenshots/03-nexus-modules-1920x1080.png)

![语音交互详情](docs/screenshots/04-voice-detail-1920x1080.png)

所有截图均由实际运行的页面通过浏览器截图获得，不是后期合成效果图；截图已更新为 P0.1 视觉状态。

### P1.1 本地数据探索截图

| 画面 | 文件 |
| --- | --- |
| 本地 ATLAS 导入与安全边界 | [查看](docs/screenshots/P1.1-01-local-import-1920x1080.png) |
| 经营数据展示详情 | [查看](docs/screenshots/P1.1-02-module-1-1920x1080.png) |
| 语音交互详情 | [查看](docs/screenshots/P1.1-03-module-2-1920x1080.png) |
| 动画调度详情 | [查看](docs/screenshots/P1.1-04-module-3-1920x1080.png) |
| Canvas 渲染详情 | [查看](docs/screenshots/P1.1-05-module-4-1920x1080.png) |
| 关系探索 · 模块文件 | [查看](docs/screenshots/P1.1-06-relation-files-1920x1080.png) |
| 关系探索 · 中文搜索 | [查看](docs/screenshots/P1.1-07-relation-search-1920x1080.png) |
| 关系探索 · 关系列表 | [查看](docs/screenshots/P1.1-08-relation-list-1920x1080.png) |
| 关系探索 · AI 复核筛选 | [查看](docs/screenshots/P1.1-09-relation-ai-filter-1920x1080.png) |

### P1.0 架构数据截图

| 画面 | 文件 |
| --- | --- |
| 首页 · 历史快照模式 | [查看](docs/screenshots/P1.0-01-home-snapshot-1920x1080.png) |
| 架构数据面板 | [查看](docs/screenshots/P1.0-02-architecture-data-1920x1080.png) |
| NEXUS 模块星系 · 历史快照 | [查看](docs/screenshots/P1.0-03-nexus-snapshot-1920x1080.png) |
| 语音详情 · 真实架构数据 | [查看](docs/screenshots/P1.0-04-voice-real-data-1920x1080.png) |

### 演示录屏

- **时长**：23.37 秒
- **帧率**：30 FPS
- **内容**：首页动态 → 悬停 NEXUS → 进入星系与模块展开 → 悬停语音交互 → 打开详情 → 展开技术信息 → 返回模块层 → 返回首页
- **原生采集**：1440×810（应用内录屏面板在 1080p 视口下会截掉右缘）
- **查看版**：1920×1080（Lanczos 放大，不改变内容）

文件：

- [dachuan-atlas-p01-demo.mp4](docs/recording/dachuan-atlas-p01-demo.mp4)（推荐播放）
- [dachuan-atlas-p01-demo.webm](docs/recording/dachuan-atlas-p01-demo.webm)（原生采集）

录屏为无声音的界面演示。

---

## 9. 已知限制

1. 画布中的系统位置、模块位置、连线、光流、装饰卫星与模块标签仍为演示构图，与真实代码依赖无关。
2. 真实架构数据只在用户本地导入后出现；默认构建与首次访问均为演示数据。
3. CRM / Electron 尚未接入真实架构数据；P1.1 未扫描这两个仓库。
4. 13 条关系为 AI 源码复核，独立人工审核为 0；3,157 条仍待核实；42 条 INFERRED 不等于事实；Canvas 模块为部分核实。
5. 模块外圈的微卫星与细轨道是装饰层，不是架构节点，也没有交互语义。
6. 详情面板在 1080p 展开技术信息后需要面板内滚动，这是当前固定高度面板的预期行为。
7. 录屏原生采集为 1440×810；1080p MP4 为放大查看版，不等同于原生 1080p 录屏。
8. 页面以桌面端为重点，支持窄屏降级，但手机端不是本轮验收目标。
9. 内置 Chromium 与独立 Google Chrome 155 已验收；Microsoft Edge、Safari、Firefox 尚未复核。
10. 未在 Windows 实机运行，未在物理 4K 显示器输出，不能据此宣称双平台或全部显示设备已通过验收。

---

## 10. Windows 迁移注意事项

当前源码没有硬编码 macOS 路径，也不依赖 macOS 特有 API。迁移到 Windows 时：

1. 安装 Node.js 22 LTS 或更高版本（最低 `^20.19.0 || >=22.12.0`）。
2. 将整个项目目录复制到 Windows，在 PowerShell 或终端中执行 `npm install`、`npm run dev`。
3. 用最新版 Chrome 或 Edge 打开终端提示的本地地址（默认 `http://127.0.0.1:4173`）。
4. 建议开启浏览器硬件加速。该项目只依赖 Canvas 2D、CSS、Pointer Events、ResizeObserver 等标准能力，不需要 WebGL。
5. 中文字体会回退到「Microsoft YaHei UI / 微软雅黑」，不会影响功能；英文展示字体已随项目本地打包。
6. 重新执行性能验收：Windows 的 GPU、驱动、浏览器版本和显示器刷新率不同，本轮 Mac 数据不能替代 Windows 实测。
7. 验收时重点检查：1920×1080 布局、完整/低动态/静态三档、失焦降载、中文字体回退、4K 缩放与详情面板滚动。
8. 数据导入 CLI 使用 Node 跨平台 API，路径统一为 POSIX 相对路径；盘符路径与 UNC 会被拒绝。建议在 Windows 实机执行 `npm test` 与一次 `npm run import:graphify`。
9. 浏览器导入使用标准 File API，不要求 Bash；快照数据是本地静态文件，离线可读。

**Windows 状态：待 Windows 验收。**

---

## 11. 项目结构

```text
.
├── src/
│   ├── App.tsx                  # 三级视图、数据源与弹窗状态
│   ├── architecture/            # P1.1 Schema、适配器、查询、隐私体检、审核记录
│   ├── components/              # 顶栏、导览、详情面板、架构数据面板
│   ├── data/atlas.ts            # 模拟布局与独立装饰卫星数据
│   ├── hooks/                   # 动效偏好、架构数据状态
│   ├── scene/
│   │   ├── AtlasScene.ts        # Canvas 星图、核心、光流、卫星、命中检测
│   │   └── math.ts              # 曲线、缓动与颜色工具
│   ├── styles/                  # 基础、场景界面、浮层三类样式
│   └── assets/fonts/            # 本地 WOFF2 字体
├── local-data/nexus/            # 本地真实快照（.gitignore，不进入构建）
├── tests/architecture/          # 73 项架构数据测试
├── tools/import-graphify.mjs    # 跨平台 Graphify → ATLAS CLI
├── tools/verify-build.mjs       # 默认构建安全门禁
├── tools/verify-chrome.mjs      # 独立 Chrome 本地导入/详情/导出验收
├── docs/
│   ├── architecture/            # Schema、模块证据、导入审计
│   ├── screenshots/             # P0.1 / P1.0 / P1.1 实机截图
│   ├── recording/               # 23.4 秒 P0.1 演示录屏
│   ├── P0.1-REPORT.md           # P0.1 视觉优化记录
│   ├── P1.0-REPORT.md           # P1.0 历史记录
│   ├── P1.1-REPORT.md           # P1.1 安全、审核、详情与关系探索报告
│   └── TEST-REPORT.md           # P0 基线验收记录
├── licenses/                    # 字体 OFL 许可证
└── THIRD_PARTY_NOTICES.md
```

---

## 12. 数据声明

DACHUAN ATLAS 是独立视觉原型与数据适配演示，必须区分四类信息：

- **画布演示构图**：星系位置、模块位置、连线、光流、模块标签与装饰卫星均为演示设定，不代表真实架构关系。
- **演示数据**：默认数据源中的 7 个节点 / 7 条关系为 `SIMULATED`，不来自源码。
- **本地 NEXUS 快照**：用户主动导入 `.atlas.json` 后，架构数据面板、四个模块详情与关系探索中的节点/证据/统计来自提交 `2584284e3e7b994d0510d9d53b2a302e3aa740bc`（图谱生成 2026-10-20）。它只代表该历史提交，不代表 NEXUS 当前工作区，也不进入默认构建。
- **未核实信息**：13 条关系为 AI 源码复核，独立人工审核为 0；3,157 条仍待核实；42 条 Graphify INFERRED 关系不等于事实；Canvas 模块仅部分核实。Graphify 未识别的 rAF、Canvas API、CSS、React 回调与跨进程关系，不代表不存在。

CRM / Electron 尚未接入真实架构数据。模块外圈的卫星、微轨道、星尘与流星属于装饰效果，不代表数据传输或架构关系。

P1.1 在安全边界、审核来源、四模块详情、关系探索与独立 Chrome 验收完成后停止，等待下一轮架构审核。
