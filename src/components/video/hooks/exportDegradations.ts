/**
 * exportDegradations — turn the backend's non-fatal composition degradations
 * (S7) into one readable notice.
 *
 * An export can finish while an image, the subtitles or an audio clip never
 * made it into the video. The status poll reports each of those as a
 * `degradation`; the same entry repeats on every poll, so they are merged by
 * kind + item ids, then summarised per kind with at most three names.
 *
 * Pure: no React, no notification side effects.
 */

import type { CompositionDegradation } from '@/lib/api/videoComposition';
import type { SupportedLocale, Translations } from '@/lib/i18n';

const MAX_LISTED_NAMES = 3;

type DegradationKind = CompositionDegradation['kind'];

/** Stable line order so the notice reads the same on every export. */
const KIND_ORDER: readonly DegradationKind[] = [
  'image_overlay',
  'subtitles',
  'audio_item',
  'embedded_audio',
];

function degradationKey(degradation: CompositionDegradation): string {
  return `${degradation.kind}:${(degradation.item_ids ?? []).join(',')}`;
}

/** Append `next` to `acc`, skipping entries already reported by an earlier poll. */
export function mergeDegradations(
  acc: readonly CompositionDegradation[],
  next: readonly CompositionDegradation[] | undefined,
): CompositionDegradation[] {
  const merged = [...acc];
  if (!next) return merged;
  const seen = new Set(acc.map(degradationKey));
  for (const degradation of next) {
    if (!degradation || typeof degradation.kind !== 'string') continue;
    const key = degradationKey(degradation);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(degradation);
  }
  return merged;
}

/** "a、b、c 等 2 个" / "a, b, c and 2 more". */
export function formatNameList(
  names: readonly string[],
  t: Translations,
  locale?: SupportedLocale,
): string {
  const separator = locale === 'zh-CN' ? '、' : ', ';
  const listed = names.slice(0, MAX_LISTED_NAMES).join(separator);
  const hidden = names.length - MAX_LISTED_NAMES;
  if (hidden <= 0) return listed;
  return `${listed} ${t.videoExport.moreItems.replace('{count}', String(hidden))}`;
}

function namesByKind(list: readonly CompositionDegradation[]): Map<DegradationKind, string[]> {
  const byKind = new Map<DegradationKind, string[]>();
  for (const degradation of list) {
    const names = byKind.get(degradation.kind) ?? [];
    const ids = degradation.item_ids ?? [];
    ids.forEach((id, index) => {
      const name = degradation.item_names?.[index] || id;
      if (!names.includes(name)) names.push(name);
    });
    byKind.set(degradation.kind, names);
  }
  return byKind;
}

function lineFor(
  kind: DegradationKind,
  names: readonly string[],
  t: Translations,
  locale?: SupportedLocale,
): string {
  // The backend reason is English ffmpeg/stderr text, so it goes to the logs
  // only; the notice names what is missing (RV-08).
  if (kind === 'subtitles') return t.videoExport.degradedSubtitles;
  const template = {
    image_overlay: t.videoExport.degradedImageOverlay,
    audio_item: t.videoExport.degradedAudioItem,
    embedded_audio: t.videoExport.degradedEmbeddedAudio,
  }[kind];
  return template.replace('{names}', formatNameList(names, t, locale));
}

/** One notice for everything that did not reach the video; null when nothing degraded. */
export function formatDegradationMessage(
  list: readonly CompositionDegradation[],
  t: Translations,
  locale?: SupportedLocale,
): string | null {
  if (list.length === 0) return null;
  const byKind = namesByKind(list);
  const lines = KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) =>
    lineFor(kind, byKind.get(kind) ?? [], t, locale),
  );
  if (lines.length === 0) return null;
  return [t.videoExport.degradedTitle, ...lines].join('\n');
}
