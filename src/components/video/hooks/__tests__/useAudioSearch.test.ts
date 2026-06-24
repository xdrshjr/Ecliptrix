import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioSearch } from '../useAudioSearch';
import type { AudioSearchResponse } from '../../types';

const searchAudios = vi.fn();

vi.mock('../../services/audioSearchService', () => ({
  createAudioSearchService: () => ({
    searchAudios,
  }),
}));

const audioResponse: AudioSearchResponse = {
  success: true,
  message: 'ok',
  total_found: 1,
  query: 'ambient',
  audios: [
    {
      id: 2468,
      name: 'ambient bed',
      description: 'loop',
      username: 'sound-user',
      duration: 12,
      download_url: 'https://freesound.org/data/previews/2/2468.mp3',
      preview_url: 'https://freesound.org/data/previews/2/2468-preview.mp3',
      waveform_url: 'https://freesound.org/data/displays/2/2468.png',
      license: 'CC0',
      tags: ['ambient'],
      filesize: 12345,
      type: 'mp3',
      channels: 2,
      bitrate: 128000,
      samplerate: 44100,
    },
  ],
};

describe('useAudioSearch', () => {
  beforeEach(() => {
    searchAudios.mockReset();
    searchAudios.mockResolvedValue(audioResponse);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => ({ size: 5 }),
    } as Response);
  });

  it('adds Freesound audio as a remote material for durable cache ingest without browser-downloading it', async () => {
    const onAddMaterials = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useAudioSearch('task-1', onAddMaterials));

    act(() => {
      result.current.setSearchQuery('ambient');
    });
    await act(async () => {
      await result.current.handleSearch();
    });
    await waitFor(() => expect(result.current.searchResults).toHaveLength(1));

    act(() => {
      result.current.handleSearchResultSelect(0);
    });
    await act(async () => {
      await result.current.handleAddSelectedAudios();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(onAddMaterials).toHaveBeenCalledTimes(1);
    const [materials] = onAddMaterials.mock.calls[0];
    expect(materials).toHaveLength(1);
    expect(materials[0]).toEqual(
      expect.objectContaining({
        type: 'audio',
        url: 'https://freesound.org/data/previews/2/2468.mp3',
        serverUrl: 'https://freesound.org/data/previews/2/2468.mp3',
        size: 12345,
        metadata: expect.objectContaining({
          source: 'freesound',
          sourceId: '2468',
          originalUrl: 'https://freesound.org/data/previews/2/2468.mp3',
        }),
      }),
    );
    expect(materials[0].url).not.toMatch(/^blob:/);
  });
});
