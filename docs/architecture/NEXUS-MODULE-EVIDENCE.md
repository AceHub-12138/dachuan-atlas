# NEXUS 历史快照 · 中文模块映射与证据记录

- **来源提交**：`2584284e3e7b994d0510d9d53b2a302e3aa740bc`
- **图谱生成**：2026-10-20
- **Graphify**：0.9.92 / schema_version 1
- **清单**：`snapshot-manifest.json` 204/204 文件通过 SHA-256，1,414,490 bytes
- **ATLAS 数据集**：`local-data/nexus/nexus-2026-10-20-2584284.atlas.json`（不进入公开构建，需本地导入）
- **数据性质**：历史快照，不代表 NEXUS 当前工作区

---

## 1. 映射原则

1. 只按源码路径与文件职责归类；**Community 编号不参与判定**。
2. 一个节点有一个主模块；Canvas 只做支撑归属，避免虚构独立模块。
3. 模块的“已核实”只表示组成已按源码核对；每条关系仍有独立审核状态。
4. 未在历史快照中出现的组件不补入；不用当前工作区信息回填旧快照。
5. 测试与脚本计入数据集，但不计入模块的 `productNodes` 构成。

---

## 2. 模块总览

| 模块 | 主节点 | 支撑节点 | 内部关系 | 跨模块关系 | Community 数 | 映射状态 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 经营数据展示 `data` | 211 | 0 | 322 | 81 | 23 | 已核实 |
| 语音交互 `voice` | 530 | 0 | 1,190 | 35 | 43 | 已核实 |
| 动画调度 `animation` | 68 | 0 | 132 | 13 | 3 | 已核实 |
| Canvas 渲染 `canvas` | 0 | 58 | 86 | 68 | 0 | 部分核实 |

> “跨模块关系”是每个模块的**关联边数**，同一对模块会在两侧各计一次；按节点对去重后的主模块跨模块关系为 48 条：`data ↔ voice` 35 条、`animation ↔ data` 13 条。Canvas 的 68 条来自支撑文件的交叉归属，不与前两者相加当总量。

---

## 3. 语音交互 `voice`

**归类规则**：`src/lib/voice/`、`services/voice-orchestrator/`、`src/app/voice-console/`、`src/components/overlay/` 为主归属；`src/lib/voice/params.ts` 同时是 Canvas 支撑文件。

**职责**：麦克风采集与 VAD、PCM 播放、WebSocket 协议、会话状态机、服务端编排、TTS 音频缓存；跨浏览器进程与 Node 服务两个运行位置。

**代表证据**（均已打开历史快照源码核对）：

| 符号 | 位置 | 能证明什么 |
| --- | --- | --- |
| `VoiceMicrophone` | `src/lib/voice/microphone.ts#L15` | 浏览器端麦克风采集、VAD/KWS 与播放让位 |
| `PcmPlayer` | `src/lib/voice/pcm-player.ts#L28` | PCM 句子级播放、降音、打断 |
| `parseWireEvent` | `src/lib/voice/protocol.ts#L198` | 语音 wire 协议解析，未知事件 fail-closed |
| `sessionReducer` | `src/lib/voice/session-machine.ts#L178` | 覆盖层会话状态机 |
| `wireToMachineEvents` | `src/lib/voice/live-source.ts#L40` | 协议事件到状态机事件的映射 |
| `createVoiceOrchestrator` | `services/voice-orchestrator/src/orchestrator.ts#L132` | 服务端编排入口 |
| `AudioStore` | `services/voice-orchestrator/src/tts/audio-store.ts#L23` | TTS 音频缓存与句子通知 |
| `startVoiceHub` | `services/voice-orchestrator/src/ws/ws-server.ts#L90` | WebSocket hub、鉴权与来源校验 |
| `SpeechClient` | `services/voice-orchestrator/src/tts/voice-local-client.ts#L14` | 本地语音服务客户端 |
| `JarvisCore` | `src/components/overlay/JarvisCore.tsx#L80` | 语音覆盖层 Canvas 2D 核心 |

**Community 说明**：语音模块横跨 **43 个 Community**。`Community 31` 只有 **17 个节点**，全部是 `services/voice-orchestrator/` 下的编排、监听窗口、鉴权与 HTTP 输入代码；它只是语音服务的一个局部聚类，不能代表整个“语音交互”模块。

**审核**：模块组成由 AI 按源码路径复核（`verified`）；内部 1,190 条关系中 4 条为 AI 源码复核，其余 1,186 条待核实；独立人工审核为 0。

---

## 4. 动画调度 `animation`

**归类规则**：`src/components/screen/motion/` 为主归属，另纳入 `src/lib/use-reduced-motion.ts`。

**职责**：MotionDirector 统一持有一个未完成的 `requestAnimationFrame`，管理场景状态、脉冲节奏、FPS 采样与低动态降级；GsapScene 提供可采样的代理时间线。

**代表证据**：

