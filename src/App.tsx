import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODULE_BY_ID, SYSTEM_BY_ID } from './data/atlas';
import type { ModuleId, SystemId } from './data/atlas';
import { AboutDialog } from './components/AboutDialog';
import { ArchitecturePanel } from './components/ArchitecturePanel';
import { BottomRail } from './components/BottomRail';
import { ComprehensionDialog } from './components/ComprehensionDialog';
import { FlowDialog } from './components/FlowDialog';
import { GraphWorkspace } from './components/GraphWorkspace';
import { HomeIntro } from './components/HomeIntro';
import { ModulePanel } from './components/ModulePanel';
import { NexusIntro } from './components/NexusIntro';
import { SceneStage } from './components/SceneStage';
import { SystemBrief } from './components/SystemBrief';
import { TopBar } from './components/TopBar';
import type { AppLevel } from './components/TopBar';
import { useArchitectureData } from './hooks/useArchitectureData';
import { useMotionMode } from './hooks/useMotionMode';
import { moduleProjection } from './architecture/projection';
import type { SceneSelection } from './scene/AtlasScene';

interface GraphOpenRequest {
  initialModuleId?: ModuleId;
  initialEdgeId?: string;
}

export default function App() {
  const { motion, setMotionMode } = useMotionMode();
  const architecture = useArchitectureData();
  const [level, setLevel] = useState<AppLevel>('universe');
  const [selectedSystem, setSelectedSystem] = useState<SystemId | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleId | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState<GraphOpenRequest | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [showGraphLinks, setShowGraphLinks] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const moduleGraph = useMemo(() => moduleProjection(architecture.dataset), [architecture.dataset]);
  const hasRealGraph = architecture.source === 'nexus-snapshot' && moduleGraph.edges.length > 0;
  const hasFlow = architecture.dataset.flows.length > 0;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 4200);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const lastDataError = useRef<string | null>(null);
  useEffect(() => {
    if (architecture.error && architecture.error !== lastDataError.current) {
      lastDataError.current = architecture.error;
      showNotice('本地架构数据读取失败，已保留演示数据。打开右上角数据徽标查看原因。');
    } else if (!architecture.error) {
      lastDataError.current = null;
    }
  }, [architecture.error, showNotice]);

  useEffect(() => {
    const onBlur = () => document.body.classList.add('is-unfocused');
    const onFocus = () => document.body.classList.remove('is-unfocused');
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    if (!document.hasFocus()) onBlur();
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.body.classList.remove('is-unfocused');
    };
  }, []);

  const goHome = useCallback(() => {
    setLevel('universe');
    setSelectedSystem(null);
    setSelectedModule(null);
    setNotice(null);
  }, []);

  const goNexus = useCallback(() => {
    setLevel('nexus');
    setSelectedSystem(null);
    setSelectedModule(null);
    setNotice(null);
  }, []);

  const openModule = useCallback(
    (id: ModuleId) => {
      setSelectedModule(id);
      setLevel('module');
      setNotice(null);
    },
    [],
  );

  const openGraph = useCallback(
    (request: GraphOpenRequest = {}) => {
      if (architecture.source !== 'nexus-snapshot') {
        setDataOpen(true);
        showNotice('架构投影需要本地 ATLAS 快照；请先导入 .atlas.json。');
        return;
      }
      setAboutOpen(false);
      setDataOpen(false);
      setGraphOpen(request);
    },
    [architecture.source, showNotice],
  );

  const openFlow = useCallback(
    (moduleId?: ModuleId) => {
      if (!hasFlow) {
        setDataOpen(true);
        showNotice('模块协作场景来自本地附加数据；当前快照没有可用的协作说明。');
        return;
      }
      const matching = moduleId
        ? architecture.dataset.flows.find((flow) => flow.entryModuleId === moduleId)
        : null;
      if (moduleId && !matching) {
        setDataOpen(true);
        showNotice('当前模块没有对应的模块协作场景。');
        return;
      }
      setAboutOpen(false);
      setDataOpen(false);
      setFlowOpen(true);
    },
    [architecture.dataset.flows, hasFlow, showNotice],
  );

  useEffect(() => {
    if (architecture.source === 'demo') {
      setGraphOpen(null);
      setFlowOpen(false);
    }
    setShowGraphLinks(true);
  }, [architecture.source]);

  const handleSelectNode = useCallback(
    (selection: SceneSelection) => {
      if (selection.kind === 'system') {
        const id = selection.id as SystemId;
        if (id === 'nexus') {
          goNexus();
        } else if (level === 'universe') {
          setSelectedSystem(id);
          setNotice(null);
        }
        return;
      }

      if (level === 'universe') return;
      openModule(selection.id as ModuleId);
    },
    [goNexus, level, openModule],
  );

  const handleBackgroundClick = useCallback(() => {
    if (level === 'module') {
      setLevel('nexus');
      return;
    }
    if (level === 'universe') {
      setSelectedSystem(null);
    }
  }, [level]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dataOpen || graphOpen || flowOpen || quizOpen) return;
      if (aboutOpen) {
        setAboutOpen(false);
        return;
      }
      if (level === 'module') {
        setLevel('nexus');
      } else if (level === 'nexus') {
        goHome();
      } else if (selectedSystem) {
        setSelectedSystem(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aboutOpen, dataOpen, flowOpen, goHome, graphOpen, level, quizOpen, selectedSystem]);

  const sceneView = level === 'universe' ? 'universe' : 'nexus';
  const activeModule = level === 'module' ? selectedModule : null;
  const selectedSystemData = selectedSystem ? SYSTEM_BY_ID[selectedSystem] : null;
  const selectedModuleName = selectedModule ? MODULE_BY_ID[selectedModule]?.name ?? null : null;

  return (
    <div className="app" data-level={level} data-motion={motion}>
      <div className="cosmos" aria-hidden="true">
        <div className="nebula nebula--warm" />
        <div className="nebula nebula--cool" />
        <div className="nebula nebula--veil" />
        <div className="cosmos__horizon" />
        <div className="cosmos__grain" />
      </div>

      <SceneStage
        view={sceneView}
        motion={motion}
        selectedSystem={level === 'universe' ? selectedSystem : null}
        activeModule={activeModule}
        graphProjection={architecture.source === 'nexus-snapshot' ? moduleGraph : null}
        showGraphLinks={showGraphLinks}
        onSelectNode={handleSelectNode}
        onSelectGraphEdge={(edgeId) => {
          if (hasRealGraph) openGraph({ initialEdgeId: edgeId });
        }}
        onBackgroundClick={handleBackgroundClick}
      />

      <div className="vignette" aria-hidden="true" />
      <div className="screen-frame" aria-hidden="true">
        <span className="screen-frame__corner screen-frame__corner--tl" />
        <span className="screen-frame__corner screen-frame__corner--tr" />
        <span className="screen-frame__corner screen-frame__corner--bl" />
        <span className="screen-frame__corner screen-frame__corner--br" />
        <span className="screen-frame__vertical">ARCHITECTURE / VISUAL INDEX / 2026</span>
      </div>

      <TopBar
        level={level}
        motion={motion}
        dataSource={architecture.source}
        dataStatus={architecture.status}
        snapshotShort={architecture.dataset.snapshot?.commitShort ?? null}
        moduleName={selectedModuleName}
        onMotionChange={setMotionMode}
        onGoHome={goHome}
        onGoNexus={goNexus}
        onOpenAbout={() => {
          setDataOpen(false);
          setAboutOpen(true);
        }}
        onOpenData={() => {
          setAboutOpen(false);
          setDataOpen(true);
        }}
      />

      <main className="scene-ui">
        <div
          className={`view-layer view-layer--home ${level === 'universe' ? 'is-active' : ''}`}
          aria-hidden={level !== 'universe' || undefined}
          inert={level !== 'universe' || undefined}
        >
          <HomeIntro onEnterNexus={goNexus} dataSource={architecture.source} />
          {selectedSystemData && !selectedSystemData.available ? (
            <SystemBrief
              system={selectedSystemData}
              dataSource={architecture.source}
              onClose={() => setSelectedSystem(null)}
            />
          ) : null}
        </div>

        <div
          className={`view-layer view-layer--nexus ${level !== 'universe' ? 'is-active' : ''}`}
          aria-hidden={level !== 'nexus' || undefined}
          inert={level !== 'nexus' || undefined}
        >
          <NexusIntro
            muted={level === 'module'}
            dataSource={architecture.source}
            modules={architecture.dataset.modules}
            graph={architecture.source === 'nexus-snapshot' ? moduleGraph : null}
            showGraphLinks={showGraphLinks}
            hasFlow={hasFlow}
            onBackHome={goHome}
            onOpenModule={openModule}
            onOpenGraph={() => openGraph()}
            onOpenFlow={() => openFlow()}
            onOpenQuiz={() => setQuizOpen(true)}
            onOpenData={() => setDataOpen(true)}
            onToggleGraphLinks={() => setShowGraphLinks((value) => !value)}
          />
        </div>

        {level === 'module' && selectedModule ? (
          <ModulePanel
            key={selectedModule}
            moduleId={selectedModule}
            data={architecture}
            hasFlow={hasFlow}
            onBack={() => setLevel('nexus')}
            onHome={goHome}
            onOpenGraph={openGraph}
            onOpenFlow={openFlow}
          />
        ) : null}
      </main>

      <BottomRail level={level} dataSource={architecture.source} />

      {notice ? (
        <div className="toast" role="status" aria-live="polite">
          <span className="status-dot" />
          <span>{notice}</span>
        </div>
      ) : null}

      {aboutOpen ? (
        <AboutDialog
          dataSource={architecture.source}
          snapshot={
            architecture.dataset.snapshot
              ? {
                  commitShort: architecture.dataset.snapshot.commitShort,
                  generatedAt: architecture.dataset.snapshot.generatedAt,
                }
              : null
          }
          onClose={() => setAboutOpen(false)}
          onOpenQuiz={() => {
            setAboutOpen(false);
            setQuizOpen(true);
          }}
        />
      ) : null}

      {dataOpen ? (
        <ArchitecturePanel data={architecture} onClose={() => setDataOpen(false)} />
      ) : null}

      {graphOpen ? (
        <GraphWorkspace
          dataset={architecture.dataset}
          motion={motion}
          initialModuleId={graphOpen.initialModuleId}
          initialEdgeId={graphOpen.initialEdgeId}
          onClose={() => setGraphOpen(null)}
        />
      ) : null}

      {flowOpen ? (
        <FlowDialog
          dataset={architecture.dataset}
          onClose={() => setFlowOpen(false)}
          onOpenData={() => {
            setFlowOpen(false);
            setDataOpen(true);
          }}
        />
      ) : null}

      {quizOpen ? <ComprehensionDialog onClose={() => setQuizOpen(false)} /> : null}
    </div>
  );
}
