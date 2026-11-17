import { describe, expect, it } from 'vitest';
import { normaliseProjectDataForSave } from '@/lib/api/videoProjects';
import { hydrateTimelineFromProjectData } from '../hydrateTimeline';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { planEffectsTimelineChange } from '../../effects/effectsTimeline';
import type { VideoEditingTaskContent } from '@/types';
import { effectsFixture } from '../../effects/__tests__/effectsFixture';

describe('特效成品项目保存与重开', () => {
  it('metadata与全部本地播放身份经过保存/水合保持一致', () => {
    const plan = planEffectsTimelineChange(effectsFixture());
    const content = { materials: [plan.material],
      uiState: { currentTimelineState: plan.timeline } } as unknown as VideoEditingTaskContent;
    const persisted = JSON.parse(JSON.stringify(normaliseProjectDataForSave(content)));
    const result = hydrateTimelineFromProjectData(persisted);
    expect(result.status).toBe('loaded');
    const item = useTimelineStore.getState().exportToData().tracks[0].items[0];
    expect(item.metadata?.effects?.assetId).toBe('asset');
    expect(item.metadata?.localResolvedUrl).toBe(plan.material.url);
    expect(item.url).toBe(plan.material.url);
    expect(item.cacheUrl).toBe(plan.material.url);
    expect(item.clipEnd).toBe(3.37);
    expect(persisted.materials[0].metadata.effects.draftVersion).toBe(1);
  });
});