| 符号 | 位置 | 能证明什么 |
| --- | --- | --- |
| `MotionDirector` | `src/components/screen/motion/MotionDirector.ts#L15` | “一个所有者、一个未完成 rAF”、INTRO/AMBIENT/PULSE/DEGRADED 与自动降级 |
| `GsapScene` | `src/components/screen/motion/GsapScene.ts#L6` | 代理 GSAP 时间线与采样接口 |
| `MotionProvider` | `src/components/screen/motion/MotionProvider.tsx#L11` | 页面可见性、减少动态、语音状态联动 |
| `useSceneMotion` | `src/components/screen/motion/useSceneMotion.ts#L12` | 逐帧写入 SVG 属性并绘制背景 Canvas 粒子 |
| `useReducedMotion` | `src/lib/use-reduced-motion.ts#L9` | 订阅 `prefers-reduced-motion` |
| `MotionConfig` | `src/components/screen/motion/config.ts#L14` | 脉冲、航线、粒子与降级阈值 |

**历史快照边界**：`GsapTickerOwner` **不存在于本历史快照**。本轮没有读取或补入 NEXUS 当前工作区的后续组件；动画模块的结论仅基于上述文件。

**审核**：模块组成由 AI 按源码路径复核（`verified`）；内部 132 条关系中 3 条为 AI 源码复核，其余 129 条待核实；独立人工审核为 0。

---

## 5. 经营数据展示 `data`

**归类规则**：`src/components/screen/`、`src/app/screen/`、`src/app/api/screen/` 与经营数据投影/格式化库（`public-screen-payload`、`format`、`freshness`、`screen-*`、`geo`、`target`）为主归属。

**职责**：经营指标、合同/回款表盘、发货预警、发货动态、业务覆盖地图；CRM 数据先经 `toPublicScreenPayload` 投影为公开 payload，再进入大屏面板。

**代表证据**：

| 符号 | 位置 | 能证明什么 |
| --- | --- | --- |
| `toPublicScreenPayload` | `src/lib/public-screen-payload.ts#L39` | 只保留公开 UI 字段，避免透传 CRM 对象 |
| `KpiRail` | `src/components/screen/KpiRail.tsx#L71` | 合同额、回款、客户、发货指标栏 |
| `ContractGauge` | `src/components/screen/NexusPanels.tsx#L16` | 合同额与目标进度 |
| `OperationMetrics` | `src/components/screen/NexusPanels.tsx#L48` | 经营读数 |
| `CollectionDial` | `src/components/screen/NexusPanels.tsx#L58` | 累计回款率表盘 |
| `DeliveryAlerts` | `src/components/screen/NexusPanels.tsx#L82` | 逾期/待发货预警 |
| `ShipmentFeed` | `src/components/screen/NexusPanels.tsx#L88` | 最近发运列表与地图选中联动 |
| `ShipmentMap` | `src/components/screen/ShipmentMap.tsx#L16` | SVG 地图、航线、城市/省份标签 |
| `freshness` | `src/lib/freshness.ts#L3` | 快照新鲜度 |
| `formatMoney` | `src/lib/format.ts#L45` | 人民币金额格式化 |

**边界**：地图是 SVG，不计入 Canvas 模块。本模块的“已核实”同样只表示组成，不表示每条数据流已确认。

**审核**：内部 322 条关系中 4 条为 AI 源码复核，其余 318 条待核实；独立人工审核为 0。

---

## 6. Canvas 渲染 `canvas`

**归类规则**：历史快照中没有独立 Canvas 目录或入口。仅把明确执行 Canvas 2D 绘制的文件标记为支撑模块：

- `src/components/overlay/JarvisCore.tsx`
- `src/lib/voice/params.ts`
- `src/components/screen/motion/useSceneMotion.ts`
- `src/components/screen/ScreenStage.tsx`

**为什么是“部分核实”**：

- 主归属节点为 **0**，支撑节点 58；没有可以称为“Canvas 模块”的独立源码单元。
- 源码能证明 Canvas 绘制存在：JarvisCore 的全屏 Canvas 2D 粒子系统、useSceneMotion 的 `nexus-particles`、params 的 3D 投影数学、ScreenStage 的 canvas 容器。
- Graphify **没有**生成 `getContext`、`fillRect`、`CanvasRenderingContext2D` 等节点或边，无法证明完整的调用网络。
- 因此不虚构一个独立模块，也不把“图中没有边”当作“没有调用”。

**代表证据**：

| 符号 | 位置 | 能证明什么 |
| --- | --- | --- |
| `JarvisCore` | `src/components/overlay/JarvisCore.tsx#L80` | 全屏 Canvas 2D 粒子环系与四组粒子池 |
| `project3` | `src/lib/voice/params.ts#L255` | 单位球粒子的弱透视投影 |
| `buildNucleus` | `src/lib/voice/params.ts#L323` | 核球粒子构建 |
| `useSceneMotion` | `src/components/screen/motion/useSceneMotion.ts#L12` | 大屏背景粒子 Canvas |
| `ScreenStage` | `src/components/screen/ScreenStage.tsx#L11` | 大屏舞台与 canvas 元素 |

