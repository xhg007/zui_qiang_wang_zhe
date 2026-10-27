import { describe, expect, it } from 'vitest';
import { EMOTION_ADVICE, EMOTION_LABELS } from './emotion';

describe('情绪策略表', () => {
  it('每个语气标签都有应对策略', () => {
    for (const label of EMOTION_LABELS) {
      expect(EMOTION_ADVICE[label]).toBeTruthy();
      expect(EMOTION_ADVICE[label].length).toBeGreaterThan(5);
    }
  });

  it('策略里不含禁用词（合规底线）', () => {
    const banned = ['傻', '蠢', '滚', '闭嘴', '垃圾'];
    for (const label of EMOTION_LABELS) {
      for (const word of banned) {
        expect(EMOTION_ADVICE[label]).not.toContain(word);
      }
    }
  });
});
