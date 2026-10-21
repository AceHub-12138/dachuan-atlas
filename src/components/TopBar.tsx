import { AtlasMark, ChevronRight, InfoIcon, MockDataset } from './Icons';
import { MotionControl } from './MotionControl';
import type { MotionMode } from '../scene/AtlasScene';

export type AppLevel = 'universe' | 'nexus' | 'module';
export type TopBarDataSource = 'demo' | 'nexus-snapshot';
export type TopBarDataStatus = 'ready' | 'loading' | 'error';

interface TopBarProps {
  level: AppLevel;
  motion: MotionMode;
  dataSource: TopBarDataSource;
  dataStatus: TopBarDataStatus;
  snapshotShort: string | null;
  moduleName: string | null;
  onMotionChange: (mode: MotionMode) => void;
  onGoHome: () => void;
  onGoNexus: () => void;
  onOpenAbout: () => void;
  onOpenData: () => void;
}

export function TopBar({
  level,
  motion,
  dataSource,
  dataStatus,
  snapshotShort,
  moduleName,
  onMotionChange,
  onGoHome,
  onGoNexus,
  onOpenAbout,
  onOpenData,
}: TopBarProps) {
  const dataLabel =
    dataSource === 'demo'
      ? '演示数据'
      : dataStatus === 'loading'
        ? '读取本地数据…'
        : dataStatus === 'error'
          ? '本地数据不可用'
          : `本地快照 · ${snapshotShort ?? '未知'}`;

  return (
    <header className="topbar">
      <div className="brand">
        <button type="button" className="brand__home" onClick={onGoHome} aria-label="返回 DACHUAN ATLAS 首页">
          <AtlasMark className="brand__mark" />
          <span className="brand__type">
            <span className="brand__wordmark">
              DACHUAN <strong>ATLAS</strong>
            </span>
            <span className="brand__sub">大川项目架构星图</span>
          </span>
        </button>
      </div>

      <div className="topbar__context">
        {level === 'universe' ? (
          <div className="context-idle">
            <span className="context-idle__pulse" />
            <span>系统宇宙</span>
            <span className="context-idle__latin">SYSTEM UNIVERSE</span>
          </div>
        ) : (
          <nav className="breadcrumb" aria-label="层级导航">
            <button type="button" onClick={onGoHome}>
              系统宇宙
            </button>
            <ChevronRight />
            <button type="button" onClick={onGoNexus} className={level === 'nexus' ? 'is-current' : undefined}>
              NEXUS 模块星系
            </button>
            {level === 'module' ? (
              <>
                <ChevronRight />
                <span aria-current="page">{moduleName ?? '模块详情'}</span>
              </>
            ) : null}
          </nav>
        )}
      </div>

      <div className="topbar__actions">
        <button
          type="button"
          className="mock-badge source-badge"
          data-source={dataSource}
          data-status={dataStatus}
          onClick={onOpenData}
          aria-label={`当前数据来源：${dataLabel}。打开架构数据面板`}
        >
          <MockDataset />
          {dataLabel}
        </button>
        <button type="button" className="about-trigger" onClick={onOpenAbout}>
          <InfoIcon />
          <span>原型说明</span>
        </button>
        <div className="topbar__divider" aria-hidden="true" />
        <MotionControl motion={motion} onChange={onMotionChange} />
      </div>
    </header>
  );
}
