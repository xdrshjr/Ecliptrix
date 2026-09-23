/**
 * editorContextPrompt — tells the agent which segment the user is editing
 * (spec R2 §3.12), so "this segment" in a request means that segment.
 *
 * Without a context the prompt is returned unchanged, character for
 * character (T-AG-1): old clients and requests without a selected segment
 * behave exactly as before.
 */

export interface EditorContextPayload {
  selectedSegmentId: string | null;
  segmentLabel: string | null;
  segmentRange: { start: number; end: number } | null;
}

/** Validate the untrusted request field; anything malformed counts as absent. */
export function readEditorContext(raw: unknown): EditorContextPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<EditorContextPayload>;
  if (typeof value.selectedSegmentId !== 'string' || value.selectedSegmentId === '') return null;
  const range = value.segmentRange;
  const validRange = range && Number.isFinite(range.start) && Number.isFinite(range.end)
    ? { start: range.start, end: range.end } : null;
  return {
    selectedSegmentId: value.selectedSegmentId,
    segmentLabel: typeof value.segmentLabel === 'string' ? value.segmentLabel.slice(0, 120) : null,
    segmentRange: validRange,
  };
}

/** The context paragraph, or '' when there is nothing to say. */
export function formatEditorContextLine(context: EditorContextPayload | null): string {
  if (!context) return '';
  const label = context.segmentLabel ?? `段落 ${context.selectedSegmentId}`;
  const range = context.segmentRange
    ? `（时间轴 ${context.segmentRange.start.toFixed(1)}s–${context.segmentRange.end.toFixed(1)}s）`
    : '';
  return `用户当前正在编辑${label}${range}。除非用户另有说明，涉及「这一段 / 本段」的指令都指该段。`;
}

/** Insert the paragraph right after the timeline state block of a prompt. */
export function appendEditorContext(
  prompt: string,
  context: EditorContextPayload | null,
  anchor: string,
): string {
  const line = formatEditorContextLine(context);
  if (!line) return prompt;
  const at = prompt.indexOf(anchor);
  if (at < 0) return `${prompt}\n\n${line}`;
  const insertAt = at + anchor.length;
  return `${prompt.slice(0, insertAt)}\n- Editing context: ${line}${prompt.slice(insertAt)}`;
}