---

## 7. AI 源码复核的关系（13 条）

其余 3,157 条关系保持 `unverified`。以下 13 条关系由施工 Agent 逐条打开历史快照源码确认，审核方式为 `ai-source-review`，**不是独立人工审核**：

| 起点 | 类型 | 终点 | 原始状态 | 源码位置 | 核对结论 |
| --- | --- | --- | --- | --- | --- |
| `microphone.ts` | `imports_from` | `pcm-player.ts` | EXTRACTED | `microphone.ts#L2` | 显式导入 |
| `main.ts` | `imports` | `AudioStore` | EXTRACTED | `main.ts#L24` | 显式导入 |
| `main.ts` | `imports` | `createVoiceOrchestrator()` | EXTRACTED | `main.ts#L21` | 显式导入 |
| `MotionProvider.tsx` | `imports` | `MotionDirector` | EXTRACTED | `MotionProvider.tsx#L4` | 显式导入 |
| `useSceneMotion.ts` | `imports_from` | `MotionProvider.tsx` | EXTRACTED | `useSceneMotion.ts#L5` | 显式导入 |
| `ScreenStage.tsx` | `imports_from` | `useSceneMotion.ts` | EXTRACTED | `ScreenStage.tsx#L3` | 显式导入 |
| `ScreenStage()` | `calls` | `useSceneMotion()` | EXTRACTED | `ScreenStage.tsx#L15` | 调用点确认 |
| `ScreenStage()` | `calls` | `ShipmentMap()` | EXTRACTED | `ScreenStage.tsx#L40` | 渲染点确认 |
| `ScreenStage()` | `calls` | `ContractGauge()` | EXTRACTED | `ScreenStage.tsx#L39` | 渲染点确认 |
| `ScreenStage()` | `calls` | `OperationMetrics()` | EXTRACTED | `ScreenStage.tsx#L39` | 渲染点确认 |
| `KpiRail()` | `calls` | `Gauge()` | EXTRACTED | `KpiRail.tsx#L114` | 渲染点确认 |
| `useSceneMotion()` | `calls` | `useMotionDirector()` | EXTRACTED | `useSceneMotion.ts#L13` | 调用点确认 |
| `createVoiceOrchestrator()` | `indirect_call` | `beginSession()` | **INFERRED** | `orchestrator.ts#L998` | 返回对象显式包含，推断成立 |

最后一条证明“INFERRED 也可以被 AI 源码复核”：原始证据类型保留为 `INFERRED`，审核方式为 `ai-source-review`，审核状态为 `verified`，三者不互相替代。

---

## 8. 已确认的覆盖盲区

这些是“Graphify 没看见”，不是“代码里不存在”：

| 盲区 | 证据 | 影响 |
| --- | --- | --- |
| `requestAnimationFrame` / `cancelAnimationFrame` | 图内 0 个节点；MotionDirector 源码明确使用 rAF | 动画调度运行时调用图不完整 |
| Canvas 原生 API | 图内 0 个 `getContext` / `fillRect` / `CanvasRenderingContext2D` 节点 | Canvas 调用网络无法从图证明 |
| CSS | 清单含 2 个 CSS 文件，图中 0 个 CSS 节点 | 布局与动效的样式影响未进入关系图 |
| 动态调用 | 28 条 `indirect_call`、5 条 `dynamic_import`，部分为 INFERRED | 动态分发只能部分还原 |
| React 回调 / 运行时状态 | 仅 import/call 边；无状态更新、回调注册边 | 组件交互链不完整 |
| 跨进程 | 浏览器 ↔ voice-orchestrator 无运行时边 | 只能依据协议源码与文件关系判断 |
| 未落边调用 | `metadata.unresolved_calls` 共 201 次，分布在 66 个节点 | 不能据此断言调用不存在 |

`unresolved_calls` 的接收者类型前六位：`Page` 94、`ServerResponse` 17、`AudioContext` 14、`Element` 12、`FrameProcessor` 10、`DataView` 9。

---

## 9. 数据质量处理记录

| 情况 | 处理 | 数量 |
| --- | --- | ---: |
| 原始节点 | — | 1,390 |
| 原始关系记录 | — | 3,170 |
| 唯一无向节点对 | 统计口径，与 Graphify 报告一致 | 3,097 |
| 自调用 | 保留，标记 `selfReference` | 16 |
| 完全重复关系 | 合并 | 0 |
| 悬空关系 | 跳过并计数 | 0 |
| 重复节点 ID | 保留首次出现 | 0 |
| 绝对路径节点 | 跳过且不回显路径 | 0 |
| 包名/非文件来源 | 按外部节点处理 | 1（`@playwright/test`） |
| 绝对路径派生的外部标签 | 脱敏 | 1 |
| 中文注释节点 | AI 源码复核 | 33 |
| AI 源码复核关系 | 逐条对照源码（人工为 0） | 13 |

> 本快照没有出现重复节点、悬空关系或绝对路径节点；适配器的相应分支由合成测试覆盖，而不是靠删数据规避。
