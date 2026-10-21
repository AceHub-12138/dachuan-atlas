import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  applyProjectionFilter,
  DEFAULT_PROJECTION_FILTER,
  EVIDENCE_LABELS,
  EVIDENCE_ORDER,
  EVIDENCE_SHORT_LABELS,
  edgeEvidenceSummary,
  fileProjection,
  findDatasetPath,
  moduleProjection,
  nodeStatusLabel,
  projectionNeighbors,
  projectionRelationLabel,
  symbolProjection,
  type DatasetPath,
  type GraphProjection,
  type ProjectionEdge,
  type ProjectionFilter,
  type ProjectionNode,
} from '../architecture/projection';
import { RELATION_TYPE_LABELS, searchNodes, type ReviewGroup } from '../architecture/query';
import {
  REVIEW_LABELS,
  reviewLabel,
  type AtlasDataset,
  type AtlasModuleId,
  type AtlasNode,
} from '../architecture/schema';
import { ProjectionCanvasScene, type ProjectionCanvasMetrics } from '../scene/ProjectionCanvas';
import type { MotionMode } from '../scene/AtlasScene';
import { ArrowRight, CloseIcon } from './Icons';

declare global {
  interface Window {
    __ATLAS_GRAPH_METRICS__?: ProjectionCanvasMetrics;
  }
}

type GraphFocus =
  | { level: 'module' }
  | { level: 'file'; moduleId: AtlasModuleId }
  | { level: 'symbol'; moduleId: AtlasModuleId; file: string };

type GraphSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

interface GraphWorkspaceProps {
  dataset: AtlasDataset;
  motion: MotionMode;
  initialModuleId?: AtlasModuleId;
  initialEdgeId?: string;
  onClose: () => void;
}

interface PathHighlight {
  nodeIds: string[];
  edgeIds: string[];
}

function shortFileName(file: string): string {
  return file.split('/').pop() ?? file;
}

function moduleName(dataset: AtlasDataset, moduleId: AtlasModuleId | null): string {
  if (!moduleId) return '未归属';
  return dataset.modules.find((module) => module.id === moduleId)?.name ?? moduleId;
}

function evidenceChipClass(edge: ProjectionEdge): string {
  return `graph-evidence graph-evidence--${edge.evidenceClass}`;
}

