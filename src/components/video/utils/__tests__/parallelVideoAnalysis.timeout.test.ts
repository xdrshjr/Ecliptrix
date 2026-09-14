import { describe, it, expect } from 'vitest';
import { batchAnalysisTimeoutMs } from '../parallelVideoAnalysis';

/** The /api/video/batch-analyze BFF route gives up after 600 s. */
const BFF_LIMIT_MS = 600_000;

describe('batchAnalysisTimeoutMs', () => {
  it('scales the batch timeout with the video count and stays under the BFF limit', () => {
    const timeouts = {
      oneQuick: batchAnalysisTimeoutMs(1, 'quick'),
      tenQuick: batchAnalysisTimeoutMs(10, 'quick'),
      tenProfessional: batchAnalysisTimeoutMs(10, 'professional'),
      hundredProfessional: batchAnalysisTimeoutMs(100, 'professional'),
    };

    expect({
      ...timeouts,
      underBffLimit: Object.values(timeouts).every((ms) => ms < BFF_LIMIT_MS),
    }).toEqual({
      oneQuick: 120_000,
      tenQuick: 210_000,
      tenProfessional: 510_000,
      hundredProfessional: 590_000,
      underBffLimit: true,
    });
  });
});
