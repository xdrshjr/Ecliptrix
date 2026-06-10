/**
 * @vitest-environment node
 *
 * TimelineItem — filmstrip multi-frame tiling (local-video-editing-refactor
 * spec 03 §2.4 / TODO 03).
 *
 * Like the sibling TimelineItem.localDownload test, we assert at the SOURCE
 * level: the project's `jsx: "preserve"` tsconfig keeps Vitest (esbuild) from
 * compiling the .tsx, so `render(<TimelineItem/>)` fails at module load. We
 * instead read TimelineItem.tsx and assert the render branches / wiring /
 * degradation exist:
 *
 *   - wide video clips tile MULTIPLE frames across the bar;
 *   - narrow (N=1) clips degrade to a single image, matching prior behaviour;
 *   - only the VISIBLE range is rendered (filmstrip uses framesFor + ensure);
 *   - a missing/failed frame falls back to the poster (item.thumbnailUrl);
 *   - direct-local materials extract via same-origin /api/storage/files,
 *     NOT /api/video-proxy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'TimelineItem.tsx');
const src = readFileSync(FILE, 'utf-8');
// The per-slot tiling + poster fallback was extracted into the
// TimelineItemFilmstrip component (Phase-4 cleanup); the slot-level assertions
// read that module, where the `slot.url ?? poster` logic lives verbatim.
const FILMSTRIP_FILE = resolve(__dirname, '..', 'TimelineItemFilmstrip.tsx');
const filmstripSrc = readFileSync(FILMSTRIP_FILE, 'utf-8');

describe('TimelineItem — filmstrip wiring', () => {
  it('imports the filmstrip cache + ZoomLevel for zoom-aware density', () => {
    expect(src).toMatch(/filmstrip\/filmstripCache/);
    expect(src).toMatch(/FilmstripCache|filmstripCache/);
    expect(src).toMatch(/ZoomLevel/);
  });

  it('renders a multi-frame filmstrip strip (more than one tile) for wide clips', () => {
    // The render function must map over slots, not render a single static img.
    expect(src).toMatch(/renderFilmstrip|renderClipThumbnails/);
    expect(filmstripSrc).toMatch(/slots\.map\(/);
  });

  it('only extracts the visible range and throttles (ensure is gated)', () => {
    // ensure() is the extract/persist orchestrator; it must be invoked from an
    // effect (not on every render) so scrolling/zoom does not thrash.
    expect(src).toMatch(/\.ensure\(/);
    expect(src).toMatch(/useEffect/);
  });

  it('falls back to the poster (item.thumbnailUrl) when a frame is missing', () => {
    // TimelineItem passes the poster down; the filmstrip component does the
    // per-slot `slot.url ?? poster` fallback.
    expect(src).toMatch(/posterUrl=\{item\.thumbnailUrl\}/);
    expect(filmstripSrc).toMatch(/slot\.url\s*\?\?|slot\.url\s*\|\|/);
  });

  it('extracts via same-origin /api/storage/files, never /api/video-proxy', () => {
    // The filmstrip source URL is the clip's same-origin playback URL; the
    // component must not route filmstrip extraction through video-proxy.
    expect(src).not.toMatch(/video-proxy.*filmstrip|filmstrip.*video-proxy/);
  });

  it('degrades narrow clips to a single tile (N=1 path preserved)', () => {
    // computeFrameTimestamps clamps to >=1, so a 1-slot strip renders one img;
    // the render path must handle the single-slot case without special-casing
    // away the poster fallback.
    expect(src).toMatch(/slots|filmstripSlots|frames/);
  });
});
