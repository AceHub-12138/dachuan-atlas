import type { ModuleId } from '../data/atlas';
import type { AtlasModuleRecord } from '../architecture/schema';
import {
  EVIDENCE_LABELS,
  EVIDENCE_ORDER,
  type GraphProjection,
} from '../architecture/projection';
import { ArrowLeft, ArrowRight } from './Icons';

interface NexusIntroProps {
  muted: boolean;
  dataSource: 'demo' | 'nexus-snapshot';
  modules: AtlasModuleRecord[];
  graph: GraphProjection | null;
  showGraphLinks: boolean;
  hasFlow: boolean;
  onBackHome: () => void;
  onOpenModule: (id: ModuleId) => void;
  onOpenGraph: () => void;
  onOpenFlow: () => void;
  onOpenData: () => void;
  onToggleGraphLinks: () => void;
}

export function NexusIntro({
  muted,
  dataSource,
  modules,
  graph,
  showGraphLinks,
  hasFlow,
  onBackHome,
  onOpenModule,
  onOpenGraph,
  onOpenFlow,
  onOpenData,
  onToggleGraphLinks,
}: NexusIntroProps) {
  return (
    <section
      className={`nexus-intro ${muted ? 'is-muted' : ''}`}
      aria-labelledby="nexus-title"
      aria-hidden={muted || undefined}
    >
      <button type="button" className="text-back" onClick={onBackHome} tabIndex={muted ? -1 : 0}>
        <ArrowLeft />
        <span>返回系统宇宙</span>
      </button>
      <div className="eyebrow nexus-eyebrow">
        <span className="eyebrow__line" />
        <span>NEXUS · MODULE CONSTELLATION</span>
      </div>
      <h2 id="nexus-title" className="nexus-title">
        可视化大屏
      </h2>
      <p className="nexus-lede">
        四个核心模块，共同构成现场的感知与表达。
        <br />
        选择一个模块，查看它在系统中的位置。
      </p>
      <div className="nexus-caption">
        <span className="status-dot" />
        <span>04 CORE MODULES</span>
        <i />
        <span>{dataSource === 'demo' ? '模拟模块' : '本地快照 · 模块映射'}</span>
      </div>

      <div className="module-index">
        <div className="module-index__head">
          <span>模块索引</span>
          <span>INDEX / {String(modules.length).padStart(2, '0')}</span>
        </div>
        <ol>
          {modules.map((module) => (
            <li key={module.id}>
              <button
                type="button"
                className="module-row is-available"
                onClick={() => onOpenModule(module.id)}
                tabIndex={muted ? -1 : 0}
              >
                <span className="module-row__index">{module.index}</span>
                <span className="module-row__name">{module.name}</span>
                <span className="module-row__status">查看详情</span>
                <ArrowRight className="module-row__arrow" />
              </button>
            </li>
          ))}
        </ol>
        <p className="module-index__hint">
          {dataSource === 'demo'
            ? '四个模块均可查看演示详情；导入本地快照后查看源码证据。'
            : '四个模块的构成来自本地快照；关系逐条保留审核状态。'}
        </p>
      </div>

      {dataSource === 'nexus-snapshot' && graph ? (
        <section className="graph-summary" aria-labelledby="graph-summary-title">
          <div className="graph-summary__head">
            <div>
              <span className="graph-summary__kicker">GRAPH PROJECTION</span>
              <h3 id="graph-summary-title">真实关系投影</h3>
            </div>
            <button
              type="button"
              className={`graph-summary__toggle ${showGraphLinks ? 'is-on' : ''}`}
              aria-pressed={showGraphLinks}
              onClick={onToggleGraphLinks}
            >
              <i />
              <span>{showGraphLinks ? '真实连线已显示' : '只显示构图'}</span>
            </button>
          </div>
          <div className="graph-summary__counts">
            <span>
              <strong>{graph.stats.edgeCount}</strong> 组模块对
            </span>
            <span>
              <strong>{graph.stats.relationCount}</strong> 条关系
            </span>
            <span>
              <strong>{graph.stats.aiReviewed}</strong> AI 复核
            </span>
            <span>
              <strong>{graph.stats.unverified}</strong> 待核实
            </span>
          </div>
          <div className="graph-summary__legend">
            {EVIDENCE_ORDER.map((value) => (
              <span key={value} data-evidence={value}>
                <i />
                {EVIDENCE_LABELS[value]}
              </span>
            ))}
            <span data-evidence="mixed">
              <i>?</i>
              待核实叠加
            </span>
            <span data-evidence="decorative">
              <i />
              中枢连接 · 构图
            </span>
          </div>
          <p className="graph-summary__compact-legend">
            青=直接提取 · 紫=AI 复核 · 琥珀=推断 · 红点=待核实 · 橙=构图
          </p>
          <div className="graph-summary__actions">
            <button type="button" className="graph-summary__primary" onClick={onOpenGraph}>
              打开架构投影
              <ArrowRight />
            </button>
            <button type="button" className="graph-summary__secondary" onClick={onOpenFlow} disabled={!hasFlow}>
              按流程理解
              {hasFlow ? <ArrowRight /> : null}
            </button>
          </div>
          <p className="graph-summary__note">
            仅绘制有证据的跨模块关系；Canvas 无主归属，不画模块连线。橙色中枢连接、星点、轨道与流星为装饰，不参与统计。
          </p>
        </section>
      ) : (
        <section className="graph-summary graph-summary--demo" aria-labelledby="graph-summary-title-demo">
          <div className="graph-summary__head">
            <div>
              <span className="graph-summary__kicker">DEMO CONSTELLATION</span>
              <h3 id="graph-summary-title-demo">演示星系</h3>
            </div>
            <span className="graph-summary__status">模拟</span>
          </div>
          <p className="graph-summary__note">
            保留 P0.1 原有星系结构。导入本地 ATLAS 快照后，才会出现可追溯的跨模块连线和按流程理解。
          </p>
          <button type="button" className="graph-summary__secondary" onClick={onOpenData}>
            导入本地快照
            <ArrowRight />
          </button>
        </section>
      )}
    </section>
  );
}
