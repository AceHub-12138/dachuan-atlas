import type { AppLevel } from './TopBar';

interface BottomRailProps {
  level: AppLevel;
  dataSource: 'demo' | 'nexus-snapshot';
}

const instructions: Record<AppLevel, string> = {
  universe: '悬停探索星系，点击 NEXUS 进入模块层',
  nexus: '点击模块查看详情；左下角投影摘要可打开真实关系',
  module: '查看关系证据；按流程理解会标出图谱缺口',
};

const stageIndex: Record<AppLevel, number> = {
  universe: 0,
  nexus: 1,
  module: 2,
};

export function BottomRail({ level, dataSource }: BottomRailProps) {
  const active = stageIndex[level];

  return (
    <footer className="bottom-rail" aria-label="星图状态与操作提示">
      <div className="bottom-rail__left">
        <span className="rail-label">操作</span>
        <span>{instructions[level]}</span>
      </div>
      <div className="bottom-rail__center">
        <div className="stage-dots" aria-label={`当前位于第 ${active + 1} 级`}>
          {['系统宇宙', '模块星系', '模块详情'].map((label, index) => (
            <span
              key={label}
              className={`stage-dot ${index === active ? 'is-active' : ''} ${index < active ? 'is-past' : ''}`}
            >
              <i />
              <em>{label}</em>
            </span>
          ))}
        </div>
      </div>
      <div className="bottom-rail__right">
        <span className="rail-label">数据声明</span>
        <span>
          {dataSource === 'demo'
            ? '所有连接均为模拟关系，非真实代码依赖'
            : '真实跨模块连线来自本地快照；其余画布元素为演示构图'}
        </span>
      </div>
    </footer>
  );
}
