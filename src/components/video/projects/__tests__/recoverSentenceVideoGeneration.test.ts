import { expect, it } from 'vitest';
import { recoverSentenceVideoGeneration } from '../recoverSentenceVideoGeneration';

it('重新打开项目后终止无本地任务的逐句生成状态，保留脚本、已生成素材和备份', () => {
  const saved = {
    timelineRecoveryBackup: { savedAt: '2026-11-05', timeline: { tracks: [] } },
    materials: [{ id: 'video', url: '/api/storage/files/video.mp4' }],
    scriptSegments: [{ id: 'segment', sentences: [
      { id: 'pending', text: '纸船', aiVideoStatus: 'generating', aiVideoPrompt: '水面的纸船' },
      { id: 'complete', aiVideoStatus: 'succeeded', linkedMaterialId: 'video' },
    ] }],
  };
  const restored = recoverSentenceVideoGeneration(saved);
  expect(restored.scriptSegments[0].sentences[0]).toEqual({
    ...saved.scriptSegments[0].sentences[0], aiVideoStatus: 'failed',
  });
  expect(restored.scriptSegments[0].sentences[1]).toBe(saved.scriptSegments[0].sentences[1]);
  expect(restored.materials).toBe(saved.materials);
  expect(restored.timelineRecoveryBackup).toBe(saved.timelineRecoveryBackup);
  expect(saved.scriptSegments[0].sentences[0].aiVideoStatus).toBe('generating');
});

it('没有中断生成的项目保持原引用', () => {
  const saved = { scriptSegments: [{ id: 's', sentences: [{ id: 'v', aiVideoStatus: 'succeeded' }] }] };
  expect(recoverSentenceVideoGeneration(saved)).toBe(saved);
  expect(recoverSentenceVideoGeneration({})).toEqual({});
});
