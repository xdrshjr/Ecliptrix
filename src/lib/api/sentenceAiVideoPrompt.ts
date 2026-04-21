import { polishPrompt } from './promptPolish';
import { ScriptSegment, ScriptSentence } from '@/types';

const MAX_CONTEXT_CHARS = 4000;

export function buildFullScriptContext(segments: ScriptSegment[]): string {
  if (!segments || segments.length === 0) return '';
  const pieces: string[] = [];
  for (const seg of segments) {
    const title = (seg.title || '').trim();
    const narration = (seg.narrationText || '').trim();
    const fallback = narration
      ? ''
      : (seg.sentences || []).map(s => (s.text || '').trim()).filter(Boolean).join('');
    const body = narration || fallback;
    if (title || body) {
      pieces.push([title ? `【${title}】` : '', body].filter(Boolean).join(' '));
    }
  }
  let joined = pieces.join('\n');
  if (joined.length > MAX_CONTEXT_CHARS) {
    joined = joined.slice(0, MAX_CONTEXT_CHARS) + '…';
  }
  return joined;
}

export interface GenerateSentencePromptResult {
  success: boolean;
  prompt: string;
  message?: string;
}

export async function generateSentenceAiVideoPrompt(
  sentenceText: string,
  fullScript: string,
): Promise<GenerateSentencePromptResult> {
  const raw = (sentenceText || '').trim();
  if (!raw) {
    return { success: false, prompt: '', message: 'empty sentence' };
  }
  const res = await polishPrompt({
    prompt: raw,
    videoAnalysisContext: fullScript || undefined,
    targetType: 'ai-video',
  });
  if (res.success && res.polishedPrompt) {
    return { success: true, prompt: res.polishedPrompt, message: res.message };
  }
  return { success: false, prompt: '', message: res.message };
}

export function shouldAutoGeneratePrompt(sentence: ScriptSentence): boolean {
  if (!sentence || !(sentence.text || '').trim()) return false;
  if (sentence.aiVideoPromptStatus === 'generating') return false;
  if (sentence.aiVideoPromptManual && sentence.aiVideoPrompt) return false;
  if (sentence.aiVideoPromptStatus === 'succeeded' && sentence.aiVideoPrompt) return false;
  return true;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const size = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < size; i++) {
    runners.push((async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
  return results;
}
