import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COMPREHENSION_QUESTIONS,
  scoreComprehension,
  type ComprehensionScore,
} from '../architecture/comprehension';
import { CloseIcon } from './Icons';

interface ComprehensionDialogProps {
  onClose: () => void;
}

/**
 * 5 题理解检查。它只使用界面中已有的概念，不引用源码路径或内部符号。
 * 结果不是认证，也不改变任何架构数据。
 */
export function ComprehensionDialog({ onClose }: ComprehensionDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<ComprehensionScore | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const answeredCount = useMemo(
    () => COMPREHENSION_QUESTIONS.filter((question) => answers[question.id]).length,
    [answers],
  );
  const allAnswered = answeredCount === COMPREHENSION_QUESTIONS.length;

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

  const reset = () => {
    setAnswers({});
    setScore(null);
  };

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="quiz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quiz-dialog__head">
          <div>
            <span className="voice-panel__kicker">COMPREHENSION CHECK · 5 QUESTIONS</span>
            <h2 id="quiz-title">理解检查</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭理解检查">
            <CloseIcon />
          </button>
        </header>

        <p className="quiz-dialog__intro">
          用 5 个问题检查你是否能用自己的话解释 NEXUS 的模块、语音组件、动画调度、
          Canvas 边界和图谱连线。题目只使用界面中出现过的概念；这不是认证，也不改变任何数据。
        </p>

        <div className="quiz-dialog__scroll">
          {COMPREHENSION_QUESTIONS.map((question, index) => {
            const result = score?.results.find((item) => item.question.id === question.id);
            return (
              <fieldset
                key={question.id}
                className={`quiz-question ${result ? (result.correct ? 'is-correct' : 'is-wrong') : ''}`}
              >
                <legend>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {question.prompt}
                </legend>
                <div className="quiz-options">
                  {question.options.map((option) => (
                    <label key={option.id} className="quiz-option">
                      <input
                        type="radio"
                        name={question.id}
                        value={option.id}
                        checked={answers[question.id] === option.id}
                        disabled={score !== null}
                        onChange={() =>
                          setAnswers((current) => ({ ...current, [question.id]: option.id }))
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {result ? (
                  <div className="quiz-answer" role="status">
                    <strong>{result.correct ? '回答正确' : '需要回看'}</strong>
                    <p>{question.explanation}</p>
                    <span>在哪里可以核对：{question.evidenceHint}</span>
                  </div>
                ) : null}
              </fieldset>
            );
          })}
        </div>

        <footer className="quiz-dialog__foot">
          {score ? (
            <div className="quiz-score" role="status">
              <strong>
                {score.correct} / {score.total}
              </strong>
              <span>
                {score.correct === score.total
                  ? '你已能区分模块、组件、Canvas 边界与静态连接。'
                  : '回看标为“需要回看”的题目与对应界面，再试一次。'}
              </span>
            </div>
          ) : (
            <span className="quiz-progress">
              已答 {answeredCount} / {COMPREHENSION_QUESTIONS.length} 题
            </span>
          )}
          <div className="quiz-actions">
            {score ? (
              <button type="button" className="secondary-action" onClick={reset}>
                <span>重新作答</span>
              </button>
            ) : (
              <button
                type="button"
                className="graph-primary-action"
                disabled={!allAnswered}
                onClick={() => setScore(scoreComprehension(answers))}
              >
                查看结果
              </button>
            )}
            <button type="button" className="secondary-action" onClick={onClose}>
              <span>关闭</span>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
