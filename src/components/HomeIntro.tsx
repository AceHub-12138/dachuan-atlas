import { ArrowRight } from './Icons';

interface HomeIntroProps {
  onEnterNexus: () => void;
  dataSource: 'demo' | 'nexus-snapshot';
}

export function HomeIntro({ onEnterNexus, dataSource }: HomeIntroProps) {
  return (
    <section className="home-intro" aria-labelledby="home-title">
      <div className="eyebrow">
        <span className="eyebrow__line" />
        <span>DACHUAN SOFTWARE ATLAS</span>
        <span className="eyebrow__serial">00 / 系统宇宙</span>
      </div>
      <h1 id="home-title" className="home-title">
        <span>大川项目</span>
        <span className="home-title__accent">架构星图</span>
      </h1>
      <p className="home-lede">
        从核心出发，探索系统、模块与协作关系。
        <br />
        让复杂的软件体系，成为一张可以被看见的星图。
      </p>
      <div className="home-actions">
        <button type="button" className="primary-action" onClick={onEnterNexus}>
          <span>进入 NEXUS 星系</span>
          <ArrowRight />
        </button>
        <span className="home-hint">悬停查看星系名称</span>
      </div>
      <div className="home-meta">
        <span>{dataSource === 'demo' ? 'P0 VISUAL PROTOTYPE' : 'P1.1 LOCAL DATA'}</span>
        <i />
        <span>
          {dataSource === 'demo'
            ? '系统关系均为模拟数据'
            : '画布为演示构图 · 架构数据需本地导入'}
        </span>
      </div>
    </section>
  );
}
