import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { flowViewsFor, type FlowStepView, type FlowTransitionView, type FlowView } from '../architecture/flows';
import {
  EVIDENCE_LABELS,
  EVIDENCE_ORDER,
  type EvidenceClass,
} from '../architecture/projection';
import { RELATION_TYPE_LABELS } from '../architecture/query';
import { reviewLabel, type AtlasDataset } from '../architecture/schema';
import { ArrowRight, CloseIcon } from './Icons';

interface FlowDialogProps {
  dataset: AtlasDataset;
  onClose: () => void;
  onOpenData: () => void;
}

type FlowSelection =
  | { kind: 'step'; id: string }
  | { kind: 'transition'; index: number }
  | null;

export function FlowDialog({ dataset, onClose, onOpenData }: FlowDialogProps) {
  const views = useMemo(() => flowViewsFor(dataset), [dataset]);
  const [viewId, setViewId] = useState<string | null>(views[0]?.scenario.id ?? null);
  const view = views.find((candidate) => candidate.scenario.id === viewId) ?? views[0] ?? null;
  const [selection, setSelection] = useState<FlowSelection>(
    view ? { kind: 'step', id: view.steps[0]?.step.id ?? '' } : null,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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

  if (!view) {
    return createPortal(
      <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
        <section
          className="flow-dialog flow-dialog--empty"
          role="dialog"
          aria-modal="true"
          aria-labelledby="flow-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="flow-dialog__head">
            <div>
              <span className="voice-panel__kicker">MODULE COLLABORATION · CONCEPTUAL</span>
              <h2 id="flow-title">模块协作示意</h2>
            </div>
            <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭模块协作示意">
              <CloseIcon />
            </button>
          </header>
          <div className="flow-empty">
            <strong>当前数据没有可用的模块协作示意</strong>
            <p>
              协作示意是本地附加的解释材料，不是运行时流程，也不会从关系图自动生成。导入包含协作场景的本地
              ATLAS 快照后，这里会显示每一步的源码来源和未覆盖的证据缺口。
            </p>
            <button type="button" className="graph-primary-action" onClick={onOpenData}>
              打开架构数据
            </button>
          </div>
        </section>
      </div>,
      document.body,
    );
  }

  const selectedStep =
    selection?.kind === 'step'
      ? view.steps.find((step) => step.step.id === selection.id) ?? view.steps[0] ?? null
      : null;
  const selectedTransition =
    selection?.kind === 'transition' ? view.transitions[selection.index] ?? null : null;

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="flow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flow-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flow-dialog__head">
          <div>
            <span className="voice-panel__kicker">
              MODULE COLLABORATION · {view.scenario.entryModuleId.toUpperCase()}
            </span>
            <h2 id="flow-title">模块协作示意</h2>
          </div>
          <div className="flow-dialog__head-right">
            <span className="source-flag source-flag--real">本地快照 · 概念解释</span>
            <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭模块协作示意">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="flow-summary">
          <div>
            <h3>{view.scenario.title}</h3>
            <p>{view.scenario.summary}</p>
          </div>
          <div className="flow-semantics" aria-label="语义分层">
            <div data-kind="concept">
              <strong>{view.semantics.conceptualStepCount}</strong>
              <span>AI 概念步骤</span>
              <em>按已核对职责整理</em>
            </div>
            <div data-kind="static">
              <strong>{view.semantics.staticLinkCount}</strong>
              <span>源码静态关联</span>
              <em>有图边，不代表顺序</em>
            </div>
            <div data-kind="runtime" data-verified={view.semantics.runtimeOrderVerified || undefined}>
              <strong>{view.semantics.runtimeLinkCount}</strong>
              <span>已验证运行时顺序</span>
              <em>{view.semantics.runtimeOrderVerified ? '有运行时证据' : '当前没有运行时证据'}</em>
            </div>
            <div data-kind="gap" data-gap={view.semantics.gapCount > 0 || undefined}>
              <strong>{view.semantics.gapCount}</strong>
              <span>缺少证据的衔接</span>
              <em>不补线、不猜测</em>
            </div>
          </div>
        </div>
        <p className="flow-semantics__note">
          这是<strong>模块协作示意</strong>，不是执行流程。步骤顺序由 AI 根据已核对的模块职责整理；
          相邻步骤之间只显示当前快照中确有记录的静态关系。{view.semantics.runtimeOrderNote}
          {view.unresolvedCount ? ` 另有 ${view.unresolvedCount} 个步骤在当前快照中找不到源码位置。` : ''}
        </p>

        {views.length > 1 ? (
          <div className="flow-tabs" role="tablist" aria-label="流程场景">
            {views.map((candidate) => (
              <button
                key={candidate.scenario.id}
                type="button"
                role="tab"
                aria-selected={candidate.scenario.id === view.scenario.id}
                className={candidate.scenario.id === view.scenario.id ? 'is-active' : undefined}
                onClick={() => {
                  setViewId(candidate.scenario.id);
                  setSelection(
                    candidate.steps[0] ? { kind: 'step', id: candidate.steps[0].step.id } : null,
                  );
                }}
              >
                {candidate.scenario.title}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flow-body">
          <div className="flow-timeline" aria-label="流程步骤">
            {view.steps.map((step, index) => (
              <div key={step.step.id} className="flow-timeline__item">
                <button
                  type="button"
                  className={`flow-step ${selection?.kind === 'step' && selection.id === step.step.id ? 'is-active' : ''}`}
                  onClick={() => setSelection({ kind: 'step', id: step.step.id })}
                >
                  <span className="flow-step__index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="flow-step__main">
                    <strong>{step.step.title}</strong>
                    <small>
                      {step.resolved ? '源码证据可展开 · 运行时顺序未验证' : '当前快照未找到源码位置'}
                    </small>
                  </span>
                  <span className={`flow-step__dot ${step.resolved ? '' : 'is-missing'}`} />
                </button>
                {index < view.transitions.length ? (
                  <TransitionButton
                    transition={view.transitions[index]}
                    active={selection?.kind === 'transition' && selection.index === index}
                    onClick={() => setSelection({ kind: 'transition', index })}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <aside className="flow-detail">
            <div className="flow-detail__scroll">
              {selectedTransition ? (
                <TransitionDetail transition={selectedTransition} view={view} />
              ) : selectedStep ? (
                <StepDetail step={selectedStep} view={view} />
              ) : (
                <p>选择一个步骤查看来源。</p>
              )}
            </div>
          </aside>
        </div>

        <footer className="flow-dialog__foot">
          <span>{view.scenario.disclaimer}</span>
          <span>{dataset.source.label}</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function TransitionButton({
  transition,
  active,
  onClick,
}: {
  transition: FlowTransitionView;
  active: boolean;
  onClick: () => void;
}) {
  const label =
    transition.kind === 'static-link'
      ? `静态关联 · ${transition.relations.length} 条`
      : transition.kind === 'gap'
        ? '缺少证据'
        : '源码位置缺失';
  return (
    <button
      type="button"
      className={`flow-transition flow-transition--${transition.status} ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <span className="flow-transition__line" />
      <span>{label}</span>
      <ArrowRight />
    </button>
  );
}

function StepDetail({ step, view }: { step: FlowStepView; view: FlowView }) {
  const relatedTransitions = view.transitions.filter(
    (transition) =>
      transition.fromStepId === step.step.id || transition.toStepId === step.step.id,
  );
  return (
    <section className="flow-detail__section">
      <span className="graph-detail__kicker">STEP · {step.step.moduleId.toUpperCase()}</span>
      <h3>{step.step.title}</h3>
      <div className="flow-detail__badges">
        <span className="flow-status flow-status--concept">
          {step.basis === 'runtime-evidence' ? '运行时证据步骤' : 'AI 概念步骤'}
        </span>
        <span className="flow-status flow-status--runtime">
          运行时顺序：未验证
        </span>
      </div>
      <p className="flow-detail__description">{step.step.description}</p>
      <div className="flow-detail__source">
        <div>
          <span>源码位置（技术）</span>
          <code>{step.evidenceLocator ?? '未找到'}</code>
        </div>
        <div>
          <span>节点</span>
          <strong>{step.node?.displayName ?? step.node?.symbol ?? '未解析'}</strong>
        </div>
        <div>
          <span>审核</span>
          <strong>{step.review ? reviewLabel(step.review) : '未记录'}</strong>
        </div>
      </div>
      <div className="flow-detail__note">
        <strong>为什么可以这样描述</strong>
        <p>{step.step.note}</p>
        <p className="flow-detail__caution">
          这句话说明的是源码中已核对的职责，不是这次运行实际发生的调用顺序。
        </p>
      </div>
      {step.node ? (
        <details className="graph-source" open>
          <summary>节点职责与源码证据</summary>
          <p>{step.node.responsibility ?? '当前节点没有中文职责说明。'}</p>
          <dl>
            <div>
              <dt>原始符号</dt>
              <dd><code>{step.node.symbol}</code></dd>
            </div>
            <div>
              <dt>归属模块</dt>
              <dd>{step.node.moduleIds.join(' · ')}</dd>
            </div>
          </dl>
          <ul>
            {step.node.evidence.map((evidence) => (
              <li key={evidence.locator}>
                <code>{evidence.locator}</code>
                <span>{evidence.symbol ?? '源码位置'}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <h4 className="flow-detail__subhead">这一步与相邻步骤</h4>
      <ul className="flow-step-links">
        {relatedTransitions.map((transition, index) => (
          <li key={`${transition.fromStepId}-${transition.toStepId}-${index}`}>
            <span className={`flow-status flow-status--${transition.status}`}>
              {transition.status === 'linked'
                ? '有静态关系'
                : transition.status === 'gap'
                  ? '图谱缺口'
                  : '位置缺失'}
            </span>
            <span>{transition.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TransitionDetail({
  transition,
  view,
}: {
  transition: FlowTransitionView;
  view: FlowView;
}) {
  const from = view.steps.find((step) => step.step.id === transition.fromStepId);
  const to = view.steps.find((step) => step.step.id === transition.toStepId);
  return (
    <section className="flow-detail__section">
      <span className="graph-detail__kicker">TRANSITION · STATIC EVIDENCE</span>
      <h3>
        {from?.step.title ?? '上一步'} <ArrowRight /> {to?.step.title ?? '下一步'}
      </h3>
      <div className="flow-detail__badges">
        <span className={`flow-status flow-status--${transition.status}`}>
          {transition.kind === 'static-link'
            ? '源码静态关联'
            : transition.kind === 'gap'
              ? '缺少证据'
              : '源码位置缺失'}
        </span>
        <span className="flow-status flow-status--runtime">
          运行时顺序：{transition.runtimeVerified ? '已有证据' : '未验证'}
        </span>
      </div>
      <p className="flow-detail__description">{transition.note}</p>
      {transition.status === 'linked' ? (
        <>
          <div className="graph-evidence-grid">
            {EVIDENCE_ORDER.filter((value) => (transition.evidenceCounts[value] ?? 0) > 0).map((value) => (
              <div key={value}>
                <strong>{transition.evidenceCounts[value]}</strong>
                <span>{EVIDENCE_LABELS[value as EvidenceClass]}</span>
              </div>
            ))}
          </div>
          <h4 className="flow-detail__subhead">底层关系</h4>
          <ul className="flow-relations">
            {transition.relations.slice(0, 8).map((relation) => (
              <li key={relation.id}>
                <div>
                  <strong>{RELATION_TYPE_LABELS[relation.type] ?? relation.type}</strong>
                  <span>{reviewLabel(relation.review)}</span>
                </div>
                <code>{relation.evidence?.locator ?? '源码定位缺失'}</code>
              </li>
            ))}
          </ul>
          {transition.relations.length > 8 ? (
            <p className="flow-detail__note">
              另有 {transition.relations.length - 8} 条关系未列出；这里只展示前 8 条证据样本。
            </p>
          ) : null}
        </>
      ) : (
        <div className={`flow-gap-note flow-gap-note--${transition.status}`}>
          <strong>
            {transition.status === 'gap'
              ? '这里是一个明确的图谱缺口'
              : '这一步在当前快照中没有可解析的源码节点'}
          </strong>
          <p>
            界面不会为缺口补一条线，也不会把这一步描述成已验证的运行时调用。
            如需确认，只能回到源码或补充新的架构快照。
          </p>
        </div>
      )}
    </section>
  );
}
