/**
 * waveformClient — same-origin client for the local waveform endpoints
 * (spec 04 — 本地音频波形).
 *
 * Wraps:
 *   POST /api/storage/waveform/generate  (idempotent trigger)
 *   GET  /api/storage/waveform/{id}      (fetch persisted peaks)
 *
 * The REST surface is snake_case (project convention); this module normalizes
 * the fetched payload to a camelCase document so the renderer + cache speak a
 * single shape (`peaksPerSecond`, `durationSec`, `peaks`) matching the
 * persisted on-disk JSON.
 */

import { http } from '@/lib/api/http-client';

export type WaveformStatus = 'ready' | 'pending' | 'missing' | 'failed';

/** Normalized (camelCase) waveform document the cache + renderer consume. */
export interface WaveformDoc {
  status: WaveformStatus;
  durationSec?: number;
  peaksPerSecond?: number;
  peaks: number[] | null;
  url?: string;
}

/** Result of a generation trigger. */
export interface WaveformGenerateResult {
  status: 'ready' | 'pending' | 'failed';
  url?: string;
}

interface RestWaveformDataResponse {
  status?: string;
  duration_sec?: number | null;
  peaks_per_second?: number | null;
  peaks?: number[] | null;
  url?: string | null;
}

interface RestWaveformGenerateResponse {
  status?: string;
  url?: string | null;
}

function normalizeStatus(raw: string | undefined): WaveformStatus {
  if (raw === 'ready' || raw === 'pending' || raw === 'failed') return raw;
  return 'missing';
}

/**
 * Fetch the persisted waveform for a material.
 *
 * @param materialId Material identifier (filename-safe on the backend).
 * @returns A normalized camelCase {@link WaveformDoc}. `status` is `'missing'`
 *   when no waveform has been generated yet.
 */
export async function fetchWaveform(materialId: string): Promise<WaveformDoc> {
  const res = await http.get<RestWaveformDataResponse>(
    `/api/storage/waveform/${encodeURIComponent(materialId)}`,
  );
  return {
    status: normalizeStatus(res?.status),
    durationSec: res?.duration_sec ?? undefined,
    peaksPerSecond: res?.peaks_per_second ?? undefined,
    peaks: res?.peaks ?? null,
    url: res?.url ?? undefined,
  };
}

/**
 * Trigger (idempotent) backend waveform generation for a material.
 *
 * @param materialId Material identifier.
 * @param audioUrl Same-origin `/api/storage/files/...` reference to the audio
 *   (or audio-bearing video) source.
 * @returns The generation result: `'ready'` when peaks already existed / were
 *   produced synchronously, `'pending'` when queued, `'failed'` on error.
 */
export async function requestWaveformGeneration(
  materialId: string,
  audioUrl: string,
): Promise<WaveformGenerateResult> {
  const res = await http.post<RestWaveformGenerateResponse>(
    '/api/storage/waveform/generate',
    { material_id: materialId, audio_url: audioUrl },
  );
  const status = res?.status;
  return {
    status:
      status === 'ready' || status === 'pending' || status === 'failed'
        ? status
        : 'failed',
    url: res?.url ?? undefined,
  };
}
