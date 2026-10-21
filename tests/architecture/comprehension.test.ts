import { describe, expect, it } from 'vitest';
import {
  COMPREHENSION_QUESTIONS,
  COMPREHENSION_QUESTION_COUNT,
  scoreComprehension,
} from '../../src/architecture/comprehension';

describe('普通用户理解检查', () => {
  it('包含 5 道题，题目与选项 ID 唯一', () => {
    expect(COMPREHENSION_QUESTION_COUNT).toBe(5);
    expect(new Set(COMPREHENSION_QUESTIONS.map((question) => question.id)).size).toBe(5);
    for (const question of COMPREHENSION_QUESTIONS) {
      expect(question.options.length).toBeGreaterThanOrEqual(3);
      expect(new Set(question.options.map((option) => option.id)).size).toBe(question.options.length);
      expect(question.options.some((option) => option.id === question.answerId)).toBe(true);
      expect(question.explanation.length).toBeGreaterThan(20);
      expect(question.evidenceHint.length).toBeGreaterThan(5);
    }
  });

  it('覆盖任务要求的五个理解点', () => {
    const text = JSON.stringify(COMPREHENSION_QUESTIONS);
    expect(text).toContain('NEXUS 主要由哪些功能领域组成');
    expect(text).toContain('语音交互中有哪些主要组件');
    expect(text).toContain('动画调度器负责什么');
    expect(text).toContain('Canvas 为什么不是一个独立业务子系统');
    expect(text).toContain('图谱中的一条连接到底表示什么');
  });

  it('满分与零分计分正确', () => {
    const allCorrect = Object.fromEntries(
      COMPREHENSION_QUESTIONS.map((question) => [question.id, question.answerId]),
    );
    expect(scoreComprehension(allCorrect)).toMatchObject({ total: 5, correct: 5 });
    const allWrong = Object.fromEntries(
      COMPREHENSION_QUESTIONS.map((question) => [
        question.id,
        question.options.find((option) => option.id !== question.answerId)!.id,
      ]),
    );
    expect(scoreComprehension(allWrong)).toMatchObject({ total: 5, correct: 0 });
    expect(scoreComprehension({}).correct).toBe(0);
  });

  it('题目不包含源码路径或内部符号', () => {
    const text = JSON.stringify(COMPREHENSION_QUESTIONS);
    for (const needle of [
      'src/lib/voice/',
      'services/voice-orchestrator/',
      'VoiceMicrophone',
      'PcmPlayer',
      'JarvisCore',
      '/Users/',
    ]) {
      expect(text).not.toContain(needle);
    }
  });
});
