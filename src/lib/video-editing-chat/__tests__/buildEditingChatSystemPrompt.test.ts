import { describe, it, expect } from 'vitest';
import { buildEditingChatSystemPrompt } from '../buildEditingChatSystemPrompt';

describe('buildEditingChatSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildEditingChatSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('mentions all six core responsibilities', () => {
    const prompt = buildEditingChatSystemPrompt();
    // Spec §2.6 — six buckets.
    expect(prompt).toContain('脚本编写与优化');
    expect(prompt).toContain('创意建议');
    expect(prompt).toContain('技术指导');
    expect(prompt).toContain('素材推荐');
    expect(prompt).toContain('时间轴规划');
    expect(prompt).toContain('文案润色');
  });

  it('stays well under the 4000-char budget for the lightweight chat path', () => {
    const prompt = buildEditingChatSystemPrompt();
    expect(prompt.length).toBeLessThan(4000);
  });
});
