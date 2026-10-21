import type { AtlasSystem } from '../data/atlas';
import { CloseIcon } from './Icons';

interface SystemBriefProps {
  system: AtlasSystem;
  dataSource: 'demo' | 'nexus-snapshot';
  onClose: () => void;
}

export function SystemBrief({ system, dataSource, onClose }: SystemBriefProps) {
  return (
    <aside
      className="system-brief"
      style={{ ['--system-color' as string]: system.color }}
      aria-label={`${system.name} 星系摘要`}
    >
      <span className="system-brief__line" />
      <div className="system-brief__head">
        <span>
          <i />
          已选中星系
        </span>
        <button type="button" onClick={onClose} aria-label="取消选中该星系">
          <CloseIcon />
        </button>
      </div>
      <p className="system-brief__code">
        SYS · {system.index} / {system.latin}
      </p>
      <h3>{system.name}</h3>
      <p>{system.description}</p>
      <div className="system-brief__note">
        <span>未接入</span>
        <p>
          该星系尚未接入真实架构数据；P1.1 未扫描该仓库。当前显示的模块与关系仅为
          {dataSource === 'demo' ? ' P0.1 演示构图。' : '画布演示构图，不代表真实依赖。'}
        </p>
      </div>
    </aside>
  );
}
