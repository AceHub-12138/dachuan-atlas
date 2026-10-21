import { useEffect, useMemo, useRef } from 'react';
import { auditDatasetPrivacy } from '../architecture/privacy';
import { moduleReviewCounts } from '../architecture/query';
import { REVIEW_LABELS, reviewLabel } from '../architecture/schema';
import type { AtlasDataset } from '../architecture/schema';
import type { ArchitectureDataState } from '../hooks/useArchitectureData';
import { CloseIcon } from './Icons';

interface ArchitecturePanelProps {
  data: ArchitectureDataState;
  onClose: () => void;
}

const numberFormat = new Intl.NumberFormat('zh-CN');

function formatDate(value: string | null): string {
  if (!value) return '未知';
  return value.slice(0, 10);
}

function reviewClass(status: string): string {
  return `review-badge review-badge--${status.replace('_', '-')}`;
}

function SnapshotMeta({ dataset }: { dataset: AtlasDataset }) {
  const snapshot = dataset.snapshot;
  if (!snapshot) return null;
  return (
    <dl className="data-meta">
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
        <dd>{formatDate(snapshot.generatedAt)}</dd>
      </div>
      <div>
        <dt>导入时间</dt>
        <dd>{formatDate(snapshot.importedAt)}</dd>
      </div>
      <div>
        <dt>Graphify</dt>
        <dd>
          {snapshot.graphifyVersion} / schema {snapshot.graphifySchemaVersion}
        </dd>
      </div>
      <div>
        <dt>ATLAS Schema</dt>
        <dd>
          {snapshot.atlasSchemaVersion}
          {dataset.schemaMigratedFrom ? `（由 ${dataset.schemaMigratedFrom} 迁移）` : ''}
        </dd>
      </div>
      <div>
        <dt>清单校验</dt>
        <dd>
          {snapshot.manifest?.status === 'verified'
            ? `${snapshot.manifest.verifiedFiles}/${snapshot.manifest.fileCount}`
            : '未完成'}
        </dd>
      </div>
      <div>
        <dt>导入状态</dt>
        <dd>{snapshot.importStatus === 'complete' ? '完整' : '部分'}</dd>
      </div>
    </dl>
  );
}

