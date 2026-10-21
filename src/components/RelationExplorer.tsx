import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RELATION_FILTER,
  fileNodes,
  moduleFiles,
  nodeRelations,
  reviewCounts,
  searchModules,
  searchNodes,
  type RelationFilter,
  type ReviewGroup,
} from '../architecture/query';
import {
  REVIEW_LABELS,
  reviewLabel,
  type AtlasDataset,
  type AtlasModuleId,
  type AtlasNode,
} from '../architecture/schema';
import { CloseIcon } from './Icons';

interface RelationExplorerProps {
  dataset: AtlasDataset;
  initialModuleId: AtlasModuleId;
  initialNodeId?: string;
  onClose: () => void;
}

function shortFileName(file: string): string {
  return file.split('/').pop() ?? file;
}

function reviewGroupLabel(group: ReviewGroup): string {
  if (group === 'ai') return 'AI 源码复核';
  if (group === 'human') return '独立人工审核';
  if (group === 'unverified') return '待核实';
  return '全部';
}

export function RelationExplorer({
  dataset,
  initialModuleId,
  initialNodeId,
  onClose,
}: RelationExplorerProps) {
  const initialNode = initialNodeId ? dataset.nodes.find((node) => node.id === initialNodeId) : undefined;
  const [moduleId, setModuleId] = useState<AtlasModuleId>(
    initialNode?.moduleIds[0] ?? initialModuleId,
  );
  const [query, setQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(initialNode?.sourceFile ?? null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNode?.id ?? null);
  const [filter, setFilter] = useState<RelationFilter>(DEFAULT_RELATION_FILTER);
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

  const files = useMemo(() => moduleFiles(dataset, moduleId), [dataset, moduleId]);
  const symbols = useMemo(
    () => (selectedFile ? fileNodes(dataset, moduleId, selectedFile) : []),
    [dataset, moduleId, selectedFile],
  );
  const searchResults = useMemo(
    () => (query.trim() ? searchNodes(dataset, query, { moduleId, limit: 30 }) : []),
    [dataset, moduleId, query],
  );
  const matchedModuleIds = useMemo(() => (query.trim() ? searchModules(dataset, query) : []), [dataset, query]);
  const selectedNode = selectedNodeId ? dataset.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const allViews = useMemo(
    () => (selectedNode ? nodeRelations(dataset, selectedNode.id) : []),
    [dataset, selectedNode],
  );
  const views = useMemo(
    () => (selectedNode ? nodeRelations(dataset, selectedNode.id, filter) : []),
    [dataset, selectedNode, filter],
  );
  const counts = reviewCounts(allViews.map((view) => view.relation));
  const module = dataset.modules.find((item) => item.id === moduleId);

  const selectNode = (node: AtlasNode) => {
    setSelectedFile(node.sourceFile);
    setSelectedNodeId(node.id);
  };

  const selectModule = (next: AtlasModuleId) => {
    setModuleId(next);
    setSelectedFile(null);
    setSelectedNodeId(null);
    setQuery('');
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="explorer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="explorer-dialog__head">
          <div>
            <span className="voice-panel__kicker">RELATION EXPLORER</span>
            <h2 id="explorer-title">真实关系探索</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭关系探索">
            <CloseIcon />
          </button>
        </header>

        <div className="explorer-toolbar">
          <label>
            <span>模块</span>
            <select
              value={moduleId}
              onChange={(event) => selectModule(event.target.value as AtlasModuleId)}
            >
              {dataset.modules.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.index} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="explorer-search">
            <span>搜索</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedFile(null);
                setSelectedNodeId(null);
              }}
              placeholder="中文模块名、中文节点名、文件名或符号"
            />
          </label>
        </div>

        {matchedModuleIds.length ? (
          <div className="explorer-module-matches">
            <span>匹配模块</span>
            {matchedModuleIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  selectModule(id);
                  setQuery('');
                }}
              >
                {dataset.modules.find((item) => item.id === id)?.name ?? id}
              </button>
            ))}
          </div>
        ) : null}

        <div className="explorer-body">
          <div className="explorer-browser">
            <div className="explorer-breadcrumb">
              <button type="button" onClick={() => { setSelectedFile(null); setSelectedNodeId(null); }}>
                {module?.name ?? moduleId}
              </button>
              {selectedFile ? <span>/ {shortFileName(selectedFile)}</span> : null}
              {selectedNode ? <span>/ {selectedNode.displayName ?? selectedNode.symbol}</span> : null}
            </div>

            {selectedNode ? (
              <div className="explorer-node-summary">
                <strong>{selectedNode.displayName ?? selectedNode.symbol}</strong>
                <code>{selectedNode.symbol}</code>
                <span>{selectedNode.responsibility ?? '未收录中文职责说明。'}</span>
                <em>{reviewLabel(selectedNode.review)}</em>
                <button type="button" onClick={() => setSelectedNodeId(null)}>
                  返回文件对象
                </button>
              </div>
            ) : null}

            {query.trim() ? (
              <div className="explorer-list">
                <p className="explorer-list__title">
                  搜索结果 · {searchResults.length} 个节点（最多显示 30）
                </p>
                {searchResults.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`explorer-row ${node.id === selectedNodeId ? 'is-active' : ''}`}
                    onClick={() => selectNode(node)}
                  >
                    <strong>{node.displayName ?? node.symbol}</strong>
                    <span>{node.sourceFile ?? '外部引用'}</span>
                    <em>{node.moduleIds.map((id) => dataset.modules.find((item) => item.id === id)?.name ?? id).join(' · ')}</em>
                  </button>
                ))}
                {!searchResults.length ? (
                  <p className="explorer-empty">没有匹配的节点。未出现不等于不存在；可尝试原始符号名或文件名。</p>
                ) : null}
              </div>
            ) : selectedFile ? (
              <div className="explorer-list">
                <p className="explorer-list__title">
                  文件对象 · {symbols.length} 个符号
                </p>
                {symbols.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`explorer-row ${node.id === selectedNodeId ? 'is-active' : ''}`}
                    onClick={() => selectNode(node)}
                  >
                    <strong>{node.displayName ?? node.symbol}</strong>
                    <code>{node.symbol}</code>
                    <em>{reviewLabel(node.review)}</em>
                  </button>
                ))}
              </div>
            ) : (
              <div className="explorer-list">
                <p className="explorer-list__title">模块文件 · {files.length} 个文件</p>
                {files.map((file) => (
                  <button
                    key={file.file}
                    type="button"
                    className="explorer-row"
                    onClick={() => {
                      setSelectedFile(file.file);
                      setSelectedNodeId(null);
                    }}
                  >
                    <strong>{shortFileName(file.file)}</strong>
                    <span>{file.file}</span>
                    <em>
                      {file.nodeCount} 节点{file.supportingCount ? ` · ${file.supportingCount} 支撑` : ''}
                    </em>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="explorer-relations">
            {selectedNode ? (
              <>
                <div className="explorer-relations__head">
                  <div>
                    <span>关系</span>
                    <strong>{allViews.length} 条</strong>
                  </div>
                  <div className="explorer-relation-counts">
                    <span>AI {counts.ai}</span>
                    <span>人工 {counts.human}</span>
                    <span>待核实 {counts.unverified}</span>
                  </div>
                </div>

                <div className="explorer-filters">
                  <label>
                    <span>类型</span>
                    <select
                      value={filter.typeGroup}
                      onChange={(event) => setFilter({ ...filter, typeGroup: event.target.value as RelationFilter['typeGroup'] })}
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
                      onChange={(event) => setFilter({ ...filter, reviewGroup: event.target.value as ReviewGroup })}
                    >
                      {(['all', 'ai', 'human', 'unverified'] as ReviewGroup[]).map((group) => (
                        <option key={group} value={group}>
                          {reviewGroupLabel(group)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>证据</span>
                    <select
                      value={filter.evidenceType}
                      onChange={(event) => setFilter({ ...filter, evidenceType: event.target.value as RelationFilter['evidenceType'] })}
                    >
                      <option value="all">全部</option>
                      <option value="EXTRACTED">EXTRACTED</option>
                      <option value="INFERRED">INFERRED</option>
                      <option value="AMBIGUOUS">AMBIGUOUS</option>
                    </select>
                  </label>
                  <label>
                    <span>方向</span>
                    <select
                      value={filter.direction}
                      onChange={(event) => setFilter({ ...filter, direction: event.target.value as RelationFilter['direction'] })}
                    >
                      <option value="all">全部</option>
                      <option value="out">出</option>
                      <option value="in">入</option>
                    </select>
                  </label>
                </div>

                <p className="explorer-warning">
                  只显示数据集中确有证据的关系；未显示不代表不存在。画布中的模块连线仍为演示构图。
                </p>

                <ul className="explorer-relation-list">
                  {views.map(({ relation, direction, counterpart, typeLabel }) => (
                    <li key={relation.id}>
                      <div className="explorer-relation-main">
                        <span className="explorer-direction">{direction === 'out' ? '出 →' : '← 入'}</span>
                        <strong>{counterpart.displayName ?? counterpart.symbol}</strong>
                        <span className="explorer-type">{typeLabel}</span>
                        <span className={`explorer-review explorer-review--${relation.review.method}`}>
                          {reviewLabel(relation.review)}
                        </span>
                        <span className={`explorer-evidence explorer-evidence--${relation.evidenceType.toLowerCase()}`}>
                          {relation.evidenceType}
                        </span>
                      </div>
                      <div className="explorer-relation-meta">
                        <code>{relation.evidence?.locator ?? '源码定位缺失'}</code>
                        <span>{REVIEW_LABELS[relation.review.status]}</span>
                        {relation.confidence !== null ? <span>置信度 {relation.confidence}</span> : null}
                      </div>
                      <details>
                        <summary>查看证据与原始类型</summary>
                        <dl>
                          <div>
                            <dt>原始类型</dt>
                            <dd>{relation.sourceRelation}</dd>
                          </div>
                          <div>
                            <dt>上下文</dt>
                            <dd>{relation.context ?? '未记录'}</dd>
                          </div>
                          <div>
                            <dt>仓库 / 提交</dt>
                            <dd>
                              {relation.evidence
                                ? `${relation.evidence.repository} · ${relation.evidence.commit}`
                                : '证据缺失'}
                            </dd>
                          </div>
                          <div>
                            <dt>文件 / 行</dt>
                            <dd>
                              {relation.evidence
                                ? `${relation.evidence.file}#L${relation.evidence.line ?? '?'}`
                                : '证据缺失'}
                            </dd>
                          </div>
                          <div>
                            <dt>审核</dt>
                            <dd>
                              {reviewLabel(relation.review)} · {relation.review.actor ?? '主体未记录'} ·{' '}
                              {relation.review.reviewedAt ?? '时间未记录'}
                            </dd>
                          </div>
                        </dl>
                      </details>
                    </li>
                  ))}
                </ul>
                {!views.length ? (
                  <p className="explorer-empty">
                    当前筛选下没有关系。可放宽筛选，或到源码中核实未落边的调用。
                  </p>
                ) : null}
              </>
            ) : (
              <div className="explorer-placeholder">
                <strong>选择一个文件或符号</strong>
                <p>
                  按 模块 → 文件 → 符号 逐级查看关系。左侧搜索支持中文模块名、中文节点名、文件名和原始符号。
                </p>
                <p>关系数据与画布装饰轨道完全分离；这里不会绘制装饰性连线。</p>
              </div>
            )}
          </div>
        </div>

        <footer className="explorer-dialog__foot">
          <span>数据来自本地 ATLAS 快照，仅代表该历史提交。</span>
          <span>审核状态分为 Graphify 提取 / 推断 / AI 复核 / 人工 / 待核实</span>
        </footer>
      </section>
    </div>
  );
}
