import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModuleId } from '../data/atlas';
import { REVIEW_LABELS, reviewLabel, type AtlasNode, type AtlasReview } from '../architecture/schema';
import { moduleReviewCounts } from '../architecture/query';
import { edgeEvidenceSummary, moduleProjection } from '../architecture/projection';
import { explainModule } from '../architecture/plain';
import type { ArchitectureDataState } from '../hooks/useArchitectureData';
import { ArrowLeft, ArrowRight, CloseIcon } from './Icons';
import { PlainExplanationCard } from './PlainExplanationCard';
import { RelationExplorer } from './RelationExplorer';

interface ModulePanelProps {
  moduleId: ModuleId;
  data: ArchitectureDataState;
  hasFlow: boolean;
  onBack: () => void;
  onHome: () => void;
  onOpenGraph: (options: { initialModuleId?: ModuleId; initialEdgeId?: string }) => void;
  onOpenFlow: (moduleId: ModuleId) => void;
}

function componentNodeId(dataset: ArchitectureDataState['dataset'], file: string, symbol: string): string | null {
  const node = dataset.nodes.find(
    (candidate) =>
      candidate.sourceFile === file &&
      (candidate.symbol === symbol || candidate.symbol === `${symbol}()` || candidate.symbol === `.${symbol}()`),
  );
  return node?.id ?? null;
}

function evidenceLocator(node: AtlasNode): string {
  return node.evidence[0]?.locator ?? node.sourceFile ?? 'unknown';
}

function ReviewLine({ review }: { review: AtlasReview }) {
  return (
    <span className="module-review-line">
      <span>{reviewLabel(review)}</span>
      {review.actor ? <em>{review.actor}</em> : null}
      {review.reviewedAt ? <time dateTime={review.reviewedAt}>{review.reviewedAt}</time> : null}
    </span>
  );
}

