import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AtlasScene } from '../scene/AtlasScene';
import type {
  MotionMode,
  SceneHover,
  SceneMetrics,
  SceneSelection,
  ViewLevel,
} from '../scene/AtlasScene';
import type { ModuleId, SystemId } from '../data/atlas';

interface SceneStageProps {
  view: ViewLevel;
  motion: MotionMode;
  selectedSystem: SystemId | null;
  activeModule: ModuleId | null;
  onSelectNode: (selection: SceneSelection) => void;
  onBackgroundClick: () => void;
}

declare global {
  interface Window {
    __ATLAS_METRICS__?: SceneMetrics;
  }
}

const TOOLTIP_WIDTH = 290;
const TOOLTIP_HEIGHT_ESTIMATE = 216;

const tooltipPosition = (hover: SceneHover) => {
  const margin = 24;
  const preferLeft = hover.anchor.x > window.innerWidth - TOOLTIP_WIDTH - 90;
  let left = preferLeft ? hover.anchor.x - TOOLTIP_WIDTH - 30 : hover.anchor.x + 30;
  left = Math.max(margin, Math.min(window.innerWidth - TOOLTIP_WIDTH - margin, left));
  let top = hover.anchor.y - 74;
  top = Math.max(
    96,
    Math.min(window.innerHeight - TOOLTIP_HEIGHT_ESTIMATE - 56, top),
  );
  return { left, top };
};

export function SceneStage({
  view,
  motion,
  selectedSystem,
  activeModule,
  onSelectNode,
  onBackgroundClick,
}: SceneStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AtlasScene | null>(null);
  const callbacksRef = useRef({ onSelectNode, onBackgroundClick });
  const [hover, setHover] = useState<SceneHover | null>(null);

  callbacksRef.current = { onSelectNode, onBackgroundClick };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new AtlasScene({
      canvas,
      onHover: (nextHover) => setHover(nextHover),
      onSelect: (selection) => callbacksRef.current.onSelectNode(selection),
      onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
      initialMotion: motion,
      onMetrics: (metrics) => {
        window.__ATLAS_METRICS__ = metrics;
        canvas.dataset.fps = String(metrics.fps);
        canvas.dataset.frameMs = String(metrics.frameMs);
      },
    });

    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
      delete window.__ATLAS_METRICS__;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    sceneRef.current?.setMotion(motion);
  }, [motion]);

  useEffect(() => {
    sceneRef.current?.setSelectedSystem(selectedSystem);
  }, [selectedSystem]);

  useEffect(() => {
    sceneRef.current?.setActiveModule(activeModule);
  }, [activeModule]);

  const visibleHover = activeModule ? null : hover;
  const position = visibleHover ? tooltipPosition(visibleHover) : null;

  return (
    <div className="scene-stage">
      <canvas
        ref={canvasRef}
        className="atlas-canvas"
        aria-label="DACHUAN ATLAS 交互式架构星图。使用页面上的按钮或鼠标悬停与点击探索。"
      />
      {visibleHover && position
        ? createPortal(
            <div
              className="node-tooltip"
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                ['--tooltip-accent' as string]: visibleHover.color,
              }}
              role="presentation"
            >
              <div className="node-tooltip__top">
                <span>{visibleHover.kind === 'system' ? '系统星系' : '模块'}</span>
                <span className="mini-mock">模拟</span>
              </div>
              <h3>{visibleHover.title}</h3>
              <span className="node-tooltip__latin">{visibleHover.latin}</span>
              <p>{visibleHover.description}</p>
              <div className="node-tooltip__meta">
                <i />
                <span>{visibleHover.meta}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
