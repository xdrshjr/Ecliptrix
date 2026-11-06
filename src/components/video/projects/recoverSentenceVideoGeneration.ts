/** 项目重新载入时，本地逐句生成的回调与轮询已不再存在。 */
export function recoverSentenceVideoGeneration<T extends Record<string, unknown>>(saved: T): T {
  if (!Array.isArray(saved.scriptSegments)) return saved;
  let changed = false;
  const scriptSegments = saved.scriptSegments.map(segment => {
    if (!segment || !Array.isArray(segment.sentences)) return segment;
    let interrupted = false;
    const sentences = segment.sentences.map((sentence: unknown) => {
      if (!sentence || typeof sentence !== 'object' ||
          !('aiVideoStatus' in sentence) || sentence.aiVideoStatus !== 'generating') return sentence;
      interrupted = true;
      return { ...sentence, aiVideoStatus: 'failed' };
    });
    changed ||= interrupted;
    return interrupted ? { ...segment, sentences } : segment;
  });
  return changed ? { ...saved, scriptSegments } : saved;
}