export function ModulePanel({
  moduleId,
  data,
  hasFlow,
  onBack,
  onHome,
  onOpenGraph,
  onOpenFlow,
}: ModulePanelProps) {
  const [explorer, setExplorer] = useState<{ moduleId: ModuleId; nodeId?: string } | null>(null);
  const module = data.dataset.modules.find((item) => item.id === moduleId);
  const snapshot = data.source === 'nexus-snapshot' ? data.dataset.snapshot : null;
  const isReal = snapshot !== null;
  const counts = moduleReviewCounts(data.dataset, moduleId);
  const components = module?.keyComponents.slice(0, 5) ?? [];
  const moduleGraph = moduleProjection(data.dataset);
  const moduleEdges = isReal
    ? moduleGraph.edges.filter(
        (edge) => edge.from === `module:${moduleId}` || edge.to === `module:${moduleId}`,
      )
    : [];
  const moduleNames = new Map(data.dataset.modules.map((item) => [item.id, item.name]));
  const gaps = [...(module?.gaps ?? []), ...(module?.notes ?? [])].filter(
    (note, index, list) => note && list.indexOf(note) === index,
  );
  const compositionReview = module?.reviewRecord;
  const explanation = useMemo(
    () => explainModule(data.dataset, moduleId),
    [data.dataset, moduleId],
  );
  const evidenceRefs = module
    ? [
        ...new Map(
          module.evidence
            .flatMap((evidence) => evidence.sourceRefs)
            .map((ref) => [ref.locator, ref]),
        ).values(),
      ]
    : [];

  if (!module) return null;

  return (
    <>
      <aside
        className="voice-panel module-panel"
        aria-labelledby="module-panel-title"
        tabIndex={-1}
      >
        <div className="voice-panel__edge" aria-hidden="true" />
        <header className="voice-panel__header">
          <div>
            <span className="voice-panel__kicker">MODULE PROFILE</span>
            <span className="voice-panel__serial">
              {module.index} / 04
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onBack} aria-label="关闭详情并返回模块星系">
            <CloseIcon />
          </button>
        </header>

        <div className="voice-panel__scroll">
          <div className="voice-panel__status">
            <span className="status-dot" />
            <span>
              {snapshot
                ? `NEXUS 本地历史快照 · ${snapshot.commitShort}`
                : '演示模块 · 无源码证据'}
            </span>
          </div>
          <h2 id="module-panel-title">{module.name}</h2>
          <p className="voice-panel__latin">{module.latin}</p>

          {explanation ? <PlainExplanationCard explanation={explanation} /> : null}

          {moduleId === 'voice' ? (
            <div className="voice-wave" aria-hidden="true">
              {Array.from({ length: 36 }).map((_, index) => (
                <span
                  key={index}
                  style={{
                    ['--wave-height' as string]: `${18 + ((index * 17) % 63)}%`,
                    ['--wave-delay' as string]: `${(index % 9) * -0.13}s`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="module-panel__divider" aria-hidden="true">
              <span />
              {moduleId === 'canvas' ? 'DISTRIBUTED CANVAS 2D' : 'VERIFIED MODULE'}
            </div>
          )}

          <section className="panel-section panel-section--purpose">
            <div className="panel-section__head">
              <span>01</span>
              <h3>它做什么</h3>
              <em>{isReal ? '源码职责' : '演示说明'}</em>
            </div>
            <p className="module-panel__description">{module.description}</p>
            <ul className="module-does">
              {module.responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="panel-section">
            <div className="panel-section__head">
              <span>02</span>
              <h3>组成与关系</h3>
              <em>分开呈现</em>
            </div>
            <div className="module-review-grid">
              <div className="module-review-box">
                <span className="module-review-box__label">组成</span>
                <strong>{compositionReview ? `${reviewLabel(compositionReview)} · ${REVIEW_LABELS[module.review]}` : REVIEW_LABELS[module.review]}</strong>
                {compositionReview ? <ReviewLine review={compositionReview} /> : null}
                <p>{module.notes[0] ?? '模块边界以源码路径为准。'}</p>
              </div>
              <div className="module-review-box">
                <span className="module-review-box__label">内部关系</span>
                <strong>{counts.total} 条</strong>
                <div className="module-review-counts">
                  <span>AI 复核 {counts.ai}</span>
                  <span>人工 {counts.human}</span>
                  <span>待核实 {counts.unverified}</span>
                </div>
                <p>关系默认待核实；未绘制的连接不代表不存在。</p>
              </div>
            </div>
            {isReal ? (
              <div className="module-links">
                <div className="module-links__head">
                  <span>与哪些模块有已记录关系</span>
                  <em>{moduleEdges.length} 个方向</em>
                </div>
                {moduleEdges.length ? (
                  <ul>
                    {moduleEdges.map((edge) => {
                      const outgoing = edge.from === `module:${moduleId}`;
                      const otherId = (outgoing ? edge.to : edge.from).replace('module:', '');
                      const otherName = moduleNames.get(otherId as ModuleId) ?? otherId;
                      return (
                        <li key={edge.id}>
                          <button
                            type="button"
                            onClick={() => onOpenGraph({ initialEdgeId: edge.id })}
                          >
                            <span className="module-links__direction">
                              {outgoing ? '本模块 →' : '← 对方模块'}
                            </span>
                            <strong>{otherName}</strong>
                            <span className="module-links__count">{edge.count} 条</span>
                            <em>{edgeEvidenceSummary(edge)}</em>
                            <span className="module-links__action">
                              查看证据
                              <ArrowRight />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="module-panel__hint">
                    {moduleId === 'canvas'
                      ? 'Canvas 渲染没有主归属节点，当前快照没有以它为主模块的跨模块关系。它只作为分布式能力集合展示，不伪造模块边界。'
                      : '当前快照没有以本模块为主归属的跨模块关系。没有边不代表不存在依赖。'}
                  </p>
                )}
                <p className="module-links__note">
                  连线只表示标准数据集中有证据的静态关系
                  {moduleEdges.some((edge) => edge.unverifiedCount > 0)
                    ? '；带待核实的关系不会被标成已确认'
                    : ''}
                  。不表示运行时调用顺序。
                </p>
              </div>
            ) : null}
            {isReal ? (
              <div className="module-workspace-actions">
                <button
                  type="button"
                  className="module-explorer-link"
                  onClick={() => setExplorer({ moduleId })}
                >
                  <span>打开关系探索</span>
                  <ArrowRight />
                </button>
                <button
                  type="button"
                  className="module-explorer-link module-explorer-link--graph"
                  onClick={() => onOpenGraph({ initialModuleId: moduleId })}
                >
                  <span>打开架构投影</span>
                  <ArrowRight />
                </button>
              </div>
            ) : (
              <p className="module-panel__hint">导入本地 ATLAS 快照后可探索真实关系。</p>
            )}
            {isReal && hasFlow ? (
              <button
                type="button"
                className="module-flow-link"
                onClick={() => onOpenFlow(moduleId)}
              >
                <span>
                  <strong>模块协作示意</strong>
                  <em>AI 按已核对职责整理的概念步骤，不是运行时顺序</em>
                </span>
                <ArrowRight />
              </button>
            ) : null}
          </section>

          <section className="panel-section">
            <div className="panel-section__head">
              <span>03</span>
              <h3>包含哪些部分</h3>
              <em>{components.length ? `${components.length} 个代表对象` : '待导入'}</em>
            </div>
            {components.length ? (
              <ul className="module-components">
                {components.map((component) => {
                  const nodeId = componentNodeId(data.dataset, component.file, component.symbol);
                  return (
                    <li key={`${component.file}:${component.symbol}`}>
                      <button
                        type="button"
                        onClick={() => setExplorer({ moduleId, nodeId: nodeId ?? undefined })}
                        disabled={!nodeId}
                      >
                        <span className="module-component__main">
                          <strong>{component.name}</strong>
                          <span>{component.responsibility}</span>
                        </span>
                        <span className="module-component__meta">
                          <em>{reviewLabel(component.review)}</em>
                          <span className="module-component__more">查看关系</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="module-panel__hint">
                演示模式不提供源码组件；导入本地 ATLAS 快照后显示 3–5 个代表对象。
              </p>
            )}
          </section>

          <section className="panel-section">
            <div className="panel-section__head">
              <span>04</span>
              <h3>证据在哪里</h3>
              <em>{snapshot ? snapshot.commitShort : '演示'}</em>
            </div>
            {snapshot ? (
              <details className="module-evidence">
                <summary>展开仓库、提交 SHA、文件与符号</summary>
                <dl>
                  <div>
                    <dt>仓库</dt>
                    <dd>{snapshot.repository.name}</dd>
                  </div>
                  <div>
                    <dt>提交 SHA</dt>
                    <dd>
                      <code>{snapshot.commit}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>图谱生成</dt>
                    <dd>{snapshot.generatedAt ?? '未知'}</dd>
                  </div>
                </dl>
                <ul>
                  {evidenceRefs.map((ref) => (
                    <li key={ref.locator}>
                      <code>{ref.locator}</code>
                      <span>{ref.symbol ?? '源码位置'}</span>
                    </li>
                  ))}
                </ul>
                {components.length ? (
                  <ul className="module-evidence__components">
                    {components.map((component) => (
                      <li key={component.symbol}>
                        <code>{component.file}#L{component.line ?? '?'}</code>
                        <span>{component.symbol}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ) : (
              <p className="module-panel__hint">演示数据不包含仓库、提交或源码定位。</p>
            )}
          </section>

          <section className="panel-section">
            <div className="panel-section__head">
              <span>05</span>
              <h3>还缺少什么</h3>
              <em>未核实</em>
            </div>
            <ul className="module-gaps">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </section>

          <p className="panel-disclaimer">
            {snapshot
              ? '模块位置、中枢连接、星点与轨道仍是演示构图；跨模块连线只有在本地快照中确有证据时才会绘制。没有边不等于不存在调用，静态关系也不等于运行时顺序。'
              : '本页为 P0.1 演示内容，不代表真实代码依赖。导入本地 ATLAS 快照后查看真实模块详情。'}
          </p>
        </div>

        <footer className="voice-panel__footer">
          <button type="button" className="secondary-action" onClick={onBack}>
            <ArrowLeft />
            <span>返回上一级</span>
          </button>
          <button type="button" className="home-action" onClick={onHome}>
            <span>返回首页</span>
            <ArrowRight />
          </button>
        </footer>
      </aside>

      {explorer
        ? createPortal(
            <RelationExplorer
              dataset={data.dataset}
              initialModuleId={explorer.moduleId}
              initialNodeId={explorer.nodeId}
              onClose={() => setExplorer(null)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

export { evidenceLocator };