export function ArchitecturePanel({ data, onClose }: ArchitecturePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { dataset } = data;
  const snapshot = dataset.snapshot;
  const counts = dataset.diagnostics.counts;
  const reviews = dataset.diagnostics.reviewCounts;
  const privacy = useMemo(() => auditDatasetPrivacy(dataset), [dataset]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const openImport = () => fileInputRef.current?.click();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('atlas:request-import', openImport);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('atlas:request-import', openImport);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const openSnapshot = () => {
    if (data.source === 'nexus-snapshot' || !data.isFileImport) {
      data.requestImport();
      return;
    }
    data.setSource('nexus-snapshot');
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="data-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="data-dialog__head">
          <div>
            <span className="voice-panel__kicker">P1.1 · LOCAL DATA</span>
            <h2 id="data-dialog-title">架构数据</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭架构数据">
            <CloseIcon />
          </button>
        </header>

        <div className="data-dialog__scroll">
          <div className="source-switch" role="tablist" aria-label="数据来源">
            <button
              type="button"
              role="tab"
              aria-selected={data.source === 'demo'}
              className={data.source === 'demo' ? 'is-active' : undefined}
              onClick={() => data.setSource('demo')}
            >
              <span>演示数据</span>
              <small>随前端发布 · 模拟</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={data.source === 'nexus-snapshot'}
              className={data.source === 'nexus-snapshot' ? 'is-active' : undefined}
              onClick={openSnapshot}
            >
              <span>本地历史快照</span>
              <small>{data.isFileImport ? '已导入 · 仅本地' : '导入 .atlas.json'}</small>
            </button>
          </div>

          {data.status === 'loading' ? (
            <div className="data-status" role="status">
              <span className="status-dot" />
              正在读取本地文件…
            </div>
          ) : null}

          {data.error ? (
            <div className="data-error" role="alert">
              <strong>数据读取失败</strong>
              <p>{data.error}</p>
              <button type="button" className="secondary-action" onClick={data.requestImport}>
                <span>重新选择本地文件</span>
              </button>
            </div>
          ) : null}

          <div className="data-summary">
            <div>
              <span className="data-summary__kicker">当前来源</span>
              <h3>{dataset.source.label}</h3>
              <p>{dataset.source.detail}</p>
            </div>
            <span className={snapshot ? 'source-flag source-flag--real' : 'source-flag'}>
              {snapshot ? '本地导入 · 非实时' : '演示模拟'}
            </span>
          </div>

          {snapshot ? (
            <>
              <SnapshotMeta dataset={dataset} />
              <div className="data-counts">
                <div>
                  <strong>{numberFormat.format(snapshot.stats.nodes)}</strong>
                  <span>节点</span>
                </div>
                <div>
                  <strong>{numberFormat.format(snapshot.stats.relations)}</strong>
                  <span>关系记录</span>
                </div>
                <div>
                  <strong>{numberFormat.format(snapshot.stats.uniqueRelationPairs)}</strong>
                  <span>唯一节点对</span>
                </div>
                <div>
                  <strong>{numberFormat.format(reviews.aiReviewed)}</strong>
                  <span>AI 源码复核</span>
                </div>
                <div>
                  <strong>{numberFormat.format(reviews.humanReviewed)}</strong>
                  <span>独立人工审核</span>
                </div>
                <div>
                  <strong>{numberFormat.format(reviews.graphifyExtractedUnverified)}</strong>
                  <span>直接提取 · 待核实</span>
                </div>
                <div>
                  <strong>{numberFormat.format(reviews.graphifyInferredUnverified)}</strong>
                  <span>推断 · 待核实</span>
                </div>
                <div>
                  <strong>{numberFormat.format(dataset.nodes.filter((node) => node.displayName).length)}</strong>
                  <span>中文注释节点</span>
                </div>
              </div>
            </>
          ) : (
            <div className="data-counts data-counts--demo">
              <div>
                <strong>{numberFormat.format(counts.nodes)}</strong>
                <span>演示节点</span>
              </div>
              <div>
                <strong>{numberFormat.format(counts.relations)}</strong>
                <span>模拟关系</span>
              </div>
              <div>
                <strong>0</strong>
                <span>源码证据</span>
              </div>
              <div>
                <strong>0</strong>
                <span>AI / 人工审核</span>
              </div>
            </div>
          )}

          <section className="data-section" aria-labelledby="data-security-title">
            <div className="data-section__head">
              <h3 id="data-security-title">安全边界</h3>
              <span>真实数据不进入默认构建</span>
            </div>
            <div className="data-security">
              <p>
                生产构建只包含演示数据。真实 NEXUS 快照存放在项目外的 <code>local-data/</code>，必须由你在本页明确选择
                <code>.atlas.json</code> 才会进入内存；文件不会上传，也不会写入调试日志。
              </p>
              <ul>
                <li>默认构建：不含真实节点、关系或源码定位。</li>
                <li>Graphify 原始图：先在本地运行 <code>npm run import:graphify</code> 转换，再导入结果。</li>
                <li>导出文件仍含内部符号名与仓库相对路径，不要公开上传。</li>
              </ul>
              <div className="data-privacy" data-status={privacy.status}>
                <strong>隐私体检：{privacy.status === 'pass' ? '通过' : privacy.status === 'warn' ? '提示' : '失败'}</strong>
                <span>
                  绝对路径 {privacy.absolutePathCount} · 凭据字段 {privacy.credentialFieldCount} · 内部符号{' '}
                  {privacy.internalSymbolCount}
                </span>
                {privacy.findings.slice(0, 4).map((finding) => (
                  <p key={`${finding.code}-${finding.field}`}>{finding.message}</p>
                ))}
              </div>
            </div>
          </section>

          <section className="data-section" aria-labelledby="data-modules-title">
            <div className="data-section__head">
              <h3 id="data-modules-title">模块映射</h3>
              <span>{snapshot ? '组成与关系分开审核' : '演示模块'}</span>
            </div>
            <div className="data-modules">
              {dataset.modules.map((module) => {
                const moduleReviews = moduleReviewCounts(dataset, module.id);
                return (
                  <article key={module.id} className="data-module" data-review={module.review}>
                    <header>
                      <span className="data-module__index">{module.index}</span>
                      <div>
                        <h4>{module.name}</h4>
                        <small>{module.latin}</small>
                      </div>
                      <span className={reviewClass(module.review)}>{module.reviewRecord ? `${reviewLabel(module.reviewRecord)} · ${REVIEW_LABELS[module.review]}` : REVIEW_LABELS[module.review]}</span>
                    </header>
                    <p className="data-module__summary">{module.summary}</p>
                    {snapshot ? (
                      <>
                        <div className="data-module__stats">
                          <span>
                            <strong>{module.stats.productNodes}</strong>主节点
                          </span>
                          <span>
                            <strong>{module.stats.supportingNodes}</strong>支撑
                          </span>
                          <span>
                            <strong>{module.keyComponents.length}</strong>代表对象
                          </span>
                        </div>
                        <div className="data-module__review">
                          <span>组成：{module.reviewRecord ? reviewLabel(module.reviewRecord) : '未记录'}</span>
                          <span>
                            关系：AI {moduleReviews.ai} · 人工 {moduleReviews.human} · 待核实 {moduleReviews.unverified}
                          </span>
                        </div>
                      </>
                    ) : null}
                    <ul className="data-module__notes">
                      {module.gaps.slice(0, 2).map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="data-section" aria-labelledby="data-quality-title">
            <div className="data-section__head">
              <h3 id="data-quality-title">可信度与遗漏</h3>
              <span>未出现连线 ≠ 不存在调用</span>
            </div>
            <div className="data-quality">
              {snapshot ? (
                <dl className="data-review-provenance">
                  <div>
                    <dt>AI 源码复核</dt>
                    <dd>{numberFormat.format(reviews.aiReviewed)}</dd>
                  </div>
                  <div>
                    <dt>独立人工审核</dt>
                    <dd>{numberFormat.format(reviews.humanReviewed)}</dd>
                  </div>
                  <div>
                    <dt>Graphify 直接提取 · 待核实</dt>
                    <dd>{numberFormat.format(reviews.graphifyExtractedUnverified)}</dd>
                  </div>
                  <div>
                    <dt>Graphify 推断 · 待核实</dt>
                    <dd>{numberFormat.format(reviews.graphifyInferredUnverified)}</dd>
                  </div>
                </dl>
              ) : null}
              <ul className="data-coverage">
                {dataset.diagnostics.coverageNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <div className="data-issues">
                {dataset.diagnostics.issues.map((issue) => (
                  <p key={issue.code} data-severity={issue.severity}>
                    <span>{issue.severity === 'warning' ? '提示' : '说明'}</span>
                    {issue.message}
                  </p>
                ))}
              </div>
              {dataset.diagnostics.unresolvedCallsByReceiver.length ? (
                <div className="data-unresolved">
                  <h4>未被 Graphify 落成边的调用（按接收者类型）</h4>
                  <p>
                    共 {counts.unresolvedCalls} 次，分布在 {counts.nodesWithUnresolvedCalls} 个节点。
                  </p>
                  <ul>
                    {dataset.diagnostics.unresolvedCallsByReceiver.slice(0, 6).map((entry) => (
                      <li key={entry.receiver}>
                        <code>{entry.receiver}</code>
                        <span>{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <section className="data-section" aria-labelledby="data-io-title">
            <div className="data-section__head">
              <h3 id="data-io-title">导入 / 导出</h3>
              <span>全部在本地完成</span>
            </div>
            <div className="data-actions">
              <label className="data-file">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    event.target.value = '';
                    if (files.length) void data.importFiles(files);
                  }}
                />
                <span>选择本地 ATLAS 文件</span>
              </label>
              <button type="button" className="secondary-action" onClick={data.exportDataset}>
                <span>导出当前标准数据</span>
              </button>
            </div>
            <p className="data-actions__note">
              导入单个由本地 CLI 生成的 <code>.atlas.json</code>。浏览器不会读取 graph.json，也不会上传文件。导出的数据包含内部符号名与相对路径，请勿公开上传。
            </p>
            {data.importNotice ? (
              <p className="data-notice data-notice--import" role="status">
                {data.importNotice}
              </p>
            ) : null}
            {data.exportNotice ? (
              <p className="data-notice data-notice--export" role="status">
                {data.exportNotice}
              </p>
            ) : null}
          </section>

          <p className="data-dialog__disclaimer">
            画布中的系统与模块空间关系仍是 P0.1 演示构图。真实数据只在本地导入后进入详情和关系探索，不会把所有源码节点绘制到首页。
          </p>
        </div>
      </section>
    </div>
  );
}