export function GraphWorkspace({
  dataset,
  motion,
  initialModuleId,
  initialEdgeId,
  onClose,
}: GraphWorkspaceProps) {
  const initialModule = moduleProjection(dataset);
  const initialEdge = initialEdgeId
    ? initialModule.edges.find((edge) => edge.id === initialEdgeId) ?? null
    : null;
  const [focus, setFocus] = useState<GraphFocus>(
    initialModuleId ? { level: 'file', moduleId: initialModuleId } : { level: 'module' },
  );
  const [filter, setFilter] = useState<ProjectionFilter>(DEFAULT_PROJECTION_FILTER);
  const [selection, setSelection] = useState<GraphSelection>(
    initialEdge ? { kind: 'edge', id: initialEdge.id } : null,
  );
  const [pathHighlight, setPathHighlight] = useState<PathHighlight>({ nodeIds: [], edgeIds: [] });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ProjectionCanvasScene | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const callbacksRef = useRef({
    onSelectNode: (nodeId: string) => setSelection({ kind: 'node', id: nodeId }),
    onSelectEdge: (edgeId: string) => setSelection({ kind: 'edge', id: edgeId }),
    onBackgroundClick: () => setSelection(null),
  });

  const baseProjection = useMemo(() => {
    if (focus.level === 'module') return moduleProjection(dataset);
    if (focus.level === 'file') return fileProjection(dataset, focus.moduleId);
    return symbolProjection(dataset, focus.moduleId, focus.file);
  }, [dataset, focus]);
  const projection = useMemo(
    () => applyProjectionFilter(baseProjection, filter),
    [baseProjection, filter],
  );

  const selectedEdge =
    selection?.kind === 'edge'
      ? projection.edges.find((edge) => edge.id === selection.id) ?? null
      : null;
  const selectedNode =
    selection?.kind === 'node'
      ? projection.nodes.find((node) => node.id === selection.id) ?? null
      : null;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new ProjectionCanvasScene({
      canvas,
      projection,
      motion,
      selection: {
        nodeId: selectedNode?.id ?? null,
        edgeId: selectedEdge?.id ?? null,
        pathNodeIds: pathHighlight.nodeIds,
        pathEdgeIds: pathHighlight.edgeIds,
      },
      onSelectNode: (nodeId) => callbacksRef.current.onSelectNode(nodeId),
      onSelectEdge: (edgeId) => callbacksRef.current.onSelectEdge(edgeId),
      onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
      onMetrics: (metrics) => {
        window.__ATLAS_GRAPH_METRICS__ = metrics;
        canvas.dataset.nodes = String(metrics.nodes);
        canvas.dataset.edges = String(metrics.edges);
      },
    });
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
      delete window.__ATLAS_GRAPH_METRICS__;
    };
    // The scene owns the canvas for the dialog lifetime; projection changes are
    // applied through setProjection below, not by recreating the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setProjection(projection);
  }, [projection]);

  useEffect(() => {
    sceneRef.current?.setMotion(motion);
  }, [motion]);

  useEffect(() => {
    sceneRef.current?.setSelection({
      nodeId: selectedNode?.id ?? null,
      edgeId: selectedEdge?.id ?? null,
      pathNodeIds: pathHighlight.nodeIds,
      pathEdgeIds: pathHighlight.edgeIds,
    });
  }, [selectedNode, selectedEdge, pathHighlight]);

  useEffect(() => {
    if (selection?.kind === 'edge' && !projection.edges.some((edge) => edge.id === selection.id)) {
      setSelection(null);
    }
    if (selection?.kind === 'node' && !projection.nodes.some((node) => node.id === selection.id)) {
      setSelection(null);
    }
  }, [projection, selection]);

  const changeFocus = (next: GraphFocus) => {
    setFocus(next);
    setSelection(null);
    setPathHighlight({ nodeIds: [], edgeIds: [] });
  };

  const drillNode = (node: ProjectionNode) => {
    if (node.level === 'module' && node.moduleId) {
      changeFocus({ level: 'file', moduleId: node.moduleId });
      return;
    }
    if (node.level === 'file') {
      const moduleId =
        node.moduleId ??
        (focus.level === 'module' ? null : focus.moduleId);
      if (moduleId) changeFocus({ level: 'symbol', moduleId, file: node.entityId });
    }
  };

  const breadcrumb = (
    <nav className="graph-breadcrumb" aria-label="关系投影层级">
      <button
        type="button"
        onClick={() => changeFocus({ level: 'module' })}
        className={focus.level === 'module' ? 'is-current' : undefined}
      >
        全部模块
      </button>
      {focus.level !== 'module' ? (
        <>
          <span>/</span>
          <button
            type="button"
            onClick={() => changeFocus({ level: 'file', moduleId: focus.moduleId })}
            className={focus.level === 'file' ? 'is-current' : undefined}
          >
            {moduleName(dataset, focus.moduleId)}
          </button>
        </>
      ) : null}
      {focus.level === 'symbol' ? (
        <>
          <span>/</span>
          <span className="is-current" aria-current="page">
            {shortFileName(focus.file)}
          </span>
        </>
      ) : null}
      <em>{focus.level === 'module' ? '模块层级' : focus.level === 'file' ? '文件层级' : '符号层级'}</em>
    </nav>
  );

  const nodeList = (
    <div className="graph-node-list" aria-label="当前层级节点">
      <div className="graph-node-list__head">
        <span>节点</span>
        <span>{projection.nodes.length}</span>
      </div>
      {projection.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={`graph-node-row ${selection?.kind === 'node' && selection.id === node.id ? 'is-active' : ''}`}
          onClick={() => setSelection({ kind: 'node', id: node.id })}
        >
          <span className={`graph-node-dot graph-node-dot--${node.level}`} data-distributed={node.distributed || undefined} />
          <span className="graph-node-row__main">
            <strong>{node.label}</strong>
            <small>{nodeStatusLabel(node)}</small>
          </span>
          <em>{node.relationCount}</em>
          {node.level !== 'symbol' ? (
            <span
              className="graph-node-row__drill"
              role="button"
              tabIndex={0}
              aria-label={`进入 ${node.label} 的下一层`}
              onClick={(event) => {
                event.stopPropagation();
                drillNode(node);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  drillNode(node);
                }
              }}
            >
              <ArrowRight />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="graph-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="graph-dialog__head">
          <div>
            <span className="voice-panel__kicker">GRAPH PROJECTION · P1.2</span>
            <h2 id="graph-title">架构投影</h2>
          </div>
          <div className="graph-dialog__head-right">
            <span className={`source-flag ${projection.simulated ? '' : 'source-flag--real'}`}>
              {projection.simulated ? '演示构图' : `本地快照 · ${projection.snapshotShort ?? '未知'}`}
            </span>
            <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭架构投影">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="graph-toolbar">
          {breadcrumb}
          <div className="graph-filters">
            <label>
              <span>类型</span>
              <select
                value={filter.typeGroup}
                onChange={(event) =>
                  setFilter({ ...filter, typeGroup: event.target.value as ProjectionFilter['typeGroup'] })
                }
              >
                <option value="all">全部</option>
                <option value="calls">调用</option>
                <option value="imports">导入</option>
                <option value="contains">包含</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              <span>审核</span>
              <select
                value={filter.reviewGroup}
                onChange={(event) =>
                  setFilter({ ...filter, reviewGroup: event.target.value as ReviewGroup })
                }
              >
                <option value="all">全部</option>
                <option value="ai">AI 源码复核</option>
                <option value="human">独立人工审核</option>
                <option value="unverified">待核实</option>
              </select>
            </label>
            <label>
              <span>证据</span>
              <select
                value={filter.evidenceClass}
                onChange={(event) =>
                  setFilter({
                    ...filter,
                    evidenceClass: event.target.value as ProjectionFilter['evidenceClass'],
                  })
                }
              >
                <option value="all">全部</option>
                {EVIDENCE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {EVIDENCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="graph-body">
          <div className="graph-stage">
            <canvas
              ref={canvasRef}
              className="graph-stage__canvas"
              aria-label="架构关系投影画布。节点和连线来自本地 ATLAS 标准数据；背景星点与轨道为装饰。"
            />
            <div className="graph-stage__banner">
              <span className="status-dot" />
              <span>
                {projection.simulated
                  ? '演示模式：没有真实关系，只保留模块节点。导入本地快照后启用投影。'
                  : `${projection.stats.edgeCount} 条聚合边 · ${projection.stats.relationCount} 条关系 · 当前层级最多渲染 ${projection.nodes.length} 个节点`}
              </span>
            </div>
            <div className="graph-stage__foot">
              <span>连线为静态证据；不绘制运行时调用顺序</span>
              <span>背景星点 / 轨道为装饰</span>
            </div>
            {projection.omitted.note ? (
              <p className="graph-stage__omitted">{projection.omitted.note}</p>
            ) : null}
          </div>

          <aside className="graph-side">
            <div className="graph-side__scroll">
              {selectedEdge ? (
                <EdgeDetail
                  edge={selectedEdge}
                  projection={projection}
                  dataset={dataset}
                  onSelectNode={(id) => {
                    if (projection.nodes.some((node) => node.id === id)) {
                      setSelection({ kind: 'node', id });
                    }
                  }}
                />
              ) : selectedNode ? (
                <NodeDetail
                  node={selectedNode}
                  projection={projection}
                  dataset={dataset}
                  onDrill={() => drillNode(selectedNode)}
                  onSelectNode={(id) => {
                    if (projection.nodes.some((node) => node.id === id)) {
                      setSelection({ kind: 'node', id });
                    }
                  }}
                />
              ) : (
                <Overview projection={projection} dataset={dataset} />
              )}

              {nodeList}

              <PathQuery
                dataset={dataset}
                projection={projection}
                filter={filter}
                onHighlight={setPathHighlight}
              />
            </div>
          </aside>
        </div>

        <footer className="graph-dialog__foot">
          <div className="graph-legend">
            {EVIDENCE_ORDER.map((value) => (
              <span key={value} className={`graph-legend__item graph-legend__item--${value}`}>
                <i />
                {EVIDENCE_LABELS[value]}
              </span>
            ))}
            <span className="graph-legend__item graph-legend__item--mixed">
              <i>?</i>
              待核实叠加
            </span>
          </div>
          <span>
            {projection.sourceLabel} · 仅代表该历史提交；未显示的关系不等于不存在。
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function Overview({ projection, dataset }: { projection: GraphProjection; dataset: AtlasDataset }) {
  return (
    <section className="graph-detail">
      <span className="graph-detail__kicker">CURRENT LAYER</span>
      <h3>{projection.scopeLabel}</h3>
      <p className="graph-detail__lede">
        默认从模块层开始，点击节点查看详情，再进入文件与符号层。画布不会一次渲染全部
        {dataset.nodes.length.toLocaleString('zh-CN')} 个节点。
      </p>
      <div className="graph-stat-grid">
        <div>
          <strong>{projection.nodes.length}</strong>
          <span>可见节点</span>
        </div>
        <div>
          <strong>{projection.stats.edgeCount}</strong>
          <span>聚合边</span>
        </div>
        <div>
          <strong>{projection.stats.relationCount}</strong>
          <span>底层关系</span>
        </div>
        <div>
          <strong>{projection.stats.unverified}</strong>
          <span>待核实关系</span>
        </div>
      </div>
      <div className="graph-evidence-summary">
        <span>{EVIDENCE_SHORT_LABELS['ai-reviewed']} {projection.stats.aiReviewed}</span>
        <span>{EVIDENCE_SHORT_LABELS['human-reviewed']} {projection.stats.humanReviewed}</span>
        <span>{EVIDENCE_SHORT_LABELS.extracted} {projection.stats.extracted}</span>
        <span>{EVIDENCE_SHORT_LABELS.inferred} {projection.stats.inferred}</span>
        <span>{EVIDENCE_SHORT_LABELS.unverified} {projection.stats.unverified}</span>
      </div>
      <ul className="graph-notes">
        {projection.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {projection.nodes.some((node) => node.distributed) ? (
        <p className="graph-distributed-note">
          Canvas 渲染标注为“分布式能力集合”：它没有主归属节点，不能当作独立业务子系统。
        </p>
      ) : null}
    </section>
  );
}

function NodeDetail({
  node,
  projection,
  dataset,
  onDrill,
  onSelectNode,
}: {
  node: ProjectionNode;
  projection: GraphProjection;
  dataset: AtlasDataset;
  onDrill: () => void;
  onSelectNode: (id: string) => void;
}) {
  const upstream = projectionNeighbors(projection, node.id, 'in');
  const downstream = projectionNeighbors(projection, node.id, 'out');
  const entity =
    node.level === 'symbol' ? dataset.nodes.find((candidate) => candidate.id === node.entityId) ?? null : null;
  const fileNodes =
    node.level === 'file'
      ? dataset.nodes
          .filter((candidate) => candidate.sourceFile === node.entityId && candidate.scope === 'product')
          .slice()
          .sort((a, b) => (a.sourceLine ?? 0) - (b.sourceLine ?? 0))
          .slice(0, 8)
      : [];

  return (
    <section className="graph-detail">
      <span className="graph-detail__kicker">
        {node.level === 'module' ? 'MODULE' : node.level === 'file' ? 'FILE' : 'SYMBOL'} · {node.moduleId ? moduleName(dataset, node.moduleId) : '未归属'}
      </span>
      <h3>{node.label}</h3>
      <code className="graph-detail__code">{node.sublabel}</code>
      <div className="graph-detail__badges">
        <span className={`review-badge review-badge--${node.review.replace('_', '-')}`}>
          {REVIEW_LABELS[node.review]}
        </span>
        <span className="graph-chip">{nodeStatusLabel(node)}</span>
        {node.distributed ? <span className="graph-chip graph-chip--warn">分布式能力集合</span> : null}
      </div>
      <p className="graph-detail__lede">
        {node.level === 'module'
          ? '模块层级只聚合有主归属的产品节点关系；Canvas 支撑节点不会重复计入模块。'
          : node.level === 'file'
            ? '文件层级展示当前模块直接相连的文件。进入下一步可查看文件内符号。'
            : '符号层级展示当前文件内关系最多的符号，以及最多 8 个直接关联符号。'}
      </p>
      <div className="graph-stat-grid">
        <div>
          <strong>{node.nodeCount}</strong>
          <span>{node.level === 'module' ? '主归属节点' : node.level === 'file' ? '文件内节点' : '节点'}</span>
        </div>
        <div>
          <strong>{node.relationCount}</strong>
          <span>可见边</span>
        </div>
        <div>
          <strong>{upstream.length}</strong>
          <span>上游</span>
        </div>
        <div>
          <strong>{downstream.length}</strong>
          <span>下游</span>
        </div>
      </div>

      {node.level !== 'symbol' ? (
        <button type="button" className="graph-primary-action" onClick={onDrill}>
          <span>{node.level === 'module' ? '进入文件层级' : '进入符号层级'}</span>
          <ArrowRight />
        </button>
      ) : null}

      {entity ? (
        <details className="graph-source" open>
          <summary>源码证据</summary>
          <dl>
            <div>
              <dt>文件</dt>
              <dd><code>{entity.sourceFile ?? '外部引用'}</code></dd>
            </div>
            <div>
              <dt>行号</dt>
              <dd>{entity.sourceLine ?? '未知'}</dd>
            </div>
            <div>
              <dt>审核</dt>
              <dd>{reviewLabel(entity.review)} · {entity.review.actor ?? '主体未记录'} · {entity.review.reviewedAt ?? '时间未记录'}</dd>
            </div>
          </dl>
          <ul>
            {entity.evidence.map((evidence) => (
              <li key={evidence.locator}>
                <code>{evidence.locator}</code>
                <span>{evidence.symbol ?? '源码位置'}</span>
              </li>
            ))}
            {!entity.evidence.length ? <li>当前节点没有可展开的源码定位。</li> : null}
          </ul>
        </details>
      ) : null}

      {fileNodes.length ? (
        <div className="graph-file-nodes">
          <h4>文件内节点</h4>
          <ul>
            {fileNodes.map((candidate) => (
              <li key={candidate.id}>
                <strong>{candidate.displayName ?? candidate.symbol}</strong>
                <code>{candidate.symbol}</code>
                <span>{reviewLabel(candidate.review)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="graph-neighbors">
        <h4>上游 <em>{upstream.length}</em></h4>
        <ul>
          {upstream.slice(0, 6).map((item) => (
            <li key={`${item.edge.id}-${item.node.id}`}>
              <button type="button" onClick={() => onSelectNode(item.node.id)}>
                <span>{item.node.label}</span>
                <em>{item.edge.count} 条 · {EVIDENCE_SHORT_LABELS[item.edge.evidenceClass]}</em>
              </button>
            </li>
          ))}
          {!upstream.length ? <li className="graph-empty-line">当前投影没有入向关系。</li> : null}
        </ul>
        <h4>下游 <em>{downstream.length}</em></h4>
        <ul>
          {downstream.slice(0, 6).map((item) => (
            <li key={`${item.edge.id}-${item.node.id}`}>
              <button type="button" onClick={() => onSelectNode(item.node.id)}>
                <span>{item.node.label}</span>
                <em>{item.edge.count} 条 · {EVIDENCE_SHORT_LABELS[item.edge.evidenceClass]}</em>
              </button>
            </li>
          ))}
          {!downstream.length ? <li className="graph-empty-line">当前投影没有出向关系。</li> : null}
        </ul>
      </div>
      <p className="graph-detail__note">
        上游 / 下游只按数据集中已记录的关系方向统计；没有边不等于不存在调用。
      </p>
    </section>
  );
}

function EdgeDetail({
  edge,
  projection,
  dataset,
  onSelectNode,
}: {
  edge: ProjectionEdge;
  projection: GraphProjection;
  dataset: AtlasDataset;
  onSelectNode: (id: string) => void;
}) {
  return (
    <section className="graph-detail">
      <span className="graph-detail__kicker">RELATION EVIDENCE</span>
      <h3>
        {edge.fromLabel} <ArrowRight /> {edge.toLabel}
      </h3>
      <div className="graph-detail__badges">
        <span className={evidenceChipClass(edge)}>{EVIDENCE_LABELS[edge.evidenceClass]}</span>
        <span className="graph-chip">{edge.count} 条关系</span>
        <span className="graph-chip">{REVIEW_LABELS[edge.reviewStatus]}</span>
        {edge.mixed ? <span className="graph-chip graph-chip--warn">混合证据</span> : null}
      </div>
      <div className="graph-evidence-grid">
        {EVIDENCE_ORDER.map((value) => (
          <div key={value} data-zero={edge.evidenceCounts[value] === 0 || undefined}>
            <strong>{edge.evidenceCounts[value]}</strong>
            <span>{EVIDENCE_SHORT_LABELS[value]}</span>
          </div>
        ))}
      </div>
      <p className="graph-detail__lede">
        这条线是由 {edge.count} 条底层关系聚合而成：{edgeEvidenceSummary(edge)}。每条关系都保留源码定位，可展开核对。
      </p>
      <div className="graph-edge-actions">
        <button
          type="button"
          onClick={() => onSelectNode(edge.from)}
          disabled={!projection.nodes.some((node) => node.id === edge.from)}
        >
          查看起点
        </button>
        <button
          type="button"
          onClick={() => onSelectNode(edge.to)}
          disabled={!projection.nodes.some((node) => node.id === edge.to)}
        >
          查看终点
        </button>
      </div>
      <h4 className="graph-samples__title">关系样本与源码证据</h4>
      <ul className="graph-samples">
        {edge.samples.map((sample) => (
          <li key={sample.id}>
            <details>
              <summary>
                <span>{projectionRelationLabel(sample)}</span>
                <strong>
                  {sample.fromLabel} → {sample.toLabel}
                </strong>
                <em>{reviewLabel({
                  status: sample.status,
                  method: sample.method,
                  actor: null,
                  reviewer: null,
                  reviewedAt: null,
                  note: null,
                  evidence: [],
                })}</em>
              </summary>
              <dl>
                <div>
                  <dt>源码定位</dt>
                  <dd><code>{sample.locator ?? '缺失'}</code></dd>
                </div>
                <div>
                  <dt>原始类型</dt>
                  <dd>{sample.type}</dd>
                </div>
                <div>
                  <dt>上下文</dt>
                  <dd>{sample.context ?? '未记录'}</dd>
                </div>
                <div>
                  <dt>关系 ID</dt>
                  <dd><code>{sample.id}</code></dd>
                </div>
                <div>
                  <dt>审核</dt>
                  <dd>{reviewLabel({
                    status: sample.status,
                    method: sample.method,
                    actor: null,
                    reviewer: null,
                    reviewedAt: null,
                    note: null,
                    evidence: [],
                  })} · {REVIEW_LABELS[sample.status]}</dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ul>
      <p className="graph-detail__note">
        共 {edge.count} 条关系，这里列出 {edge.samples.length} 条证据样本。聚合边不代表运行时调用顺序；
        如需逐条浏览全部关系，请使用模块详情中的关系探索。
        <span className="graph-detail__dataset"> 数据集：{dataset.source.label}</span>
      </p>
    </section>
  );
}

function PathQuery({
  dataset,
  projection,
  filter,
  onHighlight,
}: {
  dataset: AtlasDataset;
  projection: GraphProjection;
  filter: ProjectionFilter;
  onHighlight: (highlight: PathHighlight) => void;
}) {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [fromNode, setFromNode] = useState<AtlasNode | null>(null);
  const [toNode, setToNode] = useState<AtlasNode | null>(null);
  const [result, setResult] = useState<DatasetPath | null>(null);
  const [searched, setSearched] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const fromResults = useMemo(
    () => (fromQuery.trim() ? searchNodes(dataset, fromQuery, { limit: 5 }) : []),
    [dataset, fromQuery],
  );
  const toResults = useMemo(
    () => (toQuery.trim() ? searchNodes(dataset, toQuery, { limit: 5 }) : []),
    [dataset, toQuery],
  );

  useEffect(() => {
    setResult(null);
    setSearched(false);
    onHighlight({ nodeIds: [], edgeIds: [] });
    // Filter changes invalidate the previous path; selection changes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, projection.level, projection.focus.moduleId, projection.focus.file]);

  useEffect(() => {
    if (!searched) return;
    resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [searched, result]);

  const run = () => {
    if (!fromNode || !toNode) return;
    const path = findDatasetPath(dataset, fromNode.id, toNode.id, { filter, maxDepth: 6 });
    setResult(path);
    setSearched(true);
    if (!path) {
      onHighlight({ nodeIds: [], edgeIds: [] });
      return;
    }
    const stepRelationIds = new Set(
      path.steps.map((step) => step.relation?.id).filter((id): id is string => !!id),
    );
    const nodeIds = new Set<string>();
    for (const node of path.nodes) {
      if (projection.level === 'symbol') nodeIds.add(node.id);
      else if (projection.level === 'file' && node.sourceFile) nodeIds.add(node.sourceFile);
      else if (projection.level === 'module' && node.moduleId) nodeIds.add(`module:${node.moduleId}`);
    }
    const edgeIds = projection.edges
      .filter((edge) => edge.facts.some((fact) => stepRelationIds.has(fact.id)))
      .map((edge) => edge.id);
    onHighlight({ nodeIds: [...nodeIds], edgeIds });
  };

  const clear = () => {
    setResult(null);
    setSearched(false);
    setFromQuery('');
    setToQuery('');
    setFromNode(null);
    setToNode(null);
    onHighlight({ nodeIds: [], edgeIds: [] });
  };

  return (
    <section className="graph-path">
      <div className="graph-path__head">
        <div>
          <span className="graph-detail__kicker">PATH QUERY · STATIC GRAPH</span>
          <h4>关系路径查询</h4>
        </div>
        {searched ? (
          <button type="button" onClick={clear}>
            清除
          </button>
        ) : null}
      </div>
      <p>
        在标准数据集中搜索两个已知节点之间的既有关系。路径按无向关联搜索，只说明图谱中存在怎样的静态关系。
      </p>
      <div className="graph-path__fields">
        <NodePicker
          label="起点"
          query={fromQuery}
          setQuery={setFromQuery}
          selected={fromNode}
          setSelected={setFromNode}
          results={fromResults}
        />
        <NodePicker
          label="终点"
          query={toQuery}
          setQuery={setToQuery}
          selected={toNode}
          setSelected={setToNode}
          results={toResults}
        />
      </div>
      <button
        type="button"
        className="graph-primary-action"
        disabled={!fromNode || !toNode || fromNode.id === toNode.id}
        onClick={run}
      >
        查找已有关系路径
      </button>
      <div ref={resultRef}>
      {searched ? (
        result ? (
          <div className="graph-path__result">
            <div className="graph-path__result-head">
              <strong>找到 {result.nodes.length} 个节点、{result.steps.length - 1} 步关系</strong>
              <span>不是唯一路径</span>
            </div>
            <ol>
              {result.steps.map((step, index) => (
                <li key={`${step.node.id}-${index}`}>
                  <span className="graph-path__node">{step.node.displayName ?? step.node.symbol}</span>
                  {step.relation ? (
                    <span className="graph-path__edge">
                      {step.direction === 'out' ? '→' : '←'}{' '}
                      {RELATION_TYPE_LABELS[step.relation.type] ?? step.relation.type} ·{' '}
                      {EVIDENCE_SHORT_LABELS[
                        step.relation.review.method === 'ai-source-review'
                          ? 'ai-reviewed'
                          : step.relation.review.method === 'human-review'
                            ? 'human-reviewed'
                            : step.relation.review.method === 'graphify-inferred'
                              ? 'inferred'
                              : step.relation.review.method === 'graphify-extracted'
                                ? 'extracted'
                                : 'unverified'
                      ]}
                      <code>{step.relation.evidence?.locator ?? '定位缺失'}</code>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <p>{result.note}</p>
            {result.nodes.some((node) => !projection.nodes.some((visible) => visible.id === node.id)) &&
            projection.level === 'symbol' ? (
              <p className="graph-path__hint">路径包含当前符号层级之外的节点，画布只高亮当前可见部分。</p>
            ) : null}
          </div>
        ) : (
          <div className="graph-path__empty" role="status">
            <strong>当前图谱未发现关系路径</strong>
            <p>
              这不表示两个模块没有关系，只表示当前标准数据集中没有找到已记录的关系路径；也可能被当前筛选条件排除。
            </p>
          </div>
        )
      ) : null}
      </div>
    </section>
  );
}

function NodePicker({
  label,
  query,
  setQuery,
  selected,
  setSelected,
  results,
}: {
  label: string;
  query: string;
  setQuery: (value: string) => void;
  selected: AtlasNode | null;
  setSelected: (node: AtlasNode | null) => void;
  results: AtlasNode[];
}) {
  return (
    <div className="graph-path__field">
      <span>{label}</span>
      {selected ? (
        <div className="graph-path__selected">
          <strong>{selected.displayName ?? selected.symbol}</strong>
          <code>{selected.symbol}</code>
          <button type="button" onClick={() => setSelected(null)} aria-label={`清除${label}`}>
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="中文名、文件名或符号"
          />
          {results.length ? (
            <div className="graph-path__suggestions">
              {results.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => {
                    setSelected(node);
                    setQuery('');
                  }}
                >
                  <span>{node.displayName ?? node.symbol}</span>
                  <code>{node.sourceFile ? shortFileName(node.sourceFile) : node.symbol}</code>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
