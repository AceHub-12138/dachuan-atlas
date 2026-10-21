import { MODULES } from '../data/atlas';
import type { ModuleId } from '../data/atlas';
import { ArrowLeft, ArrowRight } from './Icons';

interface NexusIntroProps {
  muted: boolean;
  dataSource: 'demo' | 'nexus-snapshot';
  onBackHome: () => void;
  onOpenModule: (id: ModuleId) => void;
}

export function NexusIntro({ muted, dataSource, onBackHome, onOpenModule }: NexusIntroProps) {
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
          <span>INDEX / 04</span>
        </div>
        <ol>
          {MODULES.map((module) => (
            <li key={module.id}>
              <button
                type="button"
                className={`module-row ${module.available ? 'is-available' : ''}`}
                onClick={() => onOpenModule(module.id)}
                tabIndex={muted ? -1 : 0}
              >
                <span className="module-row__index">{module.index}</span>
                <span className="module-row__name">{module.name}</span>
                <span className="module-row__status">
                  {module.available
                    ? '查看详情'
                    : dataSource === 'nexus-snapshot'
                      ? '详情待开放'
                      : 'P0 占位'}
                </span>
                {module.available ? <ArrowRight className="module-row__arrow" /> : null}
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
    </section>
  );
}
