import type { AppLevel } from './TopBar';

interface BottomRailProps {
  level: AppLevel;
  dataSource: 'demo' | 'nexus-snapshot';
}

const instructions: Record<AppLevel, string> = {
  universe: '悬停探索星系，点击 NEXUS 进入模块层',
  nexus: '选择模块，点击「语音交互」查看详情',
  module: '按模块 → 文件 → 符号查看关系；Esc 返回模块星系',
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
            : '画布连接为演示构图；真实关系只在本地导入后显示'}
        </span>
      </div>
    </footer>
  );
}
