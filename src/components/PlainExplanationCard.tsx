import type { PlainExplanation } from '../architecture/plain';

interface PlainExplanationCardProps {
  explanation: PlainExplanation;
  /** 紧凑模式用于弹窗右侧栏，减少纵向占用。 */
  compact?: boolean;
  /** 是否在卡片内提供技术标识与源码证据折叠区。 */
  technical?: boolean;
  /** 外层已有标题时隐藏卡片标题，避免重复。 */
  titleless?: boolean;
}

/**
 * 面向普通用户的默认解释卡。
 * 只展示已收录的中文事实与关系摘要；原始符号、路径和完整证据留在
 * 各工作台的“技术信息 / 源码证据”折叠区。
 */
export function PlainExplanationCard({
  explanation,
  compact = false,
  technical = false,
  titleless = false,
}: PlainExplanationCardProps) {
  return (
    <section className={`plain-card ${compact ? 'plain-card--compact' : ''}`} aria-label="中文解释">
      <div className="plain-card__head">
        <div>
          <span className="plain-card__kicker">用中文理解</span>
          {titleless ? null : <h3>{explanation.title}</h3>}
        </div>
        <span className="plain-card__kind">
          {explanation.objectKind === 'module'
            ? '模块'
            : explanation.objectKind === 'file'
              ? '文件'
              : '组件'}
        </span>
      </div>

      {!explanation.verifiedChinese ? (
        <p className="plain-card__unverified">
          当前快照没有为这个对象收录经核对的中文说明；下面只展示已有数据，不自动生成职责。
        </p>
      ) : null}

      <dl className="plain-card__facts">
        <div>
          <dt>它负责什么</dt>
          <dd>{explanation.what}</dd>
        </div>
        <div>
          <dt>为什么需要它</dt>
          <dd>{explanation.why}</dd>
        </div>
        <div>
          <dt>和当前对象的关系</dt>
          <dd>{explanation.connectionSummary}</dd>
        </div>
      </dl>

      {explanation.connections.length ? (
        <>
          <ul className="plain-card__connections" aria-label="已记录的关系">
            {explanation.connections.slice(0, compact ? 3 : 5).map((connection) => (
              <li key={connection.key}>
                <span className="plain-card__direction">{connection.directionLabel}</span>
                <strong>{connection.counterpart}</strong>
                <span>{connection.relationLabel}</span>
                <em>{connection.count} 条 · {connection.evidenceLabel}</em>
              </li>
            ))}
          </ul>
          {explanation.connections.some((connection) => connection.counterpart === '未收录中文名的组件') ? (
            <p className="plain-card__hint">
              部分对象尚未收录经核对的中文名；展开“技术细节 / 源码证据”可查看原始符号与路径。
            </p>
          ) : null}
        </>
      ) : null}

      <div className="plain-card__uncertain">
        <strong>仍需确认</strong>
        <ul>
          {explanation.uncertain.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <p className="plain-card__review">
        解释审核：{explanation.reviewLabel}
        {explanation.reviewNote ? ` · ${explanation.reviewNote}` : ''}
      </p>

      {technical ? (
        <details className="plain-card__technical">
          <summary>技术标识与源码证据</summary>
          <dl>
            <div>
              <dt>对象 ID</dt>
              <dd><code>{explanation.technical.id}</code></dd>
            </div>
            <div>
              <dt>文件</dt>
              <dd>{explanation.technical.file ? <code>{explanation.technical.file}</code> : '不适用'}</dd>
            </div>
            <div>
              <dt>行号</dt>
              <dd>{explanation.technical.line ?? '未记录'}</dd>
            </div>
            <div>
              <dt>符号</dt>
              <dd>{explanation.technical.symbol ? <code>{explanation.technical.symbol}</code> : '不适用'}</dd>
            </div>
            <div>
              <dt>模块</dt>
              <dd>{explanation.technical.modules.join(' · ') || '未归属'}</dd>
            </div>
          </dl>
          {explanation.technical.evidence.length ? (
            <ul>
              {explanation.technical.evidence.map((evidence) => (
                <li key={evidence.locator}>
                  <code>{evidence.locator}</code>
                  <span>{evidence.symbol ?? '源码位置'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>当前对象没有可展开的源码定位。</p>
          )}
        </details>
      ) : null}
    </section>
  );
}
