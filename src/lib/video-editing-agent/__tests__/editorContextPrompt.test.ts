import { describe, expect, it } from 'vitest';
import {
  appendEditorContext,
  formatEditorContextLine,
  readEditorContext,
} from '../editorContextPrompt';

const PROMPT = '## Current Project State\n- Total duration: 25.6s\n\n## User Request\nmake it brighter';
const ANCHOR = '- Total duration: 25.6s';

describe('editorContext in the agent prompt (T-AG-1)', () => {
  it('without editorContext the prompt is unchanged, character for character', () => {
    expect(appendEditorContext(PROMPT, readEditorContext(undefined), ANCHOR)).toBe(PROMPT);
  });

  it('a malformed field counts as absent', () => {
    expect([readEditorContext({ selectedSegmentId: '' }), readEditorContext('x')]).toEqual([null, null]);
  });

  it('with a selected segment the context follows the timeline state', () => {
    const context = readEditorContext({
      selectedSegmentId: 'seg-2', segmentLabel: '第 2 段「活泼天性」', segmentRange: { start: 8.5, end: 16.5 },
    });
    const prompt = appendEditorContext(PROMPT, context, ANCHOR);
    expect(prompt).toBe(`## Current Project State\n- Total duration: 25.6s\n- Editing context: ${
      formatEditorContextLine(context)}\n\n## User Request\nmake it brighter`);
  });

  it('the line names the segment and its range', () => {
    const line = formatEditorContextLine({
      selectedSegmentId: 'seg-2', segmentLabel: '第 2 段「活泼天性」', segmentRange: { start: 8.5, end: 16.5 },
    });
    expect(line).toBe('用户当前正在编辑第 2 段「活泼天性」（时间轴 8.5s–16.5s）。除非用户另有说明，涉及「这一段 / 本段」的指令都指该段。');
  });
});
